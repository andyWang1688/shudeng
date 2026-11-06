import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNodeSQLiteDriver, type NodeSQLiteDriver } from '@shudeng/core/db/testing';
import { createShudengDataLayer, type ShudengDataLayer } from '../../db/engine';

const state = vi.hoisted(() => ({ layer: null as ShudengDataLayer | null, working: null as NodeSQLiteDriver | null, files: new Map<string, string>(), copyIndex: null as (() => Promise<void>) | null }));
vi.mock('../../db', () => ({ getDataLayer: async () => state.layer }));
vi.mock('@shudeng/core/db', async original => ({ ...await original<typeof import('@shudeng/core/db')>(), createExpoSQLiteDriver: (database: unknown) => database }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => state.working }));
vi.mock('expo-file-system', () => {
  const join = (values: readonly (string | { uri: string })[]) => values.map(value => typeof value === 'string' ? value : value.uri).join('/');
  class File {
    uri: string;
    constructor(...values: (string | { uri: string })[]) { this.uri = join(values); }
    get exists() { return state.files.has(this.uri); }
    get name() { return this.uri.slice(this.uri.lastIndexOf('/') + 1); }
    get parentDirectory() { return new Directory(this.uri.slice(0, this.uri.lastIndexOf('/'))); }
    async copy(target: File) { if (this.name === 'book-index.sqlite') await state.copyIndex!(); state.files.set(target.uri, state.files.get(this.uri)!); }
    delete() { state.files.delete(this.uri); }
    write(value: string) { state.files.set(this.uri, value); }
  }
  class Directory {
    uri: string;
    constructor(...values: (string | { uri: string })[]) { this.uri = join(values); }
    get exists() { return [...state.files.keys()].some(key => key.startsWith(this.uri + '/')); }
    create() {}
  }
  return { File, Directory, Paths: { document: { uri: 'file:///documents' } } };
});
vi.mock('../../embedding', () => ({ embeddingStatus: async () => ({ available: false, reason: '未安装' }) }));
vi.mock('../../ai/bookIndex', () => ({ cancelBookIndexing: async () => {}, readBookContent: async () => ({}), startBookPreparation: () => {}, resumeAvailableBookIndexes: async () => {} }));
vi.mock('../progress', () => ({ ensureProgressTable: async () => state.layer, loadAllBookProgress: async () => new Map() }));
vi.mock('../conversations', () => ({ listConversationIdsForBook: async () => [], markConversationsDeleted: () => () => {}, cancelConversationRun: () => {} }));
vi.mock('../bookCovers', () => ({ loadBookCover: async () => undefined, saveBookCover: async () => undefined }));

const tables = ['fragment_terms', 'embeddings', 'fragments', 'chapters', 'contents', 'preparations', 'embedding_progress'];
const workingFile = 'file:///documents/SQLite/legacy-book-index.sqlite';
const originalFile = 'file:///documents/legacy/book-index.sqlite';
const book = { id: 'retired', title: '旧书', format: 'epub' as const, sourceHash: 'hash' };
let driver: NodeSQLiteDriver;
let original: NodeSQLiteDriver;

async function seedLegacy(target: NodeSQLiteDriver) {
  await target.exec('CREATE TABLE chapters (book_id TEXT, ordinal INTEGER, href TEXT, title TEXT)');
  await target.exec('CREATE TABLE fragments (id INTEGER PRIMARY KEY, book_id TEXT, chapter INTEGER, ordinal INTEGER, original TEXT, locator TEXT)');
  await target.exec('CREATE VIRTUAL TABLE fragment_terms USING fts5(book_id UNINDEXED, terms)');
  await target.exec('CREATE TABLE embeddings (book_id TEXT, model TEXT, fragment_id INTEGER, piece INTEGER, offset INTEGER, original TEXT, vector BLOB)');
  for (const table of ['contents', 'preparations', 'embedding_progress']) await target.exec('CREATE TABLE ' + table + ' (book_id TEXT)');
  for (const [index, id] of ['retired', 'other'].entries()) {
    await target.run('INSERT INTO chapters VALUES (?, 0, ?, ?)', [id, 'chapter.xhtml', '第一章']);
    await target.run('INSERT INTO fragments VALUES (?, ?, 0, 0, ?, ?)', [index + 1, id, '旧原文', '{}']);
    await target.run('INSERT INTO fragment_terms VALUES (?, ?)', [id, '旧原文']);
    await target.run('INSERT INTO embeddings VALUES (?, ?, ?, 0, 0, ?, ?)', [id, 'old', index + 1, '旧原文', new Uint8Array(4)]);
    for (const table of ['contents', 'preparations', 'embedding_progress']) await target.run('INSERT INTO ' + table + ' VALUES (?)', [id]);
  }
}

