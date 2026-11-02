/**
 * V2 真实 embedding 评测（Node + onnxruntime-node + 本地 MiniLM int8 ONNX）。
 *
 * 流程：本地模型（ios/.../SemanticModel，不提交/不修改）→ 流式解压 cache（SHA 校验）
 * → OnnxEmbeddingProvider(384 维, 128 token, mean pooling+L2) → 切块 → 0002 索引
 * → 中文/跨语言检索召回@1 + Agent(question→search_book→citation) 闭环。
 *
 * 运行：pnpm --filter @shudeng/eval eval:rag:real
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBookAgent, type AgentEvent, type AgentRunResult } from '@shudeng/core/agent';
import { createScriptedModel } from '@shudeng/core/agent/testing';
import { migrate } from '@shudeng/core/db';
import { createNodeSQLiteDriver } from '@shudeng/core/db/testing';
import {
  ParagraphTextChunker,
  SqliteBookSource,
  SqliteSearchIndex,
  indexRagBook,
  type RagBook,
} from '@shudeng/core/rag';
import { OnnxEmbeddingProvider } from '@shudeng/core/rag/onnx';
import { cosineSimilarity } from '@shudeng/core/rag';
import { fixtureBook } from './fixtures.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const modelDir = process.env.SHUDENG_SEMANTIC_MODEL_DIR ?? join(repoRoot, 'ios/Shudeng/Resources/SemanticModel');
const cacheDir = resolve(repoRoot, 'node_modules/.cache/shudeng-semantic-model');

function rssMb(): number {
  return process.memoryUsage().rss / 1024 / 1024;
}

function nowMs(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

const extraChapters = [
  {
    ordinal: 3,
    title: '第三章 · 月亮',
    page: 3,
    paragraphs: ['月亮挂在窗外，河流安静地流过夜色。'],
  },
];

function buildRagBook(): RagBook {
  return {
    book: { ...fixtureBook.book, id: `${fixtureBook.book.id}-real` },
    chapters: [
      ...fixtureBook.chapters.map((chapter, index) => ({
        ordinal: index + 1,
        title: chapter.title,
        ...(chapter.page !== undefined ? { page: chapter.page } : {}),
        paragraphs: chapter.paragraphs,
      })),
      ...extraChapters,
    ],
  };
}

interface RecallCase {
  query: string;
  expect: string;
  kind: '中文' | '跨语言';
}

const recallCases: RecallCase[] = [
  { query: '灯把书页照亮', expect: '灯', kind: '中文' },
  { query: '阅读不是把答案抄下来', expect: '阅读', kind: '中文' },
  { query: '月亮挂在窗外', expect: '月亮', kind: '中文' },
  { query: 'The lamp lights the page', expect: '灯', kind: '跨语言' },
  { query: 'read the original text slowly', expect: '阅读', kind: '跨语言' },
];

interface AgentCase {
  id: string;
  question: string;
  searchQuery: string;
  answer: string;
  forgedQuote?: string;
}

const agentCases: AgentCase[] = [
  {
    id: 'lamp-meaning',
    question: '“灯”在这本书里指什么？',
    searchQuery: '灯 照亮 书页',
    answer: '灯把书页照亮，也把问题留在纸上。',
  },
  {
    id: 'reading-attitude',
    question: '作者怎么看待阅读？',
    searchQuery: '阅读 原文 慢一点',
    answer: '阅读要慢下来读原文，而不是直接抄答案。',
  },
  {
    id: 'forged-citation',
    question: '书里有没有说灯会自己写答案？',
    searchQuery: '灯 照亮',
    answer: '没有这样的原文。',
    forgedQuote: '灯会自己写答案并替读者做决定',
  },
];

function modelTurns(agentCase: AgentCase, citationQuote: string) {
  return [
    {
      chunks: [
        { reasoning: `先检索「${agentCase.searchQuery}」。` },
        { toolCalls: [{ id: 'call_1', name: 'search_book', args: { query: agentCase.searchQuery } }] },
      ],
    },
    {
      chunks: [
        { reasoning: '依据检索到的原文组织回答。' },
        {
          text: JSON.stringify({
            answer: agentCase.answer,
            citations: [{ id: 'E1', quote: citationQuote }],
          }),
        },
      ],
    },
  ];
}

function checkAgentResult(
  agentCase: AgentCase,
  result: AgentRunResult | null,
  events: AgentEvent[],
): string {
  if (!result) return 'FAIL：没有 completed 结果';
  const toolOk = events.some((event) => event.type === 'toolFinished' && !event.isError);
  if (!toolOk) return 'FAIL：没有成功的 search_book 工具调用';
  if (agentCase.forgedQuote) {
    if (result.citations.length !== 0) return 'FAIL：伪造引用未剔除';
    if (!result.droppedCitationIds.includes('E1')) return 'FAIL：未记录 dropped';
    return 'PASS：伪造引用被剔除';
  }
  if (result.citations.length !== 1) return `FAIL：真实引用数 ${result.citations.length} != 1`;
  try {
    const locator = JSON.parse(result.citations[0]!.locator) as { engine?: string };
    if (locator.engine !== 'rag-chunk-v1') return 'FAIL：locator 引擎不对';
  } catch {
    return 'FAIL：locator 非 JSON';
  }
  return `PASS：引用 ${result.citations[0]!.id} @ ${result.citations[0]!.chapter}`;
}

async function main(): Promise<void> {
  if (!existsSync(join(modelDir, 'model.onnx.gz')) || !existsSync(join(modelDir, 'tokenizer.json'))) {
    console.error(`未找到本地 ONNX 模型：${modelDir}（真实 embedding 未验证）`);
    process.exitCode = 1;
    return;
  }

  console.log('=== 真实 ONNX embedding 评测 ===');
  console.log(`模型目录：${modelDir}`);
  console.log(`解压缓存：${cacheDir}`);
  const startRss = rssMb();
  const startMs = nowMs();

  const loadStart = nowMs();
  const provider = await OnnxEmbeddingProvider.create({ modelDir, cacheDir });
  const loadMs = nowMs() - loadStart;
  const afterLoadRss = rssMb();
  console.log(`模型加载：${loadMs}ms，维度 ${provider.dimension}，modelId=${provider.modelId}`);
  console.log(`RSS：起始 ${startRss.toFixed(1)}MB → 加载后 ${afterLoadRss.toFixed(1)}MB`);

  const driver = createNodeSQLiteDriver();
  const book = buildRagBook();
  try {
    await migrate(driver);
    const index = new SqliteSearchIndex(driver, provider);
    const chunkStart = nowMs();
    const { chunks } = await indexRagBook({
      index,
      chunker: new ParagraphTextChunker(),
      embedding: provider,
      book,
      chunkOptions: { maxChars: 220 },
    });
    const chunkMs = nowMs() - chunkStart;
    const embedMetrics = provider.metricsSnapshot();
    console.log(
      `切块+embedding：${chunks.length} chunks，${chunkMs}ms（平均 ${(chunkMs / Math.max(1, chunks.length)).toFixed(1)}ms/chunk，embedding ${embedMetrics.totalEmbedMs}ms）`,
    );
    const stats = await index.stats(book.book.id);
    console.log(`索引：${stats.chunkCount} chunks / ${stats.vectorCount} vectors / model=${stats.models[0]?.model}`);

    // 1) 中文/跨语言召回@1
    let recalled = 0;
    console.log('\n-- 检索召回（hybrid, top1）--');
    for (const recallCase of recallCases) {
      const hits = await index.search(recallCase.query, { bookId: book.book.id, topK: 3 });
      const top = hits[0];
      const ok = Boolean(top && top.chunk.text.includes(recallCase.expect));
      if (ok) recalled += 1;
      let cos = 'n/a';
      if (top) {
        const [queryVector, chunkVector] = await provider.embed([recallCase.query, top.chunk.text]);
        cos = cosineSimilarity(queryVector!, chunkVector!).toFixed(3);
      }
      console.log(
        `[${recallCase.kind}] ${ok ? 'HIT' : 'MISS'} 「${recallCase.query}」→ top1=${top?.chunk.chapter ?? '∅'} / ${top?.chunk.text.slice(0, 30) ?? ''}…（cos=${cos}）`,
      );
    }
    console.log(`召回@1：${recalled}/${recallCases.length}`);

    // 2) Agent 工具 + 引用闭环（真实检索）
    const source = new SqliteBookSource(index, book.book);
    let agentPassed = 0;
    console.log('\n-- Agent 闭环（真实检索 + 引用核对）--');
    for (const agentCase of agentCases) {
      const hits = await source.search(agentCase.searchQuery, 3);
      const first = hits[0];
      if (!first) {
        console.log(`[${agentCase.id}] FAIL：检索无结果`);
        continue;
      }
      const citationQuote = agentCase.forgedQuote ?? first.quote.slice(0, 8);
      const session = runBookAgent({
        model: createScriptedModel(modelTurns(agentCase, citationQuote)),
        source,
        book: book.book,
        question: agentCase.question,
      });
      const events: AgentEvent[] = [];
      for await (const event of session.events) events.push(event);
      const verdict = checkAgentResult(agentCase, await session.result, events);
      if (verdict.startsWith('PASS')) agentPassed += 1;
      console.log(
        `[${agentCase.id}] ${verdict}（检索 top1：${first.chapter} / ${first.quote.slice(0, 24)}…）`,
      );
    }
    console.log(`Agent 闭环：${agentPassed}/${agentCases.length}`);

    const embedEnd = provider.metricsSnapshot();
    const totalMs = nowMs() - startMs;
    console.log(
      `\n真实 embedding 总耗时 ${embedEnd.totalEmbedMs}ms / ${embedEnd.embeddedTexts} 条文本（最后一次 ${embedEnd.lastEmbedMs}ms）`,
    );
    console.log(`RSS：结束 ${rssMb().toFixed(1)}MB（峰值增量 +${(rssMb() - startRss).toFixed(1)}MB）`);
    console.log(`总耗时：${totalMs}ms`);

    const ok = recalled === recallCases.length && agentPassed === agentCases.length;
    console.log(`\n结果：${ok ? 'PASS' : 'FAIL'}（召回 ${recalled}/${recallCases.length}，Agent ${agentPassed}/${agentCases.length}）`);
    if (!ok) process.exitCode = 1;
  } finally {
    await driver.close();
    await provider.dispose();
  }
}

void main();
