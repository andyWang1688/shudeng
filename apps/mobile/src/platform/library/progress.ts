/**
 * 阅读进度：版本迁移管理 reading_progress 表；首次读到旧书时
 * 把 library.json 的 locatorJSON 回填成进度（幂等）。供书架「继续阅读」与阅读器恢复。
 */
import type { SQLiteValue } from '@shudeng/core/db';
import { getDataLayer, type ShudengDataLayer } from '../db';
import { legacyProgression, formatOf, isRecord, parseStoredLocatorJson, percentOf, readerLocatorFromLegacy } from './pure';
import { parseLegacyJSON } from './legacyMigration';
import { legacyBookDataDeletedKey } from './bookFileOperations';
import type { BookProgress, StoredReaderLocator } from './types';

const backfills = new WeakMap<ShudengDataLayer, Promise<void>>();

/** Compatibility entry point; all DDL belongs to the versioned core migrations. */
export function ensureProgressTable(): Promise<ShudengDataLayer> { return getDataLayer(); }

function rowToProgress(row: Record<string, SQLiteValue>): BookProgress | null {
  const locator = parseStoredLocatorJson(typeof row.locator_json === 'string' ? row.locator_json : null);
  if (!locator || typeof row.book_id !== 'string') return null;
  return {
    bookId: row.book_id,
    percent: percentOf(row.percent),
    locator,
    page: typeof row.page === 'number' ? row.page : locator.type === 'pdf' ? locator.page : null,
    chapter: typeof row.chapter === 'string' ? row.chapter : null,
    updatedAt: typeof row.updated_at === 'number' ? row.updated_at : 0,
  };
}

/** 首次读到旧书时，把 library.json 的 locatorJSON 变成进度（幂等；迁移标记已存在也能补）。 */
async function backfillLegacyProgress(layer: ShudengDataLayer): Promise<void> {
  const pending = backfills.get(layer);
  if (pending) return pending;
  const operation = performLegacyBackfill(layer).catch(error => {
    backfills.delete(layer);
    throw error;
  });
  backfills.set(layer, operation);
  return operation;
}

async function performLegacyBackfill(layer: ShudengDataLayer): Promise<void> {
  const library = parseLegacyJSON('library.json');
  if (!Array.isArray(library)) return;
  for (const entry of library) {
    if (!isRecord(entry)) continue;
    const bookId = typeof entry.id === 'string' ? entry.id : null;
    if (!bookId) continue;
    const format = formatOf(entry.format);
    const locator = readerLocatorFromLegacy(entry.locatorJSON, format);
    if (!locator) continue;
    const percent = legacyProgression(entry.locatorJSON);
    await layer.driver.run(
      `INSERT OR IGNORE INTO reading_progress (book_id, locator_json, percent, page, chapter, updated_at)
       SELECT id, ?, ?, ?, ?, ? FROM books WHERE id = ?
         AND NOT EXISTS (SELECT 1 FROM book_file_operations WHERE id = books.id)
         AND NOT EXISTS (SELECT 1 FROM app_preferences WHERE key = ?)`,
      [JSON.stringify(locator), percent, locator.type === 'pdf' ? locator.page : null, null, Date.now(), bookId, legacyBookDataDeletedKey(bookId)],
    );
  }
}

export async function loadBookProgress(bookId: string): Promise<BookProgress | null> {
  const layer = await ensureProgressTable();
  await backfillLegacyProgress(layer);
  const rows = await layer.driver.all<Record<string, SQLiteValue>>(
    'SELECT book_id, locator_json, percent, page, chapter, updated_at FROM reading_progress WHERE book_id = ? LIMIT 1',
    [bookId],
  );
  return rows[0] ? rowToProgress(rows[0]) : null;
}

export async function loadAllBookProgress(): Promise<ReadonlyMap<string, BookProgress>> {
  const layer = await ensureProgressTable();
  await backfillLegacyProgress(layer);
  const rows = await layer.driver.all<Record<string, SQLiteValue>>(
    'SELECT book_id, locator_json, percent, page, chapter, updated_at FROM reading_progress',
  );
  const result = new Map<string, BookProgress>();
  for (const row of rows) {
    const progress = rowToProgress(row);
    if (progress) result.set(progress.bookId, progress);
  }
  return result;
}

export async function saveBookProgress(bookId: string, progress: {
  readonly locator: StoredReaderLocator;
  readonly percent: number;
  readonly chapter?: string | null;
}): Promise<void> {
  const layer = await ensureProgressTable();
  await layer.driver.run(
    `INSERT INTO reading_progress (book_id, locator_json, percent, page, chapter, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(book_id) DO UPDATE SET locator_json = excluded.locator_json,
       percent = excluded.percent, page = excluded.page, chapter = excluded.chapter, updated_at = excluded.updated_at`,
    [
      bookId,
      JSON.stringify(progress.locator),
      Math.min(1, Math.max(0, progress.percent)),
      progress.locator.type === 'pdf' ? progress.locator.page : null,
      progress.chapter ?? null,
      Date.now(),
    ],
  );
}
