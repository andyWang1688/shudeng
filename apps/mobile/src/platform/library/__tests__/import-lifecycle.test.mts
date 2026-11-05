import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShudengDataLayer, type ShudengDataLayer } from '../../db/engine';
import { createNodeSQLiteDriver, type NodeSQLiteDriver } from '@shudeng/core/db/testing';

const state = vi.hoisted(() => ({
  layer: null as ShudengDataLayer | null,
  files: new Map<string, Uint8Array>(),
  hashes: new Map<string, string>(),
  indexed: new Set<string>(),
  failure: '',
  rollbacks: 0,
  reads: 0,
  pdf: { pageCount: 0, textPageCount: 0 },
}));
const digest = 'a'.repeat(64);

vi.mock('expo-file-system', () => {
  const join = (values: readonly (string | { uri: string })[]) => values.map((value) => typeof value === 'string' ? value : value.uri).join('/');
  class Directory {
    uri: string;
    constructor(...values: (string | { uri: string })[]) { this.uri = join(values); }
    get exists() { return true; }
    create() {}
  }
  class File {
    uri: string;
    constructor(...values: (string | { uri: string })[]) { this.uri = join(values); }
    get exists() { return state.files.has(this.uri); }
    async digest() { if (state.failure === 'hash') throw new Error('hash failed'); return state.hashes.get(this.uri) ?? digest; }
    async copy(target: File) { state.files.set(target.uri, state.files.get(this.uri)!); state.hashes.set(target.uri, state.hashes.get(this.uri) ?? digest); }
    async move(target: File) {
      await Promise.resolve();
      const bytes = state.files.get(this.uri);
      if (!bytes) throw new Error('missing file');
      state.files.set(target.uri, bytes);
      if (state.hashes.has(this.uri)) state.hashes.set(target.uri, state.hashes.get(this.uri)!);
      state.files.delete(this.uri);
      this.uri = target.uri; // Expo mutates the original File instance after moving.
    }
    delete() { state.files.delete(this.uri); state.hashes.delete(this.uri); }
  }
  return { File, Directory, Paths: { document: { uri: 'file:///documents' } } };
});
vi.mock('../progress', () => ({
  ensureProgressTable: async () => state.layer,
  loadAllBookProgress: async () => {
    const rows = await state.layer!.driver.all<{ book_id: string; percent: number; page: number | null; chapter: string | null; updated_at: number }>('SELECT * FROM reading_progress');
    return new Map(rows.map((row) => [row.book_id, { percent: row.percent, page: row.page, chapter: row.chapter, updatedAt: row.updated_at }]));
  },
}));
vi.mock('../../db', () => ({ getDataLayer: async () => state.layer }));
vi.mock('../../ai/bookIndex', () => ({
  readBookContent: async () => {
    state.reads += 1;
    if (state.failure === 'parse') throw new Error('invalid publication');
    return { title: '真实书名', author: '作者', chapters: [{ ordinal: 1, title: '章节', text: '原文' }], ...(state.pdf.pageCount ? { pdf: state.pdf } : {}) };
  },
  startBookPreparation: (book: { id: string }) => {
    state.indexed.add(book.id);
  },
  resumeAvailableBookIndexes: async () => {},
  cancelBookIndexing: async () => {},
  deleteBookIndex: async (id: string) => { state.indexed.delete(id); },
}));
vi.mock('../conversations', () => ({
  loadConversationSummaries: async () => {
    const rows = await state.layer!.driver.all<{ id: string; book_id: string }>('SELECT id, book_id FROM conversations');
    return rows.map((row) => ({ conversationId: row.id, bookId: row.book_id }));
  },
  cancelConversationRun: () => {},
  markConversationsDeleted: () => () => { state.rollbacks += 1; },
}));
vi.mock('../bookCovers', () => ({ loadBookCover: async () => undefined, saveBookCover: async () => undefined }));

