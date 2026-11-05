import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNodeSQLiteDriver, type NodeSQLiteDriver } from '../db/testing/node-sqlite-driver.js';
import { migrate } from '../db/migrations.js';
import { ParagraphTextChunker } from './chunker.js';
import { cosineSimilarity } from './embedding.js';
import { SearchIndexChangedError } from './index-revision.js';
import { SqliteSearchIndex } from './search-index.js';
import type { EmbeddingProvider } from './types.js';
const book = { id: 'bounded', title: '多章', format: 'epub' as const, sourceHash: 'hash' };
const publication = { book, chapters: Array.from({ length: 270 }, (_, index) => ({ ordinal: index + 1, title: '章节' + index, text: '正文' + index })) };
const chunks = new ParagraphTextChunker().chunk(publication), vectors = chunks.map((_, index) => new Float32Array([index % 9, 1]));
const embedding: EmbeddingProvider = { modelId: 'test', dimension: 2, embed: async () => [new Float32Array([2, 1])] };
let driver: NodeSQLiteDriver;
beforeEach(async () => { driver = createNodeSQLiteDriver(); await migrate(driver); await new SqliteSearchIndex(driver, embedding).indexBook(publication, chunks, vectors); });
afterEach(async () => { await driver.close(); });

describe('bounded SQLite consumers', () => {
  it.each(['chapter', 'page', 'list'])('rejects an index promotion while %s rows are in flight', async kind => {
    const original = driver.all.bind(driver); let replaced = false;
    vi.spyOn(driver, 'all').mockImplementation(async (sql, params) => {
      const rows = await original(sql, params);
      if (!replaced && sql.startsWith('SELECT * FROM rag_chunks WHERE book_id')) { replaced = true; await new SqliteSearchIndex(driver, embedding).indexBook(publication, chunks, vectors); }
      return rows;
    });
    const index = new SqliteSearchIndex(driver, null), reading = kind === 'chapter' ? index.chunksForChapter(book.id, 1) : kind === 'page' ? index.chunksForPage(book.id, 1) : index.listChunks(book.id);
    await expect(reading).rejects.toThrow(SearchIndexChangedError);
  });
  it('vector keyset batches preserve the full-scan topK and equal-score ID order', async () => {
    const original = driver.all.bind(driver), pages: number[] = [];
    vi.spyOn(driver, 'all').mockImplementation(async (sql, params) => { const rows = await original(sql, params); if (sql.includes('v.vector FROM')) { expect(sql).toContain('LIMIT 64'); pages.push(rows.length); } return rows; });
    const hits = await new SqliteSearchIndex(driver, embedding, { candidateLimit: 17 }).search('问题', { bookId: book.id, mode: 'vector', topK: 17 });
    const expected = chunks.map((chunk, index) => ({ id: chunk.id, score: cosineSimilarity(new Float32Array([2, 1]), vectors[index]!) })).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id)).slice(0, 17);
    expect(hits.map(hit => hit.chunk.id)).toEqual(expected.map(hit => hit.id)); expect(pages.length).toBeGreaterThan(4); expect(Math.max(...pages)).toBe(64);
  });

  it('streams exact chunk order through keyset pages and aborts a replacement even with the same book/hash', async () => {
    const index = new SqliteSearchIndex(driver, null), seen = [];
    for await (const chunk of index.iterateChunks(book.id, { batchSize: 7 })) seen.push(chunk);
    expect(seen).toEqual(chunks);
    const iterator = index.iterateChunks(book.id, { batchSize: 7 });
    for (let offset = 0; offset < 7; offset += 1) await iterator.next();
    await new SqliteSearchIndex(driver, embedding).indexBook(publication, chunks, vectors);
    await expect(iterator.next()).rejects.toThrow(SearchIndexChangedError);
  });

  it('does not downgrade a mid-page vector replacement to optional model failure', async () => {
    const original = driver.all.bind(driver); let scanned = false, fallback = false;
    vi.spyOn(driver, 'all').mockImplementation(async (sql, params) => {
      const rows = await original(sql, params);
      if (!scanned && sql.includes('v.vector FROM')) { scanned = true; await new SqliteSearchIndex(driver, embedding).indexBook(publication, chunks, vectors); }
      return rows;
    });
    await expect(new SqliteSearchIndex(driver, embedding, { onVectorError: () => { fallback = true; } }).search('正文', { bookId: book.id })).rejects.toThrow(SearchIndexChangedError);
    expect(fallback).toBe(false);
  });

  it('does not swallow a transient revision-read error after a vector page as a model failure', async () => {
    const original = driver.all.bind(driver); let vectorPageReturned = false, failed = false, fallback = false;
    vi.spyOn(driver, 'all').mockImplementation(async (sql, params) => {
      if (vectorPageReturned && !failed && sql.startsWith('SELECT value_json FROM app_preferences')) { failed = true; throw new Error('revision read failed'); }
      const rows = await original(sql, params);
      if (sql.includes('v.vector FROM')) vectorPageReturned = true;
      return rows;
    });
    await expect(new SqliteSearchIndex(driver, embedding, { onVectorError: () => { fallback = true; } }).search('正文', { bookId: book.id })).rejects.toThrow('revision read failed');
    expect(fallback).toBe(false);
  });

  it('checks injected lifecycle guards and cancellation at every vector/chunk page', async () => {
    let reads = 0;
    const index = new SqliteSearchIndex(driver, embedding, { validateRead: async () => { if (++reads > 4) throw new Error('source generation changed'); }, onVectorError: () => {} });
    await expect(index.search('正文', { bookId: book.id })).rejects.toThrow('source generation changed');
    let cancelled = false; const iterator = new SqliteSearchIndex(driver, null).iterateChunks(book.id, { batchSize: 1, signal: { get aborted() { return cancelled; } } });
    await iterator.next(); cancelled = true;
    await expect(iterator.next()).rejects.toHaveProperty('name', 'AbortError');
  });
});
