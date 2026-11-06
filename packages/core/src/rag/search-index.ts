/**
 * SQLite 混合检索实现：FTS5（中文按字 token 化）+ 向量 BLOB（余弦，JS 计算）。
 *
 * 设计取舍：
 * - 不依赖 SQLite 向量扩展；Float32 BLOB 按 64 条 keyset 扫描，JS 余弦排名仅保留有界候选。
 * - FTS5 用 unicode61 + rag/text.ts 的字符/词 token（中文可子串召回）；BM25 与向量排名
 *   用 RRF（Reciprocal Rank Fusion）融合，按 chunk id 去重。
 * - 所有写入在事务内；删除同一本书的旧索引（chunks/fts/vectors）后重建。
 */
import type { SQLiteDriver, SQLiteValue } from '../db/driver.js';
import { rankVectorCandidates } from './vector-ranking.js';
import { decodeReadCursor, passageSliceEnd, scanTextSelection } from './passage-window.js';
import { parseChunkLocator } from './chunker.js';
import { embedSearchQuery } from './query-embedding.js';
import { parseReaderTextLocation, type ReaderTextLocation } from './reader-location.js';
import { ftsIndexText, ftsQueryVariants } from './text.js';
import { advanceRagIndexRevision, getRagIndexRevision, SearchIndexChangedError } from './index-revision.js';
import {
  assertNotAborted,
  type EmbeddingProvider,
  type IndexBookOptions,
  type IndexStats,
  type RagBook,
  type SearchHit,
  type SearchIndex,
  type SearchOptions,
  type SearchSource,
  type TextChunk,
  type ChunkOutline,
  type ChunkReadPage,
  type ChunkReadRequest,
} from './types.js';
import type { CancellationSignal } from './types.js';

type Row = Record<string, SQLiteValue>;
type LocatedChunk = TextChunk & Pick<ChunkReadPage, 'locationPrecision' | 'locationNote'> & { readonly within?: number; readonly readerSelection?: boolean };

export interface SqliteSearchIndexOptions {
  /** RRF 常数（默认 60，排名贡献 1/(k+rank)）。 */
  rrfK?: number;
  /** 每个检索路径进入融合的候选数（默认 max(20, topK*4)）。 */
  candidateLimit?: number;
  /** Optional model failure policy. Without an explicit handler, vector errors still propagate. */
  onVectorError?: (error: unknown) => void | Promise<void>;
  /** Platform source/generation/lifecycle guard, checked at every paged read boundary. */
  validateRead?: (driver: SQLiteDriver) => Promise<void>;
}

function text(value: SQLiteValue | undefined): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

function nullableInt(value: SQLiteValue | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export function float32ToBytes(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength));
}

export function bytesToFloat32(bytes: Uint8Array): Float32Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4));
}

export class SqliteSearchIndex implements SearchIndex {
  private readonly driver: SQLiteDriver;
  private readonly embedding: EmbeddingProvider | null;
  private readonly rrfK: number;
  private readonly configuredCandidateLimit: number | undefined;
  private readonly onVectorError: SqliteSearchIndexOptions['onVectorError'];
  private readonly validateRead: SqliteSearchIndexOptions['validateRead'];

  constructor(driver: SQLiteDriver, embedding: EmbeddingProvider | null, options: SqliteSearchIndexOptions = {}) {
    this.driver = driver;
    this.embedding = embedding;
    this.rrfK = Math.max(1, options.rrfK ?? 60);
    this.configuredCandidateLimit = options.candidateLimit;
    this.onVectorError = options.onVectorError;
    this.validateRead = options.validateRead;
  }

  // ---------- 写入 ----------

