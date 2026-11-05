import { describe, expect, it } from 'vitest';
import { runBookAgent } from './agent.js';
import { InMemoryBookSource } from './book-source.js';
import type { AgentEvent, AgentRunSession } from './events.js';
import { createScriptedModel, ScriptedChatModel } from './testing.js';
import { contentText, estimateRequestContext, estimateTextTokens, requestMaterials } from './request-context.js';

const book = { id: 'context-book', title: '材料书', format: 'epub' as const, sourceHash: 'context-hash' };
const source = () => new InMemoryBookSource({ book, chapters: [
  { title: '第一章', paragraphs: ['原文开头。' + '长篇原文'.repeat(600) + '不应发送的全文尾部。'] },
] });
async function collect(session: AgentRunSession) {
  const events: AgentEvent[] = [];
  for await (const event of session.events) events.push(event);
  return events;
}

describe('actual request context projection', () => {
  it('uses the native CJK heuristic without claiming provider usage', () => {
    expect(estimateTextTokens('中 文，abcd efghi😀')).toBe(6);
    expect(estimateTextTokens(' \n\t')).toBe(0);
  });

  it('persists only rendered tool previews present in the actual next model invocation', async () => {
    const model = createScriptedModel([
      { chunks: [{ toolCalls: [{ id: 'chapter-1', name: 'read_chapter', args: { reference: '1' } }] }] },
      { chunks: [{ text: '{"answer":"结果","citations":[]}' }] },
    ]);
    const session = runBookAgent({ model, book, source: source(), question: '问题', selectionQuote: '纸上的灯。' });
    const events = await collect(session);
    const calls = (model.langChainModel as ScriptedChatModel).calls;
    expect(calls).toHaveLength(2);
    const toolMessage = calls[1]!.find(message => message.getType() === 'tool')!;
    expect(toolMessage).toBeDefined();
    const result = (await session.result)!;
    expect(result.sentMaterials).toEqual([
      { id: 'selection', kind: 'selection', name: '选中原文', content: '纸上的灯。' },
      { id: 'E1', kind: 'book-tool', name: '第一章', content: '原文开头。' + '长篇原文'.repeat(600).slice(0, 1195) + '…（片段较长，仅显示前 1200 字）' },
    ]);
    expect(result.sentMaterials![1]!.content).not.toContain('不应发送的全文尾部');
    expect(contentText(toolMessage.content)).toContain(result.sentMaterials![1]!.content);
    const final = calls[1]!;
    expect(result.contextEstimate).toEqual(estimateRequestContext(
      final.find(message => message.getType() === 'system'), final.filter(message => message.getType() !== 'system'),
      { compacted: false, summarizedMessages: 0 },
    ));
    expect(events.some(event => event.type === 'contextUsage')).toBe(false);
    expect(result.contextUsage).toBeUndefined();
    expect(result.contextEstimate?.contextWindowTokens).toBeUndefined();
  });

  it('separates external materials and never exposes an unsent selection', async () => {
    const model = createScriptedModel([
      { chunks: [{ toolCalls: [{ id: 'remote-1', name: 'external_lookup', args: {} }] }] },
      { chunks: [{ text: '{"answer":"结果","citations":[]}', usage: { input_tokens: 900, output_tokens: 3, total_tokens: 903 } }] },
    ]);
    const session = runBookAgent({ model, book, source: source(), question: '问题',
      contextWindowTokens: 10000, extraTools: [{ name: 'external_lookup', description: 'lookup', inputSchema: { type: 'object' }, invoke: async () => '真实外部结果' }],
    });
    await collect(session);
    const result = (await session.result)!;
    expect(result.sentMaterials).toEqual([{ id: 'remote-1', kind: 'external-tool', name: 'external_lookup', content: '真实外部结果' }]);
    expect(result.contextUsage?.inputTokens).toBe(900);
    expect(result.contextEstimate?.estimatedTokens).not.toBe(900);
    expect(result.contextEstimate?.thresholdTokens).toBe(1000);
    expect(requestMaterials((model.langChainModel as ScriptedChatModel).calls[0]!, new Set(), '没有发送的选文')).toEqual([]);
  });

  it('keeps fixed reader selection and position in each fresh run system context, separate from u/a history', async () => {
    const quote = '独有原文：石桥下有七盏灯。';
    for (const history of [[], [{ question: '解释这段', answer: '不复述选文的回答' }]]) {
      const model = createScriptedModel([{ chunks: [{ text: '{"answer":"解释","citations":[]}' }] }]);
      const session = runBookAgent({ model, book, source: source(), question: '这段里的七盏灯意味着什么？',
        history, selectionQuote: quote, readingPosition: 'epubcfi(/6/8)' });
      await collect(session);
      const call = (model.langChainModel as ScriptedChatModel).calls[0]!;
      expect(contentText(call[0]!.content)).toContain(quote);
      expect(contentText(call[0]!.content)).toContain('epubcfi(/6/8)');
      expect(call.slice(1).map(message => contentText(message.content))).not.toContain(quote);
      expect((await session.result)?.sentMaterials).toEqual([{ id: 'selection', kind: 'selection', name: '选中原文', content: quote }]);
    }
  });

  it('estimates the prepared summarized request and excludes the internal summary request', async () => {
    const model = createScriptedModel([
      { chunks: [{ text: '较早对话摘要。' }] },
      { chunks: [{ text: '{"answer":"新回答","citations":[]}' }] },
    ]);
    const session = runBookAgent({ model, book, source: source(), question: '新问题', contextWindowTokens: 1000,
      history: Array.from({ length: 5 }, () => ({ question: '旧问'.repeat(100), answer: '旧答'.repeat(100) })),
    });
    const events = await collect(session);
    expect(events.filter(event => event.type === 'requestContext')).toHaveLength(1);
    const estimate = (await session.result)!.contextEstimate!;
    const calls = (model.langChainModel as ScriptedChatModel).calls;
    const prepared = calls.at(-1)!;
    expect(estimate.action).toBe('compacted');
    expect(estimate.summarizedMessages).toBeGreaterThan(0);
    expect(estimate.summaryTokens).toBeGreaterThan(0);
    expect(estimate).toEqual(estimateRequestContext(
      prepared[0], prepared.slice(1),
      { window: 2000, threshold: 1000, compacted: true, summarizedMessages: estimate.summarizedMessages,
        trimmedMessages: 0, truncatedToolResults: 0 },
    ));
  });

  it('does not mark a produced tool result as sent when cancelled before the next request', async () => {
    const model = createScriptedModel([{ chunks: [{ toolCalls: [{ id: 'cancel-1', name: 'cancel_tool', args: {} }] }] }]);
    let session: AgentRunSession;
    session = runBookAgent({ model, book, source: source(), question: '问题', extraTools: [{
      name: 'cancel_tool', description: 'cancel', inputSchema: { type: 'object' },
      invoke: async () => { session.cancel(); return '从未发送的结果'; },
    }] });
    const events = await collect(session);
    expect((model.langChainModel as ScriptedChatModel).calls).toHaveLength(1);
    expect(events.flatMap(event => event.type === 'requestContext' ? event.materials : [])).toEqual([]);
    expect(await session.result).toBeNull();
  });
});
