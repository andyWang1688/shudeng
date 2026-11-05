/** Resumable chapter/batch writer. Pending namespaces are private to this module.
 * Readers continue to use the previous committed book until atomic promotion. */
import type { SQLiteDriver } from '../db/driver.js';
import type { BookIdentity } from '../domain/types.js';
import { float32ToBytes } from './search-index.js';
import { ftsIndexText } from './text.js';
import { advanceRagIndexRevision } from './index-revision.js';
import { assertNotAborted, type CancellationSignal, type TextChunk } from './types.js';

const PREFIX = '__rag_pending__:';
const KEY_PREFIX = 'rag-index-build:';
const VERSION = 1;

export interface IndexBuildIdentity {
  readonly bookId: string;
  readonly sourceHash: string;
  readonly generation: string;
}
export interface IndexBuildModel { readonly id: string; readonly dimension: number }
interface Manifest extends IndexBuildIdentity {
  readonly version: 1;
  readonly extractionVersion: string;
  readonly chapterCount: number;
  readonly nextChapter: number;
  readonly nextChunk: number;
  readonly chunkCount: number;
  readonly vectorCount: number;
  readonly model: IndexBuildModel | null;
  readonly semanticFailure: string | null;
}
export interface IndexBuildCursor {
  readonly nextChapter: number;
  readonly nextChunk: number;
  readonly chunkCount: number;
  readonly vectorCount: number;
  readonly semanticFailure: string | null;
}
export interface ChapterIndexBuildOptions {
  readonly book: BookIdentity;
  readonly generation: string;
  readonly extractionVersion: string;
  readonly chapterCount: number;
  readonly model: IndexBuildModel | null;
  /** Runs inside every write transaction. Throw when source/lifecycle/generation changed. */
  readonly guard: (tx: SQLiteDriver) => Promise<void>;
  readonly signal?: CancellationSignal;
}
export interface IndexBuildSummary { readonly chunkCount: number; readonly vectorCount: number; readonly semantic: boolean; readonly semanticFailure: string | null }

function key(bookId: string): string { return KEY_PREFIX + bookId; }
function pendingId(bookId: string): string { return PREFIX + bookId; }
function chunkPrefix(bookId: string): string { return pendingId(bookId) + ':'; }
function integer(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }

/** The sole parser for persisted manifests. Corrupt/incompatible checkpoints are disposable. */
function parseManifest(raw: string | undefined, bookId: string): Manifest | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const row = value as Record<string, unknown>;
    const model = row.model;
    if (row.version !== VERSION || row.bookId !== bookId || typeof row.sourceHash !== 'string' || typeof row.generation !== 'string' || typeof row.extractionVersion !== 'string') return null;
    if (!integer(row.chapterCount) || !integer(row.nextChapter) || row.nextChapter > row.chapterCount || !integer(row.nextChunk) || !integer(row.chunkCount) || !integer(row.vectorCount) || row.vectorCount > row.chunkCount) return null;
    if (row.nextChapter === row.chapterCount && row.nextChunk !== 0) return null;
    if (row.semanticFailure !== null && typeof row.semanticFailure !== 'string') return null;
    if (model !== null) {
      if (typeof model !== 'object' || !model || typeof (model as Record<string, unknown>).id !== 'string' || !integer((model as Record<string, unknown>).dimension) || ((model as Record<string, unknown>).dimension as number) === 0) return null;
    }
    if (model === null && row.vectorCount !== 0) return null;
    return value as Manifest;
  } catch { return null; }
}

async function loadManifest(tx: SQLiteDriver, bookId: string): Promise<Manifest | null> {
  const [row] = await tx.all<{ value_json: string }>('SELECT value_json FROM app_preferences WHERE key = ?', [key(bookId)]);
  return parseManifest(row?.value_json, bookId);
}
async function saveManifest(tx: SQLiteDriver, manifest: Manifest): Promise<void> {
  await tx.run('INSERT INTO app_preferences (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json', [key(manifest.bookId), JSON.stringify(manifest)]);
}

