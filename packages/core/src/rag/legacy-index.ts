/**
 * 旧 Swift `book-index.sqlite` 检索适配（只读）：复用旧 App 已准备的
 * fragments / fragment_terms(FTS5) / embeddings(384d float32 BLOB)，查询用当前
 * ONNX EmbeddingProvider 现算；对外提供 Agent 需要的 BookSource。
 *
 * 为什么复用旧索引：旧 App 在设备上已对真实书分章节/分 fragment、做了 FTS 与向量
 * （MiniLM，同一模型）。在手机端重新跑 1000+ fragments 的 ONNX 代价高，旧索引是
 * 迁移后可用的直接数据源。旧 locator 原样透传给 UI（数据层可 JSON.parse）。
 *
 * 旧库 schema（Read-only）：
 *   chapters(book_id, ordinal, href, title)
 *   fragments(id, book_id, chapter, ordinal, original, locator)
 *   fragment_terms(FTS5: book_id UNINDEXED, terms)
 *   embeddings(book_id, model, fragment_id, piece, offset, original, vector BLOB 1536)
 */
import type { BookSource, BookExcerpt, BookPassage } from '../agent/book-source.js';
import type { BookIdentity } from '../domain/types.js';
import { assertNotAborted, type CancellationSignal, type EmbeddingProvider } from './types.js';
import type { SQLiteDriver, SQLiteValue } from '../db/driver.js';

type Row = Record<string, SQLiteValue>;

export interface LegacySearchOptions {
  /** 向量候选上限；默认 200。 */
  vectorCandidateLimit?: number;
  /** RRF 常数，默认 60。 */
  rrfK?: number;
  onVectorError?: (error: unknown) => void | Promise<void>;
}

export interface LegacySearchHit {
  readonly fragmentId: number;
  readonly chapter: string;
  readonly chapterOrdinal: number;
  readonly page?: number;
  readonly quote: string;
  /** 旧 Readium locator JSON 原文（原样透传；数据层可 JSON.parse）。 */
  readonly locator: string;
  readonly score: number;
  readonly sources: ReadonlyArray<'fts' | 'vector'>;
}

/** 旧 App 的 FTS term 规则：中文/英文按 Unicode scalar 做 uni/bigram，查询多字时只用 bigram + AND。 */
export function legacyFtsTerms(text: string, query = false): string {
  const chars = [...text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()].map((char) =>
    (char.codePointAt(0) ?? 0).toString(16),
  );
  const unigrams = chars.map((hex) => `u${hex}`);
  const bigrams: string[] = [];
  for (let index = 0; index + 1 < chars.length; index += 1) {
    bigrams.push(`b${chars[index]}x${chars[index + 1]}`);
  }
  const values = [...new Set(query && chars.length > 1 ? bigrams : [...unigrams, ...bigrams])].sort();
  return values.join(query ? ' AND ' : ' ');
}

