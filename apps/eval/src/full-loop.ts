/**
 * V5 Node 业务闭环 + 性能采样（真实 ONNX embedding + SQLite FTS/vector + LangChain Agent）。
 *
 * 流程：
 *   脱敏旧备份 → migrateSwiftLibrary → 写入共享 SQLite schema
 *   → 导入书文本（切块 + 真实 ONNX embedding + FTS/vector 索引）
 *   → LangChain Agent（scripted model 固定问题）→ search_book → 引用核对 → answer
 *   → 性能采样：1000 chunk 索引耗时/内存、FTS/vector 查询延迟、Agent 工具轮耗时。
 *
 * 仅 Node/PC 基线，不代表移动端/Hermes 性能；可重复运行。
 * 运行：pnpm --filter @shudeng/eval eval:full-loop
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ParagraphTextChunker,
  SqliteBookSource,
  SqliteSearchIndex,
  annotations as annotationsTable,
  anchors as anchorsTable,
  books as booksTable,
  citations as citationsTable,
  createDatabase,
  migrate,
  migrateSwiftLibrary,
  messages as messagesTable,
  runBookAgent,
  type AgentEvent,
  type AgentRunResult,
  type AgentRunSession,
  type RagBook,
  type RagChapter,
  type SQLiteValue,
} from '@shudeng/core';
import { createScriptedModel } from '@shudeng/core/agent/testing';
import { createNodeSQLiteDriver, type NodeSQLiteDriver } from '@shudeng/core/db/testing';
import { OnnxEmbeddingProvider } from '@shudeng/core/rag/onnx';
import {
  MIGRATION_EPUB_ID,
  MIGRATION_NOW,
  migrationCopyOfLegacyBackup,
} from './migration-fixture.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const logsDir = join(repoRoot, '.scratch/impl/rn-langchain-v5/logs');
mkdirSync(logsDir, { recursive: true });
const modelDir = process.env.SHUDENG_SEMANTIC_MODEL_DIR ?? join(repoRoot, 'ios/Shudeng/Resources/SemanticModel');
const cacheDir = join(repoRoot, 'node_modules/.cache/shudeng-semantic-model');

const MAX_CHARS = 220; // 功能书：短章节，验证检索闭环
const PERF_MAX_CHARS = 120; // 性能书：中文 ~100–120 字/块，避免 128 token 截断
const PERF_BOOK_ID = 'f'.repeat(64);
const PERF_TARGET_CHUNKS = 1000;

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];
const metrics: Record<string, unknown> = {};

function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
}

function nowMs(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

function rssMb(): number {
  return Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1));
}

function stats(samples: ReadonlyArray<number>): {
  count: number;
  min: number;
  p50: number;
  p95: number;
  mean: number;
  max: number;
} {
  const sorted = [...samples].sort((left, right) => left - right);
  const at = (ratio: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
  return {
    count: sorted.length,
    min: Number((sorted[0] ?? 0).toFixed(3)),
    p50: Number(at(0.5).toFixed(3)),
    p95: Number(at(0.95).toFixed(3)),
    mean: Number((sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length)).toFixed(3)),
    max: Number((sorted[sorted.length - 1] ?? 0).toFixed(3)),
  };
}

/** 迁移后的书目文本（脱敏合成；与旧库 EPUB 书 id 对齐，用于真实检索闭环）。 */
function functionalBook(): RagBook {
  return {
    book: {
      id: MIGRATION_EPUB_ID,
      title: '迁移评测 EPUB',
      format: 'epub',
      sourceHash: MIGRATION_EPUB_ID,
    },
    chapters: [
      {
        ordinal: 1,
        title: '第一章 · 灯',
        paragraphs: [
          '灯把书页照亮，也把问题留在纸上。',
          '阅读不是把答案抄下来，而是把原文读慢一点。',
        ],
      },
      {
        ordinal: 2,
        title: '第二章 · 书页',
        page: 2,
        paragraphs: ['书页记录的是作者写下的句子，读者要回到这些句子本身。'],
      },
      {
        ordinal: 3,
        title: '第三章 · 月亮',
        page: 3,
        paragraphs: ['月亮挂在窗外，河流安静地流过夜色。'],
      },
    ],
  };
}