/** Caller owns the transaction, including a removal's generation increment. */
export async function deletePendingBookIndex(tx: SQLiteDriver, bookId: string): Promise<void> {
  const id = pendingId(bookId);
  await tx.run('DELETE FROM rag_chunks_fts WHERE book_id = ?', [id]);
  await tx.run('DELETE FROM rag_chunk_vectors WHERE chunk_id IN (SELECT id FROM rag_chunks WHERE book_id = ?)', [id]);
  await tx.run('DELETE FROM rag_chunks WHERE book_id = ?', [id]);
  await tx.run('DELETE FROM app_preferences WHERE key = ?', [key(bookId)]);
}

/** Startup repair removes orphan/corrupt builds; lifecycle policy stays with the platform. */
export async function cleanupStaleBookIndexBuilds(driver: SQLiteDriver, isCurrent: (tx: SQLiteDriver, identity: IndexBuildIdentity) => Promise<boolean>): Promise<void> {
  await driver.transaction(async tx => {
    const rows = await tx.all<{ key: string; value_json: string }>('SELECT key, value_json FROM app_preferences WHERE substr(key, 1, ?) = ?', [KEY_PREFIX.length, KEY_PREFIX]);
    const retained = new Set<string>();
    for (const row of rows) {
      const bookId = row.key.slice(KEY_PREFIX.length), manifest = parseManifest(row.value_json, bookId);
      if (manifest && await isCurrent(tx, manifest)) retained.add(pendingId(bookId));
      else await deletePendingBookIndex(tx, bookId);
    }
    const orphans = await tx.all<{ book_id: string }>('SELECT DISTINCT book_id FROM rag_chunks WHERE substr(book_id, 1, ?) = ?', [PREFIX.length, PREFIX]);
    for (const row of orphans) if (!retained.has(row.book_id)) await deletePendingBookIndex(tx, row.book_id.slice(PREFIX.length));
    // A damaged interrupted writer must not strand FTS rows without chunks.
    await tx.run('DELETE FROM rag_chunks_fts WHERE substr(book_id, 1, ?) = ? AND chunk_id NOT IN (SELECT id FROM rag_chunks)', [PREFIX.length, PREFIX]);
    await tx.run('DELETE FROM rag_chunk_vectors WHERE substr(chunk_id, 1, ?) = ? AND chunk_id NOT IN (SELECT id FROM rag_chunks)', [PREFIX.length, PREFIX]);
  });
}

/** No pending ID is returned to the caller, a BookSource, a locator, or a citation. */
export class ChapterIndexBuild {
  private manifest: Manifest;
  private constructor(private readonly driver: SQLiteDriver, private readonly options: ChapterIndexBuildOptions, manifest: Manifest) { this.manifest = manifest; }

  static async open(driver: SQLiteDriver, options: ChapterIndexBuildOptions): Promise<ChapterIndexBuild> {
    if (options.book.id.startsWith(PREFIX) || !integer(options.chapterCount)) throw new Error('索引书籍标识或章节数无效');
    if (options.model && (!options.model.id || !integer(options.model.dimension) || options.model.dimension === 0)) throw new Error('索引语义模型无效');
    const fresh: Manifest = { version: VERSION, bookId: options.book.id, sourceHash: options.book.sourceHash, generation: options.generation, extractionVersion: options.extractionVersion, chapterCount: options.chapterCount, nextChapter: 0, nextChunk: 0, chunkCount: 0, vectorCount: 0, model: options.model, semanticFailure: null };
    const manifest = await driver.transaction(async tx => {
      assertNotAborted(options.signal);
      await options.guard(tx);
      const previous = await loadManifest(tx, options.book.id);
      if (previous && previous.sourceHash === fresh.sourceHash && previous.generation === fresh.generation && previous.extractionVersion === fresh.extractionVersion && previous.chapterCount === fresh.chapterCount && JSON.stringify(previous.model) === JSON.stringify(fresh.model) && await countsMatch(tx, previous)) return previous;
      await deletePendingBookIndex(tx, options.book.id);
      await saveManifest(tx, fresh);
      return fresh;
    });
    return new ChapterIndexBuild(driver, options, manifest);
  }

