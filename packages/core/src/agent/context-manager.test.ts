import { describe, expect, it, vi } from 'vitest';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { NativeContextManager, nativeContextBudget, summaryTranscript, textCharacters, TOOL_TRIMMED_SUFFIX } from './context-manager.js';
import { EvidenceRegistry } from './evidence.js';
import { runBookAgent } from './agent.js';
import { InMemoryBookSource, type BookSource } from './book-source.js';
import { createScriptedModel, ScriptedChatModel } from './testing.js';
import type { AgentEvent, AgentRunSession } from './events.js';

const book = { id: 'budget-book', title: '书', format: 'epub' as const, sourceHash: 'budget' };
const source = () => new InMemoryBookSource({ book, chapters: [{ title: '章', paragraphs: ['原文'] }] });
async function collect(session: AgentRunSession) {
  const events: AgentEvent[] = [];
  for await (const event of session.events) events.push(event);
  return events;
}

describe('native context preparation contract', () => {
  it('preserves emoji and combining graphemes even when Intl.Segmenter is absent', () => {
    const original = Intl.Segmenter;
    try {
      Object.defineProperty(Intl, 'Segmenter', { value: undefined, configurable: true });
      expect(textCharacters('灯👨‍👩‍👧‍👦e\u0301🇨🇳')).toEqual(['灯', '👨‍👩‍👧‍👦', 'e\u0301', '🇨🇳']);
    } finally { Object.defineProperty(Intl, 'Segmenter', { value: original, configurable: true }); }
  });
  it('uses native reserve/headroom thresholds and only compacts strictly above the limit', async () => {
    expect(nativeContextBudget(128000)).toEqual({ window: 128000, threshold: 102400, retainTokens: 20256 });
    expect(nativeContextBudget(200000)).toEqual({ window: 200000, threshold: 160000, retainTokens: 31776 });
    expect(nativeContextBudget(10000).threshold).toBe(7600);
    const summarize = vi.fn(async () => '摘要');
    const manager = new NativeContextManager({ window: 2000, outputReserve: 744 }, summarize);
    const messages = [new HumanMessage('')];
    const equal = await manager.prepare(new SystemMessage('中'.repeat(996)), messages);
    expect(equal.estimate.estimatedTokens).toBe(1000);
    expect(equal.overBudget).toBe(false);
    expect(equal.estimate.action).toBe('none');
    const over = await manager.prepare(new SystemMessage('中'.repeat(997)), messages);
    expect(over.overBudget).toBe(true);
    expect(summarize).not.toHaveBeenCalled();
  });

  it('first trims oversized tools to 4000 characters and keeps each tool-call group intact', async () => {
    const summarize = vi.fn(async () => '不应摘要');
    const truncations = vi.fn();
    const manager = new NativeContextManager({ window: 20000 }, summarize, truncations);
    const ai = new AIMessage({ content: '', tool_calls: [{ id: 'tool-a', name: 'read', args: {} }] });
    const plan = await manager.prepare(undefined, [new HumanMessage('问题'), ai,
      new ToolMessage({ content: '中'.repeat(18000), tool_call_id: 'tool-a', name: 'read' })]);
    expect(plan.overBudget).toBe(false);
    expect(plan.estimate).toMatchObject({ action: 'pruned', truncatedToolResults: 1, summarizedMessages: 0, trimmedMessages: 0 });
    expect(plan.messages[1]).toBe(ai);
    expect(plan.messages[2]!.content).toBe('中'.repeat(4000) + TOOL_TRIMMED_SUFFIX);
    expect(summarize).not.toHaveBeenCalled();
    expect(truncations).toHaveBeenCalledTimes(1);
  });

  it('keeps at most twelve recent messages and scopes skip counts to this run', async () => {
    const summarize = vi.fn(async (_messages: readonly BaseMessage[]) => '摘要'.repeat(1200));
    const manager = new NativeContextManager({ window: 128000 }, summarize);
    const messages = Array.from({ length: 100 }, (_, i) => new HumanMessage('中'.repeat(1100) + i));
    const first = await manager.prepare(undefined, messages);
    expect(summarize.mock.calls[0]![0]).toHaveLength(88);
    expect(first.messages).toHaveLength(13);
    expect(first.messages.slice(1)).toEqual(messages.slice(-12));
    expect(first.newSummary).toHaveLength(2000);
    expect(first.estimate).toMatchObject({ action: 'compacted', summarizedMessages: 88 });
    const second = await manager.prepare(undefined, messages);
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(second.estimate).toMatchObject({ action: 'none', summarizedMessages: 0, trimmedMessages: 0, truncatedToolResults: 0 });
    expect(second.estimate.summaryTokens).toBeGreaterThan(0);
    // A normal follow-up is a different per-question manager, and replays all u/a text.
    const nextRun = new NativeContextManager({ window: 128000 }, summarize);
    await nextRun.prepare(undefined, messages);
    expect(summarize).toHaveBeenCalledTimes(2);
    expect(summarize.mock.calls[1]![0]).toHaveLength(88);
  });

  it('falls back to trimming older safe groups when summary fails and never removes the last group', async () => {
    const summarize = vi.fn(async () => { throw Error('summary unavailable'); });
    const manager = new NativeContextManager({ window: 20000 }, summarize);
    const messages = [...Array.from({ length: 10 }, () => new HumanMessage('中'.repeat(2000))), new HumanMessage('当前问题')];
    const plan = await manager.prepare(undefined, messages);
    expect(plan.estimate.action).toBe('trimmed');
    expect(plan.estimate.trimmedMessages).toBe(9);
    expect(plan.newSummary).toBeUndefined();
    expect(plan.messages).toEqual(messages.slice(-2));
    const huge = await new NativeContextManager({ window: 20000 }, summarize)
      .prepare(undefined, [new HumanMessage('中'.repeat(18000))]);
    expect(huge.overBudget).toBe(true);
    expect(huge.messages).toHaveLength(1);
  });

  it('omits reasoning and tool args from summary transcript and applies native text limits', () => {
    const messages = [new HumanMessage('旧问题'), new AIMessage({ content: '答案',
      additional_kwargs: { reasoning_content: '不应进入摘要的思考' },
      tool_calls: [{ id: 'a', name: '检索', args: { secret: '不应进入摘要的参数' } }] }),
      new ToolMessage({ content: '原'.repeat(500), tool_call_id: 'a' })];
    const transcript = summaryTranscript(messages);
    expect(transcript).toContain('读者：旧问题\n助手：答案\n（调用工具：检索）');
    expect(transcript).toContain('（工具结果：' + '原'.repeat(300) + '）');
    expect(transcript).not.toContain('不应进入摘要');
    const limited = summaryTranscript([new HumanMessage('头部' + '中'.repeat(7000) + '尾部')]);
    expect(limited).toHaveLength(6001);
    expect(limited.startsWith('…')).toBe(true);
    expect(limited.endsWith('尾部')).toBe(true);
  });

  it('projects a budget-trimmed quote only as far as it was actually sent', () => {
    const registry = new EvidenceRegistry();
    const original = '标题\n[E1] 已发送前半段还有未发送后半段\n[E2] 第二条';
    registry.recordRendered(original, [{ id: 'E1', name: '章节', content: '已发送前半段还有未发送后半段' },
      { id: 'E2', name: '章节', content: '第二条' }]);
    const prefix = '标题\n[E1] 已发送前半段';
    registry.recordTruncated(original, prefix, prefix + TOOL_TRIMMED_SUFFIX);
    expect(registry.renderedMaterials(prefix + TOOL_TRIMMED_SUFFIX)).toEqual([
      { id: 'E1', name: '章节', content: '已发送前半段' },
    ]);
  });

  it('rejects a real passage tail trimmed before dispatch while keeping its transmitted prefix citable', async () => {
    const prefix = '确实发送的原文前缀';
    const tail = '这是预算裁剪后没有发送的独特尾句';
    const quote = prefix + '中'.repeat(10500) + tail;
    const passageSource: BookSource = {
      search: async () => [], page: async () => null, chapter: async () => null,
      passage: async () => ({ chapter: '章', reference: 'r1', excerpts: [
        { context: quote, quote, chapter: '章', locator: 'chapter:1', readRef: 'r1' },
      ] }),
    };
    for (const citation of [tail, prefix]) {
      const model = createScriptedModel([
        { chunks: [{ toolCalls: [{ id: 'read-1', name: 'read_book_passage', args: { reference: 'r1' } }] }] },
        { chunks: [{ text: JSON.stringify({ answer: '回答', citations: [{ id: 'E1', quote: citation }] }) }] },
      ]);
      const session = runBookAgent({ model, source: passageSource, book, question: '解释', contextWindowTokens: 12000 });
      const events = await collect(session);
      const result = await session.result;
      const calls = (model.langChainModel as ScriptedChatModel).calls;
      expect(calls).toHaveLength(2);
      const transmitted = calls.flatMap(call => call.filter(message => message.getType() === 'tool'));
      expect(transmitted.some(message => String(message.content).includes(tail))).toBe(false);
      expect(transmitted.some(message => String(message.content).includes(prefix))).toBe(true);
      expect(result?.contextEstimate).toMatchObject({ action: 'pruned', truncatedToolResults: 1 });
      expect(result?.sentMaterials?.some(material => material.content.includes(tail))).toBe(false);
      expect(result?.citations.map(item => item.quote)).toEqual(citation === tail ? [] : [prefix]);
      expect(result?.droppedCitationIds).toEqual(citation === tail ? ['E1'] : []);
      expect(events.filter(event => event.type === 'citation')).toHaveLength(citation === tail ? 0 : 1);
    }
  });

  it('keeps a passage tail citable when an earlier request sent it before later compaction', async () => {
    const tail = '前一轮已发送的独特原文尾句';
    const quote = '中'.repeat(6500) + tail;
    const passageSource: BookSource = {
      search: async () => [2, 3].map(index => ({
        context: '补'.repeat(900), quote: '补'.repeat(900), chapter: '补充章', locator: 'chapter:' + index,
      })),
      page: async () => null, chapter: async () => null,
      passage: async () => ({ chapter: '章', reference: 'r1', excerpts: [
        { context: quote, quote, chapter: '章', locator: 'chapter:1', readRef: 'r1' },
      ] }),
    };
    const model = createScriptedModel([
      { chunks: [{ toolCalls: [{ id: 'read-1', name: 'read_book_passage', args: { reference: 'r1' } }] }] },
      { chunks: [{ toolCalls: [{ id: 'search-1', name: 'search_book', args: { query: '补充' } }] }] },
      { chunks: [{ text: JSON.stringify({ answer: '回答', citations: [{ id: 'E1', quote: tail }] }) }] },
    ]);
    const session = runBookAgent({ model, source: passageSource, book, question: '解释', contextWindowTokens: 12000 });
    await collect(session);
    const result = await session.result;
    const calls = (model.langChainModel as ScriptedChatModel).calls;
    expect(calls).toHaveLength(3);
    const hasTail = (messages: readonly BaseMessage[]) => messages.some(message =>
      message.getType() === 'tool' && String(message.content).includes(tail));
    expect(hasTail(calls[1]!)).toBe(true);
    expect(hasTail(calls[2]!)).toBe(false);
    expect(result?.contextEstimate).toMatchObject({ action: 'pruned', truncatedToolResults: 1 });
    expect(result?.citations.map(item => item.quote)).toEqual([tail]);
    expect(result?.droppedCitationIds).toEqual([]);
  });

  it('fails preflight without invoking the main model when the last question cannot fit', async () => {
    const model = createScriptedModel([{ chunks: [{ text: '{"answer":"不应请求","citations":[]}' }] }]);
    const session = runBookAgent({ model, source: source(), book, question: '中'.repeat(18000), contextWindowTokens: 20000 });
    const events = await collect(session);
    expect((model.langChainModel as ScriptedChatModel).calls).toHaveLength(0);
    expect(events.find(event => event.type === 'failed')).toMatchObject({ code: 'capacity' });
    expect(events.flatMap(event => event.type === 'requestContext' ? event.materials : [])).toEqual([]);
    expect(await session.result).toBeNull();
  });

  it('falls back after a summary idle timeout without leaking the summary stream', async () => {
    vi.useFakeTimers();
    try {
      const model = createScriptedModel([
        { chunks: [{ text: '不会完成', delayMs: 46000 }] },
        { chunks: [{ text: '{"answer":"降级后回答","citations":[]}' }] },
      ]);
      const session = runBookAgent({ model, source: source(), book, question: '新问题', contextWindowTokens: 8192,
        history: Array.from({ length: 5 }, () => ({ question: '旧问'.repeat(400), answer: '旧答'.repeat(400) })) });
      const pending = collect(session);
      await vi.advanceTimersByTimeAsync(45001);
      const events = await pending;
      expect((await session.result)?.answer).toBe('降级后回答');
      expect((await session.result)?.contextEstimate?.action).toBe('trimmed');
      expect(events.flatMap(event => event.type === 'textDelta' ? [event.delta] : []).join('')).not.toContain('不会完成');
    } finally { vi.useRealTimers(); }
  });
});