/** 性能用合成书：50 章 × 20 段，段落约 150+ 字，目标 ~1000 chunks（maxChars=220 时每段一块）。 */
function performanceBook(): RagBook {
  const chapters: RagChapter[] = Array.from({ length: 50 }, (_, chapterIndex) => {
    const paragraphs = Array.from({ length: 20 }, (_, paragraphIndex) => {
      const base = '灯把书页照亮，也把问题留在纸上。阅读不是把答案抄下来，而是把原文读慢一点。';
      return `性能采样段落 ${chapterIndex + 1}-${paragraphIndex + 1}：${base.repeat(2)}`;
    });
    return {
      ordinal: chapterIndex + 1,
      title: `性能章节 ${chapterIndex + 1}`,
      page: chapterIndex + 1,
      paragraphs,
    };
  });
  return {
    book: { id: PERF_BOOK_ID, title: '性能采样书', format: 'epub', sourceHash: PERF_BOOK_ID },
    chapters,
  };
}

interface AgentCase {
  id: string;
  question: string;
  searchQuery: string;
  answer: string;
  forgedQuote?: string;
}

const agentCases: AgentCase[] = [
  {
    id: 'lamp',
    question: '“灯”在这本书里指什么？',
    searchQuery: '灯 照亮 书页',
    answer: '灯把书页照亮，也把问题留在纸上。',
  },
  {
    id: 'reading',
    question: '作者怎么看待阅读？',
    searchQuery: '阅读 原文 慢一点',
    answer: '阅读要慢下来读原文，而不是直接抄答案。',
  },
  {
    id: 'forged',
    question: '书里有没有说灯会自己写答案？',
    searchQuery: '灯 照亮',
    answer: '没有这样的原文。',
    forgedQuote: '灯会自己写答案并替读者做决定',
  },
];

