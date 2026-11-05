/** Platform adapter for the native reader-search contract; searches prepared text only. */
import { assertNotAborted, SqliteSearchIndex } from '@shudeng/core';
import { getDataLayer } from '../db';
import { getBookIndexGeneration, isBookFileOperationActive } from '../library/bookFileOperations';
import { getLocalBookIndexStatus } from './bookIndex';
import { findBookTextOccurrencesFromChunks, type BookTextSearchHit, type BookTextSearchOptions } from './bookTextOccurrences';

export type { BookTextSearchHit, BookTextSearchOptions } from './bookTextOccurrences';

export class BookTextSearchUnavailableError extends Error {
  constructor(detail: string) { super(detail); this.name = 'BookTextSearchUnavailableError'; }
}

const changed = (): BookTextSearchUnavailableError => new BookTextSearchUnavailableError('书籍正在更新，请重新搜索');

export async function searchBookText(bookId: string, query: string, options: BookTextSearchOptions = {}): Promise<readonly BookTextSearchHit[]> {
  assertNotAborted(options.signal);
  if (!query.trim()) return [];
  if (isBookFileOperationActive(bookId)) throw changed();
  const { driver } = await getDataLayer();
  const generation = await getBookIndexGeneration(driver, bookId);
  const status = await getLocalBookIndexStatus(bookId);
  assertNotAborted(options.signal);
  if (!status.available) throw new BookTextSearchUnavailableError(status.detail);
  const [snapshot] = await driver.all<{ source_hash: string }>(
      'SELECT source_hash FROM books WHERE id = ? AND removed_at IS NULL AND NOT EXISTS (SELECT 1 FROM book_file_operations WHERE id = books.id)', [bookId],
  );
  if (!snapshot || isBookFileOperationActive(bookId) || await getBookIndexGeneration(driver, bookId) !== generation) throw changed();
  const validateRead = async () => {
    const [book] = await driver.all<{ source_hash: string }>('SELECT source_hash FROM books WHERE id = ? AND removed_at IS NULL AND NOT EXISTS (SELECT 1 FROM book_file_operations WHERE id = books.id)', [bookId]);
    if (isBookFileOperationActive(bookId) || book?.source_hash !== snapshot.source_hash || await getBookIndexGeneration(driver, bookId) !== generation) throw changed();
  };
  assertNotAborted(options.signal);
  const index = new SqliteSearchIndex(driver, null, { validateRead });
  const hits = await findBookTextOccurrencesFromChunks(bookId, index.iterateChunks(bookId, options), query, options);
  const current = await driver.all<{ source_hash: string }>(
    'SELECT source_hash FROM books WHERE id = ? AND removed_at IS NULL AND NOT EXISTS (SELECT 1 FROM book_file_operations WHERE id = books.id)', [bookId],
  );
  const currentGeneration = await getBookIndexGeneration(driver, bookId);
  assertNotAborted(options.signal);
  if (isBookFileOperationActive(bookId) || current[0]?.source_hash !== snapshot.source_hash || currentGeneration !== generation) throw changed();
  return hits;
}
