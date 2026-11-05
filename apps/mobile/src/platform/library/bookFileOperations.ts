/** Write-ahead intents bridge SQLite and publication files across process termination. */
import { File, Paths } from 'expo-file-system';
import type { SaveBookInput, SQLiteDriver } from '@shudeng/core/db';
import { advanceRagIndexRevision, deletePendingBookIndex } from '@shudeng/core';
import { getDataLayer } from '../db';

export type BookFileIntent = {
  readonly kind: 'import' | 'remove' | 'delete';
  readonly targetUri: string;
  readonly stagingUri: string;
  readonly phase?: 'staging' | 'ready';
  readonly book?: SaveBookInput;
  readonly existing?: boolean;
  readonly indexState?: { readonly status: string; readonly detail: string };
};

/** This tombstone survives the book row and only blocks reads from immutable legacy JSON. */
export function legacyBookDataDeletedKey(id: string): string { return 'legacy-book-data-deleted:' + id; }
export function legacyBookIndexRetiredKey(id: string): string { return 'legacy-book-index-retired:' + id; }
function bookIndexGenerationKey(id: string): string { return 'book-index-generation:' + id; }

export async function getBookIndexGeneration(driver: SQLiteDriver, id: string): Promise<string> {
  const [row] = await driver.all<{ value_json: string }>('SELECT value_json FROM app_preferences WHERE key = ?', [bookIndexGenerationKey(id)]);
  return row?.value_json ?? '0';
}

export async function removeBookIndexRecords(driver: SQLiteDriver, id: string): Promise<void> {
  await deletePendingBookIndex(driver, id);
  await driver.run('DELETE FROM rag_chunks_fts WHERE book_id = ?', [id]);
  await driver.run('DELETE FROM rag_chunk_vectors WHERE chunk_id IN (SELECT id FROM rag_chunks WHERE book_id = ?)', [id]);
  await driver.run('DELETE FROM rag_chunks WHERE book_id = ?', [id]);
  await advanceRagIndexRevision(driver, id);
  await driver.run('DELETE FROM book_index_state WHERE book_id = ?', [id]);
  await driver.run('INSERT INTO app_preferences (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json', [legacyBookIndexRetiredKey(id), 'true']);
  // The counter survives a deleted row, so callbacks from its old generation cannot touch a reimport.
  await driver.run('INSERT INTO app_preferences (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = CAST(CAST(app_preferences.value_json AS INTEGER) + 1 AS TEXT)', [bookIndexGenerationKey(id), '1']);
}

/** Also used inside checkpoint batch/promotion transactions, not as a preflight-only check. */
export async function isBookIndexGenerationCurrent(driver: SQLiteDriver, book: Pick<SaveBookInput, 'id' | 'sourceHash'>, generation: string): Promise<boolean> {
  const rows = await driver.all<{ id: string }>(
    `SELECT id FROM books WHERE id = ? AND source_hash = ? AND removed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM book_file_operations WHERE id = books.id)
      AND COALESCE((SELECT value_json FROM app_preferences WHERE key = ?), '0') = ?`,
    [book.id, book.sourceHash, bookIndexGenerationKey(book.id), generation],
  );
  return rows.length === 1;
}

