import type { SQLiteDriver } from '../db/driver.js';
const key = (bookId: string): string => 'rag-index-revision:' + bookId;
/** Survives deletion: a paged reader cannot mistake a reimport for the same snapshot. */
export async function getRagIndexRevision(driver: SQLiteDriver, bookId: string): Promise<string> {
  const [row] = await driver.all<{ value_json: string }>('SELECT value_json FROM app_preferences WHERE key = ?', [key(bookId)]);
  return row?.value_json ?? '0';
}
/** Caller owns the transaction that replaces/removes the official namespace. */
export async function advanceRagIndexRevision(driver: SQLiteDriver, bookId: string): Promise<void> {
  await driver.run('INSERT INTO app_preferences (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = CAST(CAST(app_preferences.value_json AS INTEGER) + 1 AS TEXT)', [key(bookId), '1']);
}
export class SearchIndexChangedError extends Error {
  constructor() { super('书内索引正在更新，请重新查找'); this.name = 'SearchIndexChangedError'; }
}
