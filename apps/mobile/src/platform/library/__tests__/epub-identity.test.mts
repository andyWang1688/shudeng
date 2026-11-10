import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createExpoSQLiteDriver, createDatabase, migrate, ShudengStore, type ExpoSQLiteDatabaseLike, type SQLiteValue } from '@shudeng/core/db';
import { decodeEpubAnchor, encodeEpubAnchor, sameEpubSelection, sameEpubBookmark } from '@shudeng/core/domain';
import { saveEpubAnnotation } from '../epubAnnotations';
import { anchorJsonForSelection, readerLocatorFromLegacy } from '../pure';
import { storedLocatorFromReaderLocator, readerLocatorFromStoredLocator } from '../../../reader/readerMapping';
import { epubTarget } from '../../../../../../packages/reader-web/src/epub-location';
import type { SaveReaderAnnotationInput } from '../types';

class SQLiteExpoDatabase implements ExpoSQLiteDatabaseLike {
  readonly db = new DatabaseSync(':memory:');
  async execAsync(sql: string) { this.db.exec(sql); }
  async runAsync(sql: string, ...params: SQLiteValue[]) { return { changes: Number(this.db.prepare(sql).run(...params).changes) }; }
  async getAllAsync<T>(sql: string, ...params: SQLiteValue[]) { return this.db.prepare(sql).all(...params) as T[]; }
  async getFirstAsync<T>(sql: string, ...params: SQLiteValue[]) { return (await this.getAllAsync<T>(sql, ...params))[0] ?? null; }
  async withExclusiveTransactionAsync<T>(fn: (transaction: ExpoSQLiteDatabaseLike) => Promise<T>) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = await fn(this); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
const databases: SQLiteExpoDatabase[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.db.close(); });
const readium = (offset = 0) => ({ href: 'OEBPS/ch1.xhtml', locations: { cssSelector: '#p', domRange: { start: { cssSelector: '#p', textNodeIndex: 0, charOffset: offset }, end: { cssSelector: '#p', textNodeIndex: 0, charOffset: offset + 4 } } }, text: { before: '', highlight: '重复文字', after: ' 后文' } });
const input = (offset = 0): SaveReaderAnnotationInput => ({ format: 'EPUB', kind: 'highlight', color: 'green', quote: '重复文字', locator: { type: 'epub', cfi: 'epubcfi(/6/4,/1:0,/1:4)', href: 'OEBPS/ch1.xhtml', selection: readium(offset) } });
async function setup() {
  const database = new SQLiteExpoDatabase(); databases.push(database);
  const driver = createExpoSQLiteDriver(database); await migrate(driver);
  const store = new ShudengStore(createDatabase(driver));
  await store.saveBook({ id: 'book', title: '身份回归', format: 'epub', sourceHash: 'fixture' });
  return { driver, store, database };
}

