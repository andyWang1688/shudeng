import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParagraphTextChunker, SqliteSearchIndex, type EmbeddingProvider } from '@shudeng/core';
import { createNodeSQLiteDriver, type NodeSQLiteDriver } from '@shudeng/core/db/testing';
import { createShudengDataLayer, type ShudengDataLayer } from '../../db/engine';

const state = vi.hoisted(() => ({ layer: null as ShudengDataLayer | null, embed: null as EmbeddingProvider['embed'] | null }));
vi.mock('../../db', () => ({ getDataLayer: async () => state.layer }));
vi.mock('../../epubArchive', () => ({ openEpubArchive: async () => { throw new Error('not needed by query tests'); } }));
vi.mock('../../embedding', () => ({
  embeddingStatus: async () => ({ available: true, modelId: 'test', dimension: 1 }),
  getEmbeddingProvider: () => ({ modelId: 'test', dimension: 1, embed: (...args: Parameters<EmbeddingProvider['embed']>) => state.embed!(...args) }),
}));
vi.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(...values: (string | { uri: string })[]) { this.uri = values.map(value => typeof value === 'string' ? value : value.uri).join('/'); }
    get exists() { return false; }
  }
  return { File, Directory: File, Paths: { document: { uri: 'file:///documents' } } };
});
vi.mock('../progress', () => ({ ensureProgressTable: async () => state.layer, loadAllBookProgress: async () => new Map() }));
vi.mock('../conversations', () => ({ listConversationIdsForBook: async () => [], markConversationsDeleted: () => () => {}, cancelConversationRun: () => {} }));
vi.mock('../bookCovers', () => ({ loadBookCover: async () => undefined, saveBookCover: async () => undefined }));
import { BOOK_INDEX_FORMAT_VERSION, createLocalBookSource } from '../../ai/bookIndex';
import { deleteShelfBook, removeShelfBook } from '../import';
import { saveBookFileIntent } from '../bookFileOperations';

let driver: NodeSQLiteDriver;
const book = { id: 'race-book', title: '竞态测试', format: 'epub' as const, sourceHash: 'hash' };
beforeEach(async () => {
  driver = createNodeSQLiteDriver();
  state.layer = await createShudengDataLayer(driver);
  await state.layer.store.saveBook(book);
  const ragBook = { book, chapters: [{ ordinal: 1, title: '章', text: '灯照亮书页' }] };
  const chunks = new ParagraphTextChunker().chunk(ragBook);
  const embedding = { dimension: 1, modelId: 'test', embed: async () => [new Float32Array([1])] };
  await new SqliteSearchIndex(driver, embedding).indexBook(ragBook, chunks, chunks.map(() => new Float32Array([1])));
  await driver.run('INSERT INTO book_index_state VALUES (?, ?, ?, ?, ?)', [book.id, 'ready', '就绪', book.sourceHash, 1]);
  await driver.run('INSERT INTO app_preferences (key, value_json) VALUES (?, ?)', [`book-index-format:${book.id}`, JSON.stringify({ version: BOOK_INDEX_FORMAT_VERSION, sourceHash: book.sourceHash })]);
});
afterEach(async () => { await driver.close(); });

describe('query embedding completion after a book operation', () => {
  it('all tools on an old BookSource reject after deletion and same-hash reimport', async () => {
    state.embed = async () => [new Float32Array([1])];
    const source = await createLocalBookSource(book);
    await deleteShelfBook(book.id); await state.layer!.store.saveBook(book);
    const ragBook = { book, chapters: [{ ordinal: 1, title: '新一代', text: '新一代正文' }] };
    await new SqliteSearchIndex(driver, null).indexBook(ragBook, new ParagraphTextChunker().chunk(ragBook), []);
    await expect(source.search('正文')).rejects.toMatchObject({ name: 'AbortError' });
    await expect(source.page(1)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(source.chapter('1')).rejects.toMatchObject({ name: 'AbortError' });
  });
  it.each(['remove', 'delete', 'intent', 'reimport'])('cannot restore index state after %s', async kind => {
    let rejectEmbedding!: (error: Error) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    state.embed = async () => { entered(); return new Promise((_, reject) => { rejectEmbedding = reject; }); };
    const source = await createLocalBookSource(book);
    const pending = source.search('灯');
    await started;
    if (kind === 'remove') await removeShelfBook(book.id);
    else if (kind === 'delete' || kind === 'reimport') {
      await deleteShelfBook(book.id);
      if (kind === 'reimport') {
        await state.layer!.store.saveBook(book);
        await driver.run('INSERT INTO book_index_state VALUES (?, ?, ?, ?, ?)', [book.id, 'ready', '新一代', book.sourceHash, 2]);
      }
    }
    else {
      await saveBookFileIntent(book.id, { kind: 'remove', targetUri: 'file:///documents/Books/race-book.epub', stagingUri: 'file:///documents/Books/.removing-race-book.epub' });
      await driver.run('DELETE FROM book_index_state WHERE book_id = ?', [book.id]);
    }
    rejectEmbedding(new Error('query embedding failed'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(await driver.all('SELECT status FROM book_index_state')).toEqual(kind === 'reimport' ? [{ status: 'ready' }] : []);
  });
});
