import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('pages old vectors, retains the best piece per fragment and accepts only verified model identities', async () => {
    const aligned = new Float32Array(384); aligned[0] = 1;
    const orthogonal = new Float32Array(384); orthogonal[1] = 1;
    const swiftModel = 'minilm-e8f8c211-arm64-int8-128-mean-l2-sentence100-overlap20-v2';
    const model = { modelId: 'minilm-e8f8c211-arm64-int8-128-mean-l2-v1', dimension: 384,
      async embed(texts: ReadonlyArray<string>) { return texts.map(() => aligned); } };
    await driver.run('UPDATE embeddings SET model = ?, vector = ?', [swiftModel, bytes(orthogonal)]);
    for (let piece = 1; piece < 140; piece += 1) {
      await driver.run('INSERT INTO embeddings VALUES (?,?,?,?,?,?,?)', [BOOK_ID, swiftModel, 1, piece, 0,
        piece === 139 ? 'THE_BEST_PIECE' : 'other piece', bytes(piece === 139 ? aligned : orthogonal)]);
    }
    // Equal dimensions cannot make an unrelated model compatible.
    await driver.run('INSERT INTO embeddings VALUES (?,?,?,?,?,?,?)', [BOOK_ID, 'unrelated-384d-model', 2, 1, 0, 'FOREIGN_MODEL', bytes(aligned)]);
    const read = driver.all.bind(driver), pageSizes: number[] = [];
    const spy = vi.spyOn(driver, 'all').mockImplementation(async (sql, params) => {
      const rows = await read(sql, params);
      if (sql.includes('FROM embeddings e')) {
        expect(sql).toContain('ORDER BY e.fragment_id, e.piece LIMIT 64'); pageSizes.push(rows.length);
      }
      return rows;
    });
    const hits = await new LegacyIndexSearch(driver, model, { vectorCandidateLimit: 1 }).searchBook(BOOK_ID, 'not present in the book', 1);
    expect(hits).toMatchObject([{ fragmentId: 1, quote: 'THE_BEST_PIECE', sources: ['vector'] }]);
    expect(pageSizes.length).toBeGreaterThan(2);
    expect(Math.max(...pageSizes)).toBe(64);
    spy.mockRestore();
    await driver.run('UPDATE embeddings SET model = NULL');
    expect(await new LegacyIndexSearch(driver, model).searchBook(BOOK_ID, 'not present in the book')).toEqual([]);
    expect((await new LegacyIndexSearch(driver, model).searchBook(BOOK_ID, '灯把书页'))[0]?.sources).toEqual(['fts']);
  });

  it('cancels at the old vector page boundary without treating cancellation as model fallback', async () => {
    let cancelled = false;
    const read = driver.all.bind(driver);
    const spy = vi.spyOn(driver, 'all').mockImplementation(async (sql, params) => {
      const rows = await read(sql, params);
      if (sql.includes('FROM embeddings e')) cancelled = true;
      return rows;
    });
    const fallback = vi.fn();
    await expect(new LegacyIndexSearch(driver, provider, { onVectorError: fallback })
      .searchBook(BOOK_ID, '灯', 5, { get aborted() { return cancelled; } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fallback).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('keeps legacy semantic and keyword retrieval working for long natural-language questions', async () => {
    let prepared = false;
    const embedded: string[] = [];
    const budgeted = { dimension: 384, modelId: provider.modelId, maxInputTokens: 8,
      prepare: async () => { prepared = true; }, countTokens: (text: string) => [...text].length + 2,
      async embed(texts: ReadonlyArray<string>) {
        expect(prepared).toBe(true);
        for (const text of texts) { expect([...text].length + 2).toBeLessThanOrEqual(8); embedded.push(text); }
        return provider.embed(texts);
      } };
    const query = '请告诉我这本书中关于月亮的描述有哪些';
    const hits = await new LegacyIndexSearch(driver, budgeted).searchBook(BOOK_ID, query);
    expect(embedded.join('')).toBe(query);
    expect(hits.some(hit => hit.quote.includes('月亮'))).toBe(true);
    const fts = await new LegacyIndexSearch(driver, null).searchBook(BOOK_ID, query);
    expect(fts[0]?.quote).toContain('月亮');
  });

  it('continues legacy fragments when a remaining UTF-16 unit cannot fit the next emoji', async () => {
    await driver.run('UPDATE fragments SET original = ? WHERE id = 1', ['a'.repeat(255)]);
    await driver.run('INSERT INTO fragments VALUES (?, ?, ?, ?, ?, ?)', [3, BOOK_ID, 0, 1, '😀THIS_CONTENT_MUST_NOT_DISAPPEAR', readiumLocator('emoji')]);
    await driver.run('INSERT INTO fragments VALUES (?, ?, ?, ?, ?, ?)', [4, BOOK_ID, 0, 2, 'END_MARKER', readiumLocator('end')]);
    let passage = await source.passage({ reference: 'chapter:1', before: 0, after: 19, maxChars: 256 });
    let text = passage!.excerpts.map(excerpt => excerpt.quote).join('');
    while (passage?.nextCursor) {
      passage = await source.passage({ reference: 'chapter:1', cursor: passage.nextCursor, before: 0, after: 19, maxChars: 256 });
      expect(passage).not.toBeNull(); text += passage!.excerpts.map(excerpt => excerpt.quote).join('');
    }
    expect(text).toBe('a'.repeat(255) + '😀THIS_CONTENT_MUST_NOT_DISAPPEAR' + 'END_MARKER');
  });

  it('starts a long legacy fragment at the selected tail and continues without lost or repeated text', async () => {
    const selected = 'SELECTED_UNIQUE_TEXT', tail = selected + '😀尾部'.repeat(180);
    await driver.run('UPDATE fragments SET original = ? WHERE id = 1', ['前置段落。'.repeat(300)]);
    await driver.run('INSERT INTO fragments VALUES (?, ?, ?, ?, ?, ?)', [3, BOOK_ID, 0, 1, 'a'.repeat(1000) + tail, readiumLocator('长段')]);
    const reference = JSON.stringify({ type: 'epub', href: 'OEBPS/chapter1.xhtml', text: { highlight: selected } });
    for (const before of [0, 1]) {
      let passage = await source.passage({ reference, before, after: 0, maxChars: 256 });
      expect(passage?.locationPrecision).toBe('exact');
      expect(passage!.excerpts[0]!.quote).toContain(selected);
      let collected = passage!.excerpts.map(item => item.quote).join('');
      while (passage?.nextCursor) {
        passage = await source.passage({ reference, cursor: passage.nextCursor, before: 0, after: 0, maxChars: 256 });
        expect(passage).not.toBeNull(); collected += passage!.excerpts.map(item => item.quote).join('');
      }
      expect(collected).toBe(tail);
    }
  });

  it('locates legacy reader highlights with context and refuses an ambiguous duplicate or unsupported CFI', async () => {
    await driver.run('INSERT INTO fragments VALUES (?, ?, ?, ?, ?, ?)', [3, BOOK_ID, 0, 1, '前乙。重复原文。后乙。', readiumLocator('重复段')]);
    await driver.run('INSERT INTO fragments VALUES (?, ?, ?, ?, ?, ?)', [4, BOOK_ID, 0, 2, '前甲。重复原文。后甲。', readiumLocator('重复段2')]);
    const reference = JSON.stringify({ type: 'epub', href: 'OEBPS/chapter1.xhtml', selection: { href: 'OEBPS/chapter1.xhtml', text: { before: '前甲。', highlight: '重复原文。', after: '后甲。' } } });
    const located = await source.passage({ reference, before: 0, after: 0 });
    expect(located?.locationPrecision).toBe('exact');
    expect(located?.excerpts[0]?.quote).toBe('前甲。重复原文。后甲。');
    await expect(source.passage({ reference: JSON.stringify({ href: 'OEBPS/chapter1.xhtml', text: { highlight: '重复原文。' } }) })).rejects.toThrow(/多次出现/);
    await expect(source.passage({ reference: JSON.stringify({ type: 'epub', cfi: 'epubcfi(/6/2)' }) })).rejects.toThrow(/只有 CFI/);
    expect((await source.passage({ reference: JSON.stringify({ type: 'pdf', page: 2 }) }))?.excerpts[0]?.quote).toContain('月亮');
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