describe('EPUB annotation identity with real SQLite and the production Expo driver contract', () => {
  it('reuses ID and original creation time for sequential and simultaneous repeated highlights', async () => {
    const { driver } = await setup();
    const first = await saveEpubAnnotation(driver, 'book', input());
    await driver.run('UPDATE annotations SET created_at = 10 WHERE id = ?', [first.annotationId]);
    const repeats = await Promise.all(Array.from({ length: 6 }, () => saveEpubAnnotation(driver, 'book', input())));
    expect(repeats.every(result => result.annotationId === first.annotationId && result.anchorId === first.anchorId)).toBe(true);
    expect(await driver.all('SELECT created_at FROM annotations')).toEqual([{ created_at: 10 }]);
    expect(await driver.all('SELECT COUNT(*) AS count FROM anchors')).toEqual([{ count: 1 }]);
  });
  it('refuses implicit highlight-to-note conversion and preserves the complete original record', async () => {
    const { driver } = await setup(); const first = await saveEpubAnnotation(driver, 'book', input());
    await driver.run('UPDATE annotations SET created_at = 12 WHERE id = ?', [first.annotationId]);
    const before = await driver.all('SELECT * FROM annotations');
    const anchors = await driver.all('SELECT * FROM anchors');
    const { color: _color, ...note } = input();
    await expect(saveEpubAnnotation(driver, 'book', { ...note, kind: 'note', body: '  我的笔记  ' })).rejects.toThrow('取消高亮');
    expect(await driver.all('SELECT * FROM annotations')).toEqual(before);
    expect(await driver.all('SELECT * FROM anchors')).toEqual(anchors);
  });
  it('re-highlighting a note updates color without erasing the note body', async () => {
    const { driver } = await setup(); const first = await saveEpubAnnotation(driver, 'book', { ...input(), kind: 'note', body: '保留正文' });
    expect(await saveEpubAnnotation(driver, 'book', { ...input(), color: 'rose' })).toEqual(first);
    expect(await driver.all('SELECT kind, color, body FROM annotations')).toEqual([{ kind: 'note', color: 'rose', body: '保留正文' }]);
    await expect(saveEpubAnnotation(driver, 'book', { ...input(), kind: 'note', body: ' ' })).rejects.toThrow('不能为空');
  });
  it('creates a note in a distinct DOM range and later edits that note without changing the highlight', async () => {
    const { driver } = await setup(); const highlight = await saveEpubAnnotation(driver, 'book', input(0));
    const before = await driver.all('SELECT * FROM annotations WHERE id = ?', [highlight.annotationId]);
    const noteInput = { ...input(8), kind: 'note' as const, body: '另一处的笔记' };
    const note = await saveEpubAnnotation(driver, 'book', noteInput);
    expect(note.annotationId).not.toBe(highlight.annotationId);
    expect(await saveEpubAnnotation(driver, 'book', { ...noteInput, body: '更新正文' })).toEqual(note);
    expect(await driver.all('SELECT * FROM annotations WHERE id = ?', [highlight.annotationId])).toEqual(before);
    expect(await driver.all('SELECT kind, body FROM annotations WHERE id = ?', [note.annotationId])).toEqual([{ kind: 'note', body: '更新正文' }]);
    expect(await driver.all('SELECT COUNT(*) AS count FROM annotations')).toEqual([{ count: 2 }]);
  });
  it('keeps identical text in distinct DOM ranges separate even if an old engine gives the same CFI', async () => {
    const { driver } = await setup();
    const first = await saveEpubAnnotation(driver, 'book', input(0)); const second = await saveEpubAnnotation(driver, 'book', input(8));
    expect(first.annotationId).not.toBe(second.annotationId);
    expect(await driver.all('SELECT COUNT(*) AS count FROM annotations')).toEqual([{ count: 2 }]);
  });
  it.each(['raw-cfi', 'readium', 'v3-readium', 'v3-offset', 'legacy-raw'])('reuses a historic %s record without rewriting its identity', async format => {
    const { driver, store } = await setup(); const selection = readium();
    const locatorJson = format === 'raw-cfi' ? input().locator.type === 'epub' ? input().locator.cfi : ''
      : format === 'readium' ? JSON.stringify(selection)
      : format === 'v3-readium' ? JSON.stringify({ schema: 'shudeng.anchor.v3', version: 3, kind: 'readium', locator: selection })
      : format === 'v3-offset' ? JSON.stringify({ schema: 'shudeng.anchor.v3', version: 3, kind: 'offset', locator: { href: selection.href, startOffset: 0, endOffset: 4 }, readium: selection })
      : JSON.stringify({ legacy: { raw: JSON.stringify(selection) } });
    await store.saveAnchor({ id: 'old-anchor', bookId: 'book', engine: 'readium', locatorJson, quote: '重复文字' });
    await store.saveAnnotation({ id: 'old-note', bookId: 'book', anchorId: 'old-anchor', kind: 'note', body: '旧正文', color: 'blue' });
    expect(await saveEpubAnnotation(driver, 'book', input())).toEqual({ anchorId: 'old-anchor', annotationId: 'old-note' });
    expect(await driver.all('SELECT body FROM annotations')).toEqual([{ body: '旧正文' }]);
  });
  it('rolls back the newly inserted anchor when the annotation write fails', async () => {
    const { driver } = await setup();
    await driver.exec("CREATE TRIGGER fail_annotation BEFORE INSERT ON annotations BEGIN SELECT RAISE(ABORT, 'injected annotation failure'); END;");
    await expect(saveEpubAnnotation(driver, 'book', input())).rejects.toThrow('injected');
    expect(await driver.all('SELECT COUNT(*) AS count FROM anchors')).toEqual([{ count: 0 }]);
    expect(await driver.all('SELECT COUNT(*) AS count FROM annotations')).toEqual([{ count: 0 }]);
  });
});

