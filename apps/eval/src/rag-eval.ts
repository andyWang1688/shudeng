/**
 * V2 RAG 评测：fixture 书 → 切块 → 确定性 embedding → SQLite FTS5+向量索引
 * → SqliteBookSource → Agent(question→search_book→引用核对) 闭环。
 *
 * 运行：pnpm --filter @shudeng/eval eval:rag
 */
import {
  runBookAgent,
  type AgentEvent,
  type AgentRunResult,
} from '@shudeng/core/agent';
import { createScriptedModel } from '@shudeng/core/agent/testing';
import type { BookIdentity } from '@shudeng/core/domain';
import { migrate } from '@shudeng/core/db';
import { createNodeSQLiteDriver } from '@shudeng/core/db/testing';
import {
  DeterministicEmbeddingProvider,
  ParagraphTextChunker,
  SqliteBookSource,
  SqliteSearchIndex,
  indexRagBook,
  type RagBook,
} from '@shudeng/core/rag';
import { evalCases, fixtureBook, type EvalCase } from './fixtures.js';

function toRagBook(book: (typeof fixtureBook)): RagBook {
  return {
    book: book.book,
    chapters: book.chapters.map((chapter, index) => ({
      ordinal: index + 1,
      title: chapter.title,
      ...(chapter.page !== undefined ? { page: chapter.page } : {}),
      paragraphs: chapter.paragraphs,
    })),
  };
}

function modelTurns(testCase: EvalCase, citationQuote: string) {
  const payload = JSON.stringify({
    answer: testCase.answer,
    citations: [{ id: 'E1', quote: citationQuote }],
  });
  return [
    {
      chunks: [
        { reasoning: `先检索「${testCase.searchQuery}」。` },
        {
          toolCalls: [
            { id: 'call_1', name: 'search_book', args: { query: testCase.searchQuery } },
          ],
        },
      ],
    },
    { chunks: [{ reasoning: '依据检索到的原文组织回答。' }, { text: payload }] },
  ];
}

function formatEvent(event: AgentEvent): string {
  switch (event.type) {
    case 'started':
      return `started tools=${event.started.toolNames.join(',')}`;
    case 'reasoningDelta':
      return `reasoning +${JSON.stringify(event.delta)}`;
    case 'textDelta':
      return `text +${JSON.stringify(event.delta)}`;
    case 'toolStarted':
      return `toolStarted ${event.name} ${JSON.stringify(event.args)}`;
    case 'toolFinished':
      return `toolFinished ${event.name} isError=${event.isError} ${event.content.slice(0, 50).replace(/\n/g, ' ')}…`;
    case 'citation':
      return `citation ${event.citation.id} 「${event.citation.quote}」 @ ${event.citation.locator}`;
    case 'completed':
      return `completed citations=${event.result.citations.length} dropped=${event.result.droppedCitationIds.length}`;
    case 'failed':
      return `failed ${event.code} ${event.message}`;
    case 'cancelled':
      return 'cancelled';
  }
}

interface CaseReport {
  id: string;
  ok: boolean;
  detail: string;
}

function verify(
  testCase: EvalCase,
  result: AgentRunResult | null,
  events: AgentEvent[],
  expectedChapter: string,
): CaseReport {
  if (!result) return { id: testCase.id, ok: false, detail: '没有 completed 结果' };
  const tools = events.filter((event) => event.type === 'toolFinished');
  if (!tools.some((event) => event.type === 'toolFinished' && !event.isError)) {
    return { id: testCase.id, ok: false, detail: '没有成功的 search_book 工具调用' };
  }
  if (testCase.forgedCitation) {
    if (result.citations.length !== 0) return { id: testCase.id, ok: false, detail: '伪造引用未剔除' };
    if (!result.droppedCitationIds.includes('E1')) {
      return { id: testCase.id, ok: false, detail: '未记录被剔除的伪造引用' };
    }
    return { id: testCase.id, ok: true, detail: `伪造引用被剔除（dropped=${result.droppedCitationIds.join(',')}）` };
  }
  if (result.citations.length !== 1) {
    return { id: testCase.id, ok: false, detail: `真实引用数 ${result.citations.length} != 1` };
  }
  const citation = result.citations[0]!;
  let locator: { engine?: string; chapter?: string } = {};
  try {
    locator = JSON.parse(citation.locator) as { engine?: string; chapter?: string };
  } catch {
    return { id: testCase.id, ok: false, detail: 'citation locator 不是合法 JSON' };
  }
  if (locator.engine !== 'rag-chunk-v1') {
    return { id: testCase.id, ok: false, detail: `locator 引擎不对：${String(locator.engine)}` };
  }
  if (citation.chapter !== expectedChapter) {
    return { id: testCase.id, ok: false, detail: `引用章节 ${citation.chapter} != ${expectedChapter}` };
  }
  return { id: testCase.id, ok: true, detail: `引用 ${citation.id} @ ${citation.chapter}（locator rag-chunk-v1）` };
}

async function main(): Promise<void> {
  const ragBook = toRagBook(fixtureBook);
  const driver = createNodeSQLiteDriver();
  const embedding = new DeterministicEmbeddingProvider();
  const chunker = new ParagraphTextChunker();
  const reports: CaseReport[] = [];
  try {
    const migration = await migrate(driver);
    console.log(
      `RAG eval · 书《${ragBook.book.title}》 · 迁移 ${migration.applied.join(',')} · embedding ${embedding.modelId}`,
    );
    const index = new SqliteSearchIndex(driver, embedding);
    const { chunks } = await indexRagBook({
      index,
      chunker,
      embedding,
      book: ragBook,
      chunkOptions: { maxChars: 220 },
    });
    const stats = await index.stats(ragBook.book.id);
    console.log(`索引：${stats.chunkCount} chunks / ${stats.vectorCount} vectors / 维度 ${embedding.dimension}\n`);
    const source = new SqliteBookSource(index, ragBook.book);

    for (const testCase of evalCases) {
      const hits = await source.search(testCase.searchQuery, 3);
      if (hits.length === 0) {
        reports.push({ id: testCase.id, ok: false, detail: `检索「${testCase.searchQuery}」没有结果` });
        continue;
      }
      const first = hits[0]!;
      const citationQuote = testCase.forgedCitation ?? first.quote.slice(0, Math.min(8, first.quote.length));
      console.log(`[${testCase.id}] ${testCase.question}`);
      console.log(`  · 检索 top1（${first.chapter}${first.page ? ` / 第 ${first.page} 页` : ''}）：${first.quote.slice(0, 40)}…`);
      const model = createScriptedModel(modelTurns(testCase, citationQuote));
      const session = runBookAgent({
        model,
        source,
        book: ragBook.book,
        question: testCase.question,
      });
      const events: AgentEvent[] = [];
      for await (const event of session.events) {
        events.push(event);
        console.log(`  · ${formatEvent(event)}`);
      }
      const result = await session.result;
      const report = verify(testCase, result, events, first.chapter);
      reports.push(report);
      console.log(`  → ${report.ok ? 'PASS' : `FAIL：${report.detail}`}（${report.detail}）\n`);
    }
  } finally {
    await driver.close();
  }

  const passed = reports.filter((report) => report.ok).length;
  console.log(`结果：${passed}/${reports.length} 通过`);
  if (passed !== reports.length) process.exitCode = 1;
}

void main();
