import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeSQLiteDriver, type NodeSQLiteDriver } from '../db/testing/node-sqlite-driver.js';
import { migrate } from '../db/migrations.js';
import { ParagraphTextChunker } from './chunker.js';
import { SqliteSearchIndex } from './search-index.js';
import { assertNotAborted, type EmbeddingProvider, type RagBook, type SearchHit } from './types.js';

const fixtureBook: RagBook = {
  book: { id: 'book-1', title: '测试书', format: 'epub', sourceHash: 'hash-1' },
  chapters: [
    { ordinal: 1, title: '第一章 · 灯', paragraphs: ['灯把书页照亮，也把问题留在纸上。'] },
    { ordinal: 2, title: '第二章 · 阅读', paragraphs: ['阅读不是把答案抄下来，而是把原文读慢一点。'] },
    { ordinal: 3, title: '第三章 · 书页', page: 3, paragraphs: ['书页记录的是作者写下的句子。'] },
    { ordinal: 4, title: '第四章 · 月亮', page: 4, paragraphs: ['月亮照着窗外的河流。'] },
  ],
};

/** 测试用「关键词维度」embedding：同关键词文本余弦高，可精确断言排序。 */
class KeywordEmbeddingProvider implements EmbeddingProvider {
  readonly dimension = 4;
  readonly modelId = 'keyword-test-v1';
  private readonly keywords: ReadonlyArray<string>;

  constructor(keywords: ReadonlyArray<string> = ['灯', '阅读', '书页', '月亮']) {
    this.keywords = keywords;
  }

  vector(text: string): Float32Array {
    const vector = new Float32Array(this.dimension);
    this.keywords.forEach((keyword, index) => {
      if (text.includes(keyword)) vector[index] = 1;
    });
    let norm = 0;
    for (const value of vector) norm += value * value;
    norm = Math.sqrt(norm);
    if (norm > 0) for (let index = 0; index < vector.length; index += 1) vector[index] = (vector[index] ?? 0) / norm;
    return vector;
  }

  async embed(texts: ReadonlyArray<string>, options: { signal?: { readonly aborted: boolean } } = {}): Promise<Float32Array[]> {
    return texts.map((text) => {
      assertNotAborted(options.signal);
      return this.vector(text);
    });
  }
}

interface Setup {
  driver: NodeSQLiteDriver;
  index: SqliteSearchIndex;
  embedding: KeywordEmbeddingProvider;
  chunks: ReturnType<ParagraphTextChunker['chunk']>;
}

async function indexFixture(book: RagBook = fixtureBook): Promise<Setup> {
  const driver = createNodeSQLiteDriver();
  await migrate(driver);
  const embedding = new KeywordEmbeddingProvider();
  const index = new SqliteSearchIndex(driver, embedding, { rrfK: 60 });
  const chunks = new ParagraphTextChunker().chunk(book, { maxChars: 200 });
  const embeddings = await embedding.embed(chunks.map((chunk) => chunk.text));
  await index.indexBook(book, chunks, embeddings);
  return { driver, index, embedding, chunks };
}

let setups: Setup[] = [];

afterEach(async () => {
  for (const setup of setups.splice(0)) await setup.driver.close();
});

async function setupIndex(book?: RagBook): Promise<Setup> {
  const setup = await indexFixture(book);
  setups.push(setup);
  return setup;
}

function texts(hits: ReadonlyArray<SearchHit>): string[] {
  return hits.map((hit) => hit.chunk.text);
}