describe('single typed EPUB anchor boundary', () => {
  it('round trips selection identity through V3, mobile mapping and browser destinations', () => {
    const locator = input().locator; const decoded = decodeEpubAnchor(locator)!;
    expect(decodeEpubAnchor(encodeEpubAnchor(decoded))).toEqual(decoded);
    expect(decodeEpubAnchor(anchorJsonForSelection(input()))).toEqual(decoded);
    expect(readerLocatorFromStoredLocator(storedLocatorFromReaderLocator(locator)!)).toEqual(locator);
    expect(epubTarget(encodeEpubAnchor(decoded)).domRange).toEqual(readium().locations.domRange);
  });
  it('preserves raw text spacing and does not identify a selection by quote alone', () => {
    expect(sameEpubSelection(readium(), { ...readium(), text: { ...readium().text, after: '后文' } })).toBe(false);
    expect(sameEpubSelection(readium(), readium(8))).toBe(false);
    expect(sameEpubSelection({ href: 'ch1', text: { highlight: '重复文字' } }, { href: 'ch1', text: { highlight: '重复文字' } })).toBe(false);
  });
  it('keeps old Readium selection context usable and rejects malformed or PDF anchors', () => {
    const legacy = readerLocatorFromLegacy(JSON.stringify(readium()), 'EPUB');
    expect(legacy?.type === 'epub' ? legacy.selection : null).toEqual(readium());
    expect(epubTarget(JSON.stringify(legacy)).quote).toBe('重复文字');
    expect(decodeEpubAnchor('{broken')).toBeNull();
    expect(decodeEpubAnchor({ type: 'pdf', page: 1 })).toBeNull();
  });
});

describe('EPUB bookmark identity across reflow', () => {
  it('reuses one bookmark when CFI changes while scoped text stays the same', async () => {
    const { driver } = await setup();
    const firstInput = { ...input(), kind: 'bookmark' as const };
    const first = await saveEpubAnnotation(driver, 'book', firstInput);
    const second = { ...firstInput, locator: { ...firstInput.locator, type: 'epub' as const, cfi: 'epubcfi(/6/4,/1:12,/1:44)' } };
    expect(sameEpubBookmark(firstInput.locator, second.locator)).toBe(true);
    expect(await saveEpubAnnotation(driver, 'book', second)).toEqual(first);
    expect(await driver.all('SELECT COUNT(*) AS count FROM annotations')).toEqual([{ count: 1 }]);
  });
  it('keeps a bookmark separate from an annotation on the same passage', async () => {
    const { driver } = await setup();
    const highlight = await saveEpubAnnotation(driver, 'book', input());
    const bookmark = await saveEpubAnnotation(driver, 'book', { ...input(), kind: 'bookmark' });
    expect(highlight.annotationId).not.toBe(bookmark.annotationId);
    expect(await driver.all('SELECT kind FROM annotations ORDER BY kind')).toEqual([{kind:'bookmark'}, {kind:'highlight'}]);
  });
  it('does not merge repeated text from a different element or context', () => {
    const original = input().locator;
    expect(sameEpubBookmark(original, { ...original, selection: { ...readium(), locations: { cssSelector:'#other' } } })).toBe(false);
    expect(sameEpubBookmark(original, { ...original, selection: { ...readium(), text: { ...readium().text, before:'other' } } })).toBe(false);
  });
});