beforeEach(async () => {
  vi.resetModules();
  driver = createNodeSQLiteDriver();
  state.layer = await createShudengDataLayer(driver);
  await state.layer.store.saveBook(book);
  await state.layer.store.saveBook({ ...book, id: 'other', sourceHash: 'other' });
  original = createNodeSQLiteDriver();
  state.working = createNodeSQLiteDriver();
  await seedLegacy(original);
  await seedLegacy(state.working);
  state.copyIndex = () => seedLegacy(state.working!);
  state.files.clear();
  state.files.set(originalFile, 'unchanged backup');
  state.files.set(workingFile, 'working copy');
});
afterEach(async () => { await driver.close(); await original.close(); await state.working!.close(); });

describe('legacy working index lifecycle', () => {
  it.each(['remove', 'delete'])('purges only working rows on %s and keeps that legacy source retired after reimport', async kind => {
    const legacy = await import('../../ai/legacyIndex');
    expect((await legacy.getLegacyIndexStatus(book.id)).available).toBe(true);
    const library = await import('../import');
    if (kind === 'remove') await library.removeShelfBook(book.id); else await library.deleteShelfBook(book.id);
    for (const table of tables) {
      expect(await state.working!.all('SELECT book_id FROM ' + table + ' WHERE book_id = ?', [book.id])).toEqual([]);
      expect(await original.all('SELECT book_id FROM ' + table + ' WHERE book_id = ?', [book.id])).toHaveLength(1);
      expect(await state.working!.all('SELECT book_id FROM ' + table + ' WHERE book_id = ?', ['other'])).toHaveLength(1);
    }
    await state.layer!.store.saveBook(book);
    await driver.run('UPDATE books SET removed_at = NULL WHERE id = ?', [book.id]);
    expect((await legacy.getLegacyIndexStatus(book.id)).available).toBe(false);
    await expect(legacy.createLegacyBookSource(book)).rejects.toThrow();
    expect(state.files.get(originalFile)).toBe('unchanged backup');
  });

  it('purges retired rows again when a later process recopies the full immutable backup', async () => {
    const library = await import('../import');
    await library.deleteShelfBook(book.id);
    await state.working!.close();
    state.working = createNodeSQLiteDriver();
    state.files.delete(workingFile);
    vi.resetModules();
    const legacy = await import('../../ai/legacyIndex');
    expect((await legacy.getLegacyIndexStatus('other')).available).toBe(true);
    for (const table of tables) expect(await state.working!.all('SELECT book_id FROM ' + table + ' WHERE book_id = ?', [book.id])).toEqual([]);
    expect((await legacy.getLegacyIndexStatus(book.id)).available).toBe(false);
  });

  it('keeps a cleanup intent and retries if the working database rejects deletion', async () => {
    await state.working!.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON fragments BEGIN SELECT RAISE(ABORT, 'legacy cleanup failed'); END");
    const library = await import('../import');
    await expect(library.removeShelfBook(book.id)).rejects.toThrow('legacy cleanup failed');
    expect(await driver.all('SELECT id FROM book_file_operations')).toEqual([{ id: book.id }]);
    await state.working!.exec('DROP TRIGGER fail_delete');
    const { recoverBookFileOperations } = await import('../bookFileOperations');
    await recoverBookFileOperations();
    expect(await driver.all('SELECT id FROM book_file_operations')).toEqual([]);
    expect(await state.working!.all('SELECT * FROM fragments WHERE book_id = ?', [book.id])).toEqual([]);
  });
});