function text(value: SQLiteValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function numberOf(value: SQLiteValue | undefined): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function optionalPage(locatorJson: string): number | undefined {
  try {
    const parsed: unknown = JSON.parse(locatorJson);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const record = parsed as Record<string, unknown>;
    const locations = typeof record.locations === 'object' && record.locations !== null
      ? (record.locations as Record<string, unknown>)
      : undefined;
    const explicit = locations?.page;
    if (typeof explicit === 'number' && Number.isInteger(explicit) && explicit >= 1) return explicit;
    const fragments = locations?.fragments;
    if (Array.isArray(fragments)) {
      for (const fragment of fragments) {
        if (typeof fragment !== 'string') continue;
        const match = /^page=(\d+)$/.exec(fragment);
        if (match?.[1]) return Number(match[1]);
      }
    }
    if (typeof record.href === 'string') {
      const match = /^pdf:\/\/page\/(\d+)/.exec(record.href);
      if (match?.[1]) return Number(match[1]);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

interface FragmentMeta {
  readonly fragmentId: number;
  readonly chapterOrdinal: number;
  readonly chapterTitle: string;
  readonly href: string;
  readonly original: string;
  readonly locator: string;
  readonly page?: number;
}

function toMeta(row: Row): FragmentMeta {
  const locator = text(row.locator);
  const page = optionalPage(locator);
  return {
    fragmentId: numberOf(row.id),
    chapterOrdinal: numberOf(row.chapter),
    chapterTitle: text(row.chapter_title),
    href: text(row.href),
    original: text(row.original),
    locator,
    ...(page !== undefined ? { page } : {}),
  };
}

/** 旧索引检索器（只读，永不写旧库）。 */
export class LegacyIndexSearch {
  private readonly driver: SQLiteDriver;
  /** null = 语义模型未安装：降级为纯 FTS（仍可引用原文，UI 应提示）。 */
  private readonly embedding: EmbeddingProvider | null;
  private readonly vectorCandidateLimit: number;
  private readonly rrfK: number;
  private readonly onVectorError: LegacySearchOptions['onVectorError'];

  constructor(driver: SQLiteDriver, embedding: EmbeddingProvider | null, options: LegacySearchOptions = {}) {
    this.driver = driver;
    this.embedding = embedding;
    this.vectorCandidateLimit = options.vectorCandidateLimit ?? 200;
    this.rrfK = options.rrfK ?? 60;
    this.onVectorError = options.onVectorError;
  }

  /** 是否有该书的索引（迁移/可用性检查）。 */
  async hasBook(bookId: string): Promise<boolean> {
    const rows = await this.driver.all<Row>('SELECT count(*) AS n FROM fragments WHERE book_id = ? LIMIT 1', [bookId]);
    return numberOf(rows[0]?.n) > 0;
  }

  async searchBook(
    bookId: string,
    query: string,
    limit = 5,
    signal?: CancellationSignal,
  ): Promise<LegacySearchHit[]> {
    assertNotAborted(signal);
    const trimmed = query.trim();
    if (!trimmed) return [];
    const topK = Math.max(1, Math.min(8, limit));
    const candidateLimit = Math.max(topK * 4, 20);

    const ftsIds: number[] = [];
    const expression = legacyFtsTerms(trimmed, true);
    if (expression) {
      const rows = await this.driver.all<Row>(
        `SELECT f.id AS id, f.chapter AS chapter, f.ordinal AS ordinal, f.original AS original, f.locator AS locator,
                c.title AS chapter_title, c.href AS href
         FROM fragment_terms t JOIN fragments f ON f.id = t.rowid
         LEFT JOIN chapters c ON c.book_id = f.book_id AND c.ordinal = f.chapter
         WHERE fragment_terms MATCH ? AND t.book_id = ?
         ORDER BY bm25(fragment_terms) LIMIT ?`,
        [expression, bookId, candidateLimit],
      );
      for (const row of rows) ftsIds.push(numberOf(row.id));
    }
    assertNotAborted(signal);

    let queryVector: Float32Array | undefined;
    if (this.embedding) {
      try { [queryVector] = await this.embedding.embed([trimmed], signal ? { signal } : {}); }
      catch (error) {
        assertNotAborted(signal);
        if (!this.onVectorError) throw error;
        await this.onVectorError(error);
      }
    }
    assertNotAborted(signal);
    const vectorRows = queryVector
      ? await this.driver.all<Row>(
      `SELECT e.fragment_id AS id, e.fragment_id AS fragment_id, e.piece AS piece, e.original AS original,
              e.vector AS vector, f.chapter AS chapter, f.ordinal AS ordinal, f.locator AS locator,
              c.title AS chapter_title, c.href AS href
       FROM embeddings e JOIN fragments f ON f.id = e.fragment_id
       LEFT JOIN chapters c ON c.book_id = f.book_id AND c.ordinal = f.chapter
       WHERE e.book_id = ?`,
          [bookId],
        )
      : [];
    const vectorByFragment = new Map<number, { score: number; original: string; meta: FragmentMeta }>();
    if (queryVector) {
      for (let index = 0; index < vectorRows.length; index += 1) {
        if (index % 128 === 0) assertNotAborted(signal);
        const row = vectorRows[index]!;
        const vector = row.vector;
        if (!(vector instanceof Uint8Array) || vector.byteLength !== queryVector.byteLength) continue;
        const fragmentId = numberOf(row.fragment_id);
        const values = new Float32Array(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength));
        if (values.length !== queryVector.length) continue;
        let dot = 0;
        for (let i = 0; i < values.length; i += 1) dot += values[i]! * queryVector[i]!;
        if (!Number.isFinite(dot)) continue;
        const previous = vectorByFragment.get(fragmentId);
        if (!previous || dot > previous.score) {
          vectorByFragment.set(fragmentId, {
            score: dot,
            original: text(row.original),
            meta: toMeta(row),
          });
        }
      }
    }
    const vectorRanked = [...vectorByFragment.entries()]
      .sort((left, right) => right[1].score - left[1].score)
      .slice(0, this.vectorCandidateLimit);
    assertNotAborted(signal);

    // FTS 命中片段元数据
    const ftsMeta = new Map<number, { meta: FragmentMeta; original: string }>();
    if (ftsIds.length > 0) {
      const placeholders = ftsIds.map(() => '?').join(',');
      const rows = await this.driver.all<Row>(
        `SELECT f.id AS id, f.chapter AS chapter, f.ordinal AS ordinal, f.original AS original, f.locator AS locator,
                c.title AS chapter_title, c.href AS href
         FROM fragments f LEFT JOIN chapters c ON c.book_id = f.book_id AND c.ordinal = f.chapter
         WHERE f.id IN (${placeholders})`,
        [...ftsIds],
      );
      for (const row of rows) ftsMeta.set(numberOf(row.id), { meta: toMeta(row), original: text(row.original) });
    }

    const fused = new Map<
      number,
      { score: number; sources: Set<'fts' | 'vector'>; quote: string; meta: FragmentMeta }
    >();
    ftsIds.forEach((fragmentId, rank) => {
      const found = ftsMeta.get(fragmentId);
      if (!found) return;
      const entry = fused.get(fragmentId) ?? {
        score: 0,
        sources: new Set<'fts' | 'vector'>(),
        quote: found.original,
        meta: found.meta,
      };
      entry.score += 1 / (this.rrfK + rank + 1);
      entry.sources.add('fts');
      fused.set(fragmentId, entry);
    });
    vectorRanked.forEach(([fragmentId, value], rank) => {
      const entry = fused.get(fragmentId) ?? {
        score: 0,
        sources: new Set<'fts' | 'vector'>(),
        quote: value.original || value.meta.original,
        meta: value.meta,
      };
      entry.score += 1 / (this.rrfK + rank + 1);
      entry.sources.add('vector');
      // 向量 piece 的原文通常比整段 fragment 更聚焦，优先作为引用原文。
      if (value.original.trim()) entry.quote = value.original;
      fused.set(fragmentId, entry);
    });

    return [...fused.entries()]
      .map(([fragmentId, entry]) => ({
        fragmentId,
        chapter: entry.meta.chapterTitle || `第 ${entry.meta.chapterOrdinal + 1} 章`,
        chapterOrdinal: entry.meta.chapterOrdinal,
        ...(entry.meta.page !== undefined ? { page: entry.meta.page } : {}),
        quote: entry.quote.trim() || entry.meta.original,
        locator: entry.meta.locator,
        score: entry.score,
        sources: [...entry.sources].sort(),
      }))
      .filter((hit) => hit.quote.trim().length > 0)
      .sort((left, right) => right.score - left.score || left.fragmentId - right.fragmentId)
      .slice(0, topK);
  }

  async fragmentMetas(bookId: string, where: string, params: ReadonlyArray<SQLiteValue>): Promise<FragmentMeta[]> {
    const rows = await this.driver.all<Row>(
      `SELECT f.id AS id, f.chapter AS chapter, f.original AS original, f.locator AS locator,
              c.title AS chapter_title, c.href AS href
       FROM fragments f LEFT JOIN chapters c ON c.book_id = f.book_id AND c.ordinal = f.chapter
       WHERE f.book_id = ? ${where} ORDER BY f.chapter, f.ordinal LIMIT 200`,
      [bookId, ...params],
    );
    return rows.map(toMeta);
  }

  async chapterMetas(bookId: string): Promise<Array<{ ordinal: number; title: string; href: string }>> {
    const rows = await this.driver.all<Row>(
      'SELECT ordinal, title, href FROM chapters WHERE book_id = ? ORDER BY ordinal',
      [bookId],
    );
    return rows.map((row) => ({
      ordinal: numberOf(row.ordinal),
      title: text(row.title),
      href: text(row.href),
    }));
  }
}

/** BookSource：Agent 工具（search_book/read_page/read_chapter）直接读取旧真实索引。 */
export class LegacyIndexBookSource implements BookSource {
  private readonly searchIndex: LegacyIndexSearch;
  private readonly book: BookIdentity;

  constructor(searchIndex: LegacyIndexSearch, book: BookIdentity) {
    this.searchIndex = searchIndex;
    this.book = book;
  }

  async search(query: string, limit = 5): Promise<BookExcerpt[]> {
    const hits = await this.searchIndex.searchBook(this.book.id, query, limit);
    return hits.map((hit) => this.toExcerpt(hit));
  }

  private toExcerpt(hit: LegacySearchHit): BookExcerpt {
    return {
      context: hit.quote,
      quote: hit.quote,
      chapter: hit.chapter,
      ...(hit.page !== undefined ? { page: hit.page } : {}),
      locator: hit.locator,
    };
  }

  async page(page: number): Promise<BookPassage | null> {
    if (!Number.isInteger(page) || page < 1) return null;
    const metas = await this.searchIndex.fragmentMetas(this.book.id, 'AND f.chapter = ?', [page - 1]);
    if (metas.length === 0) return null;
    const chapters = await this.searchIndex.chapterMetas(this.book.id);
    const chapter = chapters.find((item) => item.ordinal === page - 1);
    return {
      chapter: chapter?.title ?? (this.book.format === 'pdf' ? `第 ${page} 页` : `第 ${page} 章`),
      ...(this.book.format === 'pdf' ? { page } : {}),
      excerpts: metas.slice(0, 8).map((meta) => ({
        context: meta.original,
        quote: meta.original,
        chapter: meta.chapterTitle || `第 ${meta.chapterOrdinal + 1} 章`,
        ...(meta.page !== undefined ? { page: meta.page } : {}),
        locator: meta.locator,
      })),
      ...(metas.length > 8 ? { truncated: true } : {}),
    };
  }

  async chapter(reference: string): Promise<BookPassage | null> {
    const chapters = await this.searchIndex.chapterMetas(this.book.id);
    const trimmed = reference.trim();
    const numeric = /^\d+$/.test(trimmed) ? Number(trimmed) - 1 : null;
    const matched =
      chapters.find((item) => (numeric !== null ? item.ordinal === numeric : item.title === trimmed || item.href === trimmed)) ??
      chapters.find((item) => numeric === null && (item.title.includes(trimmed) || item.href.includes(trimmed)));
    if (!matched) return null;
    const metas = await this.searchIndex.fragmentMetas(this.book.id, 'AND f.chapter = ?', [matched.ordinal]);
    if (metas.length === 0) return null;
    return {
      chapter: matched.title,
      ...(this.book.format === 'pdf' ? { page: matched.ordinal + 1 } : {}),
      excerpts: metas.slice(0, 8).map((meta) => ({
        context: meta.original,
        quote: meta.original,
        chapter: meta.chapterTitle || matched.title,
        ...(meta.page !== undefined ? { page: meta.page } : {}),
        locator: meta.locator,
      })),
      ...(metas.length > 8 ? { truncated: true } : {}),
    };
  }
}
