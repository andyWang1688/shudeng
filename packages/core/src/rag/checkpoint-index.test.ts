import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeSQLiteDriver, type NodeSQLiteDriver } from '../db/testing/node-sqlite-driver.js';
import { migrate } from '../db/migrations.js';
import { ChapterIndexBuild, cleanupStaleBookIndexBuilds, deletePendingBookIndex, type ChapterIndexBuildOptions } from './checkpoint-index.js';
import { ParagraphTextChunker } from './chunker.js';
import { SqliteSearchIndex } from './search-index.js';

const book = { id: 'book', title: '书', format: 'epub' as const, sourceHash: 'hash' };
const oldBook = { book, chapters: [{ ordinal: 1, title: '旧章', text: '此前已就绪的文字' }] };
const newBook = { book, chapters: [{ ordinal: 1, title: '新章', href: 'Text/one.xhtml', text: '新文字😀第一句。'.repeat(30) }, { ordinal: 3, title: '第三章', text: '新的结束' }] };
const chunker = new ParagraphTextChunker(), chunks = newBook.chapters.map(chapter => chunker.chunk({ book, chapters: [chapter] }));
let driver: NodeSQLiteDriver, valid = true;
const model = { id: 'fixture-model', dimension: 2 };
function options(overrides: Partial<ChapterIndexBuildOptions> = {}): ChapterIndexBuildOptions {
  return { book, generation: '0', chapterCount: 2, extractionVersion: 'fixture-v1', model, guard: async () => { if (!valid) throw new Error('stale generation'); }, ...overrides };
}
const vectors = (count: number) => Array.from({ length: count }, () => new Float32Array([1, 0]));
beforeEach(async () => { driver = createNodeSQLiteDriver(); await migrate(driver); valid = true; await new SqliteSearchIndex(driver, null).indexBook(oldBook, chunker.chunk(oldBook), []); });
afterEach(async () => { await driver.close(); });

async function finish(build: ChapterIndexBuild) {
  for (let chapter = build.cursor.nextChapter; chapter < chunks.length; chapter += 1) {
    const offset = build.cursor.nextChunk, pending = chunks[chapter]!.slice(offset);
    if (pending.length) await build.append(chapter, offset, pending, vectors(pending.length));
    await build.finishChapter(chapter, chunks[chapter]!.length);
  }
}

