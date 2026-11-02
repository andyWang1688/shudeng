import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeSQLiteDriver, type NodeSQLiteDriver } from '../db/testing/node-sqlite-driver.js';
import { migrate } from '../db/migrations.js';
import { runBookAgent } from '../agent/agent.js';
import { createScriptedModel } from '../agent/testing.js';
import type { AgentEvent } from '../agent/events.js';
import { ParagraphTextChunker } from './chunker.js';
import { DeterministicEmbeddingProvider } from './embedding.js';
import { indexRagBook } from './index.js';
import { SqliteBookSource } from './book-source.js';
import { SqliteSearchIndex } from './search-index.js';
import type { RagBook } from './types.js';

const ragBook: RagBook = {
  book: { id: 'fixture-rag-book', title: '书灯夹具：灯与书页', format: 'epub', sourceHash: 'fixture-hash-1' },
  chapters: [
    {
      ordinal: 1,
      title: '第一章 · 灯',
      paragraphs: ['灯把书页照亮，也把问题留在纸上。', '阅读不是把答案抄下来，而是把原文读慢一点。'],
    },
    {
      ordinal: 2,
      title: '第二章 · 书页',
      page: 2,
      paragraphs: ['书页记录的是作者写下的句子，读者要回到这些句子本身。'],
    },
  ],
};

let driver: NodeSQLiteDriver;

beforeEach(async () => {
  driver = createNodeSQLiteDriver();
  await migrate(driver);
});

afterEach(async () => {
  await driver.close();
});

async function buildSource(): Promise<{ source: SqliteBookSource; chunks: Awaited<ReturnType<typeof indexRagBook>>['chunks'] }> {
  const embedding = new DeterministicEmbeddingProvider();
  const index = new SqliteSearchIndex(driver, embedding);
  const { chunks } = await indexRagBook({
    index,
    chunker: new ParagraphTextChunker(),
    embedding,
    book: ragBook,
    chunkOptions: { maxChars: 200 },
  });
  return { source: new SqliteBookSource(index, ragBook.book), chunks };
}

async function collect(session: ReturnType<typeof runBookAgent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of session.events) events.push(event);
  return events;
}

describe('SqliteBookSource（接到 LangChain 工具/引用闭环）', () => {
  it('search 返回真实 chunk 原文 + 可回跳 locator', async () => {
    const { source, chunks } = await buildSource();
    const excerpts = await source.search('灯', 3);
    expect(excerpts.length).toBeGreaterThan(0);
    const first = excerpts[0]!;
    expect(first.quote.length).toBeGreaterThan(0);
    expect(chunks.some((chunk) => chunk.text === first.quote)).toBe(true);
    const locator = JSON.parse(first.locator) as { engine: string; chapter: string; charStart: number };
    expect(locator.engine).toBe('rag-chunk-v1');
    expect(locator.chapter).toBe(first.chapter);
    expect(typeof locator.charStart).toBe('number');
  });

  it('page/chapter 读取：PDF 页优先，EPUB 回退章节序号', async () => {
    const { source } = await buildSource();
    const chapter = await source.chapter('第二章');
    expect(chapter?.chapter).toContain('第二章');
    expect(chapter?.excerpts.length).toBeGreaterThan(0);

    const page = await source.page(2);
    expect(page?.excerpts.length).toBeGreaterThan(0);

    const ordinalFallback = await source.page(1);
    expect(ordinalFallback?.chapter).toContain('第一章');

    expect(await source.chapter('不存在的章节')).toBeNull();
  });

  it('Agent 工具闭环：search_book → 引用核对 → completed（locator 来自 SQLite 索引）', async () => {
    const { source } = await buildSource();
    const target = (await source.search('灯', 1))[0]!;
    const citationQuote = target.quote.slice(0, 6);
    expect(target.quote).toContain(citationQuote);

    const model = createScriptedModel([
      { chunks: [{ toolCalls: [{ id: 'call_1', name: 'search_book', args: { query: '灯' } }] }] },
      {
        chunks: [
          {
            text: JSON.stringify({
              answer: '灯把书页照亮。',
              citations: [{ id: 'E1', quote: citationQuote }],
            }),
          },
        ],
      },
    ]);
    const session = runBookAgent({
      model,
      source,
      book: ragBook.book,
      question: '灯是什么意思？',
    });
    const events = await collect(session);
    const result = await session.result;

    expect(result?.answer).toBe('灯把书页照亮。');
    expect(result?.citations).toHaveLength(1);
    expect(result?.citations[0]?.id).toBe('E1');
    expect(result?.citations[0]?.locator).toContain('rag-chunk-v1');
    expect(result?.citations[0]?.chapter).toBe(target.chapter);
    expect(result?.droppedCitationIds).toEqual([]);
    expect(events.some((event) => event.type === 'toolFinished' && !event.isError)).toBe(true);
  });

  it('伪造引用仍被剔除（quote 不在索引原文里）', async () => {
    const { source } = await buildSource();
    const model = createScriptedModel([
      { chunks: [{ toolCalls: [{ id: 'call_1', name: 'search_book', args: { query: '灯' } }] }] },
      {
        chunks: [
          {
            text: JSON.stringify({
              answer: '伪造引用。',
              citations: [{ id: 'E1', quote: '索引里根本没有这句话' }],
            }),
          },
        ],
      },
    ]);
    const session = runBookAgent({ model, source, book: ragBook.book, question: '灯' });
    await collect(session);
    const result = await session.result;
    expect(result?.citations).toHaveLength(0);
    expect(result?.droppedCitationIds).toEqual(['E1']);
  });
});