describe('SQLite RAG 索引（迁移/FTS5/向量/混合检索）', () => {
  it('迁移 0002 建出 rag 表，且幂等', async () => {
    const driver = createNodeSQLiteDriver();
    setups.push({ driver, index: new SqliteSearchIndex(driver, new KeywordEmbeddingProvider()), embedding: new KeywordEmbeddingProvider(), chunks: [] });
    const first = await migrate(driver);
    expect(first.applied).toEqual(['0001_initial', '0002_rag']);
    const second = await migrate(driver);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(['0001_initial', '0002_rag']);

    const rows = await driver.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name",
    );
    const names = rows.map((row) => row.name);
    for (const table of ['rag_chunks', 'rag_chunks_fts', 'rag_chunk_vectors']) {
      expect(names).toContain(table);
    }
  });

  it('FTS5 中文查询可召回（字符 token 化），支持章节/页码定位', async () => {
    const { index } = await setupIndex();
    const hits = await index.search('灯', { bookId: 'book-1', mode: 'fts' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.chunk.text).toContain('灯');
    expect(hits[0]!.chunk.chapter).toBe('第一章 · 灯');

    const pageHits = await index.search('月亮', { bookId: 'book-1', mode: 'fts' });
    expect(pageHits[0]!.chunk.page).toBe(4);

    const multi = await index.search('书页 照亮', { bookId: 'book-1', mode: 'fts' });
    expect(multi[0]!.chunk.text).toContain('灯把书页照亮');
    expect(multi.some((hit) => hit.chunk.text.includes('书页记录'))).toBe(false);
  });

  it('向量检索按 cosine 排序，并隔离 bookId', async () => {
    const { index } = await setupIndex();
    const hits = await index.search('阅读', { bookId: 'book-1', mode: 'vector' });
    expect(hits[0]!.chunk.text).toContain('阅读');

    const otherBook: RagBook = {
      book: { id: 'book-2', title: '另一本', format: 'epub', sourceHash: 'h2' },
      chapters: [{ ordinal: 1, title: '第一章', paragraphs: ['月亮独自挂在夜空。'] }],
    };
    const otherEmbedding = new KeywordEmbeddingProvider();
    const otherChunks = new ParagraphTextChunker().chunk(otherBook, { maxChars: 200 });
    await index.indexBook(otherBook, otherChunks, await otherEmbedding.embed(otherChunks.map((chunk) => chunk.text)));

    const isolated = await index.search('月亮', { bookId: 'book-1', mode: 'vector' });
    expect(isolated.some((hit) => hit.chunk.bookId === 'book-2')).toBe(false);
  });

  it('混合检索按 chunk 去重、topK 生效、sources 记录来源', async () => {
    const { index } = await setupIndex();
    const hits = await index.search('灯', { bookId: 'book-1', topK: 5 });
    const ids = hits.map((hit) => hit.chunk.id);
    expect(new Set(ids).size).toBe(ids.length);

    const top = hits[0]!;
    expect(top.chunk.text).toContain('灯');
    expect(top.sources).toContain('fts');
    expect(top.sources).toContain('vector');

    const limited = await index.search('灯', { bookId: 'book-1', topK: 1 });
    expect(limited).toHaveLength(1);
  });

  it('重复索引同一本书不会产生重复数据；删除书会清理三张表', async () => {
    const { index, driver, embedding, chunks } = await setupIndex();
    const before = await index.stats('book-1');
    expect(before.chunkCount).toBe(chunks.length);
    expect(before.vectorCount).toBe(chunks.length);

    await index.indexBook(fixtureBook, chunks, await embedding.embed(chunks.map((chunk) => chunk.text)));
    expect((await index.stats('book-1')).chunkCount).toBe(chunks.length);

    await index.deleteBook('book-1');
    expect((await index.stats('book-1')).chunkCount).toBe(0);
    expect(await index.listChunks('book-1')).toHaveLength(0);
    const ftsRows = await driver.all("SELECT chunk_id FROM rag_chunks_fts");
    expect(ftsRows).toHaveLength(0);
  });

  it('chapter/page 读取与 locator 一致', async () => {
    const { index } = await setupIndex();
    const chapterChunks = await index.chunksForChapter('book-1', '第二章');
    expect(chapterChunks.length).toBeGreaterThan(0);
    expect(chapterChunks.every((chunk) => chunk.chapter.includes('第二章'))).toBe(true);

    const ordinalChunks = await index.chunksForChapter('book-1', 3);
    expect(ordinalChunks[0]!.chapter).toContain('第三章');
    expect(ordinalChunks[0]!.locator.charStart).toBe(0);

    const pageChunks = await index.chunksForPage('book-1', 3);
    expect(pageChunks.length).toBeGreaterThan(0);
    expect(pageChunks[0]!.page).toBe(3);
  });

  it('取消：已中止信号与检索中途取消都会抛 AbortError', async () => {
    const { index } = await setupIndex();
    const aborted = new AbortController();
    aborted.abort();
    await expect(index.search('灯', { bookId: 'book-1', signal: aborted.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });

    const slow: EmbeddingProvider = {
      dimension: 4,
      modelId: 'slow-test-v1',
      async embed(texts, options = {}) {
        const signal = options.signal as unknown as
          | { aborted: boolean; addEventListener?: (type: string, listener: () => void) => void }
          | undefined;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 50);
          signal?.addEventListener?.('abort', () => {
            clearTimeout(timer);
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
        assertNotAborted(options.signal);
        return texts.map(() => new Float32Array([1, 0, 0, 0]));
      },
    };
    const slowDriver = createNodeSQLiteDriver();
    await migrate(slowDriver);
    const slowIndex = new SqliteSearchIndex(slowDriver, slow);
    setups.push({
      driver: slowDriver,
      index: slowIndex,
      embedding: new KeywordEmbeddingProvider(),
      chunks: [],
    });
    const controller = new AbortController();
    const pending = slowIndex.search('灯', { bookId: 'book-1', signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('向量维度不一致时拒绝建索引', async () => {
    const driver = createNodeSQLiteDriver();
    setups.push({ driver, index: new SqliteSearchIndex(driver, new KeywordEmbeddingProvider()), embedding: new KeywordEmbeddingProvider(), chunks: [] });
    await migrate(driver);
    const chunks = new ParagraphTextChunker().chunk(fixtureBook, { maxChars: 200 });
    const index = new SqliteSearchIndex(driver, new KeywordEmbeddingProvider());
    await expect(
      index.indexBook(fixtureBook, chunks, chunks.map(() => new Float32Array(2))),
    ).rejects.toThrow(/维度/);
  });
});
