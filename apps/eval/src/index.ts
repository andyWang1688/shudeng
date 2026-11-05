/**
 * Node 评测入口：fixture 书 → question → search_book 工具 → 引用核对 → answer。
 * 用脚本化 ChatModel 跑确定性闭环（无 key、无网络）；真实 provider 用法见 README/报告。
 */
import { InMemoryBookSource, runBookAgent, type AgentEvent, type AgentRunResult } from '@shudeng/core/agent';
import { createScriptedModel, type ScriptedTurn } from '@shudeng/core/agent/testing';
import { evalCases, fixtureBook, type EvalCase } from './fixtures.js';

function turnsFor(testCase: EvalCase): ScriptedTurn[] {
  const citedQuote = testCase.forgedCitation ?? testCase.citationQuote;
  const answerPayload = JSON.stringify({
    answer: testCase.answer,
    citations: [{ id: 'E1', quote: citedQuote }],
  });
  return [
    {
      // 模拟 DeepSeek 原生思考 + 工具调用（真实 provider 由 createChatModel 接入）。
      chunks: [
        { reasoning: `先检索「${testCase.searchQuery}」。` },
        { toolCalls: [{ id: 'call_1', name: 'search_book', args: { query: testCase.searchQuery } }] },
      ],
    },
    {
      chunks: [{ reasoning: '依据检索到的原文组织回答。' }, { text: answerPayload }],
    },
  ];
}

function formatEvent(event: AgentEvent): string {
  switch (event.type) {
    case 'started':
      return `started provider=${event.started.provider} tools=${event.started.toolNames.join(',')}`;
    case 'reasoningDelta':
      return `reasoning +${JSON.stringify(event.delta)}`;
    case 'textDelta':
      return `text +${JSON.stringify(event.delta)}`;
    case 'toolStarted':
      return `toolStarted ${event.name} ${JSON.stringify(event.args)}`;
    case 'toolFinished':
      return `toolFinished ${event.name} isError=${event.isError} ${event.content.slice(0, 60).replace(/\n/g, ' ')}…`;
    case 'citation':
      return `citation ${event.citation.id} 「${event.citation.quote}」 @ ${event.citation.locator}`;
    case 'completed':
      return `completed answer=${JSON.stringify(event.result.answer)} citations=${event.result.citations.length} dropped=${event.result.droppedCitationIds.join(',') || '-'}`;
    case 'failed':
      return `failed ${event.code} ${event.message}`;
    case 'cancelled':
      return 'cancelled';
    case 'contextUsage':
      return `contextUsage input=${event.usage.inputTokens} output=${event.usage.outputTokens}`;
    case 'requestContext':
      return `requestContext estimated=${event.estimate.estimatedTokens} materials=${event.materials.length}`;
    case 'contextCompacted':
      return 'contextCompacted';
  }
}

function verify(testCase: EvalCase, result: AgentRunResult | null, events: AgentEvent[]): string[] {
  const problems: string[] = [];
  if (!result) return ['没有 completed 结果'];
  const tools = events.filter(
    (event): event is Extract<AgentEvent, { type: 'toolFinished' }> => event.type === 'toolFinished',
  );
  if (!tools.some((event) => !event.isError)) {
    problems.push('没有成功的工具调用');
  }
  if (testCase.forgedCitation) {
    if (result.citations.length !== 0) problems.push('伪造引用没有被剔除');
    if (!result.droppedCitationIds.includes('E1')) problems.push('没有记录被剔除的伪造引用');
    if (!result.warnings.some((warning) => warning.includes('核验'))) problems.push('没有引用核验 warning');
  } else {
    if (result.citations.length !== 1) problems.push(`期望 1 条真实引用，得到 ${result.citations.length}`);
    if (result.citations[0]?.id !== 'E1') problems.push('引用 id 不是 E1');
    if (result.droppedCitationIds.length > 0) problems.push('真实引用被误删');
    if (!result.answer) problems.push('回答为空');
  }
  const reasoning = events.filter((event) => event.type === 'reasoningDelta');
  if (reasoning.length === 0) problems.push('没有 reasoning 事件（脚本模型应产生）');
  if (!events.some((event) => event.type === 'completed')) problems.push('没有 completed 事件');
  return problems;
}

async function runCase(testCase: EvalCase): Promise<boolean> {
  const source = new InMemoryBookSource(fixtureBook);
  const model = createScriptedModel(turnsFor(testCase));
  const session = runBookAgent({
    model,
    source,
    book: fixtureBook.book,
    question: testCase.question,
  });
  const events: AgentEvent[] = [];
  for await (const event of session.events) {
    events.push(event);
    console.log(`  · ${formatEvent(event)}`);
  }
  const result = await session.result;
  const problems = verify(testCase, result, events);
  console.log(
    `  → ${problems.length === 0 ? 'PASS' : `FAIL: ${problems.join('; ')}`}` +
      (result ? ` (citations=${result.citations.length}, dropped=${result.droppedCitationIds.length})` : ''),
  );
  return problems.length === 0;
}

async function main(): Promise<void> {
  console.log(`shudeng eval spike · 书：《${fixtureBook.book.title}》 · 用例 ${evalCases.length} 个\n`);
  let failures = 0;
  for (const testCase of evalCases) {
    console.log(`[${testCase.id}] ${testCase.question}`);
    const passed = await runCase(testCase);
    if (!passed) failures += 1;
    console.log('');
  }
  console.log(`结果：${evalCases.length - failures}/${evalCases.length} 通过`);
  if (failures > 0) process.exitCode = 1;
}

void main();