/** Caller owns the transaction so unique records and the legacy tombstone commit together. */
export async function deleteBookRecords(driver: SQLiteDriver, id: string, conversationIds: readonly string[] = []): Promise<void> {
  const rows = await driver.all<{ id: string }>('SELECT id FROM conversations WHERE book_id = ?', [id]);
  await removeBookIndexRecords(driver, id);
  for (const conversationId of new Set(['book:' + id, ...rows.map(row => row.id), ...conversationIds])) {
    await driver.run('DELETE FROM citations WHERE conversation_id = ?', [conversationId]);
    await driver.run('DELETE FROM messages WHERE conversation_id = ?', [conversationId]);
    await driver.run('DELETE FROM checkpoints WHERE conversation_id = ?', [conversationId]);
    await driver.run('DELETE FROM lg_writes WHERE thread_id = ?', [conversationId]);
    await driver.run('DELETE FROM lg_checkpoints WHERE thread_id = ?', [conversationId]);
    await driver.run('DELETE FROM conversations WHERE id = ?', [conversationId]);
  }
  await driver.run('DELETE FROM reading_progress WHERE book_id = ?', [id]);
  await driver.run('DELETE FROM reader_preferences WHERE book_id = ?', [id]);
  await driver.run('INSERT INTO app_preferences (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json', [legacyBookDataDeletedKey(id), 'true']);
  await driver.run('DELETE FROM books WHERE id = ?', [id]);
}

/** Existence, lifecycle, and identity checks are part of the write, never a preceding SELECT. */
export async function recordBookIndexState(driver: SQLiteDriver, book: Pick<SaveBookInput, 'id' | 'sourceHash'>, status: string, detail: string, generation: string): Promise<void> {
  await driver.run(
    `INSERT INTO book_index_state (book_id, status, detail, source_hash, updated_at)
     SELECT id, ?, ?, source_hash, ? FROM books WHERE id = ? AND source_hash = ? AND removed_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM book_file_operations WHERE id = books.id)
       AND COALESCE((SELECT value_json FROM app_preferences WHERE key = ?), '0') = ?
     ON CONFLICT(book_id) DO UPDATE SET status = excluded.status, detail = excluded.detail, source_hash = excluded.source_hash, updated_at = excluded.updated_at`,
    [status, detail, Date.now(), book.id, book.sourceHash, bookIndexGenerationKey(book.id), generation],
  );
}

const busy = new Set<string>();
let recovery: Promise<void> | null = null;

export function isBookFileOperationActive(id: string): boolean { return busy.has(id); }

export function lockBookFileOperation(id: string): () => void {
  if (busy.has(id)) throw new Error('这本书正在处理中，请完成后重试');
  busy.add(id);
  return () => { busy.delete(id); };
}

export async function saveBookFileIntent(id: string, intent: BookFileIntent): Promise<void> {
  const { driver } = await getDataLayer();
  await driver.run('INSERT INTO book_file_operations (id, kind, payload_json, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, payload_json = excluded.payload_json', [id, intent.kind, JSON.stringify(intent), Date.now()]);
}

export async function clearBookFileIntent(id: string): Promise<void> {
  const { driver } = await getDataLayer();
  await driver.run('DELETE FROM book_file_operations WHERE id = ?', [id]);
}

async function removeIndex(id: string): Promise<void> {
  const { driver } = await getDataLayer();
  await driver.transaction(async (tx) => {
    await removeBookIndexRecords(tx, id);
  });
  for (const extension of ['jpg', 'jpeg', 'png', 'svg', 'webp']) {
    const cover = new File(Paths.document, 'Covers', id + '.' + extension);
    if (cover.exists) cover.delete();
  }
}

