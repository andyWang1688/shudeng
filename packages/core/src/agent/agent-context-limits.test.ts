import { describe, expect, it } from 'vitest';
import { runBookAgent } from './agent.js';
import { InMemoryBookSource } from './book-source.js';
import { createScriptedModel, ScriptedChatModel } from './testing.js';
import type { AgentEvent, AgentRunSession } from './events.js';

const book = { id: 'context-book', title: '预算测试', format: 'epub' as const, sourceHash: 'context-hash' };
const source = () => new InMemoryBookSource({ book, chapters: [{ title: '章', paragraphs: ['原文'] }] });
async function collect(session: AgentRunSession): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of session.events) events.push(event);
  return events;
}

describe('agent request capacity boundary', () => {
  it.each([0, NaN, Infinity, 999, 1000.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid explicit runtime window %s rather than turning budgeting off', (window) => {
      const model = createScriptedModel([]);
      expect(() => runBookAgent({ model, source: source(), book, question: '问题', contextWindowTokens: window })).toThrow('安全整数');
      expect((model.langChainModel as ScriptedChatModel).calls).toHaveLength(0);
    },
  );

  it('does not dispatch an oversized summary before rejecting a small-window main request', async () => {
    const model = createScriptedModel([]);
    const summaryModel = createScriptedModel([]);
    const session = runBookAgent({ model, summaryModel, source: source(), book, question: '当前问题',
      contextWindowTokens: 1000, outputReserveTokens: 500,
      history: Array.from({ length: 8 }, () => ({ question: '旧问题'.repeat(400), answer: '旧回答'.repeat(400) })),
    });
    const events = await collect(session);
    expect((summaryModel.langChainModel as ScriptedChatModel).calls).toHaveLength(0);
    expect((model.langChainModel as ScriptedChatModel).calls).toHaveLength(0);
    expect(events.find(event => event.type === 'failed')).toMatchObject({ code: 'capacity' });
    expect(await session.result).toBeNull();
  });

  it('reserves output on the summary request and uses the existing history fallback', async () => {
    const model = createScriptedModel([{ chunks: [{ text: '{"answer":"保留近期问题","citations":[]}' }] }]);
    const summaryModel = createScriptedModel([{ chunks: [{ text: '不应发送的摘要' }] }]);
    const session = runBookAgent({ model, summaryModel, source: source(), book, question: '当前问题',
      contextWindowTokens: 8192, outputReserveTokens: 3000,
      history: Array.from({ length: 8 }, () => ({ question: '旧问题'.repeat(400), answer: '旧回答'.repeat(400) })),
    });
    const events = await collect(session);
    expect((summaryModel.langChainModel as ScriptedChatModel).calls).toHaveLength(0);
    expect((model.langChainModel as ScriptedChatModel).calls).toHaveLength(1);
    expect((await session.result)?.contextEstimate?.action).toBe('trimmed');
    expect(events.flatMap(event => event.type === 'textDelta' ? [event.delta] : []).join('')).not.toContain('不应发送');
  });
});
