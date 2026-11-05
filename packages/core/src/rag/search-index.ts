/**
 * SQLite 混合检索实现：FTS5（中文按字 token 化）+ 向量 BLOB（余弦，JS 计算）。
 *
 * 设计取舍：
 * - 不依赖 SQLite 向量扩展；向量以 Float32 小端 BLOB 存储，检索时按书加载后算 cosine
 *   （评测/小书规模可接受；大书后续可加 ANN 或 SQL 层过滤）。
 * - FTS5 用 unicode61 + rag/text.ts 的字符/词 token（中文可子串召回）；BM25 与向量排名
 *   用 RRF（Reciprocal Rank Fusion）融合，按 chunk id 去重。
 * - 所有写入在事务内；删除同一本书的旧索引（chunks/fts/vectors）后重建。
 */
import type { SQLiteDriver, SQLiteValue } from '../db/driver.js';
import { cosineSimilarity } from './embedding.js';
import { parseChunkLocator } from './chunker.js';
import { ftsIndexText, ftsMatchQuery } from './text.js';
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
} from './types.js';
import type { CancellationSignal } from './types.js';

type Row = Record<string, SQLiteValue>;

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

function nullableText(value: SQLiteValue | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
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
    const topK = Math.max(1, Math.floor(options.topK ?? 5));
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
    const chunks = await this.loadChunks(fused.map((entry) => entry.chunkId));
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
    const match = ftsMatchQuery(query);
    if (!match) return [];
    const rows = await this.driver.all<Row>(
      `SELECT chunk_id FROM rag_chunks_fts
       WHERE rag_chunks_fts MATCH ? AND book_id = ?
       ORDER BY bm25(rag_chunks_fts) LIMIT ?`,
      [match, bookId, limit],
    );
    assertNotAborted(signal);
    return rows.map((row) => text(row.chunk_id));
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
      [queryVector] = await this.embedding.embed([query], { ...(signal ? { signal } : {}) });
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
    if (limit <= 0) return [];
    const scored: Array<{ id: string; score: number }> = [];
    const compare = (left: { id: string; score: number }, right: { id: string; score: number }): number => right.score - left.score || left.id.localeCompare(right.id);
    let cursor: string | null = null;
    while (true) {
      await this.checkRead(bookId, revision, signal);
      const rows = await this.driver.all<Row>(
        'SELECT c.id AS chunk_id, v.model, v.dim, v.vector FROM rag_chunks c JOIN rag_chunk_vectors v ON v.chunk_id = c.id WHERE c.book_id = ?' + (cursor === null ? '' : ' AND c.id > ?') + ' ORDER BY c.id LIMIT 64',
        cursor === null ? [bookId] : [bookId, cursor],
      );
      await this.checkRead(bookId, revision, signal);
      if (!rows.length) break;
      for (const row of rows) {
        assertNotAborted(signal);
        if (text(row.model) !== this.embedding?.modelId || nullableInt(row.dim) !== queryVector.length || !(row.vector instanceof Uint8Array)) continue;
        const vector = bytesToFloat32(row.vector);
        if (vector.length !== queryVector.length) continue;
        const candidate = { id: text(row.chunk_id), score: cosineSimilarity(queryVector, vector) };
        if (scored.length === limit && compare(candidate, scored[scored.length - 1]!) >= 0) continue;
        let low = 0, high = scored.length;
        while (low < high) { const middle = Math.floor((low + high) / 2); if (compare(scored[middle]!, candidate) <= 0) low = middle + 1; else high = middle; }
        scored.splice(low, 0, candidate);
        if (scored.length > limit) scored.pop();
      }
      cursor = text(rows[rows.length - 1]!.chunk_id);
    }
    return scored.map(entry => entry.id);
  }

  private async loadChunks(ids: ReadonlyArray<string>): Promise<Map<string, TextChunk>> {
    const map = new Map<string, TextChunk>();
    if (ids.length === 0) return map;
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await this.driver.all<Row>(
      `SELECT * FROM rag_chunks WHERE id IN (${placeholders})`,
      [...ids],
    );
    for (const row of rows) {
      const chunk = rowToChunk(row);
      if (chunk) map.set(chunk.id, chunk);
    }
    return map;
  }

  // ---------- 读取/清理 ----------

  async listChunks(bookId: string): Promise<TextChunk[]> {
    const revision = await getRagIndexRevision(this.driver, bookId);
    await this.checkRead(bookId, revision);
    const rows = await this.driver.all<Row>(
      'SELECT * FROM rag_chunks WHERE book_id = ? ORDER BY chapter_ordinal, start_offset',
      [bookId],
    );
    await this.checkRead(bookId, revision);
    return rows.map(rowToChunk).filter((chunk): chunk is TextChunk => chunk !== null);
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
    const numeric = typeof reference === 'number' ? reference : /^\d+$/.test(reference.trim()) ? Number(reference) : null;
    const rows =
      numeric !== null
        ? await this.driver.all<Row>(
            'SELECT * FROM rag_chunks WHERE book_id = ? AND chapter_ordinal = ? ORDER BY start_offset',
            [bookId, numeric],
          )
        : await this.driver.all<Row>(
            'SELECT * FROM rag_chunks WHERE book_id = ? AND (chapter_title = ? OR chapter_title LIKE ?) ORDER BY start_offset',
            [bookId, String(reference), `%${String(reference)}%`],
          );
    await this.checkRead(bookId, revision);
    return rows.map(rowToChunk).filter((chunk): chunk is TextChunk => chunk !== null);
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
    return rows.map(rowToChunk).filter((chunk): chunk is TextChunk => chunk !== null);
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

function rowToChunk(row: Row): TextChunk | null {
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
  };
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
