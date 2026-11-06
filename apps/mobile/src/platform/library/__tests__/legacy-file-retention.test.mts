import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShudengDataLayer, type ShudengDataLayer } from '../../db/engine';
import { createNodeSQLiteDriver, type NodeSQLiteDriver } from '@shudeng/core/db/testing';
import { createHash } from 'node:crypto';

const state = vi.hoisted(() => ({ layer: null as ShudengDataLayer | null, files: new Map<string, string>(), interruptCopy: false }));
vi.mock('../../db', () => ({ getDataLayer: async () => state.layer }));
vi.mock('expo-file-system', () => {
  const join = (values: readonly (string | { uri: string })[]) => values.map((value) => typeof value === 'string' ? value : value.uri).join('/');
  class File {
    uri: string;
    constructor(...values: (string | { uri: string })[]) { this.uri = join(values); }
    get exists() { return state.files.has(this.uri); }
    get name() { return this.uri.slice(this.uri.lastIndexOf('/') + 1); }
    async copy(target: File) { state.files.set(target.uri, state.interruptCopy ? 'partial' : state.files.get(this.uri)!); if (state.interruptCopy) throw new Error('copy interrupted'); }
    async digest() { return createHash('sha256').update(state.files.get(this.uri) ?? '').digest('hex'); }
    move(target: File) { state.files.set(target.uri, state.files.get(this.uri)!); state.files.delete(this.uri); this.uri = target.uri; }
    delete() { state.files.delete(this.uri); }
    textSync() { return state.files.get(this.uri); }
    write(text: string) { state.files.set(this.uri, text); }
  }
  class Directory {
    uri: string;
    constructor(...values: (string | { uri: string })[]) { this.uri = join(values); }
    get exists() { return [...state.files.keys()].some((key) => key.startsWith(this.uri + '/')); }
    create() {}
    list() { return [...state.files.keys()].filter((key) => key.startsWith(this.uri + '/') && !key.slice(this.uri.length + 1).includes('/')).map((key) => new File(key)); }
  }
  return { File, Directory, Paths: { document: { uri: 'file:///documents' } } };
});
vi.mock('../../ai/bookIndex', () => ({ cancelBookIndexing: async () => {}, readBookContent: async () => ({}), startBookPreparation: () => {}, resumeAvailableBookIndexes: async () => {} }));
vi.mock('../bookCovers', () => ({ loadBookCover: async () => undefined, saveBookCover: async () => undefined }));
vi.mock('../conversations', () => ({ listConversationIdsForBook: async () => [], markConversationsDeleted: () => () => {}, cancelConversationRun: () => {} }));
import { migrateLegacyLibraryIfNeeded } from '../legacyMigration';
import { deleteShelfBook } from '../import';
import { loadReaderPreferences } from '../readerPreferences';

let driver: NodeSQLiteDriver;
beforeEach(async () => {
  driver = createNodeSQLiteDriver();
  state.layer = await createShudengDataLayer(driver);
  state.files.clear();
  state.interruptCopy = false;
  await driver.exec('PRAGMA foreign_keys = ON');
  state.files.set('file:///documents/legacy/.imported', '1');
  for (const id of ['active', 'removed', 'deleted']) state.files.set('file:///documents/legacy/Books/' + id + '.epub', 'publication');
  await state.layer.store.saveBook({ id: 'active', title: '仍在书架', format: 'epub', sourceHash: 'active' });
  await state.layer.store.saveBook({ id: 'removed', title: '已移除原书', format: 'epub', sourceHash: 'removed' });
  await driver.run('UPDATE books SET removed_at = 1 WHERE id = ?', ['removed']);
});
afterEach(async () => { await driver.close(); });