  async indexBook(
    book: RagBook,
    chunks: ReadonlyArray<TextChunk>,
    embeddings: ReadonlyArray<Float32Array>,
    options: IndexBookOptions = {},
  ): Promise<void> {
    assertNotAborted(options.signal);
    if (embeddings.length > 0 && chunks.length !== embeddings.length) {
      throw new Error(`chunk 数（${chunks.length}）与向量数（${embeddings.length}）不一致`);
    }
    if (!this.embedding && embeddings.length > 0) throw new Error('没有语义模型时不能写入向量');
    for (const textChunk of chunks) {
      if (textChunk.bookId !== book.book.id) throw new Error(`chunk ${textChunk.id} 不属于书 ${book.book.id}`);
    }
    for (const vector of embeddings) {
      if (vector.length !== this.embedding?.dimension) {
        throw new Error(`向量维度 ${vector.length} 与模型维度 ${this.embedding?.dimension} 不一致`);
      }
    }

    await this.driver.transaction(async (tx) => {
      await tx.run('DELETE FROM rag_chunks_fts WHERE book_id = ?', [book.book.id]);
      await tx.run(
        'DELETE FROM rag_chunk_vectors WHERE chunk_id IN (SELECT id FROM rag_chunks WHERE book_id = ?)',
        [book.book.id],
      );
      await tx.run('DELETE FROM rag_chunks WHERE book_id = ?', [book.book.id]);

      for (let index = 0; index < chunks.length; index += 1) {
        assertNotAborted(options.signal);
        const chunk = chunks[index]!;
        const vector = embeddings[index];
        await tx.run(
          `INSERT INTO rag_chunks
            (id, book_id, chapter_ordinal, chapter_title, page, start_offset, end_offset, text, locator_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            chunk.id,
            chunk.bookId,
            chunk.chapterOrdinal,
            chunk.chapter,
            chunk.page ?? null,
            chunk.startOffset,
            chunk.endOffset,
            chunk.text,
            chunk.locatorJson,
          ],
        );
        await tx.run('INSERT INTO rag_chunks_fts (chunk_id, book_id, fts_text) VALUES (?, ?, ?)', [
          chunk.id,
          chunk.bookId,
          ftsIndexText(chunk.text),
        ]);
        if (vector && this.embedding) await tx.run(
          'INSERT INTO rag_chunk_vectors (chunk_id, model, dim, vector) VALUES (?, ?, ?, ?)',
          [chunk.id, this.embedding.modelId, this.embedding.dimension, float32ToBytes(vector)],
        );
      }
      await advanceRagIndexRevision(tx, book.book.id);
    });
  }

  // ---------- 检索 ----------

  private async checkRead(bookId: string, revision: string, signal?: CancellationSignal): Promise<void> {
    assertNotAborted(signal);
    await this.validateRead?.(this.driver);
    if (await getRagIndexRevision(this.driver, bookId) !== revision) throw new SearchIndexChangedError();
    assertNotAborted(signal);
  }

  async search(query: string, options: SearchOptions): Promise<SearchHit[]> {
    assertNotAborted(options.signal);
    const bookId = options.bookId;
    if (!query.trim()) return [];
    const revision = await getRagIndexRevision(this.driver, bookId);
    await this.checkRead(bookId, revision, options.signal);
    const mode = options.mode ?? 'hybrid';
    const topK = Math.max(1, Math.min(200, Math.floor(options.topK ?? 5)));
    const candidateLimit =
      this.configuredCandidateLimit ?? Math.max(20, Math.min(200, topK * 4));

    const ftsIds = mode === 'vector' ? [] : await this.searchFts(bookId, query, candidateLimit, options.signal);
    await this.checkRead(bookId, revision, options.signal);
    assertNotAborted(options.signal);
    let vectorIds: string[] = [];
    if (mode !== 'fts') {
      vectorIds = await this.searchVectorByQuery(bookId, query, candidateLimit, revision, mode === 'hybrid', options.signal);
    }
    assertNotAborted(options.signal);

    const fused = fuseRankings(
      [
        ...(mode === 'vector' ? [] : [{ source: 'fts' as const, ids: ftsIds }]),
        ...(mode === 'fts' ? [] : [{ source: 'vector' as const, ids: vectorIds }]),
      ],
      this.rrfK,
      topK,
    );
    await this.checkRead(bookId, revision, options.signal);
    if (fused.length === 0) return [];
    const chunks = await this.loadChunks(fused.map((entry) => entry.chunkId), revision);
    await this.checkRead(bookId, revision, options.signal);
    const hits: SearchHit[] = [];
    for (const entry of fused) {
      const chunk = chunks.get(entry.chunkId);
      if (!chunk) continue;
      hits.push({ chunk, score: entry.score, sources: entry.sources });
    }
    return hits;
  }

  private async searchFts(
    bookId: string,
    query: string,
    limit: number,
    signal?: CancellationSignal,
  ): Promise<string[]> {
    const ids = new Set<string>();
    for (const match of ftsQueryVariants(query)) {
      const rows = await this.driver.all<Row>(
        `SELECT chunk_id FROM rag_chunks_fts
         WHERE rag_chunks_fts MATCH ? AND book_id = ?
         ORDER BY bm25(rag_chunks_fts), chunk_id LIMIT ?`,
        [match, bookId, limit],
      );
      assertNotAborted(signal);
      for (const row of rows) ids.add(text(row.chunk_id));
      if (ids.size >= limit) break;
    }
    return [...ids].slice(0, limit);
  }

  private async searchVectorByQuery(
    bookId: string,
    query: string,
    limit: number,
    revision: string,
    allowModelFallback: boolean,
    signal?: CancellationSignal,
  ): Promise<string[]> {
    if (!this.embedding) return [];
    let queryVector: Float32Array | undefined;
    try {
      queryVector = await embedSearchQuery(this.embedding, query, signal);
      assertNotAborted(signal);
      if (!queryVector || queryVector.length !== this.embedding.dimension) throw new Error('查询向量维度与 EmbeddingProvider 不一致');
    } catch (error) {
      assertNotAborted(signal);
      await this.checkRead(bookId, revision, signal);
      if (!allowModelFallback || !this.onVectorError || error instanceof SearchIndexChangedError) throw error;
      await this.onVectorError(error);
      return [];
    }
    // Only the optional model invocation can downgrade. DB/revision/guard failures propagate.
    await this.checkRead(bookId, revision, signal);
    return this.searchVector(bookId, queryVector, limit, revision, signal);
  }

  private async searchVector(
    bookId: string,
    queryVector: Float32Array,
    limit: number,
    revision: string,
    signal?: CancellationSignal,
  ): Promise<string[]> {
    const ranked = await rankVectorCandidates(this.vectorCandidates(bookId, revision, signal), queryVector, {
      limit, compatibleModels: this.embedding ? [this.embedding.modelId] : [], signal,
    });
    return ranked.map(entry => entry.id);
  }

  private async *vectorCandidates(bookId: string, revision: string, signal?: CancellationSignal) {
    let cursor: string | null = null;
    while (true) {
      await this.checkRead(bookId, revision, signal);
      const rows = await this.driver.all<Row>(
        'SELECT c.id AS chunk_id, v.model, v.dim, v.vector FROM rag_chunks c JOIN rag_chunk_vectors v ON v.chunk_id = c.id WHERE c.book_id = ?' + (cursor === null ? '' : ' AND c.id > ?') + ' ORDER BY c.id LIMIT 64',
        cursor === null ? [bookId] : [bookId, cursor],
      );
      await this.checkRead(bookId, revision, signal);
      if (!rows.length) break;
      for (const row of rows) yield { id: text(row.chunk_id), vector: row.vector, model: text(row.model),
        ...(nullableInt(row.dim) !== undefined ? { dimension: Number(row.dim) } : {}), payload: undefined };
      cursor = text(rows[rows.length - 1]!.chunk_id);
    }
  }

  private async loadChunks(ids: ReadonlyArray<string>, revision?: string): Promise<Map<string, TextChunk>> {
    const map = new Map<string, TextChunk>();
    if (ids.length === 0) return map;
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await this.driver.all<Row>(
      `SELECT * FROM rag_chunks WHERE id IN (${placeholders})`,
      [...ids],
    );
    for (const row of rows) {
      const chunk = rowToChunk(row, revision);
      if (chunk) map.set(chunk.id, chunk);
    }
    return map;
  }

  // ---------- 读取/清理 ----------

  async outline(bookId: string, options: { cursor?: string; limit?: number; signal?: CancellationSignal } = {}): Promise<ChunkOutline> {
    const revision = await getRagIndexRevision(this.driver, bookId);
    await this.checkRead(bookId, revision, options.signal);
    let ordinal = 0;
    if (options.cursor) {
      const cursor = parseReadCursor(options.cursor, bookId, revision, 'outline');
      ordinal = cursor.ordinal;
    }
    const limit = boundedInteger(options.limit, 30, 1, 50);
    const rows = await this.driver.all<Row>(
      'SELECT chapter_ordinal, chapter_title, MIN(page) AS page, MIN(locator_json) AS locator_json, COUNT(*) AS chunk_count FROM rag_chunks WHERE book_id = ? AND chapter_ordinal > ? GROUP BY chapter_ordinal ORDER BY chapter_ordinal LIMIT ?',
      [bookId, ordinal, limit + 1],
    );
    await this.checkRead(bookId, revision, options.signal);
    const entries = rows.slice(0, limit).map(row => {
      const locator = parseChunkLocator(text(row.locator_json));
      const page = nullableInt(row.page);
      return { reference: `chapter:${Number(row.chapter_ordinal)}`, ordinal: Number(row.chapter_ordinal),
        title: text(row.chapter_title), chunkCount: Number(row.chunk_count),
        ...(page !== undefined ? { page } : {}), ...(locator?.href ? { href: locator.href } : {}) };
    });
    return { entries, ...(rows.length > limit && entries.length ? { nextCursor: JSON.stringify({
      type: 'outline', bookId, version: revision, ordinal: entries[entries.length - 1]!.ordinal,
    }) } : {}) };
  }

  /** Bounded, revision-checked chapter reads. Cursor also carries a position inside unusually long old chunks. */
  async readPassage(bookId: string, request: ChunkReadRequest): Promise<ChunkReadPage | null> {
    const revision = await getRagIndexRevision(this.driver, bookId);
    await this.checkRead(bookId, revision, request.signal);
    const before = boundedInteger(request.before, 1, 0, 3);
    const after = boundedInteger(request.after, 5, 0, 19);
    const count = Math.min(20, before + after + 1);
    const maxChars = boundedInteger(request.maxChars, 6000, 256, 12000);
    let anchor: LocatedChunk | null = null;
    let cursor: ReadCursor | undefined;
    if (request.cursor) {
      cursor = parseReadCursor(request.cursor, bookId, revision, 'passage');
      if (cursor.reference !== request.reference) throw new Error('续读位置与请求的原文不一致');
    } else {
      anchor = await this.resolvePassageAnchor(bookId, request.reference, revision, request.signal);
      if (!anchor) return null;
    }
    const ordinal = cursor?.ordinal ?? anchor!.chapterOrdinal;
    let position: readonly [number, number, string] | undefined = cursor
      ? [cursor.start!, cursor.end!, cursor.id!] : undefined;
    let anchorWithin = anchor?.within ?? 0;
    if (anchor?.readerSelection && anchor.text.length <= maxChars) anchorWithin = 0;
    if (anchor) {
      position = [anchor.startOffset, anchor.endOffset, anchor.id];
      // An explicit source position takes priority over preceding context, which can consume the entire budget.
      if (before && anchor.within === undefined) {
        const previous = await this.driver.all<Row>(
          'SELECT * FROM rag_chunks WHERE book_id = ? AND chapter_ordinal = ? AND (start_offset, end_offset, id) < (?, ?, ?) ORDER BY start_offset DESC, end_offset DESC, id DESC LIMIT ?',
          [bookId, ordinal, ...position, before],
        );
        const first = previous[previous.length - 1];
        if (first) { position = [Number(first.start_offset), Number(first.end_offset), text(first.id)]; anchorWithin = 0; }
      }
    }
    const comparator = cursor && !cursor.within ? '>' : '>=';
    const rows = await this.driver.all<Row>(
      `SELECT * FROM rag_chunks WHERE book_id = ? AND chapter_ordinal = ? AND (start_offset, end_offset, id) ${comparator} (?, ?, ?) ORDER BY start_offset, end_offset, id LIMIT ?`,
      [bookId, ordinal, ...position!, count + 1],
    );
    await this.checkRead(bookId, revision, request.signal);
    const chunks: TextChunk[] = [];
    const precision = anchor?.locationPrecision ?? cursor?.locationPrecision;
    const note = anchor?.locationNote ?? cursor?.locationNote;
    const location = { ...(precision ? { locationPrecision: precision } : {}), ...(note ? { locationNote: note } : {}) };
    let chars = 0;
    let next: ReadCursor | undefined;
    for (let index = 0; index < rows.length; index += 1) {
      assertNotAborted(request.signal);
      const original = rowToChunk(rows[index]!, revision);
      if (!original) throw new Error('书内文字的位置不一致，请重新准备后再读取');
      if (chunks.length >= count || chars >= maxChars) break;
      const within = index === 0 ? cursor?.within ?? anchorWithin : 0;
      const end = passageSliceEnd(original.text, within, maxChars - chars);
      if (end <= within) break;
      const textValue = original.text.slice(within, end);
      const locator = { ...original.locator, charStart: original.startOffset + within, charEnd: original.startOffset + end,
        ...(original.locator.text ? { text: { highlight: textValue } } : {}) };
      chunks.push({ ...original, text: textValue, startOffset: locator.charStart, endOffset: locator.charEnd, locator, locatorJson: JSON.stringify(locator) });
      chars += textValue.length;
      next = { type: 'passage', bookId, version: revision, reference: request.reference, ordinal,
        ...location,
        start: original.startOffset, end: original.endOffset, id: original.id,
        within: end < original.text.length ? end : 0 };
      if (end < original.text.length) break;
      if (index === rows.length - 1) next = undefined;
    }
    return chunks.length ? { chunks, reference: request.reference, ...(next ? { nextCursor: JSON.stringify(next) } : {}),
      ...location } : null;
  }

  private async resolvePassageAnchor(bookId: string, reference: string, revision: string, signal?: CancellationSignal): Promise<LocatedChunk | null> {
    let id: string | undefined;
    let ordinal: number | undefined;
    let offset: number | undefined;
    let reader: ReaderTextLocation | null = null;
    const value = reference.trim();
    let parsed: Record<string, unknown> | undefined;
    if (value.startsWith('{')) {
      try { parsed = JSON.parse(value) as Record<string, unknown>; } catch { throw new Error('原文定位无效'); }
      if (parsed.type === 'book-chunk') {
        if (parsed.bookId !== bookId) throw new Error('原文定位不属于当前书');
        if (parsed.version !== undefined && parsed.version !== revision) throw new SearchIndexChangedError();
        if (typeof parsed.chunkId !== 'string') throw new Error('原文定位缺少来源 ID');
        id = parsed.chunkId;
      } else if (parsed.engine === 'rag-chunk-v1' && Number.isInteger(parsed.chapterOrdinal) && Number.isInteger(parsed.charStart)) {
        ordinal = Number(parsed.chapterOrdinal); offset = Number(parsed.charStart);
      } else {
        reader = parseReaderTextLocation(parsed, bookId);
        if (!reader) throw new Error('不支持的原文定位');
        if (!reader.href && reader.page === undefined) throw new Error('当前只有 CFI，尚不能转换为精确原文位置；请用选中文字检索或提供章节 href');
      }
    }
    const chapter = /^(?:chapter:)?(\d+)$/.exec(value);
    if (chapter) ordinal = Number(chapter[1]);
    const page = /^page:(\d+)$/.exec(value);
    const params: SQLiteValue[] = [bookId];
    let where: string;
    if (id) { where = 'id = ?'; params.push(id); }
    else if (ordinal !== undefined) { where = 'chapter_ordinal = ?'; params.push(ordinal);
      if (offset !== undefined) { where += ' AND end_offset > ?'; params.push(offset); }
    } else if (reader?.page !== undefined || page) { where = 'page = ?'; params.push(reader?.page ?? Number(page![1])); }
    else if (reader?.href) { where = "json_extract(locator_json, '$.href') = ?"; params.push(reader.href); }
    else { where = "(id = ? OR chapter_title = ? OR json_extract(locator_json, '$.href') = ?)"; params.push(value, value, value); }
    let rows = await this.driver.all<Row>(`SELECT * FROM rag_chunks WHERE book_id = ? AND ${where} ORDER BY chapter_ordinal, start_offset, end_offset, id LIMIT 1`, params);
    if (!rows.length && page) rows = await this.driver.all<Row>('SELECT * FROM rag_chunks WHERE book_id = ? AND chapter_ordinal = ? ORDER BY start_offset, end_offset, id LIMIT 1', [bookId, Number(page[1])]);
    // Preserve title lookup convenience, but resolve one ordinal before reading; duplicate titles never combine chapters.
    if (!rows.length && !id && ordinal === undefined && !page && value) rows = await this.driver.all<Row>(
      "SELECT * FROM rag_chunks WHERE book_id = ? AND chapter_title LIKE ? ESCAPE '\\' ORDER BY chapter_ordinal, start_offset LIMIT 1",
      [bookId, `%${value.replace(/[\\%_]/g, '\\$&')}%`]);
    await this.checkRead(bookId, revision, signal);
    const chunk = rows[0] ? rowToChunk(rows[0], revision) : null;
    if (!chunk) return null;
    if (reader?.highlight?.trim()) {
      const located = await this.findReaderTextAnchor(bookId, chunk.chapterOrdinal, reader, revision, signal);
      return { ...located, locationPrecision: 'exact', readerSelection: true };
    }
    if (reader?.progression !== undefined) {
      const [size] = await this.driver.all<Row>('SELECT MAX(end_offset) AS end FROM rag_chunks WHERE book_id = ? AND chapter_ordinal = ?', [bookId, chunk.chapterOrdinal]);
      const near = await this.driver.all<Row>('SELECT * FROM rag_chunks WHERE book_id = ? AND chapter_ordinal = ? AND end_offset > ? ORDER BY start_offset, end_offset, id LIMIT 1', [bookId, chunk.chapterOrdinal, Math.floor(Math.max(0, Number(size?.end ?? 1) - 1) * reader.progression)]);
      await this.checkRead(bookId, revision, signal);
      return { ...(near[0] ? rowToChunk(near[0], revision) ?? chunk : chunk), locationPrecision: 'approximate', locationNote: '按章节阅读进度近似定位，尚未将 CFI/DOM 范围转换为精确文字位置。' };
    }
    if (offset !== undefined && (offset < chunk.startOffset || offset >= chunk.endOffset)) throw new Error('原文定位超出文字范围');
    return { ...chunk, ...(offset !== undefined ? { within: offset - chunk.startOffset } : {}), locationPrecision: id || offset !== undefined ? 'exact' : 'chapter',
      ...(!id && offset === undefined ? { locationNote: '这里只确定到章节或页面，返回其开头；不能声称已精确定位到选中文字。' } : {}) };
  }

  private async findReaderTextAnchor(bookId: string, ordinal: number, reader: ReaderTextLocation, revision: string, signal?: CancellationSignal): Promise<LocatedChunk> {
    const index = this;
    async function* parts() {
      let cursor: readonly [number, number, string] | undefined, lastEnd = 0;
      while (true) {
        await index.checkRead(bookId, revision, signal);
        const rows = await index.driver.all<Row>(
          'SELECT * FROM rag_chunks WHERE book_id = ? AND chapter_ordinal = ?' + (cursor ? ' AND (start_offset, end_offset, id) > (?, ?, ?)' : '') + ' ORDER BY start_offset, end_offset, id LIMIT 64',
          cursor ? [bookId, ordinal, ...cursor] : [bookId, ordinal]);
        await index.checkRead(bookId, revision, signal);
        if (!rows.length) break;
        for (const row of rows) {
          const chunk = rowToChunk(row, revision);
          if (!chunk) throw new Error('原文位置无效，请重新准备');
          yield { key: chunk.id, text: chunk.text, offset: chunk.startOffset, separatorBefore: chunk.startOffset > lastEnd ? ' ' : '' };
          lastEnd = chunk.endOffset;
        }
        const last = rows[rows.length - 1]!; cursor = [Number(last.start_offset), Number(last.end_offset), text(last.id)];
      }
    }
    const { offset: start } = await scanTextSelection(parts(), reader, signal);
    const [row] = await this.driver.all<Row>('SELECT * FROM rag_chunks WHERE book_id = ? AND chapter_ordinal = ? AND start_offset <= ? AND end_offset > ? ORDER BY start_offset LIMIT 1', [bookId, ordinal, start, start]);
    await this.checkRead(bookId, revision, signal);
    const found = row ? rowToChunk(row, revision) : null;
    if (!found) throw new Error('选中文字的位置无法还原');
    return { ...found, within: start - found.startOffset };
  }

  async listChunks(bookId: string): Promise<TextChunk[]> {
    const revision = await getRagIndexRevision(this.driver, bookId);
    await this.checkRead(bookId, revision);
    const rows = await this.driver.all<Row>(
      'SELECT * FROM rag_chunks WHERE book_id = ? ORDER BY chapter_ordinal, start_offset',
      [bookId],
    );
    await this.checkRead(bookId, revision);
    return rows.map(row => rowToChunk(row)).filter((chunk): chunk is TextChunk => chunk !== null);
  }

  /** Ordered keyset pages; no snapshot-sized JS array or OFFSET scan. Aborts if the official index changes. */
  async *iterateChunks(bookId: string, options: { readonly batchSize?: number; readonly signal?: CancellationSignal } = {}): AsyncGenerator<TextChunk> {
    const batchSize = Math.max(1, Math.min(256, Math.floor(options.batchSize ?? 64)));
    const revision = await getRagIndexRevision(this.driver, bookId);
    let cursor: readonly [number, number, number, string] | undefined;
    while (true) {
      await this.checkRead(bookId, revision, options.signal);
      const rows = await this.driver.all<Row>(
        'SELECT * FROM rag_chunks WHERE book_id = ?' + (cursor ? ' AND (chapter_ordinal, start_offset, end_offset, id) > (?, ?, ?, ?)' : '') + ' ORDER BY chapter_ordinal, start_offset, end_offset, id LIMIT ?',
        cursor ? [bookId, ...cursor, batchSize] : [bookId, batchSize],
      );
      await this.checkRead(bookId, revision, options.signal);
      if (!rows.length) break;
      for (const row of rows) {
        assertNotAborted(options.signal);
        const chunk = rowToChunk(row);
        if (!chunk) throw new Error('书内文字的位置不一致，请重新准备后再搜索');
        yield chunk;
      }
      const last = rows[rows.length - 1]!;
      cursor = [Number(last.chapter_ordinal), Number(last.start_offset), Number(last.end_offset), text(last.id)];
    }
    await this.checkRead(bookId, revision, options.signal);
  }

  async chunksForChapter(bookId: string, reference: string | number): Promise<TextChunk[]> {
    const revision = await getRagIndexRevision(this.driver, bookId);
    await this.checkRead(bookId, revision);
    const anchor = await this.resolvePassageAnchor(bookId, String(reference), revision);
    if (!anchor) return [];
    const rows = await this.driver.all<Row>(
      'SELECT * FROM rag_chunks WHERE book_id = ? AND chapter_ordinal = ? ORDER BY start_offset, end_offset, id',
      [bookId, anchor.chapterOrdinal],
    );
    await this.checkRead(bookId, revision);
    return rows.map(row => rowToChunk(row)).filter((chunk): chunk is TextChunk => chunk !== null);
  }

  async chunksForPage(bookId: string, page: number): Promise<TextChunk[]> {
    const revision = await getRagIndexRevision(this.driver, bookId);
    await this.checkRead(bookId, revision);
    if (!Number.isInteger(page) || page < 1) return [];
    const rows = await this.driver.all<Row>(
      'SELECT * FROM rag_chunks WHERE book_id = ? AND page = ? ORDER BY chapter_ordinal, start_offset',
      [bookId, page],
    );
    await this.checkRead(bookId, revision);
    return rows.map(row => rowToChunk(row)).filter((chunk): chunk is TextChunk => chunk !== null);
  }

  async deleteBook(bookId: string): Promise<void> {
    await this.driver.transaction(async (tx) => {
      await tx.run('DELETE FROM rag_chunks_fts WHERE book_id = ?', [bookId]);
      await tx.run(
        'DELETE FROM rag_chunk_vectors WHERE chunk_id IN (SELECT id FROM rag_chunks WHERE book_id = ?)',
        [bookId],
      );
      await tx.run('DELETE FROM rag_chunks WHERE book_id = ?', [bookId]);
      await advanceRagIndexRevision(tx, bookId);
    });
  }

  async stats(bookId: string): Promise<IndexStats> {
    const chunkRows = await this.driver.all<Row>('SELECT count(*) AS c FROM rag_chunks WHERE book_id = ?', [bookId]);
    const vectorRows = await this.driver.all<Row>(
      `SELECT count(*) AS c FROM rag_chunk_vectors
       WHERE chunk_id IN (SELECT id FROM rag_chunks WHERE book_id = ?)`,
      [bookId],
    );
    const modelRows = await this.driver.all<Row>(
      `SELECT model, dim, count(*) AS c FROM rag_chunk_vectors
       WHERE chunk_id IN (SELECT id FROM rag_chunks WHERE book_id = ?)
       GROUP BY model, dim`,
      [bookId],
    );
    return {
      bookId,
      chunkCount: Number(chunkRows[0]?.c ?? 0),
      vectorCount: Number(vectorRows[0]?.c ?? 0),
      models: modelRows.map((row) => ({
        model: text(row.model),
        dim: Number(row.dim ?? 0),
        count: Number(row.c ?? 0),
      })),
    };
  }
}

function rowToChunk(row: Row, sourceVersion?: string): TextChunk | null {
  const id = text(row.id);
  const locatorJson = text(row.locator_json);
  const locator = parseChunkLocator(locatorJson);
  if (!id || !locator) return null;
  const page = nullableInt(row.page);
  const chapterOrdinal = Number(row.chapter_ordinal ?? 0);
  const chapter = text(row.chapter_title);
  return {
    id,
    bookId: text(row.book_id),
    chapter,
    chapterOrdinal,
    ...(page !== undefined ? { page } : {}),
    startOffset: Number(row.start_offset ?? 0),
    endOffset: Number(row.end_offset ?? 0),
    text: text(row.text),
    locator,
    locatorJson,
    ...(sourceVersion ? { sourceVersion } : {}),
  };
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value!))) : fallback;
}

interface ReadCursor {
  type: 'outline' | 'passage'; bookId: string; version: string; ordinal: number;
  reference?: string; start?: number; end?: number; id?: string; within?: number;
  locationPrecision?: ChunkReadPage['locationPrecision']; locationNote?: string;
}

function parseReadCursor(raw: string, bookId: string, version: string, type: ReadCursor['type']): ReadCursor {
  const value = decodeReadCursor(raw, bookId, type) as unknown as ReadCursor;
  if (!Number.isInteger(value.ordinal) || value.ordinal < 1) throw new Error('续读游标不属于当前书或格式无效');
  if (value.version !== version) throw new SearchIndexChangedError();
  if (type === 'passage' && (typeof value.id !== 'string' || !Number.isInteger(value.start) || !Number.isInteger(value.end) || !Number.isInteger(value.within) || value.start! < 0 || value.end! < value.start! || value.within! < 0 || typeof value.reference !== 'string')) throw new Error('续读游标的位置无效');
  return value;
}

interface FusedEntry {
  chunkId: string;
  score: number;
  sources: SearchSource[];
}

/** RRF：每个排名列表内 1/(k+rank) 求和；同一 chunk 多来源合并去重。 */
function fuseRankings(
  rankings: ReadonlyArray<{ source: SearchSource; ids: ReadonlyArray<string> }>,
  rrfK: number,
  topK: number,
): FusedEntry[] {
  const map = new Map<string, { score: number; sources: Set<SearchSource> }>();
  for (const ranking of rankings) {
    ranking.ids.forEach((id, index) => {
      if (!id) return;
      const entry = map.get(id) ?? { score: 0, sources: new Set<SearchSource>() };
      entry.score += 1 / (rrfK + index + 1);
      entry.sources.add(ranking.source);
      map.set(id, entry);
    });
  }
  return [...map.entries()]
    .sort((left, right) => right[1].score - left[1].score || left[0].localeCompare(right[0]))
    .slice(0, topK)
    .map(([chunkId, entry]) => ({
      chunkId,
      score: entry.score,
      sources: [...entry.sources].sort(),
    }));
}