import { importBookAsset, loadShelfBooks, removeShelfBook, deleteShelfBook } from '../import';
import { recoverBookFileOperations, saveBookFileIntent } from '../bookFileOperations';

let driver: NodeSQLiteDriver;
const asset = { uri: 'file:///picked/book.epub', name: 'filename.epub', mimeType: 'application/epub+zip' };
const publication = 'file:///documents/Books/';

beforeEach(async () => {
  driver = createNodeSQLiteDriver();
  state.layer = await createShudengDataLayer(driver);
  await driver.exec('CREATE TABLE IF NOT EXISTS reading_progress (book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE, locator_json TEXT NOT NULL, percent REAL NOT NULL, page INTEGER, chapter TEXT, updated_at INTEGER NOT NULL)');
  state.files.clear(); state.hashes.clear(); state.indexed.clear(); state.failure = ''; state.rollbacks = 0; state.reads = 0;
  state.pdf = { pageCount: 0, textPageCount: 0 };
  state.files.set(asset.uri, new Uint8Array([1, 2, 3]));
});
afterEach(async () => { await driver.close(); });

async function legacyBook() {
  await state.layer!.store.saveBook({ id: 'legacy-id', sourceHash: digest, title: '旧书名', author: '作者', format: 'epub' });
  await driver.run('INSERT INTO reading_progress VALUES (?, ?, ?, ?, ?, ?)', ['legacy-id', '{}', 0.25, null, '第一章', 1]);
  const anchor = await state.layer!.store.saveAnchor({ bookId: 'legacy-id', engine: 'foliate', locatorJson: '{}', quote: '原文' });
  await state.layer!.store.saveAnnotation({ bookId: 'legacy-id', anchorId: anchor.id, kind: 'note', body: '保留笔记' });
  state.files.set(publication + 'legacy-id.epub', new Uint8Array([1, 2, 3]));
}

