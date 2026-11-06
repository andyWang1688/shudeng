import { afterEach, describe, expect, it, vi } from 'vitest';
import { runBookAgent } from './agent.js';
import { InMemoryBookSource } from './book-source.js';
import { createScriptedModel, ScriptedChatModel } from './testing.js';
import type { AgentEvent, AgentRunSession } from './events.js';
const book = { id: 'timeout-book', title: '书', format: 'epub' as const, sourceHash: 'timeout' };
const source = () => new InMemoryBookSource({ book, chapters: [{ title: '章', paragraphs: ['原文'] }] });
async function collect(session: AgentRunSession) { const events: AgentEvent[] = []; for await (const event of session.events) events.push(event); return events; }
const partials = [
  { text: '{"answer":"', delayMs: 80000 }, { text: '回答', delayMs: 80000 }, { text: '","citations":[]}', delayMs: 80000 },
];
afterEach(() => vi.useRealTimers());

describe('native timeout checkpoints and stream cancellation', () => {
  it('returns failed timeout on an idle stream and aborts the pending model', async () => {
    vi.useFakeTimers();
    const model = createScriptedModel([{ chunks: [{ text: '不会发送', delayMs: 100000 }] }]);
    const session = runBookAgent({ model, source: source(), book, question: '问' });
    const pending = collect(session);
    await vi.advanceTimersByTimeAsync(90001);
    const events = await pending;
    expect(events.find(event => event.type === 'failed')).toMatchObject({ code: 'timeout' });
    expect(events.some(event => event.type === 'cancelled')).toBe(false);
    expect(events.some(event => event.type === 'textDelta')).toBe(false);
    expect(await session.result).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resets model idle on each chunk and does not apply an absolute run deadline', async () => {
    vi.useFakeTimers();
    const model = createScriptedModel([{ chunks: [...partials, { text: ' ', delayMs: 80000 }] }]);
    const session = runBookAgent({ model, source: source(), book, question: '问' });
    const pending = collect(session);
    await vi.advanceTimersByTimeAsync(320001);
    const events = await pending;
    expect((await session.result)?.answer).toBe('回答');
    expect(events.some(event => event.type === 'failed')).toBe(false);
    expect((model.langChainModel as ScriptedChatModel).calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('checks elapsed total at the next model step after a long tool call', async () => {
    vi.useFakeTimers();
    const model = createScriptedModel([
      { chunks: [{ toolCalls: [{ id: 'slow', name: 'slow_tool', args: {} }] }] },
      { chunks: [{ text: '{"answer":"不应请求","citations":[]}' }] },
    ]);
    const session = runBookAgent({ model, source: source(), book, question: '问', extraTools: [{
      name: 'slow_tool', description: 'slow', inputSchema: { type: 'object' },
      invoke: async () => { await new Promise(resolve => setTimeout(resolve, 240001)); return '工具结果'; },
    }] });
    const pending = collect(session);
    await vi.advanceTimersByTimeAsync(240002);
    const events = await pending;
    expect(events.find(event => event.type === 'failed')).toMatchObject({ code: 'timeout' });
    expect((model.langChainModel as ScriptedChatModel).calls).toHaveLength(1);
    expect(await session.result).toBeNull();
  });

  it('honors the native DeepSeek idle/run budgets without downgrading them to ordinary service limits', async () => {
    vi.useFakeTimers();
    const model = createScriptedModel([{ chunks: [{ text: '{"answer":"回答","citations":[]}', delayMs: 179000 }] }]);
    const session = runBookAgent({ model, source: source(), book, question: '问', modelIdleTimeoutMs: 180000, runTimeoutMs: 300000 });
    const pending = collect(session);
    await vi.advanceTimersByTimeAsync(179001);
    await pending;
    expect((await session.result)?.answer).toBe('回答');
  });

  it('keeps user cancellation distinct from timeout and cancels a running summary before main dispatch', async () => {
    vi.useFakeTimers();
    const summary = createScriptedModel([{ chunks: [{ text: '长摘要', delayMs: 50000 }] }]);
    const main = createScriptedModel([{ chunks: [{ text: '{"answer":"不会请求","citations":[]}' }] }]);
    const session = runBookAgent({ model: main, summaryModel: summary, source: source(), book,
      question: '新问', contextWindowTokens: 8192,
      history: Array.from({ length: 5 }, () => ({ question: '旧问'.repeat(400), answer: '旧答'.repeat(400) })),
    });
    const pending = collect(session);
    await vi.advanceTimersByTimeAsync(100);
    session.cancel();
    const events = await pending;
    expect(events.map(event => event.type)).toEqual(['started', 'webSearchStatus', 'cancelled']);
    expect((summary.langChainModel as ScriptedChatModel).calls).toHaveLength(1);
    expect((main.langChainModel as ScriptedChatModel).calls).toHaveLength(0);
    expect(await session.result).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