  get cursor(): IndexBuildCursor {
    const { nextChapter, nextChunk, chunkCount, vectorCount, semanticFailure } = this.manifest;
    return { nextChapter, nextChunk, chunkCount, vectorCount, semanticFailure };
  }

  private async write(update: (tx: SQLiteDriver, current: Manifest) => Promise<Manifest>): Promise<void> {
    const next = await this.driver.transaction(async tx => {
      assertNotAborted(this.options.signal);
      await this.options.guard(tx);
      const current = await loadManifest(tx, this.options.book.id);
      if (!current || JSON.stringify(current) !== JSON.stringify(this.manifest)) throw new Error('索引准备记录已更换，请重新准备');
      const result = await update(tx, current);
      assertNotAborted(this.options.signal);
      await saveManifest(tx, result);
      return result;
    });
    this.manifest = next;
  }

  /** A bounded chunk/embedding batch commits together with its resume cursor. */
  async append(chapterIndex: number, chunkOffset: number, chunks: readonly TextChunk[], vectors: readonly Float32Array[]): Promise<void> {
    if (!chunks.length || (vectors.length !== 0 && vectors.length !== chunks.length)) throw new Error('索引批次数量不一致');
    if (vectors.length && !this.manifest.model) throw new Error('索引准备没有语义模型');
    for (const chunk of chunks) if (chunk.bookId !== this.options.book.id || chunk.id.startsWith(PREFIX)) throw new Error('索引批次包含其他书籍');
    for (const vector of vectors) if (vector.length !== this.manifest.model?.dimension || !vector.every(Number.isFinite)) throw new Error('索引向量维度或内容无效');
    await this.write(async (tx, current) => {
      if (current.nextChapter !== chapterIndex || current.nextChunk !== chunkOffset || chapterIndex >= current.chapterCount) throw new Error('索引批次位置不连续');
      for (let index = 0; index < chunks.length; index += 1) {
        assertNotAborted(this.options.signal);
        const chunk = chunks[index]!, id = chunkPrefix(current.bookId) + chunk.id;
        await tx.run('INSERT INTO rag_chunks (id, book_id, chapter_ordinal, chapter_title, page, start_offset, end_offset, text, locator_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, pendingId(current.bookId), chunk.chapterOrdinal, chunk.chapter, chunk.page ?? null, chunk.startOffset, chunk.endOffset, chunk.text, chunk.locatorJson]);
        await tx.run('INSERT INTO rag_chunks_fts (chunk_id, book_id, fts_text) VALUES (?, ?, ?)', [id, pendingId(current.bookId), ftsIndexText(chunk.text)]);
        const vector = vectors[index];
        if (vector && current.model) await tx.run('INSERT INTO rag_chunk_vectors (chunk_id, model, dim, vector) VALUES (?, ?, ?, ?)', [id, current.model.id, current.model.dimension, float32ToBytes(vector)]);
      }
      return { ...current, nextChunk: current.nextChunk + chunks.length, chunkCount: current.chunkCount + chunks.length, vectorCount: current.vectorCount + vectors.length };
    });
  }

  async finishChapter(chapterIndex: number, chunkCount: number): Promise<void> {
    await this.write(async (_tx, current) => {
      if (current.nextChapter !== chapterIndex || current.nextChunk !== chunkCount || chapterIndex >= current.chapterCount) throw new Error('索引章节尚未完整写入');
      return { ...current, nextChapter: chapterIndex + 1, nextChunk: 0 };
    });
  }

  async recordSemanticFailure(detail: string): Promise<void> {
    await this.write(async (_tx, current) => ({ ...current, semanticFailure: detail }));
  }

  /** The old official chunks survive until this transaction commits; IDs stay byte-for-byte stable. */
  async promote(onPromote: (tx: SQLiteDriver, summary: IndexBuildSummary) => Promise<void>): Promise<IndexBuildSummary> {
    return this.driver.transaction(async tx => {
      assertNotAborted(this.options.signal);
      await this.options.guard(tx);
      const current = await loadManifest(tx, this.options.book.id);
      if (!current || JSON.stringify(current) !== JSON.stringify(this.manifest) || current.nextChapter !== current.chapterCount || current.nextChunk !== 0 || !await countsMatch(tx, current)) throw new Error('索引准备尚未完整完成');
      const bookId = current.bookId, pending = pendingId(bookId), prefix = chunkPrefix(bookId);
      await tx.run('DELETE FROM rag_chunks_fts WHERE book_id = ?', [bookId]);
      await tx.run('DELETE FROM rag_chunk_vectors WHERE chunk_id IN (SELECT id FROM rag_chunks WHERE book_id = ?)', [bookId]);
      await tx.run('DELETE FROM rag_chunks WHERE book_id = ?', [bookId]);
      // SQLite length/substr both count code points; JS .length counts UTF16 units.
      await tx.run('UPDATE rag_chunk_vectors SET chunk_id = substr(chunk_id, length(?) + 1) WHERE chunk_id IN (SELECT id FROM rag_chunks WHERE book_id = ?)', [prefix, pending]);
      await tx.run('UPDATE rag_chunks_fts SET chunk_id = substr(chunk_id, length(?) + 1), book_id = ? WHERE book_id = ?', [prefix, bookId, pending]);
      await tx.run('UPDATE rag_chunks SET id = substr(id, length(?) + 1), book_id = ? WHERE book_id = ?', [prefix, bookId, pending]);
      await advanceRagIndexRevision(tx, bookId);
      const summary = { chunkCount: current.chunkCount, vectorCount: current.vectorCount, semantic: current.chunkCount > 0 && current.model !== null && current.vectorCount === current.chunkCount && current.semanticFailure === null, semanticFailure: current.semanticFailure };
      await onPromote(tx, summary);
      assertNotAborted(this.options.signal);
      await tx.run('DELETE FROM app_preferences WHERE key = ?', [key(bookId)]);
      return summary;
    });
  }
}

async function countsMatch(tx: SQLiteDriver, manifest: Manifest): Promise<boolean> {
  const id = pendingId(manifest.bookId);
  const [counts] = await tx.all<{ chunks: number; fts: number; vectors: number }>('SELECT (SELECT count(*) FROM rag_chunks WHERE book_id = ?) AS chunks, (SELECT count(*) FROM rag_chunks_fts WHERE book_id = ?) AS fts, (SELECT count(*) FROM rag_chunk_vectors WHERE chunk_id IN (SELECT id FROM rag_chunks WHERE book_id = ?)) AS vectors', [id, id, id]);
  if (counts?.chunks !== manifest.chunkCount || counts.fts !== manifest.chunkCount || counts.vectors !== manifest.vectorCount) return false;
  const [integrity] = await tx.all<{ matched_fts: number; invalid_vectors: number }>(
    'SELECT (SELECT count(DISTINCT f.chunk_id) FROM rag_chunks_fts f JOIN rag_chunks c ON c.id = f.chunk_id AND c.book_id = f.book_id WHERE f.book_id = ?) AS matched_fts, (SELECT count(*) FROM rag_chunk_vectors v JOIN rag_chunks c ON c.id = v.chunk_id WHERE c.book_id = ? AND (v.model != ? OR v.dim != ? OR length(v.vector) != ?)) AS invalid_vectors',
    [id, id, manifest.model?.id ?? '', manifest.model?.dimension ?? 0, (manifest.model?.dimension ?? 0) * 4],
  );
  return integrity?.matched_fts === manifest.chunkCount && integrity.invalid_vectors === 0;
}