describe('book import and removal lifecycle', () => {
  it('publishes metadata then schedules background indexing and keeps the promoted file', async () => {
    const result = await importBookAsset(asset);
    expect(result).toMatchObject({ status: 'imported', book: { title: '真实书名', author: '作者', id: digest } });
    expect(state.files.has(publication + digest + '.epub')).toBe(true);
    expect([...state.files.keys()].some((uri) => uri.includes('.import-'))).toBe(false);
    expect(state.indexed.has(digest)).toBe(true);
  });

  it.each([['hash', 'hash failed'], ['parse', 'invalid publication']])('rolls back %s failure without a visible book, orphan index, or lost source', async (failure, message) => {
    state.failure = failure;
    await expect(importBookAsset(asset)).rejects.toThrow(message);
    expect(await state.layer!.store.listBooks()).toEqual([]);
    expect([...state.files.keys()]).toEqual([asset.uri]);
    expect(await driver.all('SELECT * FROM rag_chunks')).toEqual([]);
    expect(await driver.all('SELECT * FROM book_file_operations')).toEqual([]);
  });

  it('reuses the old ID and reading records for repeated import and removal/restoration', async () => {
    await legacyBook();
    expect(await importBookAsset(asset)).toMatchObject({ status: 'imported', book: { id: 'legacy-id', progressPercent: 25 } });
    expect(state.reads).toBe(0);
    await removeShelfBook('legacy-id');
    expect(await loadShelfBooks()).toEqual([]);
    expect(await loadShelfBooks({ onlyRemoved: true })).toMatchObject([{ id: 'legacy-id', removed: true }]);
    expect(await state.layer!.store.listAnnotations('legacy-id')).toHaveLength(1);
    expect(await importBookAsset(asset)).toMatchObject({ status: 'imported', book: { id: 'legacy-id', progressPercent: 25, removed: false } });
    expect(state.files.has(publication + 'legacy-id.epub')).toBe(true);
    expect(await state.layer!.store.listAnnotations('legacy-id')).toHaveLength(1);
  });

  it('removes searchable text, vectors, and index state while preserving reading records', async () => {
    await legacyBook();
    await driver.run('INSERT INTO rag_chunks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', ['chunk', 'legacy-id', 1, '章', null, 0, 2, '原文', '{}']);
    await driver.run('INSERT INTO rag_chunks_fts VALUES (?, ?, ?)', ['chunk', 'legacy-id', '原 文']);
    await driver.run('INSERT INTO rag_chunk_vectors VALUES (?, ?, ?, ?)', ['chunk', 'test', 1, new Uint8Array(4)]);
    await driver.run('INSERT INTO book_index_state VALUES (?, ?, ?, ?, ?)', ['legacy-id', 'ready', '可查询', digest, 1]);
    await removeShelfBook('legacy-id');
    for (const table of ['rag_chunks', 'rag_chunks_fts', 'rag_chunk_vectors', 'book_index_state']) expect(await driver.all('SELECT * FROM ' + table)).toEqual([]);
    expect(await driver.all('SELECT * FROM reading_progress')).toHaveLength(1);
    expect(await state.layer!.store.listAnnotations('legacy-id')).toHaveLength(1);
  });

  it('repairs a corrupt existing publication from a verified picker copy', async () => {
    await legacyBook();
    state.hashes.set(publication + 'legacy-id.epub', 'b'.repeat(64));
    expect(await importBookAsset(asset)).toMatchObject({ status: 'imported', book: { id: 'legacy-id' } });
    expect(state.reads).toBe(1);
    expect(state.hashes.get(publication + 'legacy-id.epub') ?? digest).toBe(digest);
    expect(state.files.has(asset.uri)).toBe(true);
    expect(await state.layer!.store.listAnnotations('legacy-id')).toHaveLength(1);
  });

  it('keeps same-name publications with different bytes as separate books', async () => {
    await importBookAsset(asset);
    const other = { ...asset, uri: 'file:///picked/other.epub' };
    state.files.set(other.uri, new Uint8Array([9, 8, 7]));
    state.hashes.set(other.uri, 'b'.repeat(64));
    expect(await importBookAsset(other)).toMatchObject({ status: 'imported', book: { id: 'b'.repeat(64) } });
    expect(await loadShelfBooks()).toHaveLength(2);
    expect(state.files.has(publication + digest + '.epub')).toBe(true);
  });

  it('rolls back all unique records when permanent deletion fails after conversation deletion', async () => {
    await legacyBook();
    await driver.run('INSERT INTO conversations VALUES (?, ?, ?, ?, ?)', ['c1', 'legacy-id', null, 1, 1]);
    await state.layer!.store.appendMessage({ conversationId: 'c1', role: 'assistant', content: '保留回答' });
    await driver.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON books BEGIN SELECT RAISE(ABORT, 'storage failed'); END");
    await expect(deleteShelfBook('legacy-id')).rejects.toThrow(/storage failed/);
    expect(await state.layer!.store.getBook('legacy-id')).not.toBeNull();
    expect(await state.layer!.store.listMessages('c1')).toHaveLength(1);
    expect(await state.layer!.store.listAnnotations('legacy-id')).toHaveLength(1);
    expect(state.files.has(publication + 'legacy-id.epub')).toBe(true);
    expect(state.rollbacks).toBe(1);
  });

  it('requires confirmation for mixed PDF pages and cancels before publishing', async () => {
    const pdf = { ...asset, name: 'mixed.pdf', mimeType: 'application/pdf' };
    state.pdf = { pageCount: 2, textPageCount: 1 };
    const confirm = vi.fn(async () => false);
    expect(await importBookAsset(pdf, { confirmScannedPdf: confirm })).toEqual({ status: 'cancelled' });
    expect(confirm).toHaveBeenCalledWith({ pageCount: 2, textPageCount: 1 });
    expect(await loadShelfBooks()).toEqual([]);
    expect([...state.files.keys()]).toEqual([asset.uri]);
  });

  it('recovers termination after publication promotion but before its books row is saved', async () => {
    const targetUri = publication + digest + '.epub';
    state.files.set(targetUri, new Uint8Array([1, 2, 3]));
    await saveBookFileIntent(digest, { kind: 'import', phase: 'ready', existing: false, targetUri, stagingUri: publication + '.importing-' + digest + '.epub', book: { id: digest, title: '待恢复书', author: '作者', format: 'epub', sourceHash: digest } });
    expect(await loadShelfBooks()).toMatchObject([{ id: digest, title: '待恢复书' }]);
    expect(state.files.has(targetUri)).toBe(true);
    expect(await driver.all('SELECT * FROM book_file_operations')).toEqual([]);
  });

  it('restores a unique publication if removal terminated before its database commit', async () => {
    await legacyBook();
    const targetUri = publication + 'legacy-id.epub';
    const stagingUri = publication + '.removing-legacy-id.epub';
    state.files.set(stagingUri, state.files.get(targetUri)!);
    state.files.delete(targetUri);
    await saveBookFileIntent('legacy-id', { kind: 'remove', targetUri, stagingUri });
    await recoverBookFileOperations();
    expect(state.files.has(targetUri)).toBe(true);
    expect(state.files.has(stagingUri)).toBe(false);
    expect(await loadShelfBooks()).toMatchObject([{ id: 'legacy-id', removed: false }]);
  });

  it('finishes publication cleanup after permanent removal committed but the process terminated', async () => {
    const targetUri = publication + 'legacy-id.epub';
    const stagingUri = publication + '.deleting-legacy-id.epub';
    state.files.set(stagingUri, new Uint8Array([1, 2, 3]));
    await saveBookFileIntent('legacy-id', { kind: 'delete', targetUri, stagingUri });
    await deleteShelfBook('legacy-id');
    expect(state.files.has(stagingUri)).toBe(false);
    expect(await driver.all('SELECT * FROM book_file_operations')).toEqual([]);
  });
});

