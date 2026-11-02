import { describe, expect, it } from 'vitest';
import type { BookIdentity } from '../domain/types.js';
import { runBookAgent } from './agent.js';
import { InMemoryBookSource, type InMemoryBook } from './book-source.js';
import type { AgentEvent, AgentRunSession } from './events.js';
import { createScriptedModel, ScriptedChatModel } from './testing.js';

const book: BookIdentity = { id: 'book-1', title: '测试书', format: 'epub', sourceHash: 'hash-1' };

function fixtureBook(): InMemoryBook {
  return {
    book,
    chapters: [
      {
        title: '第一章',
        paragraphs: ['灯把书页照亮，也把问题留在纸上。', '另一段原文句子。'],
      },
      { title: '第二章', paragraphs: ['第二章的原文内容。'] },
    ],
  };
}

function source(): InMemoryBookSource {
  return new InMemoryBookSource(fixtureBook());
}

async function collect(session: AgentRunSession): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of session.events) events.push(event);
  return events;
}

function types(events: AgentEvent[]): string[] {
  return events.map((event) => event.type);
}

describe('runBookAgent（官方 LangChain createAgent 工具循环）', () => {
  it('question → 工具 → 引用核对 → answer 全链路事件', async () => {
    const model = createScriptedModel([
      { chunks: [{ toolCalls: [{ id: 'call_1', name: 'search_book', args: { query: '灯' } }] }] },
      {
        chunks: [
          { text: '{"answer":"灯把书页照亮。","citations":[{"id":"E1","quote":"灯把书页照亮"}]}' },
        ],
      },
    ]);
    const session = runBookAgent({ model, source: source(), book, question: '灯是什么意思' });
    const events = await collect(session);
    const result = await session.result;

    expect(types(events)).toContain('started');
    expect(types(events)).toContain('toolStarted');
    expect(types(events)).toContain('toolFinished');
    expect(types(events)).toContain('citation');
    expect(types(events)).toContain('completed');
    const started = events.find((event) => event.type === 'started');
    expect(started?.type === 'started' && started.started.toolNames).toEqual([
      'search_book',
      'read_page',
      'read_chapter',
    ]);
    const toolFinished = events.find((event) => event.type === 'toolFinished');
    expect(toolFinished?.type === 'toolFinished' && toolFinished.isError).toBe(false);
    expect(toolFinished?.type === 'toolFinished' && toolFinished.callId).toBe('call_1');
    expect(toolFinished?.type === 'toolFinished' && toolFinished.content).toContain('[E1]');
    expect(result?.answer).toBe('灯把书页照亮。');
    expect(result?.citations.map((citation) => citation.id)).toEqual(['E1']);
    expect(result?.droppedCitationIds).toEqual([]);
    expect(result?.warnings).toEqual([]);
    expect(result?.steps).toBeGreaterThanOrEqual(2);
    const scripted = model.langChainModel as ScriptedChatModel;
    expect(scripted.calls.length).toBe(2);
    expect(scripted.boundTools.length).toBe(3);
  });

  it('reasoning_content 分片按顺序变成 reasoningDelta，不与答案混淆', async () => {
    const model = createScriptedModel([
      {
        chunks: [
          { reasoning: '先查书内原文。' },
          { reasoning: '再看引用。' },
          { toolCalls: [{ id: 'call_1', name: 'search_book', args: { query: '灯' } }] },
        ],
      },
      {
        chunks: [
          { reasoning: '整理引用。' },
          { text: '{"answer":"灯把书页照亮。","citations":[{"id":"E1","quote":"灯把书页照亮"}]}' },
        ],
      },
    ]);
    const session = runBookAgent({ model, source: source(), book, question: '灯是什么意思' });
    const events = await collect(session);
    const reasoning = events.flatMap((event) => (event.type === 'reasoningDelta' ? [event.delta] : []));
    expect(reasoning).toEqual(['先查书内原文。', '再看引用。', '整理引用。']);
    const text = events.flatMap((event) => (event.type === 'textDelta' ? [event.delta] : [])).join('');
    expect(text).toContain('"answer":"灯把书页照亮。"');
    expect(text).not.toContain('先查书内原文');
    const citations = events.filter((event) => event.type === 'citation');
    expect(citations.length).toBe(1);
  });

  it('没有原生 reasoning 时不伪造思考（prompt 不再要求 preamble）', async () => {
    const model = createScriptedModel([
      {
        chunks: [
          { toolCalls: [{ id: 'call_1', name: 'search_book', args: { query: '灯' } }] },
        ],
      },
      { chunks: [{ text: '{"answer":"灯把书页照亮。","citations":[]}' }] },
    ]);
    const session = runBookAgent({ model, source: source(), book, question: '灯是什么意思' });
    const events = await collect(session);
    expect(events.some((event) => event.type === 'reasoningDelta')).toBe(false);
    const completed = events.find((event) => event.type === 'completed');
    expect(completed?.type === 'completed' && completed.result.answer).toBe('灯把书页照亮。');
    // 核心 prompt 不得要求“写 2-4 句当作思考过程”，也不提 JSON reasoning 兜底。
    const prompts = ((model.langChainModel as ScriptedChatModel).calls[0] ?? [])
      .filter((message) => message.getType() === 'system')
      .map((message) => String(message.content))
      .join('\n');
    expect(prompts).not.toContain('2-4 句');
    expect(prompts).not.toContain('如何查证');
    expect(prompts).not.toContain('"reasoning"');
  });

  it('伪造/未知引用被剔除，真实引用保留并给出 warning', async () => {
    const model = createScriptedModel([
      {
        chunks: [
          { toolCalls: [{ id: 'call_1', name: 'search_book', args: { query: '灯' } }] },
          { text: '查一下。' },
        ],
      },
      {
        chunks: [
          {
            text:
              '{"answer":"灯把书页照亮。","citations":[' +
              '{"id":"E1","quote":"灯把书页照亮"},' +
              '{"id":"E1","quote":"书里没有的伪造句子"},' +
              '{"id":"E99","quote":"未知证据"}]}',
          },
        ],
      },
    ]);
    const session = runBookAgent({ model, source: source(), book, question: '灯是什么意思' });
    const events = await collect(session);
    const result = await session.result;
    expect(result?.citations.map((citation) => citation.id)).toEqual(['E1']);
    expect(result?.droppedCitationIds.sort()).toEqual(['E1', 'E99']);
    expect(result?.warnings.join('')).toContain('未通过本次原文核验');
    const citationEvents = events.filter((event) => event.type === 'citation');
    expect(citationEvents.length).toBe(1);
  });

  it('工具参数非法时回填错误结果，工具循环继续', async () => {
    const model = createScriptedModel([
      { chunks: [{ toolCalls: [{ id: 'call_bad', name: 'search_book', args: {} }] }] },
      { chunks: [{ text: '{"answer":"参数错误也能回答。","citations":[]}' }] },
    ]);
    const session = runBookAgent({ model, source: source(), book, question: '问' });
    const events = await collect(session);
    const finished = events.filter((event) => event.type === 'toolFinished');
    expect(finished.length).toBe(1);
    expect(finished[0]?.type === 'toolFinished' && finished[0].isError).toBe(true);
    const completed = events.find((event) => event.type === 'completed');
    expect(completed?.type === 'completed' && completed.result.answer).toBe('参数错误也能回答。');
  });

  it('取消运行：事件流以 cancelled 结束，没有 completed', async () => {
    const model = createScriptedModel([
      {
        chunks: [
          { reasoning: '开始思考。' },
          { text: '思考中…', delayMs: 500 },
          { text: '这段不应出现。' },
        ],
      },
    ]);
    const session = runBookAgent({ model, source: source(), book, question: '问' });
    const events: AgentEvent[] = [];
    for await (const event of session.events) {
      events.push(event);
      if (event.type === 'reasoningDelta') session.cancel();
    }
    expect(events.some((event) => event.type === 'cancelled')).toBe(true);
    expect(events.some((event) => event.type === 'completed')).toBe(false);
    expect(await session.result).toBeNull();
  });

  it('history 以 Human/AI 消息回放给模型', async () => {
    const model = createScriptedModel([{ chunks: [{ text: '{"answer":"好。","citations":[]}' }] }]);
    const session = runBookAgent({
      model,
      source: source(),
      book,
      question: '新问题',
      history: [{ question: '旧问题', answer: '旧回答' }],
    });
    await collect(session);
    await session.result;
    const scripted = model.langChainModel as ScriptedChatModel;
    const firstCall = scripted.calls[0] ?? [];
    const typesSeen = firstCall.map((message) => message.getType());
    expect(typesSeen.slice(0, 4)).toEqual(['system', 'human', 'ai', 'human']);
    expect(String(firstCall[1]?.content)).toBe('旧问题');
    expect(String(firstCall[2]?.content)).toBe('旧回答');
    expect(String(firstCall[3]?.content)).toBe('新问题');
  });
});
