/**
 * 旧 Swift 书库迁移：复制旧 Books 文件、把 library.json / reading-questions.json 等
 * 一次性迁入共享 SQLite（幂等，已迁移过只补文件）。只读旧目录，不修改原数据。
 */
import { Directory, File, Paths } from 'expo-file-system';
import { migrateSwiftLibrary } from '@shudeng/core';
import { anchors, annotations, books, citations, createDatabase, messages } from '@shudeng/core/db';
import { getDataLayer } from '../db';
import { deleteBookRecords, legacyBookDataDeletedKey, recoverBookFileOperations, removeBookIndexRecords, type BookFileIntent } from './bookFileOperations';
import { isRecord } from './pure';
import { backfillLegacyAgentMetadata } from './legacyAgentMetadata';

const LEGACY_DIR = 'legacy';
const IMPORT_MARKER = '.imported';
const REMOVALS_RECOVERED_KEY = 'legacy-library-removals-recovered:v1';

/** Only active migrated rows may own a publication; final files are always verified copies. */
async function importLegacyBookFiles(): Promise<number> {
  const source = new Directory(Paths.document, LEGACY_DIR, 'Books');
  if (!source.exists) return 0;
  const destination = new Directory(Paths.document, 'Books');
  if (!destination.exists) destination.create({ intermediates: true });
  const activeNames = new Map((await (await getDataLayer()).store.listBooks())
    .filter((book) => book.removedAt === null).map((book) => [book.id + '.' + book.format, book]));
  let copied = 0;
  for (const entry of source.list()) {
    if (!(entry instanceof File)) continue;
    const book = activeNames.get(entry.name);
    if (!book) continue;
    const target = new File(destination, entry.name);
    const hash = (await entry.digest('SHA-256')).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash) || (/^[a-f0-9]{64}$/i.test(book.sourceHash) && hash !== book.sourceHash.toLowerCase())) throw new Error('旧书文件校验不一致，已保留原文件，请重新导出后重试');
    if (target.exists && (await target.digest('SHA-256')).toLowerCase() === hash) continue;
    const stagingUri = new File(destination, '.legacy-importing-' + entry.name).uri;
    const staging = new File(stagingUri);
    try {
      if (staging.exists) staging.delete();
      await entry.copy(staging);
      if ((await staging.digest('SHA-256')).toLowerCase() !== hash) throw new Error('旧书文件复制未完成，已保留原文件，请重试');
      await staging.move(target, { overwrite: true });
      copied += 1;
    } finally {
      // File.move mutates its URI. Never delete through that mutated object.
      const leftover = new File(stagingUri);
      if (leftover.exists) leftover.delete();
    }
  }
  return copied;
}

/** 读旧目录里的 JSON 文件原文；不存在返回 null。 */
export function readLegacyFile(name: string): string | null {
  const file = new File(Paths.document, LEGACY_DIR, name);
  if (!file.exists) return null;
  return file.textSync();
}

/** 读并解析旧 JSON 文件；缺失返回 undefined，坏 JSON 抛错（迁移失败可诊断）。 */
export function parseLegacyJSON(name: string): unknown {
  const text = readLegacyFile(name);
  if (!text) return undefined;
  return JSON.parse(text);
}

/** 旧 record-timestamps.json 形状校验：只保留字符串值。 */
function recordTimestampsOf(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') result[key] = item;
  }
  return result;
}

export class LibraryMigrationError extends Error {
  readonly failures: number;
  constructor(message: string, failures: number) {
    super(message);
    this.name = 'LibraryMigrationError';
    this.failures = failures;
  }
}

