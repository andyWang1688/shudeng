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
import type { BookSource, BookExcerpt, BookPassage, BookOutline, BookPassageRequest, BookSourceContext } from '../agent/book-source.js';
import type { BookIdentity } from '../domain/types.js';
import { assertNotAborted, type CancellationSignal, type EmbeddingProvider } from './types.js';
import type { SQLiteDriver, SQLiteValue } from '../db/driver.js';
import { embedSearchQuery } from './query-embedding.js';
import { rankVectorCandidates } from './vector-ranking.js';
import { decodeReadCursor, passageSliceEnd, scanTextSelection } from './passage-window.js';
import { retrievalQueryTerms } from './text.js';
import { parseReaderTextLocation, type ReaderTextLocation } from './reader-location.js';

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
  readonly fragmentOrdinal: number;
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
    fragmentOrdinal: numberOf(row.fragment_ordinal ?? row.ordinal),
    chapterOrdinal: numberOf(row.chapter),
    chapterTitle: text(row.chapter_title),
    href: text(row.href),
    original: text(row.original),
    locator,
    ...(page !== undefined ? { page } : {}),
  };
}

// The Swift v2 suffix changes document chunking, not the verified MiniLM vector space.
// See SemanticEmbedding.version/modelSHA and Resources/SemanticModel/manifest.json.
function compatibleLegacyModels(model: string): string[] {
  const versions = ['minilm-e8f8c211-arm64-int8-128-mean-l2-v1', 'minilm-e8f8c211-arm64-int8-128-mean-l2-sentence100-overlap20-v2'];
  return versions.includes(model) ? versions : [model];
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
    const exact = legacyFtsTerms(trimmed.slice(0, 2000), true);
    const relaxed = retrievalQueryTerms(trimmed).map(term => `(${legacyFtsTerms(term, true)})`).join(' OR ');
    for (const expression of [exact, ...(relaxed ? [relaxed] : [])]) {
      if (!expression) continue;
      const rows = await this.driver.all<Row>(
        `SELECT f.id AS id, f.chapter AS chapter, f.ordinal AS ordinal, f.original AS original, f.locator AS locator,
                c.title AS chapter_title, c.href AS href
         FROM fragment_terms t JOIN fragments f ON f.id = t.rowid
         LEFT JOIN chapters c ON c.book_id = f.book_id AND c.ordinal = f.chapter
         WHERE fragment_terms MATCH ? AND t.book_id = ?
         ORDER BY bm25(fragment_terms) LIMIT ?`,
        [expression, bookId, candidateLimit],
      );
      for (const row of rows) if (!ftsIds.includes(numberOf(row.id))) ftsIds.push(numberOf(row.id));
      if (ftsIds.length >= candidateLimit) break;
    }
    assertNotAborted(signal);

    let queryVector: Float32Array | undefined;
    if (this.embedding) {
      try { queryVector = await embedSearchQuery(this.embedding, trimmed, signal); }
      catch (error) {
        assertNotAborted(signal);
        if (!this.onVectorError) throw error;
        await this.onVectorError(error);
      }
    }
    assertNotAborted(signal);
    const vectorRanked = queryVector && this.embedding
      ? await rankVectorCandidates(this.vectorCandidates(bookId, signal), queryVector, {
          limit: this.vectorCandidateLimit, compatibleModels: compatibleLegacyModels(this.embedding.modelId), signal,
        })
      : [];
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
    vectorRanked.forEach(({ id: fragmentId, payload: value }, rank) => {
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

  private async *vectorCandidates(bookId: string, signal?: CancellationSignal) {
    let cursor: readonly [number, number] | undefined;
    while (true) {
      assertNotAborted(signal);
      const rows = await this.driver.all<Row>(
        'SELECT e.fragment_id AS id, e.piece, e.model, e.original, e.vector, f.chapter, f.ordinal, f.locator, c.title AS chapter_title, c.href FROM embeddings e JOIN fragments f ON f.id = e.fragment_id AND f.book_id = e.book_id LEFT JOIN chapters c ON c.book_id = f.book_id AND c.ordinal = f.chapter WHERE e.book_id = ?' + (cursor ? ' AND (e.fragment_id, e.piece) > (?, ?)' : '') + ' ORDER BY e.fragment_id, e.piece LIMIT 64',
        cursor ? [bookId, ...cursor] : [bookId]);
      assertNotAborted(signal);
      if (!rows.length) return;
      for (const row of rows) yield { id: numberOf(row.id), model: text(row.model), vector: row.vector,
        payload: { original: text(row.original), meta: toMeta(row) } };
      const last = rows[rows.length - 1]!; cursor = [numberOf(last.id), numberOf(last.piece)];
    }
  }

  async fragmentMetas(bookId: string, where: string, params: ReadonlyArray<SQLiteValue>, options: { limit?: number; descending?: boolean } = {}): Promise<FragmentMeta[]> {
    const direction = options.descending ? 'DESC' : 'ASC';
    const rows = await this.driver.all<Row>(
      `SELECT f.id AS id, f.chapter AS chapter, f.ordinal AS fragment_ordinal, f.original AS original, f.locator AS locator,
              c.title AS chapter_title, c.href AS href
       FROM fragments f LEFT JOIN chapters c ON c.book_id = f.book_id AND c.ordinal = f.chapter
       WHERE f.book_id = ? ${where} ORDER BY f.chapter ${direction}, f.ordinal ${direction}, f.id ${direction} LIMIT ?`,
      [bookId, ...params, Math.max(1, Math.min(200, Math.floor(options.limit ?? 200)))],
    );
    return rows.map(toMeta);
  }

  async chapterMetas(bookId: string, after = -1, limit = 20000): Promise<Array<{ ordinal: number; title: string; href: string }>> {
    const rows = await this.driver.all<Row>(
      'SELECT ordinal, title, href FROM chapters WHERE book_id = ? AND ordinal > ? ORDER BY ordinal LIMIT ?',
      [bookId, after, Math.max(1, Math.min(20000, Math.floor(limit)))],
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

  async search(query: string, limit = 5, context: BookSourceContext = {}): Promise<BookExcerpt[]> {
    const hits = await this.searchIndex.searchBook(this.book.id, query, limit, context.signal);
    return hits.map((hit) => this.toExcerpt(hit));
  }

  private toExcerpt(hit: LegacySearchHit): BookExcerpt {
    return {
      context: hit.quote,
      quote: hit.quote,
      chapter: hit.chapter,
      ...(hit.page !== undefined ? { page: hit.page } : {}),
      locator: hit.locator,
      chunkId: `${this.book.id}:legacy:${hit.fragmentId}`,
      readRef: JSON.stringify({ type: 'legacy-fragment', bookId: this.book.id, version: this.book.sourceHash, fragmentId: hit.fragmentId }),
      sourceVersion: this.book.sourceHash,
    };
  }

  async page(page: number, context: BookSourceContext = {}): Promise<BookPassage | null> {
    if (!Number.isInteger(page) || page < 1) return null;
    return this.passage({ reference: `chapter:${page}`, before: 0, after: 19 }, context);
  }

  async outline(options: { cursor?: string; limit?: number } = {}, context: BookSourceContext = {}): Promise<BookOutline> {
    assertNotAborted(context.signal);
    let after = -1;
    if (options.cursor) {
      const cursor = this.cursor(options.cursor, 'outline');
      after = cursor.chapter;
    }
    const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 30)));
    const chapters = await this.searchIndex.chapterMetas(this.book.id, after, limit + 1);
    assertNotAborted(context.signal);
    const entries = chapters.slice(0, limit).map(chapter => ({ reference: `chapter:${chapter.ordinal + 1}`,
      ordinal: chapter.ordinal + 1, title: chapter.title, href: chapter.href,
      ...(this.book.format === 'pdf' ? { page: chapter.ordinal + 1 } : {}) }));
    return { entries, ...(chapters.length > limit ? { nextCursor: JSON.stringify({ type: 'outline', bookId: this.book.id, version: this.book.sourceHash, chapter: chapters[limit - 1]!.ordinal }) } : {}) };
  }

  private cursor(value: string, type: string): { chapter: number; ordinal?: number; id?: number; within?: number; reference?: string; locationPrecision?: BookPassage['locationPrecision']; locationNote?: string } {
    const parsed = decodeReadCursor(value, this.book.id, type);
    if (parsed.version !== this.book.sourceHash || !Number.isInteger(parsed.chapter) || Number(parsed.chapter) < 0) throw new Error('旧书原文游标不属于当前书或版本');
    if (type === 'passage' && (!Number.isInteger(parsed.ordinal) || !Number.isInteger(parsed.id) || !Number.isInteger(parsed.within) || Number(parsed.within) < 0 || typeof parsed.reference !== 'string')) throw new Error('旧书续读游标的位置无效');
    return parsed as { chapter: number; ordinal?: number; id?: number; within?: number; reference?: string; locationPrecision?: BookPassage['locationPrecision']; locationNote?: string };
  }

  async passage(request: BookPassageRequest, context: BookSourceContext = {}): Promise<BookPassage | null> {
    assertNotAborted(context.signal);
    const cursor = request.cursor ? this.cursor(request.cursor, 'passage') : undefined;
    if (cursor && cursor.reference !== request.reference) throw new Error('续读位置与原文不一致');
    let chapter = cursor?.chapter;
    let anchorId: number | undefined;
    let anchor: FragmentMeta | undefined;
    let anchorWithin = 0;
    let readerSelection = false;
    let precision: BookPassage['locationPrecision'] = cursor?.locationPrecision ?? 'chapter';
    let note = cursor?.locationNote;
    const ref = request.reference.trim();
    if (!cursor && ref.startsWith('{')) {
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(ref) as Record<string, unknown>; } catch { throw new Error('旧书原文定位无效'); }
      if (parsed.type === 'legacy-fragment') {
        if (parsed.bookId !== this.book.id || parsed.version !== this.book.sourceHash || !Number.isInteger(parsed.fragmentId)) throw new Error('原文定位不属于当前书或版本');
        anchorId = Number(parsed.fragmentId);
        const found = await this.searchIndex.fragmentMetas(this.book.id, 'AND f.id = ?', [anchorId]);
        anchor = found[0]; chapter = anchor?.chapterOrdinal;
        precision = 'exact';
      } else {
        const reader = parseReaderTextLocation(parsed, this.book.id);
        if (!reader) throw new Error('不支持的旧书阅读位置');
        const located = await this.locateReader(reader, context);
        if (!located) return null;
        anchor = located.anchor; anchorWithin = located.within ?? 0; readerSelection = located.within !== undefined;
        chapter = located.chapter; precision = located.precision; note = located.note;
      }
    }
    if (chapter === undefined) {
      const number = /^(?:chapter:)?(\d+)$/.exec(ref);
      if (number) chapter = Number(number[1]) - 1;
      else {
        const chapters = await this.searchIndex.chapterMetas(this.book.id);
        const found = chapters.find(item => item.title === ref || item.href === ref) ?? chapters.find(item => item.title.includes(ref));
        chapter = found?.ordinal;
      }
    }
    if (chapter === undefined || chapter < 0) return null;
    const chapters = await this.searchIndex.chapterMetas(this.book.id, chapter - 1, 1);
    const title = chapters[0]?.ordinal === chapter ? chapters[0].title : `第 ${chapter + 1} 章`;
    const before = Math.max(0, Math.min(3, request.before ?? 1));
    const count = Math.max(1, Math.min(20, before + (request.after ?? 5) + 1));
    const maxChars = Math.max(256, Math.min(12000, request.maxChars ?? 6000));
    if (readerSelection && anchor && anchor.original.length <= maxChars) anchorWithin = 0;
    if (anchor && before && !cursor && !readerSelection) {
      const previous = await this.searchIndex.fragmentMetas(this.book.id, 'AND f.chapter = ? AND (f.ordinal, f.id) < (?, ?)',
        [chapter, anchor.fragmentOrdinal, anchor.fragmentId], { limit: before, descending: true });
      if (previous.length) { anchor = previous[previous.length - 1]!; anchorWithin = 0; }
    }
    const where = cursor ? `AND f.chapter = ? AND (f.ordinal, f.id) ${cursor.within ? '>=' : '>'} (?, ?)` : anchor ? 'AND f.chapter = ? AND (f.ordinal, f.id) >= (?, ?)' : 'AND f.chapter = ?';
    const params = cursor ? [chapter, cursor.ordinal!, cursor.id!] : anchor ? [chapter, anchor.fragmentOrdinal, anchor.fragmentId] : [chapter];
    const metas = await this.searchIndex.fragmentMetas(this.book.id, where, params, { limit: count + 1 });
    assertNotAborted(context.signal);
    const excerpts: BookExcerpt[] = [];
    let chars = 0, next: string | undefined;
    for (let index = 0; index < metas.length && excerpts.length < count && chars < maxChars; index += 1) {
      const meta = metas[index]!;
      const start = index === 0 ? cursor?.within ?? anchorWithin : 0;
      const end = passageSliceEnd(meta.original, start, maxChars - chars);
      if (end <= start) break;
      const quote = meta.original.slice(start, end);
      excerpts.push({ context: quote, quote, chapter: meta.chapterTitle || title, locator: meta.locator,
        chunkId: `${this.book.id}:legacy:${meta.fragmentId}`, sourceVersion: this.book.sourceHash,
        readRef: JSON.stringify({ type: 'legacy-fragment', bookId: this.book.id, version: this.book.sourceHash, fragmentId: meta.fragmentId }),
        ...(meta.page !== undefined ? { page: meta.page } : {}) });
      chars += quote.length;
      next = end < meta.original.length || index < metas.length - 1 ? JSON.stringify({
        type: 'passage', bookId: this.book.id, version: this.book.sourceHash, chapter, reference: request.reference,
        locationPrecision: precision, ...(note ? { locationNote: note } : {}),
        ordinal: meta.fragmentOrdinal, id: meta.fragmentId, within: end < meta.original.length ? end : 0,
      }) : undefined;
      if (end < meta.original.length) break;
    }
    return excerpts.length ? { chapter: title, excerpts, reference: request.reference,
      locationPrecision: precision, ...(note ? { locationNote: note } : {}),
      ...(this.book.format === 'pdf' ? { page: chapter + 1 } : {}),
      ...(next ? { truncated: true, nextCursor: next } : {}) } : null;
  }

  private async locateReader(reader: ReaderTextLocation, context: BookSourceContext): Promise<{ chapter: number; anchor?: FragmentMeta; within?: number; precision: NonNullable<BookPassage['locationPrecision']>; note?: string } | null> {
    if (!reader.href && reader.page === undefined) throw new Error('当前只有 CFI，尚不能转换为精确原文位置；请用选中文字检索或提供章节 href');
    let chapter: number | undefined;
    if (reader.page !== undefined) chapter = reader.page - 1;
    else {
      let after = -1;
      while (true) {
        const chapters = await this.searchIndex.chapterMetas(this.book.id, after, 50);
        assertNotAborted(context.signal);
        const found = chapters.find(item => item.href.split('#')[0] === reader.href);
        if (found) { chapter = found.ordinal; break; }
        if (!chapters.length) break; after = chapters[chapters.length - 1]!.ordinal;
      }
    }
    if (chapter === undefined) return null;
    if (!reader.highlight?.trim()) return { chapter, precision: 'chapter', note: '这里只确定到章节或页面，返回其开头；尚未转换 CFI/DOM 范围，不能声称已精确定位到选中文字。' };
    const searchIndex = this.searchIndex, bookId = this.book.id, ordinal = chapter;
    async function* parts() {
      let cursor: FragmentMeta | undefined;
      while (true) {
        const rows = await searchIndex.fragmentMetas(bookId, 'AND f.chapter = ?' + (cursor ? ' AND (f.ordinal, f.id) > (?, ?)' : ''), cursor ? [ordinal, cursor.fragmentOrdinal, cursor.fragmentId] : [ordinal], { limit: 64 });
        assertNotAborted(context.signal); if (!rows.length) return;
        for (const meta of rows) yield { key: meta.fragmentId, text: meta.original, separatorBefore: ' ' };
        cursor = rows[rows.length - 1];
      }
    }
    const { key, offset } = await scanTextSelection(parts(), reader, context.signal);
    const [anchor] = await searchIndex.fragmentMetas(bookId, 'AND f.chapter = ? AND f.id = ?', [chapter, key], { limit: 1 });
    assertNotAborted(context.signal);
    if (!anchor) throw new Error('选中文字的位置无法还原');
    return { chapter, anchor, within: offset, precision: 'exact' };
  }

  async chapter(reference: string, context: BookSourceContext = {}): Promise<BookPassage | null> {
    return this.passage({ reference, before: 0, after: 19 }, context);
  }
}
