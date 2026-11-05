import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeSQLiteDriver, type NodeSQLiteDriver } from '../db/testing/node-sqlite-driver.js';
import { DeterministicEmbeddingProvider } from './embedding.js';
import { LegacyIndexBookSource, LegacyIndexSearch, legacyFtsTerms } from './legacy-index.js';

const BOOK_ID = 'book-legacy-1';

function bytes(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength));
}

function readiumLocator(title: string, page?: number): string {
  return JSON.stringify({
    href: page ? `pdf://page/${page}` : 'OEBPS/chapter1.xhtml',
    title,
    ...(page
      ? { locations: { page, position: page, fragments: [`page=${page}`] }, text: { highlight: title } }
      : {
          locations: { cssSelector: '#p1', domRange: { start: { charOffset: 0 }, end: { charOffset: 10 } } },
          text: { highlight: title },
        }),
  });
}

describe('LegacyIndexSearch / LegacyIndexBookSource（旧 Swift book-index.sqlite）', () => {
  let driver: NodeSQLiteDriver;
  let source: LegacyIndexBookSource;
  let provider: DeterministicEmbeddingProvider;

  beforeEach(async () => {
    driver = createNodeSQLiteDriver();
    await driver.exec(`CREATE TABLE chapters(book_id TEXT, ordinal INTEGER, href TEXT, title TEXT, PRIMARY KEY(book_id,ordinal))`);
    await driver.exec(
      `CREATE TABLE fragments(id INTEGER PRIMARY KEY, book_id TEXT, chapter INTEGER, ordinal INTEGER, original TEXT, locator TEXT, UNIQUE(book_id,chapter,ordinal))`,
    );
    await driver.exec(`CREATE VIRTUAL TABLE fragment_terms USING fts5(book_id UNINDEXED, terms)`);
    await driver.exec(
      `CREATE TABLE embeddings(book_id TEXT, model TEXT, fragment_id INTEGER, piece INTEGER, offset INTEGER, original TEXT, vector BLOB CHECK(length(vector)=1536), PRIMARY KEY(book_id,fragment_id,piece))`,
    );

    const fragments = [
      {
        chapter: 0,
        ordinal: 0,
        original: '灯把书页照亮，也把问题留在纸上。',
        locator: readiumLocator('第一章 · 灯'),
      },
      {
        chapter: 1,
        ordinal: 0,
        original: '月亮挂在窗外，河流安静地流过夜色。',
        locator: readiumLocator('第二章 · 月亮', 2),
      },
    ];
    await driver.run('INSERT INTO chapters VALUES (?,?,?,?)', [BOOK_ID, 0, 'OEBPS/chapter1.xhtml', '第一章 · 灯']);
    await driver.run('INSERT INTO chapters VALUES (?,?,?,?)', [BOOK_ID, 1, 'pdf://page/2', '第 2 页']);
    provider = new DeterministicEmbeddingProvider({ dimension: 384 });
    for (let index = 0; index < fragments.length; index += 1) {
      const fragment = fragments[index]!;
      const id = index + 1;
      await driver.run(
        'INSERT INTO fragments(id, book_id, chapter, ordinal, original, locator) VALUES (?,?,?,?,?,?)',
        [id, BOOK_ID, fragment.chapter, fragment.ordinal, fragment.original, fragment.locator],
      );
      await driver.run('INSERT INTO fragment_terms(rowid, book_id, terms) VALUES (?,?,?)', [
        id,
        BOOK_ID,
        legacyFtsTerms(fragment.original),
      ]);
      const [vector] = await provider.embed([fragment.original]);
      await driver.run(
        'INSERT INTO embeddings(book_id, model, fragment_id, piece, offset, original, vector) VALUES (?,?,?,?,?,?,?)',
        [BOOK_ID, provider.modelId, id, 0, 0, fragment.original, bytes(vector!)],
      );
    }
    const search = new LegacyIndexSearch(driver, provider);
    source = new LegacyIndexBookSource(search, {
      id: BOOK_ID,
      title: '旧索引书',
      format: 'epub',
      sourceHash: BOOK_ID,
    });
  });

  afterEach(async () => {
    await driver.close();
  });

  it('legacyFtsTerms 复现旧 App 的 uni/bigram 规则', () => {
    expect(legacyFtsTerms('学而')).toContain('b5b66x800c');
    expect(legacyFtsTerms('学而', true)).toBe('b5b66x800c');
    expect(legacyFtsTerms('AB', true)).toBe('b61x62');
  });

  it('FTS + 向量检索命中旧 fragment，locator 原样透传', async () => {
    const search = new LegacyIndexSearch(driver, provider);
    const hits = await search.searchBook(BOOK_ID, '灯把书页', 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.quote).toContain('灯把书页照亮');
    expect(hits[0]?.chapter).toBe('第一章 · 灯');
    expect(hits[0]?.sources).toContain('fts');
    expect(JSON.parse(hits[0]!.locator)).toMatchObject({ title: '第一章 · 灯' });
  });

  it('BookSource.search/page/chapter 可用；page 走旧章节 ordinal', async () => {
    const excerpts = await source.search('月亮', 3);
    expect(excerpts[0]?.quote).toContain('月亮挂在窗外');
    expect(excerpts[0]?.page).toBe(2);
    expect(JSON.parse(excerpts[0]!.locator)).toMatchObject({ href: 'pdf://page/2' });

    const page = await source.page(2);
    expect(page?.excerpts.length).toBeGreaterThan(0);
    expect(page?.chapter).toBe('第 2 页');

    const chapter = await source.chapter('第一章');
    expect(chapter?.chapter).toBe('第一章 · 灯');
    expect(chapter?.excerpts[0]?.quote).toContain('灯把书页照亮');
    expect(await source.chapter('不存在')).toBeNull();
  });

  it('hasBook 区分有无旧索引的书', async () => {
    const search = new LegacyIndexSearch(driver, provider);
    expect(await search.hasBook(BOOK_ID)).toBe(true);
    expect(await search.hasBook('missing-book')).toBe(false);
  });

  it('falls back to the existing real text index only when an optional-model error policy is explicit', async () => {
    const failing = { dimension: 384, modelId: 'broken-runtime', async embed(): Promise<Float32Array[]> { throw new Error('model unavailable'); } };
    const failures: unknown[] = [];
    const search = new LegacyIndexSearch(driver, failing, { onVectorError(error) { failures.push(error); } });
    const hits = await search.searchBook(BOOK_ID, '灯把书页');
    expect(hits[0]?.quote).toContain('灯把书页照亮');
    expect(hits[0]?.sources).toEqual(['fts']);
    expect(failures).toHaveLength(1);
    await expect(new LegacyIndexSearch(driver, failing).searchBook(BOOK_ID, '灯')).rejects.toThrow('model unavailable');
  });
});