export async function migrateLegacyLibraryIfNeeded(): Promise<{ imported: boolean; books: number; failures: number }> {
  const layer = await getDataLayer();
  await recoverBookFileOperations();
  const marker = new File(Paths.document, LEGACY_DIR, IMPORT_MARKER);
  const wasImported = marker.exists;
  const [recovered] = await layer.driver.all('SELECT key FROM app_preferences WHERE key = ?', [REMOVALS_RECOVERED_KEY]);
  // The database transaction is authoritative even if a later file copy/marker write failed.
  // Replaying old removal intents here could delete a new generation imported after that failure.
  if (recovered) {
    await backfillLegacyAgentMetadata(layer.driver, parseLegacyJSON('reading-questions.json'));
    const copiedFiles = await importLegacyBookFiles();
    const existing = await layer.store.listBooks();
    if (!wasImported) marker.write(JSON.stringify({ importedAt: Date.now(), books: existing.length, failures: 0 }));
    return { imported: copiedFiles > 0, books: existing.length, failures: 0 };
  }

  const library = parseLegacyJSON('library.json');
  if (library === undefined) {
    await backfillLegacyAgentMetadata(layer.driver, parseLegacyJSON('reading-questions.json'));
    const copiedFiles = wasImported ? await importLegacyBookFiles() : 0;
    return { imported: copiedFiles > 0, books: wasImported ? (await layer.store.listBooks()).length : 0, failures: 0 };
  }
  const questions = parseLegacyJSON('reading-questions.json');
  const recordTimestamps = recordTimestampsOf(parseLegacyJSON('record-timestamps.json'));
  const notesBookGroups = parseLegacyJSON('notes-book-groups.json');
  const result = migrateSwiftLibrary({
    library,
    questions,
    recordTimestamps,
    ...(notesBookGroups !== undefined ? { notesBookGroups } : {}),
  });

  const tombstones = await layer.driver.all<{ key: string }>('SELECT key FROM app_preferences WHERE key LIKE ?', [legacyBookDataDeletedKey('') + '%']);
  const deleted = new Set(tombstones.map(row => row.key.slice(legacyBookDataDeletedKey('').length)));
  for (const state of result.bookStates) if (state.removal === 'deleting') deleted.add(state.bookId);
  const deletedConversations = new Set<string>();
  const conversationIdsByBook = new Map<string, string[]>();
  for (const question of Array.isArray(questions) ? questions : []) {
    if (!isRecord(question) || typeof question.bookID !== 'string') continue;
    const conversationId = typeof question.conversationID === 'string' ? question.conversationID : question.id;
    if (typeof conversationId !== 'string') continue;
    conversationIdsByBook.set(question.bookID, [...conversationIdsByBook.get(question.bookID) ?? [], conversationId]);
    if (deleted.has(question.bookID)) deletedConversations.add(conversationId);
  }
  // Imported tables, removal state and cleanup intents commit together before any final-file copy.
  await layer.driver.transaction(async tx => {
    const db = createDatabase(tx);
    // Existing markers must not re-add notes/conversations a reader deleted after migration.
    const bookRows = wasImported ? [] : result.tables.books.filter(row => !deleted.has(row.id));
    const anchorRows = wasImported ? [] : result.tables.anchors.filter(row => !deleted.has(row.bookId));
    const annotationRows = wasImported ? [] : result.tables.annotations.filter(row => !deleted.has(row.bookId));
    const messageRows = wasImported ? [] : result.tables.messages.filter(row => !deletedConversations.has(row.conversationId));
    const citationRows = wasImported ? [] : result.tables.citations.filter(row => !deletedConversations.has(row.conversationId));
    if (bookRows.length) await db.insert(books).values(bookRows).onConflictDoNothing();
    if (anchorRows.length) await db.insert(anchors).values(anchorRows).onConflictDoNothing();
    if (annotationRows.length) await db.insert(annotations).values(annotationRows).onConflictDoNothing();
    if (messageRows.length) await db.insert(messages).values(messageRows).onConflictDoNothing();
    if (citationRows.length) await db.insert(citations).values(citationRows).onConflictDoNothing();
    for (const state of result.bookStates) {
      if (!state.removal && !deleted.has(state.bookId)) continue;
      const kind = deleted.has(state.bookId) ? 'delete' : 'remove';
      if (kind === 'delete') await deleteBookRecords(tx, state.bookId, conversationIdsByBook.get(state.bookId));
      else {
        await removeBookIndexRecords(tx, state.bookId);
        await tx.run('UPDATE books SET removed_at = ?, updated_at = ? WHERE id = ?', [Date.now(), Date.now(), state.bookId]);
      }
      const name = state.bookId + '.' + state.format;
      const intent: BookFileIntent = { kind, targetUri: new File(Paths.document, 'Books', name).uri, stagingUri: new File(Paths.document, 'Books', (kind === 'delete' ? '.deleting-' : '.removing-') + name).uri };
      await tx.run('INSERT INTO book_file_operations (id, kind, payload_json, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, payload_json = excluded.payload_json', [state.bookId, kind, JSON.stringify(intent), Date.now()]);
    }
    await backfillLegacyAgentMetadata(tx, questions, messageRows, true);
    await tx.run('INSERT INTO app_preferences (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json', [REMOVALS_RECOVERED_KEY, 'true']);
  });
  await recoverBookFileOperations();
  await importLegacyBookFiles();
  marker.write(JSON.stringify({ importedAt: Date.now(), books: result.tables.books.length, failures: result.failures.length }));
  if (!result.ok && !wasImported) {
    throw new LibraryMigrationError(
      `旧书库导入有 ${result.failures.length} 条失败记录，已保留可迁移数据`,
      result.failures.length,
    );
  }
  return { imported: true, books: result.tables.books.length, failures: 0 };
}