// Independent acceptance cases: use the actual import/recovery paths and actual SQLite.
const frozenImportTime = 2_000_000_000_000;
afterEach(() => { vi.restoreAllMocks(); });

function pickedBook(symbol: string) {
  const item = { ...asset, uri: 'file:///picked/' + symbol + '.epub', name: symbol + '.epub' };
  state.files.set(item.uri, new Uint8Array([symbol.charCodeAt(0)]));
  state.hashes.set(item.uri, symbol.repeat(64));
  return item;
}
async function shelfIds() { return (await loadShelfBooks()).map(book => book.id); }
async function markRemovedWithFile(id: string) {
  await driver.run('UPDATE books SET removed_at = ? WHERE id = ?', [frozenImportTime, id]);
}
async function migrationTies() {
  // Input order deliberately differs from ID/title order.
  for (const [id, title] of [['c', '丙'], ['a', '甲'], ['b', '乙']]) {
    await driver.run('INSERT INTO books (id, title, format, source_hash, imported_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [id, title, 'epub', id.repeat(64), frozenImportTime, frozenImportTime]);
    state.files.set(publication + id + '.epub', new Uint8Array([1]));
    state.hashes.set(publication + id + '.epub', id.repeat(64));
  }
}

describe('native catalog append parity without data loss', () => {
  it('same-millisecond remove/reimport appends, active duplicate stays, next new book follows it', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(frozenImportTime);
    const a = pickedBook('a'), b = pickedBook('b'), c = pickedBook('c');
    await importBookAsset(a);
    await importBookAsset(b);
    await removeShelfBook('a'.repeat(64));
    await importBookAsset(a);
    expect(await shelfIds()).toEqual(['b'.repeat(64), 'a'.repeat(64)]);
    const restoredTime = (await state.layer!.store.getBook('a'.repeat(64)))!.importedAt;
    await importBookAsset(a);
    expect((await state.layer!.store.getBook('a'.repeat(64)))!.importedAt).toBe(restoredTime);
    await importBookAsset(c);
    expect(await shelfIds()).toEqual(['b'.repeat(64), 'a'.repeat(64), 'c'.repeat(64)]);
  });

  it('ties from native migration keep insertion order; fast restore appends only the removed book', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(frozenImportTime);
    await migrationTies();
    expect(await shelfIds()).toEqual(['c', 'a', 'b']);
    await importBookAsset(pickedBook('a'));
    expect(await shelfIds()).toEqual(['c', 'a', 'b']);
    expect((await state.layer!.store.getBook('a'))!.importedAt).toBe(frozenImportTime);
    await markRemovedWithFile('a');
    expect(await shelfIds()).toEqual(['c', 'b']);
    await importBookAsset(pickedBook('a'));
    expect(await shelfIds()).toEqual(['c', 'b', 'a']);
    expect((await state.layer!.store.getBook('c'))!.importedAt).toBe(frozenImportTime);
    expect((await state.layer!.store.getBook('b'))!.importedAt).toBe(frozenImportTime);
  });

  it('multiple removals restore in reimport order and preserve original progress/notes', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(frozenImportTime);
    await legacyBook();
    await importBookAsset(pickedBook('b'));
    await importBookAsset(pickedBook('c'));
    await removeShelfBook('legacy-id');
    await removeShelfBook('b'.repeat(64));
    await importBookAsset(pickedBook('b'));
    const result = await importBookAsset(asset);
    expect(result).toMatchObject({ status: 'imported', book: { id: 'legacy-id', progressPercent: 25 } });
    expect(await shelfIds()).toEqual(['c'.repeat(64), 'b'.repeat(64), 'legacy-id']);
    expect(await state.layer!.store.listAnnotations('legacy-id')).toMatchObject([{ body: '保留笔记' }]);
    expect(await driver.all('SELECT * FROM reading_progress WHERE book_id = ?', ['legacy-id'])).toHaveLength(1);
  });

  it('clock rollback still appends a newly imported book after restored books', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(frozenImportTime);
    const a = pickedBook('a'), b = pickedBook('b'), c = pickedBook('c');
    await importBookAsset(a); await importBookAsset(b);
    await removeShelfBook('a'.repeat(64));
    clock.mockReturnValue(frozenImportTime - 86_400_000);
    await importBookAsset(a); await importBookAsset(c);
    expect(await shelfIds()).toEqual(['b'.repeat(64), 'a'.repeat(64), 'c'.repeat(64)]);
    expect((await state.layer!.store.getBook('c'.repeat(64)))!.updatedAt).toBe(frozenImportTime - 86_400_000);
  });

  it('atomic restore failure keeps the book removed, order time, progress, and its ready intent', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(frozenImportTime);
    await legacyBook(); await importBookAsset(pickedBook('b'));
    await removeShelfBook('legacy-id');
    const before = (await state.layer!.store.getBook('legacy-id'))!;
    await driver.exec("CREATE TRIGGER fail_restore BEFORE UPDATE OF removed_at ON books WHEN OLD.removed_at IS NOT NULL AND NEW.removed_at IS NULL BEGIN SELECT RAISE(ABORT, 'restore blocked'); END");
    const rejected = await importBookAsset(asset).catch(error => error);
    expect(rejected).toBeInstanceOf(Error);
    expect(String(rejected.cause ?? rejected)).toMatch(/restore blocked/);
    expect((await state.layer!.store.listBooks()).filter(book => book.removedAt === null).map(book => book.id)).toEqual(['b'.repeat(64)]);
    const failed = (await state.layer!.store.getBook('legacy-id'))!;
    expect(failed.importedAt).toBe(before.importedAt);
    expect(failed.removedAt).toBe(before.removedAt);
    expect(await driver.all('SELECT * FROM book_file_operations WHERE id = ?', ['legacy-id'])).toHaveLength(1);
    expect(await state.layer!.store.listAnnotations('legacy-id')).toHaveLength(1);
    await driver.exec('DROP TRIGGER fail_restore');
    await recoverBookFileOperations();
    expect(await shelfIds()).toEqual(['b'.repeat(64), 'legacy-id']);
    expect(await driver.all('SELECT * FROM reading_progress WHERE book_id = ?', ['legacy-id'])).toHaveLength(1);
  });

  it('ready intent replay after cleanup failure never moves an already restored book again', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(frozenImportTime);
    await legacyBook(); await importBookAsset(pickedBook('b'));
    await removeShelfBook('legacy-id');
    await driver.exec("CREATE TRIGGER fail_intent_cleanup BEFORE DELETE ON book_file_operations WHEN OLD.id = 'legacy-id' BEGIN SELECT RAISE(ABORT, 'intent cleanup blocked'); END");
    await expect(importBookAsset(asset)).rejects.toThrow(/intent cleanup blocked/);
    const restored = (await state.layer!.store.getBook('legacy-id'))!;
    expect(restored.removedAt).toBeNull();
    expect(await driver.all('SELECT * FROM book_file_operations WHERE id = ?', ['legacy-id'])).toHaveLength(1);
    await driver.exec('DROP TRIGGER fail_intent_cleanup');
    // Simulate a second, later publication committed before the old durable intent is replayed.
    await state.layer!.store.saveBook({ id: 'later-book', title: '后来导入', format: 'epub', sourceHash: 'd'.repeat(64) });
    await recoverBookFileOperations();
    expect((await state.layer!.store.getBook('legacy-id'))!.importedAt).toBe(restored.importedAt);
    expect(await shelfIds()).toEqual(['b'.repeat(64), 'legacy-id', 'later-book']);
    expect(await driver.all('SELECT * FROM book_file_operations')).toHaveLength(0);
  });

  it('active corrupt-file repair preserves order and importedAt', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(frozenImportTime);
    await legacyBook(); await importBookAsset(pickedBook('b'));
    const before = (await state.layer!.store.getBook('legacy-id'))!;
    state.hashes.set(publication + 'legacy-id.epub', 'f'.repeat(64));
    await importBookAsset(asset);
    expect(await shelfIds()).toEqual(['legacy-id', 'b'.repeat(64)]);
    expect((await state.layer!.store.getBook('legacy-id'))!.importedAt).toBe(before.importedAt);
  });

  it('missing ready publication leaves the removed book and records unchanged until its file is available', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(frozenImportTime);
    await legacyBook(); await importBookAsset(pickedBook('b'));
    await removeShelfBook('legacy-id');
    const before = (await state.layer!.store.getBook('legacy-id'))!;
    const targetUri = publication + 'legacy-id.epub';
    const stagingUri = publication + '.importing-legacy-id.epub';
    await saveBookFileIntent('legacy-id', { kind: 'import', phase: 'ready', existing: true, targetUri, stagingUri, book: { id: 'legacy-id', title: before.title, author: before.author, format: 'epub', sourceHash: digest } });
    await expect(recoverBookFileOperations()).rejects.toThrow('导入的书籍文件缺失，请重新导入');
    expect((await state.layer!.store.getBook('legacy-id'))!.importedAt).toBe(before.importedAt);
    expect((await state.layer!.store.getBook('legacy-id'))!.removedAt).toBe(before.removedAt);
    expect(await state.layer!.store.listAnnotations('legacy-id')).toHaveLength(1);
    expect(await driver.all('SELECT * FROM book_file_operations')).toHaveLength(1);
    state.files.set(stagingUri, new Uint8Array([1, 2, 3]));
    await recoverBookFileOperations();
    expect(await shelfIds()).toEqual(['b'.repeat(64), 'legacy-id']);
    expect(await driver.all('SELECT * FROM reading_progress WHERE book_id = ?', ['legacy-id'])).toHaveLength(1);
  });
});
