import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParagraphTextChunker, SqliteSearchIndex } from '@shudeng/core';
import { createNodeSQLiteDriver, type NodeSQLiteDriver } from '@shudeng/core/db/testing';
import { createShudengDataLayer, type ShudengDataLayer } from '../../db/engine';

const state = vi.hoisted(() => ({
  layer: null as ShudengDataLayer | null, busy: false,
  status: { available: true, semantic: false, detail: '就绪', state: 'ready' },
  beforeStatus: null as (() => Promise<void>) | null,
}));
vi.mock('../../db/index.ts', () => ({ getDataLayer: async () => state.layer }));
vi.mock('../bookIndex.ts', () => ({ getLocalBookIndexStatus: async () => { if (state.beforeStatus) await state.beforeStatus(); return state.status; } }));
vi.mock('../../library/bookFileOperations.ts', () => ({
  isBookFileOperationActive: () => state.busy,
  getBookIndexGeneration: async (driver: NodeSQLiteDriver, bookId: string) => {
    const [row] = await driver.all<{ value_json: string }>('SELECT value_json FROM app_preferences WHERE key = ?', ['book-index-generation:' + bookId]);
    return row?.value_json ?? '0';
  },
}));
import { BookTextSearchUnavailableError, searchBookText } from '../searchBookText';

let driver: NodeSQLiteDriver;
const book = { id: 'book', title: '真实SQLite', format: 'epub' as const, sourceHash: 'hash' };
beforeEach(async () => {
  driver = createNodeSQLiteDriver();
  state.layer = await createShudengDataLayer(driver);
  await state.layer.store.saveBook(book);
  const rag = { book, chapters: [{ ordinal: 1, title: '第一章', href: 'chapter.xhtml', text: 'a'.repeat(79) + 'CAFÉ' + 'b'.repeat(80) + 'cafe' }] };
  const chunks = new ParagraphTextChunker().chunk(rag, { maxChars: 80 });
  await new SqliteSearchIndex(driver, null).indexBook(rag, chunks, []);
  state.status = { available: true, semantic: false, detail: '就绪', state: 'ready' };
  state.beforeStatus = null;
  state.busy = false;
});
afterEach(async () => { await driver.close(); });

describe('prepared reader-search platform adapter', () => {
  it('reads committed chunks and returns precise literal occurrences with no embedding', async () => {
    const hits = await searchBookText(book.id, 'café');
    expect(hits.map(hit => JSON.parse(hit.locator).charStart)).toEqual([79, 163]);
    expect(hits.map(hit => JSON.parse(hit.locator).text.highlight)).toEqual(['CAFÉ', 'cafe']);
    expect(hits.map(hit => hit.chapter)).toEqual(['第一章', '第一章']);
  });

  it('uses availability rather than the informational failure flag when FTS is still committed', async () => {
    state.status = { ...state.status, state: 'failed', detail: '语义准备失败，文字可用' };
    expect(await searchBookText(book.id, 'cafe')).toHaveLength(2);
    state.status = { ...state.status, available: false, detail: '尚未准备书内文字' };
    await expect(searchBookText(book.id, 'cafe')).rejects.toThrow('尚未准备书内文字');
  });

  it.each(['busy', 'removed', 'deleted', 'intent'])('refuses %s books even when a stale status reports available', async kind => {
    if (kind === 'busy') state.busy = true;
    if (kind === 'removed') await driver.run('UPDATE books SET removed_at = 1 WHERE id = ?', [book.id]);
    if (kind === 'deleted') await driver.run('DELETE FROM books WHERE id = ?', [book.id]);
    if (kind === 'intent') await driver.run('INSERT INTO book_file_operations VALUES (?, ?, ?, ?)', [book.id, 'remove', '{}', 1]);
    await expect(searchBookText(book.id, 'cafe')).rejects.toThrow(BookTextSearchUnavailableError);
  });

  it('rejects the old generation if deletion and same-hash reimport finish during status loading', async () => {
    state.beforeStatus = async () => {
      await driver.run('DELETE FROM books WHERE id = ?', [book.id]);
      await state.layer!.store.saveBook(book);
      await driver.run('INSERT INTO app_preferences VALUES (?, ?)', ['book-index-generation:' + book.id, '1']);
    };
    await expect(searchBookText(book.id, 'cafe')).rejects.toThrow('书籍正在更新');
  });

  it('stops cancelled requests and treats blank input as no search', async () => {
    await expect(searchBookText(book.id, 'cafe', { signal: { aborted: true } })).rejects.toHaveProperty('name', 'AbortError');
    state.beforeStatus = async () => { throw new Error('should not read status'); };
    expect(await searchBookText(book.id, ' ')).toEqual([]);
  });
});

  it.each(['generation', 'promotion'])('rejects %s changes between keyset pages instead of returning mixed text', async kind => {
    const rag = { book, chapters: Array.from({ length: 140 }, (_, index) => ({ ordinal: index + 1, title: '章' + index, text: 'café ' + index })) };
    const chunks = new ParagraphTextChunker().chunk(rag); await new SqliteSearchIndex(driver, null).indexBook(rag, chunks, []);
    const original = driver.all.bind(driver); let changed = false;
    vi.spyOn(driver, 'all').mockImplementation(async (sql, params) => {
      const rows = await original(sql, params);
      if (!changed && sql.includes('SELECT * FROM rag_chunks WHERE book_id') && sql.includes('LIMIT')) {
        changed = true;
        if (kind === 'promotion') await new SqliteSearchIndex(driver, null).indexBook(rag, chunks, []);
        else await driver.run('INSERT INTO app_preferences VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json', ['book-index-generation:' + book.id, '1']);
      }
      return rows;
    });
    await expect(searchBookText(book.id, 'cafe')).rejects.toThrow(/正在更新/);
  });