function scriptedTurns(agentCase: AgentCase, citationQuote: string) {
  return [
    {
      chunks: [
        { reasoning: `先检索「${agentCase.searchQuery}」。` },
        {
          toolCalls: [
            { id: 'call_1', name: 'search_book', args: { query: agentCase.searchQuery } },
          ],
        },
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

function parseLocatorEngine(locator: string): string | null {
  try {
    const value: unknown = JSON.parse(locator);
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    return typeof record.engine === 'string' ? record.engine : null;
  } catch {
    return null;
  }
}



async function main(): Promise<void> {
  const startedAt = nowMs();
  console.log('=== V5 Node 业务闭环 + 性能采样 ===');

  // 1) 旧库迁移
  console.log('\n[1/6] 脱敏旧库 → migrateSwiftLibrary');
  const legacyInput = migrationCopyOfLegacyBackup();
  const legacyBefore = JSON.stringify(legacyInput);
  const migration = migrateSwiftLibrary(legacyInput, { now: MIGRATION_NOW });
  metrics.migration = {
    ok: migration.ok,
    books: migration.tables.books.length,
    anchors: migration.tables.anchors.length,
    annotations: migration.tables.annotations.length,
    messages: migration.tables.messages.length,
    citations: migration.tables.citations.length,
    failures: migration.failures.length,
    warnings: migration.warnings.length,
    failureCodes: migration.failures.map((failure) => failure.code),
    stats: migration.stats,
  };
  check(
    '旧库迁移（部分成功，失败清单可见）',
    migration.tables.books.length === 4 &&
      migration.tables.anchors.length === 11 &&
      migration.tables.annotations.length === 6 &&
      migration.tables.messages.length === 6 &&
      migration.tables.citations.length === 3 &&
      migration.failures.length === 2 &&
      JSON.stringify(legacyInput) === legacyBefore,
    `books=${migration.tables.books.length} anchors=${migration.tables.anchors.length} annotations=${migration.tables.annotations.length} messages=${migration.tables.messages.length} citations=${migration.tables.citations.length} failures=${migration.failures.length}（输入未改）`,
  );

  // 2) 写入 SQLite
  console.log('\n[2/6] 迁移结果写入共享 SQLite schema');
  const driver: NodeSQLiteDriver = createNodeSQLiteDriver();
  let provider: OnnxEmbeddingProvider | null = null;
  try {
    const dbMigration = await migrate(driver);
    const db = createDatabase(driver);
    const tInsert = nowMs();
    await db.withTransaction(async (tx) => {
      if (migration.tables.books.length) await tx.insert(booksTable).values([...migration.tables.books]);
      if (migration.tables.anchors.length) await tx.insert(anchorsTable).values([...migration.tables.anchors]);
      if (migration.tables.annotations.length)
        await tx.insert(annotationsTable).values([...migration.tables.annotations]);
      if (migration.tables.messages.length) await tx.insert(messagesTable).values([...migration.tables.messages]);
      if (migration.tables.citations.length)
        await tx.insert(citationsTable).values([...migration.tables.citations]);
    });
    const insertMs = nowMs() - tInsert;
    const countRows = async (sql: string): Promise<number> => {
      const rows = await driver.all<Record<string, SQLiteValue>>(sql);
      return Number(rows[0]?.n ?? 0);
    };
    const dbCounts = {
      books: await countRows('SELECT count(*) AS n FROM books'),
      anchors: await countRows('SELECT count(*) AS n FROM anchors'),
      annotations: await countRows('SELECT count(*) AS n FROM annotations'),
      messages: await countRows('SELECT count(*) AS n FROM messages'),
      citations: await countRows('SELECT count(*) AS n FROM citations'),
    };
    const foreignKeyViolations = (await driver.all<Record<string, SQLiteValue>>('PRAGMA foreign_key_check')).length;
    metrics.database = { applied: dbMigration.applied, insertMs, counts: dbCounts, foreignKeyViolations };
    check(
      'SQLite 写入 + 外键完整性',
      dbCounts.books === 4 &&
        dbCounts.anchors === 11 &&
        dbCounts.annotations === 6 &&
        dbCounts.messages === 6 &&
        dbCounts.citations === 3 &&
        foreignKeyViolations === 0,
      `books=${dbCounts.books} anchors=${dbCounts.anchors} annotations=${dbCounts.annotations} messages=${dbCounts.messages} citations=${dbCounts.citations} fk=${foreignKeyViolations} insert=${insertMs}ms`,
    );

    // 3) 真实 ONNX embedding + 功能书索引
    console.log('\n[3/6] 真实 ONNX embedding + 功能书 FTS/vector 索引');
    const loadStart = nowMs();
    provider = await OnnxEmbeddingProvider.create({ modelDir, cacheDir });
    const modelLoadMs = nowMs() - loadStart;
    const rssAfterModelLoad = rssMb();
    const chunker = new ParagraphTextChunker();
    const index = new SqliteSearchIndex(driver, provider);
    const book = functionalBook();
    const functionalChunkStart = nowMs();
    const functionalChunks = chunker.chunk(book, { maxChars: MAX_CHARS });
    const functionalChunkMs = nowMs() - functionalChunkStart;
    const functionalEmbedStart = nowMs();
    const functionalEmbeddings = await provider.embed(functionalChunks.map((chunk) => chunk.text));
    const functionalEmbedMs = nowMs() - functionalEmbedStart;
    await index.indexBook(book, functionalChunks, functionalEmbeddings);
    metrics.functionalIndex = {
      modelId: provider.modelId,
      dimension: provider.dimension,
      modelLoadMs,
      chunks: functionalChunks.length,
      chunkMs: functionalChunkMs,
      embedMs: functionalEmbedMs,
      modelRssMb: rssAfterModelLoad,
    };
    const functionalHits = await index.search('灯把书页照亮', { bookId: book.book.id, topK: 3 });
    check(
      '功能书切块 + 真实 embedding + 索引',
      functionalChunks.length >= 3 && functionalEmbeddings.length === functionalChunks.length && functionalHits.length > 0,
      `chunks=${functionalChunks.length} embed=${functionalEmbedMs}ms（${(functionalEmbedMs / Math.max(1, functionalChunks.length)).toFixed(1)}ms/chunk）modelLoad=${modelLoadMs}ms top1=${functionalHits[0]?.chunk.chapter ?? '∅'}`,
    );

    // 4) LangChain Agent 闭环（scripted model，固定问题）
    console.log('\n[4/6] LangChain Agent：search_book → 引用核对 → answer');
    const source = new SqliteBookSource(index, book.book);
    const agentResults: Array<Record<string, unknown>> = [];
    let agentPassed = 0;
    for (const agentCase of agentCases) {
      const hits = await source.search(agentCase.searchQuery, 3);
      const first = hits[0];
      if (!first) {
        check(`Agent[${agentCase.id}]`, false, '检索无结果');
        continue;
      }
      const citationQuote = agentCase.forgedQuote ?? first.quote.slice(0, Math.min(8, first.quote.length));
      const session = runBookAgentForCase(agentCase, citationQuote, source, book);
      const runtime = await collectAgentRun(session);
      const verdict = verifyAgent(agentCase, runtime.result, runtime.events);
      if (verdict.ok) agentPassed += 1;
      check(`Agent[${agentCase.id}]`, verdict.ok, verdict.detail);
      agentResults.push({
        id: agentCase.id,
        passed: verdict.ok,
        detail: verdict.detail,
        totalMs: runtime.totalMs,
        toolCalls: runtime.tools.length,
        toolErrorCount: runtime.tools.filter((tool) => tool.isError).length,
        toolDurationsMs: runtime.tools.map((tool) => Number(tool.durationMs.toFixed(2))),
        citationCount: runtime.result?.citations.length ?? null,
        droppedCitationIds: runtime.result?.droppedCitationIds ?? null,
      });
    }
    metrics.agent = { cases: agentResults, passed: agentPassed, total: agentCases.length };
    check('Agent 固定问题闭环', agentPassed === agentCases.length, `${agentPassed}/${agentCases.length} 题通过`);

    // 5) 1000 chunk 索引性能（真实 embedding）
    console.log(`\n[5/6] 性能：${PERF_TARGET_CHUNKS} chunk 级索引（真实 embedding + SQLite）`);
    const perfBook = performanceBook();
    const rssBeforePerf = rssMb();
    const perfChunkStart = nowMs();
    const perfChunks = chunker.chunk(perfBook, { maxChars: PERF_MAX_CHARS });
    const perfChunkMs = nowMs() - perfChunkStart;
    const rssAfterChunk = rssMb();
    const tokenStats = perfChunks.map((chunk) => provider!.tokenize(chunk.text).ids.length);
    const truncatedChunks = tokenStats.filter((count) => count > 128).length;
    const perfEmbedStart = nowMs();
    const perfEmbeddings: Float32Array[] = [];
    const batchTimings: number[] = [];
    const batchSize = 100;
    for (let offset = 0; offset < perfChunks.length; offset += batchSize) {
      const texts = perfChunks.slice(offset, offset + batchSize).map((chunk) => chunk.text);
      const batchStart = nowMs();
      perfEmbeddings.push(...(await provider!.embed(texts)));
      batchTimings.push(nowMs() - batchStart);
    }
    const perfEmbedMs = nowMs() - perfEmbedStart;
    const rssAfterEmbed = rssMb();
    const perfIndexStart = nowMs();
    await index.indexBook(perfBook, perfChunks, perfEmbeddings);
    const perfIndexMs = nowMs() - perfIndexStart;
    const rssAfterIndex = rssMb();
    metrics.performanceIndexing = {
      requestedTargetChunks: PERF_TARGET_CHUNKS,
      actualChunks: perfChunks.length,
      chunkMaxChars: PERF_MAX_CHARS,
      chunkMs: perfChunkMs,
      tokenStats: {
        min: Math.min(...tokenStats),
        p50: stats(tokenStats).p50,
        max: Math.max(...tokenStats),
        mean: Number((tokenStats.reduce((sum, value) => sum + value, 0) / Math.max(1, tokenStats.length)).toFixed(1)),
        over128TokenChunks: truncatedChunks,
      },
      embedBatchSize: batchSize,
      embedBatches: batchTimings.length,
      embedBatchMs: stats(batchTimings),
      embedChunkMs: Number((perfEmbedMs / Math.max(1, perfChunks.length)).toFixed(2)),
      embedMs: perfEmbedMs,
      indexWriteMs: perfIndexMs,
      indexTotalMs: perfChunkMs + perfEmbedMs + perfIndexMs,
      rss: {
        beforeMb: rssBeforePerf,
        afterChunkMb: rssAfterChunk,
        afterEmbedMb: rssAfterEmbed,
        afterIndexMb: rssAfterIndex,
      },
    };
    check(
      '1000 chunk 级索引完成',
      perfChunks.length >= 900 && perfEmbeddings.length === perfChunks.length,
      `chunks=${perfChunks.length} chunk=${perfChunkMs}ms embed=${perfEmbedMs}ms（${(perfEmbedMs / Math.max(1, perfChunks.length)).toFixed(2)}ms/chunk）indexWrite=${perfIndexMs}ms total=${perfChunkMs + perfEmbedMs + perfIndexMs}ms rss ${rssBeforePerf}→${rssAfterIndex}MB`,
    );

    // 6) FTS / vector / hybrid 查询延迟（大索引上采样）
    console.log('\n[6/6] 性能：FTS / vector / hybrid 查询延迟');
    const queries = [
      '灯把书页照亮',
      '阅读不是把答案抄下来',
      '月亮挂在窗外',
      'The lamp lights the page',
      'read the original text slowly',
    ];
    const modes = ['fts', 'vector', 'hybrid'] as const;
    const latency: Record<string, ReturnType<typeof stats>> = {};
    const latencySamples: Record<string, number[]> = {};
    for (const mode of modes) {
      await index.search(queries[0]!, { bookId: PERF_BOOK_ID, mode, topK: 3 }); // warmup
      const samples: number[] = [];
      let resultCount = 0;
      for (let round = 0; round < 5; round += 1) {
        for (const query of queries) {
          const t = nowMs();
          const hits = await index.search(query, { bookId: PERF_BOOK_ID, mode, topK: 3 });
          samples.push(nowMs() - t);
          resultCount += hits.length;
        }
      }
      latencySamples[mode] = samples;
      latency[mode] = stats(samples);
      check(
        `查询延迟[${mode}]`,
        samples.length === 25 && resultCount > 0,
        `n=${samples.length} p50=${latency[mode]!.p50}ms p95=${latency[mode]!.p95}ms mean=${latency[mode]!.mean}ms max=${latency[mode]!.max}ms`,
      );
    }
    const queryEmbedSamples: number[] = [];
    await provider.embed([queries[0]!]); // warmup
    for (let index = 0; index < 25; index += 1) {
      const query = queries[index % queries.length]!;
      const t = nowMs();
      await provider.embed([query]);
      queryEmbedSamples.push(nowMs() - t);
    }
    const queryLatencyMetrics = {
      queries,
      modes,
      samples: latency,
      rawLatencyMs: latencySamples,
      queryEmbeddingMs: stats(queryEmbedSamples),
      note: 'hybrid/vector 含查询 embedding 耗时；Node/PC 基线',
    };
    metrics.queryLatency = queryLatencyMetrics;
    console.log(
      `  INFO 查询 embedding：p50=${queryLatencyMetrics.queryEmbeddingMs.p50}ms p95=${queryLatencyMetrics.queryEmbeddingMs.p95}ms（含在 vector/hybrid 延迟内）`,
    );

    // 汇总
    const failed = checks.filter((item) => !item.ok);
    const summary = {
      schema: 'shudeng.v5-full-loop.v1',
      generatedAt: new Date().toISOString(),
      env: {
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        modelDir,
        cacheDir,
        onnxruntimeNode: '1.31.1',
        modelId: provider.modelId,
        dimension: provider.dimension,
        note: 'Node/PC 基线；不代表 iOS/Hermes/Android 性能',
      },
      totalMs: nowMs() - startedAt,
      checks,
      summary: { passed: checks.length - failed.length, total: checks.length, ok: failed.length === 0 },
      metrics,
    };
    const resultPath = join(logsDir, 'full-loop-results.json');
    writeFileSync(resultPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`\n结果：${summary.summary.passed}/${summary.summary.total} 通过`);
    console.log(`结果 JSON：${resultPath}`);
    console.log(`总耗时：${summary.totalMs}ms，RSS 结束 ${rssMb()}MB`);
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    await provider?.dispose();
    await driver.close();
  }
}

// ---------- Agent helpers ----------

interface AgentRuntime {
  events: AgentEvent[];
  result: AgentRunResult | null;
  totalMs: number;
  tools: Array<{ name: string; isError: boolean; durationMs: number }>;
}

function runBookAgentForCase(
  agentCase: AgentCase,
  citationQuote: string,
  source: SqliteBookSource,
  book: RagBook,
): AgentRunSession {
  return runBookAgent({
    model: createScriptedModel(scriptedTurns(agentCase, citationQuote)),
    source,
    book: book.book,
    question: agentCase.question,
  });
}

async function collectAgentRun(session: AgentRunSession): Promise<AgentRuntime> {
  const startedAt = nowMs();
  const events: AgentEvent[] = [];
  const tools: AgentRuntime['tools'] = [];
  for await (const event of session.events) {
    events.push(event);
    if (event.type === 'toolFinished') {
      tools.push({ name: event.name, isError: event.isError, durationMs: event.durationMs });
    }
  }
  const result = await session.result;
  return { events, result, totalMs: nowMs() - startedAt, tools };
}

function verifyAgent(
  agentCase: AgentCase,
  result: AgentRunResult | null,
  events: ReadonlyArray<AgentEvent>,
): { ok: boolean; detail: string } {
  if (!result) return { ok: false, detail: '没有 completed 结果' };
  const toolFinished = events.filter((event) => event.type === 'toolFinished');
  const toolOk = toolFinished.some((event) => event.type === 'toolFinished' && !event.isError);
  if (!toolOk) return { ok: false, detail: '没有成功的 search_book 工具调用' };
  if (agentCase.forgedQuote) {
    if (result.citations.length !== 0) return { ok: false, detail: `伪造引用未被剔除（citations=${result.citations.length}）` };
    if (!result.droppedCitationIds.includes('E1')) return { ok: false, detail: '未记录被剔除的伪造引用 E1' };
    return { ok: true, detail: `伪造引用已剔除（dropped=${result.droppedCitationIds.join(',')}，tool=${toolFinished.length}）` };
  }
  if (result.citations.length !== 1) {
    return { ok: false, detail: `真实引用数 ${result.citations.length} != 1` };
  }
  const citation = result.citations[0]!;
  const engine = parseLocatorEngine(citation.locator);
  if (engine !== 'rag-chunk-v1') {
    return { ok: false, detail: `citation locator 引擎异常：${String(engine)}` };
  }
  if (!citation.quote.trim()) return { ok: false, detail: '引用 quote 为空' };
  return { ok: true, detail: `引用 ${citation.id} @ ${citation.chapter ?? '?'}（locator=rag-chunk-v1，tool=${toolFinished.length}）` };
}

void main();