describe('legacy publication retention after migration', () => {
  it('repairs an active missing publication but never resurrects removed/deleted books on later launches', async () => {
    const first = await migrateLegacyLibraryIfNeeded();
    expect(first).toMatchObject({ imported: true, books: 2 });
    expect(state.files.has('file:///documents/Books/active.epub')).toBe(true);
    expect(state.files.has('file:///documents/Books/removed.epub')).toBe(false);
    expect(state.files.has('file:///documents/Books/deleted.epub')).toBe(false);
    expect((await migrateLegacyLibraryIfNeeded()).imported).toBe(false);
    expect(await state.layer!.store.listBooks()).toHaveLength(2);
    expect(state.files.has('file:///documents/legacy/Books/removed.epub')).toBe(true);
  });

  it('retries an interrupted copy and repairs an old partial final file from the unchanged legacy source', async () => {
    state.interruptCopy = true;
    await expect(migrateLegacyLibraryIfNeeded()).rejects.toThrow('copy interrupted');
    expect(state.files.has('file:///documents/Books/active.epub')).toBe(false);
    state.interruptCopy = false;
    state.files.set('file:///documents/Books/active.epub', 'partial');
    await migrateLegacyLibraryIfNeeded();
    expect(state.files.get('file:///documents/Books/active.epub')).toBe('publication');
    expect(state.files.get('file:///documents/legacy/Books/active.epub')).toBe('publication');
  });

  it('backfills retained books for same-process reimport but never resurrects permanently deleted progress/settings', async () => {
    const locatorJSON = JSON.stringify({ href: 'chapter.xhtml', type: 'application/xhtml+xml', locations: { totalProgression: .7 } });
    state.files.set('file:///documents/legacy/library.json', JSON.stringify(['active', 'removed', 'deleted'].map(id => ({ id, format: 'epub', locatorJSON, readingSettings: { dark: true, fontSize: 140 } }))));
    const { loadAllBookProgress, loadBookProgress } = await import('../progress');
    expect([...(await loadAllBookProgress()).keys()]).toEqual(['active', 'removed']);
    expect(await loadReaderPreferences('removed', { format: 'epub' })).toMatchObject({ theme: 'dark', fontScale: 1.4 });
    await driver.run('UPDATE books SET removed_at = NULL WHERE id = ?', ['removed']);
    expect((await loadBookProgress('removed'))?.percent).toBe(.7);
    expect(await loadReaderPreferences('removed', { format: 'epub' })).toMatchObject({ theme: 'dark', fontScale: 1.4 });
    await deleteShelfBook('active');
    await state.layer!.store.saveBook({ id: 'active', title: '重新导入', format: 'epub', sourceHash: 'active' });
    vi.resetModules();
    const restartedProgress = await import('../progress');
    const restartedPreferences = await import('../readerPreferences');
    expect(await restartedProgress.loadBookProgress('active')).toBeNull();
    expect(await restartedPreferences.loadReaderPreferences('active', { format: 'epub' })).toMatchObject({ theme: 'light', fontScale: 1 });
  });

  it('finishes legacy removing/deleting intents while retaining only the removed book records', async () => {
    state.files.delete('file:///documents/legacy/.imported');
    await driver.run('DELETE FROM books');
    const locatorJSON = JSON.stringify({ href: 'chapter.xhtml', type: 'application/xhtml+xml', locations: { progression: .2 }, text: { highlight: '保留原文' } });
    state.files.set('file:///documents/legacy/library.json', JSON.stringify([null, 'removed', 'removing', 'deleting'].map((removal, index) => ({ id: 'old-' + index, title: '旧书' + index, format: 'epub', ...(removal ? { removal } : {}), notes: [{ id: 'note-' + index, locatorJSON, body: '笔记' }] }))));
    state.files.set('file:///documents/legacy/reading-questions.json', JSON.stringify([{ id: 'question-deleted', bookID: 'old-3', question: '旧问题', answer: '旧回答', state: 'complete' }]));
    for (const id of ['old-0', 'old-1', 'old-2', 'old-3']) state.files.set('file:///documents/legacy/Books/' + id + '.epub', 'publication');
    state.files.set('file:///documents/Books/old-3.epub', 'publication');
    await migrateLegacyLibraryIfNeeded();
    expect(await state.layer!.store.getBook('old-0')).toMatchObject({ removedAt: null });
    for (const id of ['old-1', 'old-2']) {
      expect((await state.layer!.store.getBook(id))?.removedAt).not.toBeNull();
      expect(await state.layer!.store.listAnnotations(id)).toHaveLength(1);
      expect(state.files.has('file:///documents/Books/' + id + '.epub')).toBe(false);
    }
    expect(await state.layer!.store.getBook('old-3')).toBeNull();
    expect(await driver.all('SELECT * FROM messages')).toEqual([]);
    expect(await driver.all('SELECT * FROM annotations WHERE book_id = ?', ['old-3'])).toEqual([]);
    expect(state.files.has('file:///documents/Books/old-3.epub')).toBe(false);
    expect(state.files.has('file:///documents/legacy/Books/old-3.epub')).toBe(true);
    await migrateLegacyLibraryIfNeeded();
    expect(await state.layer!.store.getBook('old-3')).toBeNull();
  });

  it('repairs removal states skipped by an older migration marker once without replaying them after reimport', async () => {
    state.files.set('file:///documents/legacy/library.json', JSON.stringify([{ id: 'active', title: '旧已移除书', removal: 'removing' }, { id: 'removed', title: '旧彻底删除书', removal: 'deleting' }]));
    await migrateLegacyLibraryIfNeeded();
    expect((await state.layer!.store.getBook('active'))?.removedAt).not.toBeNull();
    expect(await state.layer!.store.getBook('removed')).toBeNull();
    await driver.run('UPDATE books SET removed_at = NULL WHERE id = ?', ['active']);
    await migrateLegacyLibraryIfNeeded();
    expect((await state.layer!.store.getBook('active'))?.removedAt).toBeNull();
    expect(state.files.has('file:///documents/Books/active.epub')).toBe(true);
  });

  it('does not replay committed deletion when file copying failed before the migration file marker', async () => {
    state.files.delete('file:///documents/legacy/.imported');
    await driver.run('DELETE FROM books');
    state.files.set('file:///documents/legacy/library.json', JSON.stringify([
      { id: 'old-deleted', title: '已彻底删除', format: 'epub', removal: 'deleting' },
      { id: 'old-active', title: '待复制', format: 'epub' },
    ]));
    state.files.set('file:///documents/legacy/Books/old-active.epub', 'publication');
    state.interruptCopy = true;
    await expect(migrateLegacyLibraryIfNeeded()).rejects.toThrow('copy interrupted');
    expect(state.files.has('file:///documents/legacy/.imported')).toBe(false);
    await state.layer!.store.saveBook({ id: 'old-deleted', title: '重新导入的新一代', format: 'epub', sourceHash: 'old-deleted' });
    state.files.set('file:///documents/Books/old-deleted.epub', 'new publication');
    state.interruptCopy = false;
    await migrateLegacyLibraryIfNeeded();
    expect(await state.layer!.store.getBook('old-deleted')).toMatchObject({ title: '重新导入的新一代' });
    expect(state.files.get('file:///documents/Books/old-deleted.epub')).toBe('new publication');
    expect(state.files.has('file:///documents/legacy/.imported')).toBe(true);
  });
});