describe('checkpointed chapter index writer', () => {
  it('preserves exact original chunk IDs even when an imported legacy ID contains surrogate pairs', async () => {
    const unicodeBook = { ...book, id: '书😀' }, publication = { book: unicodeBook, chapters: [newBook.chapters[0]!] }, expected = chunker.chunk(publication);
    const build = await ChapterIndexBuild.open(driver, options({ book: unicodeBook, chapterCount: 1 }));
    await build.append(0, 0, expected, vectors(expected.length)); await build.finishChapter(0, expected.length); await build.promote(async () => {});
    expect(await new SqliteSearchIndex(driver, null).listChunks(unicodeBook.id)).toEqual(expected);
    expect((await new SqliteSearchIndex(driver, null).stats(unicodeBook.id)).vectorCount).toBe(expected.length);
  });
  it('commits bounded batches and resumes with a new writer while official old text remains intact', async () => {
    const first = await ChapterIndexBuild.open(driver, options());
    await first.append(0, 0, chunks[0]!.slice(0, 2), vectors(2));
    expect((await new SqliteSearchIndex(driver, null).listChunks(book.id)).map(chunk => chunk.text)).toEqual(['此前已就绪的文字']);
    const resumed = await ChapterIndexBuild.open(driver, options());
    expect(resumed.cursor).toMatchObject({ nextChapter: 0, nextChunk: 2, chunkCount: 2, vectorCount: 2 });
    await finish(resumed);
    const summary = await resumed.promote(async () => {});
    expect(summary.semantic).toBe(true);
    expect(await new SqliteSearchIndex(driver, null).listChunks(book.id)).toEqual(chunks.flat());
    const joined = await driver.all<{ chunk_id: string }>('SELECT v.chunk_id FROM rag_chunk_vectors v JOIN rag_chunks c ON c.id = v.chunk_id WHERE c.book_id = ? ORDER BY v.chunk_id', [book.id]);
    expect(joined.map(row => row.chunk_id).sort()).toEqual(chunks.flat().map(chunk => chunk.id).sort());
    const fts = await new SqliteSearchIndex(driver, null).search('新文字', { bookId: book.id, mode: 'fts', topK: 50 });
    expect(fts.length).toBeGreaterThan(0); expect(fts.every(hit => hit.chunk.bookId === book.id && !hit.chunk.id.includes('pending'))).toBe(true);
    expect(await driver.all('SELECT * FROM app_preferences WHERE key = ?', ['rag-index-build:' + book.id])).toEqual([]);
  });

  it('rolls back a failed promotion including FTS/vector ID changes and permits retry', async () => {
    const build = await ChapterIndexBuild.open(driver, options()); await finish(build);
    await expect(build.promote(async () => { throw new Error('ready write failed'); })).rejects.toThrow('ready write failed');
    expect((await new SqliteSearchIndex(driver, null).listChunks(book.id))[0]?.text).toBe('此前已就绪的文字');
    expect((await ChapterIndexBuild.open(driver, options())).cursor.nextChapter).toBe(2);
    await build.promote(async () => {});
    expect(await new SqliteSearchIndex(driver, null).listChunks(book.id)).toEqual(chunks.flat());
  });

  it('guards every delayed batch/promotion and deletion clears both pending rows and checkpoint', async () => {
    const build = await ChapterIndexBuild.open(driver, options());
    await build.append(0, 0, chunks[0]!.slice(0, 1), vectors(1)); valid = false;
    await expect(build.append(0, 1, chunks[0]!.slice(1, 2), vectors(1))).rejects.toThrow('stale generation');
    await driver.transaction(tx => deletePendingBookIndex(tx, book.id));
    await expect(build.promote(async () => {})).rejects.toThrow('stale generation');
    expect(await driver.all('SELECT * FROM rag_chunk_vectors')).toEqual([]);
    expect(await driver.all('SELECT * FROM app_preferences WHERE key = ?', ['rag-index-build:' + book.id])).toEqual([]);
  });

  it('resets incompatible/corrupt checkpoints and cleans orphan/stale builds', async () => {
    const build = await ChapterIndexBuild.open(driver, options()); await build.append(0, 0, chunks[0]!.slice(0, 1), vectors(1));
    const changed = await ChapterIndexBuild.open(driver, options({ generation: '1' })); expect(changed.cursor.chunkCount).toBe(0);
    await changed.append(0, 0, chunks[0]!.slice(0, 1), vectors(1));
    await driver.run('UPDATE app_preferences SET value_json = ? WHERE key = ?', ['{"version":1,"model":{}}', 'rag-index-build:' + book.id]);
    await cleanupStaleBookIndexBuilds(driver, async () => true);
    expect(await driver.all('SELECT * FROM rag_chunk_vectors')).toEqual([]);
    expect(await driver.all('SELECT * FROM app_preferences WHERE key = ?', ['rag-index-build:' + book.id])).toEqual([]);
    const orphan = await ChapterIndexBuild.open(driver, options()); await orphan.append(0, 0, chunks[0]!.slice(0, 1), vectors(1));
    await driver.run('DELETE FROM app_preferences WHERE key = ?', ['rag-index-build:' + book.id]);
    await cleanupStaleBookIndexBuilds(driver, async () => false);
    expect((await driver.all('SELECT * FROM rag_chunks')).length).toBe(1);
    expect((await driver.all('SELECT * FROM rag_chunks_fts')).length).toBe(1);
    expect(await driver.all('SELECT * FROM rag_chunk_vectors')).toEqual([]);
  });

  it('retains text when optional embeddings fail and never calls a partial vector set semantic-ready', async () => {
    const build = await ChapterIndexBuild.open(driver, options()); await build.recordSemanticFailure('model unavailable');
    for (let chapter = 0; chapter < chunks.length; chapter += 1) { await build.append(chapter, 0, chunks[chapter]!, []); await build.finishChapter(chapter, chunks[chapter]!.length); }
    expect(await build.promote(async () => {})).toMatchObject({ semantic: false, vectorCount: 0, semanticFailure: 'model unavailable' });
    expect(await new SqliteSearchIndex(driver, null).listChunks(book.id)).toEqual(chunks.flat());
  });
});
