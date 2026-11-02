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
  private readonly embedding: EmbeddingProvider;
  private readonly rrfK: number;
  private readonly configuredCandidateLimit: number | undefined;

  constructor(driver: SQLiteDriver, embedding: EmbeddingProvider, options: SqliteSearchIndexOptions = {}) {
    this.driver = driver;
    this.embedding = embedding;
    this.rrfK = Math.max(1, options.rrfK ?? 60);
    this.configuredCandidateLimit = options.candidateLimit;
  }

  // ---------- 写入 ----------

  async indexBook(
    book: RagBook,
    chunks: ReadonlyArray<TextChunk>,
    embeddings: ReadonlyArray<Float32Array>,
    options: IndexBookOptions = {},
  ): Promise<void> {
    assertNotAborted(options.signal);
    if (chunks.length !== embeddings.length) {
      throw new Error(`chunk 数（${chunks.length}）与向量数（${embeddings.length}）不一致`);
    }
    for (const textChunk of chunks) {
      if (textChunk.bookId !== book.book.id) throw new Error(`chunk ${textChunk.id} 不属于书 ${book.book.id}`);
    }
    for (const vector of embeddings) {
      if (vector.length !== this.embedding.dimension) {
        throw new Error(`向量维度 ${vector.length} 与模型维度 ${this.embedding.dimension} 不一致`);
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
        const vector = embeddings[index]!;
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
        await tx.run(
          'INSERT INTO rag_chunk_vectors (chunk_id, model, dim, vector) VALUES (?, ?, ?, ?)',
          [chunk.id, this.embedding.modelId, this.embedding.dimension, float32ToBytes(vector)],
        );
      }
    });
  }

  // ---------- 检索 ----------

  async search(query: string, options: SearchOptions): Promise<SearchHit[]> {
    assertNotAborted(options.signal);
    const bookId = options.bookId;
    if (!query.trim()) return [];
    const mode = options.mode ?? 'hybrid';
    const topK = Math.max(1, Math.floor(options.topK ?? 5));
    const candidateLimit =
      this.configuredCandidateLimit ?? Math.max(20, Math.min(200, topK * 4));

    const ftsIds = mode === 'vector' ? [] : await this.searchFts(bookId, query, candidateLimit, options.signal);
    assertNotAborted(options.signal);
    const vectorIds =
      mode === 'fts' ? [] : await this.searchVectorByQuery(bookId, query, candidateLimit, options.signal);
    assertNotAborted(options.signal);

    const fused = fuseRankings(
      [
        ...(mode === 'vector' ? [] : [{ source: 'fts' as const, ids: ftsIds }]),
        ...(mode === 'fts' ? [] : [{ source: 'vector' as const, ids: vectorIds }]),
      ],
      this.rrfK,
      topK,
    );
    if (fused.length === 0) return [];
    const chunks = await this.loadChunks(fused.map((entry) => entry.chunkId));
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
    signal?: CancellationSignal,
  ): Promise<string[]> {
    const [queryVector] = await this.embedding.embed([query], { ...(signal ? { signal } : {}) });
    assertNotAborted(signal);
    if (!queryVector || queryVector.length !== this.embedding.dimension) {
      throw new Error('查询向量维度与 EmbeddingProvider 不一致');
    }
    return this.searchVector(bookId, queryVector, limit, signal);
  }

  private async searchVector(
    bookId: string,
    queryVector: Float32Array,
    limit: number,
    signal?: CancellationSignal,
  ): Promise<string[]> {
    const rows = await this.driver.all<Row>(
      `SELECT v.chunk_id AS chunk_id, v.model AS model, v.dim AS dim, v.vector AS vector
       FROM rag_chunk_vectors v JOIN rag_chunks c ON c.id = v.chunk_id
       WHERE c.book_id = ?`,
      [bookId],
    );
    const scored: Array<{ id: string; score: number }> = [];
    for (let index = 0; index < rows.length; index += 1) {
      if (index % 32 === 0) assertNotAborted(signal);
      const row = rows[index]!;
      if (text(row.model) !== this.embedding.modelId) continue;
      const dim = nullableInt(row.dim);
      if (dim !== queryVector.length) continue;
      const raw = row.vector;
      if (!(raw instanceof Uint8Array)) continue;
      const vector = bytesToFloat32(raw);
      if (vector.length !== queryVector.length) continue;
      scored.push({ id: text(row.chunk_id), score: cosineSimilarity(queryVector, vector) });
    }
    assertNotAborted(signal);
    scored.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
    return scored.slice(0, limit).map((entry) => entry.id);
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
    const rows = await this.driver.all<Row>(
      'SELECT * FROM rag_chunks WHERE book_id = ? ORDER BY chapter_ordinal, start_offset',
      [bookId],
    );
    return rows.map(rowToChunk).filter((chunk): chunk is TextChunk => chunk !== null);
  }

  async chunksForChapter(bookId: string, reference: string | number): Promise<TextChunk[]> {
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
    return rows.map(rowToChunk).filter((chunk): chunk is TextChunk => chunk !== null);
  }

  async chunksForPage(bookId: string, page: number): Promise<TextChunk[]> {
    if (!Number.isInteger(page) || page < 1) return [];
    const rows = await this.driver.all<Row>(
      'SELECT * FROM rag_chunks WHERE book_id = ? AND page = ? ORDER BY chapter_ordinal, start_offset',
      [bookId, page],
    );
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