export async function recoverBookFileIntent(id: string, intent: BookFileIntent): Promise<void> {
  const { store, driver } = await getDataLayer();
  const target = new File(intent.targetUri);
  const staging = new File(intent.stagingUri);
  const book = await store.getBook(id);
  if (intent.kind === 'import') {
    if (intent.phase === 'ready' && intent.book) {
      // Prefer the verified staged copy when replacing an interrupted/corrupt final copy.
      const available = staging.exists ? staging : target.exists ? target : null;
      if (!available) throw new Error('导入的书籍文件缺失，请重新导入');
      const hash = await available.digest('SHA-256');
      if (hash.toLowerCase() !== intent.book.sourceHash.toLowerCase()) throw new Error('书籍文件校验不一致，已保留文件，请重新导入');
      if (available.uri !== target.uri) {
        if (target.exists) target.delete();
        await available.move(target);
      }
      await store.saveBook(intent.book);
      await store.restoreRemovedBook(id);
      // A second verified copy may remain after an interrupted promotion; only it is disposable.
      if (intent.stagingUri !== intent.targetUri && new File(intent.stagingUri).exists) new File(intent.stagingUri).delete();
    } else {
      if (!intent.existing) await removeIndex(id);
      if (staging.exists) staging.delete();
    }
  } else if (book && (intent.kind === 'delete' || book.removedAt === null)) {
    // DB did not commit the removal: put the unique publication back before clearing its intent.
    if (staging.exists && !target.exists) await staging.move(target);
    else if (staging.exists && target.exists) {
      if ((await staging.digest('SHA-256')) !== (await target.digest('SHA-256'))) throw new Error('书籍恢复时发现两份不同文件，已保留，请重试');
      staging.delete();
    }
  } else {
    await driver.transaction(tx => removeBookIndexRecords(tx, id));
    // This is a disposable working copy. Keep the original legacy backup untouched.
    // Failure leaves the durable intent in place so cleanup retries before another import.
    if (new File(Paths.document, 'SQLite', 'legacy-book-index.sqlite').exists) {
      const { purgeRetiredLegacyBookIndexes } = await import('../ai/legacyIndex');
      await purgeRetiredLegacyBookIndexes();
    }
    if (staging.exists) staging.delete();
    if (target.exists) target.delete();
    if (intent.kind === 'delete') {
      for (const extension of ['jpg', 'jpeg', 'png', 'svg', 'webp']) {
        const cover = new File(Paths.document, 'Covers', id + '.' + extension);
        if (cover.exists) cover.delete();
      }
    }
  }
  await clearBookFileIntent(id);
  if (intent.kind === 'import' && intent.phase === 'ready' && intent.book && intent.indexState) {
    await recordBookIndexState(driver, intent.book, intent.indexState.status, intent.indexState.detail, await getBookIndexGeneration(driver, id));
  }
}

/** Active operations are excluded; only work left by a previous process or failed cleanup is recovered. */
export async function recoverBookFileOperations(): Promise<void> {
  if (recovery) return recovery;
  const operation = (async () => {
    const { driver } = await getDataLayer();
    const rows = await driver.all<{ id: string; kind: string; payload_json: string }>('SELECT id, kind, payload_json FROM book_file_operations ORDER BY created_at');
    for (const row of rows) {
      if (busy.has(row.id)) continue;
      const parsed: unknown = JSON.parse(row.payload_json);
      if (typeof parsed !== 'object' || parsed === null) throw new Error('书籍文件恢复记录损坏');
      const intent = parsed as BookFileIntent;
      if (!['import', 'remove', 'delete'].includes(intent.kind) || row.kind !== intent.kind || typeof intent.targetUri !== 'string' || typeof intent.stagingUri !== 'string' || !/^[a-z0-9_-]+$/i.test(row.id)) throw new Error('书籍文件恢复路径无效');
      const name = intent.targetUri.slice(intent.targetUri.lastIndexOf('/') + 1);
      const extension = name.slice(name.lastIndexOf('.') + 1);
      const prefix = intent.kind === 'import' ? '.importing-' : intent.kind === 'remove' ? '.removing-' : '.deleting-';
      if (!['epub', 'pdf'].includes(extension) || name !== row.id + '.' + extension || !intent.stagingUri.endsWith('/Books/' + prefix + name) || (intent.book && intent.book.id !== row.id)) throw new Error('书籍文件恢复路径无效');
      // iOS may relocate an app container on update. Persisted names, rather than old UUID paths, own the files.
      const targetUri = new File(Paths.document, 'Books', name).uri;
      const stagingUri = new File(Paths.document, 'Books', prefix + name).uri;
      await recoverBookFileIntent(row.id, { ...intent, targetUri, stagingUri });
    }
  })().finally(() => { if (recovery === operation) recovery = null; });
  recovery = operation;
  return operation;
}
