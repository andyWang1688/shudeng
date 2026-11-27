import { afterEach, describe, expect, it } from 'vitest';
import { AIMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { BookIdentity } from '../domain/types.js';
import { runBookAgent } from './agent.js';
import { InMemoryBookSource } from './book-source.js';
import type { AgentEvent, AgentRunSession } from './events.js';
import {
  createChatModel,
  deepSeekThinkingParams,
  injectReasoningContent,
} from './providers.js';

const book: BookIdentity = { id: 'book-1', title: '测试书', format: 'epub', sourceHash: 'hash-1' };

function fixtureSource(): InMemoryBookSource {
  return new InMemoryBookSource({
    book,
    chapters: [{ title: '第一章', paragraphs: ['灯把书页照亮，也把问题留在纸上。'] }],
  });
}

async function collect(session: AgentRunSession): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of session.events) events.push(event);
  return events;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function sseChunk(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

let responseSequence = 0;
function deepSeekSSE(parts: Array<Record<string, unknown>>, finishReason: string | null, terminal: Record<string, unknown> = {}): string {
  const id = 'chunk-' + ++responseSequence;
  const chunks = parts.map((delta) =>
    sseChunk({ id, object: 'chat.completion.chunk', created: 1, model: 'deepseek-flash', choices: [{ index: 0, delta, finish_reason: null,
      ...(delta.server_tool_event ? { server_tool_event: delta.server_tool_event } : {}) }] }),
  );
  if (finishReason === null) return chunks.join('');
  return (
    chunks.join('') +
    sseChunk({ id, object: 'chat.completion.chunk', created: 1, model: 'deepseek-flash', choices: [{ index: 0, delta: terminal, finish_reason: finishReason }] }) +
    'data: [DONE]\n\n'
  );
}

describe('DeepSeek provider 适配', () => {
  it('thinking 参数：默认开启并带 reasoning_effort', () => {
    expect(deepSeekThinkingParams(true, 'high')).toEqual({
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    });
    expect(deepSeekThinkingParams(false)).toEqual({});
  });

  it('injectReasoningContent 按 assistant 顺序回填 provider 原始 reasoning', () => {
    const langChainMessages = [
      new SystemMessage('规则'),
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'call_1', name: 'search_book', args: { query: '灯' }, type: 'tool_call' }],
        additional_kwargs: { reasoning_content: '先查书内原文' },
      }),
      new ToolMessage({ content: '[E1] 原文', tool_call_id: 'call_1', name: 'search_book' }),
      new AIMessage({ content: '答', additional_kwargs: { reasoning_content: '整理引用' } }),
    ];
    const openAIMessages = [
      { role: 'system', content: '规则' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1' }] },
      { role: 'tool', tool_call_id: 'call_1', content: '[E1] 原文' },
      { role: 'assistant', content: '答' },
    ];
    const patched = injectReasoningContent(openAIMessages, langChainMessages);
    expect(patched[1]?.reasoning_content).toBe('先查书内原文');
    expect(patched[3]?.reasoning_content).toBe('整理引用');
    // 不修改入参、不把 reasoning 放进非 assistant 消息。
    expect(openAIMessages[1]).not.toHaveProperty('reasoning_content');
    expect(patched[0]).not.toHaveProperty('reasoning_content');
  });

  it('DeepSeek 工具循环：请求带 thinking，第二轮请求回传 reasoning_content（本地 stub 网络）', { timeout: 15_000 }, async () => {
    const requests: Array<Record<string, unknown>> = [];
    const responses = [
      deepSeekSSE(
        [
          { role: 'assistant', content: '', reasoning_content: '先查书内原文' },
          {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'search_book', arguments: JSON.stringify({ query: '灯' }) },
              },
            ],
          },
        ],
        'tool_calls',
      ),
      deepSeekSSE(
        [
          {
            role: 'assistant',
            content: '{"answer":"灯把书页照亮。","citations":[{"id":"E1","quote":"灯把书页照亮"}]}',
          },
        ],
        'stop',
      ),
    ];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      // LangChain 会用 tiktoken 远程编码文件估算 token；测试里不联网，直接返回空 JSON 触发近似降级。
      if (!url.includes('/chat/completions')) {
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      const body = typeof init?.body === 'string' ? init.body : '';
      requests.push(JSON.parse(body) as Record<string, unknown>);
      const payload = responses[Math.min(requests.length - 1, responses.length - 1)] ?? '';
      return new Response(payload, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as typeof fetch;

    const model = createChatModel({ provider: 'deepseek', model: 'deepseek-flash', apiKey: 'sk-test' });
    const session = runBookAgent({ model, source: fixtureSource(), book, question: '灯是什么意思' });
    const events = await collect(session);
    const result = await session.result;

    expect(events.some((event) => event.type === 'reasoningDelta')).toBe(true);
    expect(result?.answer).toBe('灯把书页照亮。');
    expect(result?.citations.map((citation) => citation.id)).toEqual(['E1']);
    expect(requests.length).toBe(2);
    const firstRequest = requests[0] ?? {};
    expect(firstRequest.model).toBe('deepseek-flash');
    expect(firstRequest.thinking).toEqual({ type: 'enabled' });
    expect(firstRequest.reasoning_effort).toBe('high');
    expect(firstRequest.stream).toBe(true);
    const secondMessages = (requests[1]?.messages ?? []) as Array<Record<string, unknown>>;
    const assistant = secondMessages.find(
      (message) => message.role === 'assistant' && Array.isArray(message.tool_calls),
    );
    expect(assistant?.reasoning_content).toBe('先查书内原文');
  });

  it('缺少 API Key 时给出配置错误', () => {
    expect(() => createChatModel({ provider: 'openai', model: 'gpt-4o', apiKey: '  ' })).toThrow(/API Key/);
  });

  it('declares official DeepSeek search, carries its calls through book lookup, and streams provider citations', async () => {
    const requests: Record<string, unknown>[] = [];
    const call = { index: 0, id: 'server-1', type: 'deepseek_web_search', kind: 'deep_search', action: { type: 'search', queries: ['灯'] } };
    // The provider may make more than three internal calls during one deep search.
    const serverCalls = [{ index: 0, reasoning_content: '', calls: Array.from({ length: 4 }, (_, index) => ({
      ...call, index, id: 'server-' + (index + 1), status: 'completed',
    })) }];
    const annotation = { type: 'url_citation', url_citation: { url: 'https://example.com/lamp', title: '网页实证' } };
    const responses = [
      deepSeekSSE([
        { role: 'assistant' },
        { server_tool_event: { type: 'call_started', step: 0, call } },
        { reasoning_content: '再查书内原文' },
        { tool_calls: [{ index: 0, id: 'book-call', type: 'function', function: { name: 'search_book', arguments: '{"query":"灯"}' } }] },
      ], 'tool_calls', { server_tool_calls: serverCalls, annotations: [annotation] }),
      deepSeekSSE([{ role: 'assistant', content: '{"answer":"结合两种来源解释。","citations":[{"id":"E1","quote":"灯把书页照亮"}]}' }], 'stop'),
    ];
    const model = createChatModel({ provider: 'deepseek', model: 'deepseek-flash', apiKey: 'synthetic',
      baseUrl: 'https://api.deepseek.com/v1', webSearch: { enabled: true, maxUses: 3 }, fetch: async (input, init) => {
        expect(String(input)).toBe('https://api.deepseek.com/v1/chat/completions');
        const payload = responses[requests.length];
        requests.push(JSON.parse(String(init?.body)));
        return new Response(payload, { headers: { 'content-type': 'text/event-stream' } });
      },
    });
    (model.langChainModel as { getNumTokens(text: string): Promise<number> }).getNumTokens = async text => Math.ceil(text.length / 4);
    const session = runBookAgent({ model, source: fixtureSource(), book, question: '请联网查证并和书内原文比较',
      history: [{ question: '上轮问题', answer: '上轮存档回答' }] });
    const events = await collect(session);
    expect(events.filter(event => event.type === 'failed')).toEqual([]);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.tools).toContainEqual({ type: 'deepseek_web_search' });
    expect(requests[0]?.tools).toContainEqual(expect.objectContaining({ function: expect.objectContaining({ name: 'search_book' }) }));
    expect(requests[1]?.tools).not.toContainEqual({ type: 'deepseek_web_search' });
    expect(JSON.stringify(requests[1]?.messages)).toContain('本步骤不能再发起联网搜索');
    expect(JSON.stringify(requests[1]?.messages)).not.toContain('本轮已启用服务商内置联网搜索');
    const assistant = (requests[1]?.messages as Record<string, unknown>[]).filter(message => message.role === 'assistant');
    expect(assistant[0]).not.toHaveProperty('reasoning_content');
    expect(assistant[1]).toMatchObject({ server_tool_calls: serverCalls, reasoning_content: '再查书内原文' });
    expect(events.filter(event => event.type === 'webSearchStatus').map(event => event.status)).toEqual(['enabled', 'searching', 'complete']);
    expect(await session.result).toMatchObject({ answer: '结合两种来源解释。',
      citations: [expect.objectContaining({ id: 'E1' })],
      webSources: [{ id: 'W1', url: 'https://example.com/lamp', title: '网页实证', provider: 'deepseek' }],
    });
  });

  it.each([
    ['核对这份文档 https://example.com/tools', 'deepseek_read_url'],
    ['联网查证最新的工具名', 'deepseek_web_search'],
  ])('keeps the correct DeepSeek web tool available after reading the book: %s', async (request, type) => {
    const url = 'https://example.com/tools';
    const requests: Record<string, unknown>[] = [];
    const page = { url, title: '工具文档' };
    const readingLink = type === 'deepseek_read_url';
    const call = { index: 0, id: 'server-1', type, status: 'completed',
      ...(readingLink ? { kind: 'read_link', action: { type: 'read_link', url }, page }
        : { kind: 'deep_search', action: { type: 'search', queries: ['工具'] }, sources: [page] }) };
    const finalAnswer = JSON.stringify({ answer: '灯照亮书页。文档介绍工具名。', citations: [
      { id: 'E1', quote: '灯把书页照亮', after: '灯照亮书页。' }, { url, after: '文档介绍工具名。' },
    ] });
    const nativeWebResponse = deepSeekSSE([
      { role: 'assistant' }, { server_tool_event: { type: 'call_started', step: 0, call } },
      { content: readingLink ? '网页原文：工具文档' : finalAnswer },
    ], 'stop', { server_tool_calls: [{ index: 0, calls: [call] }] });
    const responses = [
      deepSeekSSE([{ role: 'assistant', reasoning_content: '先读书' },
        { tool_calls: [{ index: 0, id: 'book-call', type: 'function', function: { name: 'search_book', arguments: '{"query":"灯"}' } }] }], 'tool_calls'),
      ...(readingLink ? [deepSeekSSE([{ role: 'assistant', reasoning_content: '用网页读取工具' },
        { tool_calls: ['web-call', 'duplicate-web-call'].map((id, index) => ({ index, id, type: 'function',
          function: { name: 'read_web_links', arguments: '{}' } })) }], 'tool_calls')] : []),
      nativeWebResponse,
      ...(readingLink ? [deepSeekSSE([{ role: 'assistant', content: finalAnswer }], 'stop')] : []),
    ];
    const model = createChatModel({ provider: 'deepseek', model: 'deepseek-flash', apiKey: 'synthetic', webSearch: { enabled: true },
      fetch: async (_input, init) => {
        const payload = responses[requests.length];
        requests.push(JSON.parse(String(init?.body)));
        return new Response(payload, { headers: { 'content-type': 'text/event-stream' } });
      },
    });
    (model.langChainModel as { getNumTokens(text: string): Promise<number> }).getNumTokens = async text => Math.ceil(text.length / 4);
    const session = runBookAgent({ model, source: fixtureSource(), book, question: '先查书里的灯，再' + request });
    const events = await collect(session);
    expect(events.filter(event => event.type === 'failed')).toEqual([]);
    expect(requests).toHaveLength(readingLink ? 4 : 2);
    for (const body of requests.slice(0, 2)) {
      const tools = body.tools as Record<string, unknown>[];
      expect(tools.filter(item => String(item.type).startsWith('deepseek_'))).toEqual([{ type }]);
      expect(tools).toContainEqual(expect.objectContaining({ function: expect.objectContaining({ name: 'search_book' }) }));
      if (readingLink) expect(tools).toContainEqual(expect.objectContaining({ function: expect.objectContaining({ name: 'read_web_links' }) }));
      expect(body.thinking).toEqual({ type: 'enabled' });
    }
    expect(requests[1]?.messages).toContainEqual(expect.objectContaining({ role: 'tool', content: expect.stringContaining('[E1]') }));
    if (readingLink) {
      expect(requests[2]?.tools).toEqual([{ type }]);
      expect(requests[2]?.messages).not.toContainEqual(expect.objectContaining({ role: 'tool' }));
      expect(requests[3]?.tools).not.toContainEqual({ type });
      for (const id of ['web-call', 'duplicate-web-call']) {
        expect(requests[3]?.messages).toContainEqual(expect.objectContaining({ role: 'tool', tool_call_id: id, content: expect.stringContaining('网页原文：工具文档') }));
      }
      expect(events.filter(event => event.type === 'textDelta')).not.toContainEqual(expect.objectContaining({ delta: '网页原文：工具文档' }));
    }
    expect(events.filter(event => event.type === 'webSearchStatus').map(event => event.status)).toEqual(['enabled', 'searching', 'complete']);
    expect(await session.result).toMatchObject({ citations: [expect.objectContaining({ id: 'E1' })],
      webSources: [expect.objectContaining({ ...page, provider: 'deepseek', answerAnchor: '文档介绍工具名。' })] });
  });

  it.each([
    { name: 'interrupted stream', status: 200, completes: true },
    { name: 'output limit', status: 200, completes: true, finishReason: 'length' },
    { name: 'unsupported URL tool', status: 400, completes: true },
    { name: 'authentication error', status: 401, completes: false },
    { name: 'rate limit', status: 429, completes: false },
    { name: 'reader cancellation', status: 0, completes: false },
  ])('preserves book evidence and handles a DeepSeek URL lookup $name', async ({ status, completes, finishReason }) => {
    const url = 'https://example.com/tools';
    const requests: Record<string, unknown>[] = [];
    let startedReading!: () => void;
    const readingStarted = new Promise<void>(resolve => { startedReading = resolve; });
    const webAnnotation = { type: 'url_citation', url_citation: { url, title: '网页未接收完整' } };
    const responses = [
      deepSeekSSE([{ role: 'assistant', reasoning_content: '先查书' }, { tool_calls: [{ index: 0, id: 'book-call', type: 'function',
        function: { name: 'search_book', arguments: '{"query":"灯"}' } }] }], 'tool_calls'),
      deepSeekSSE([{ role: 'assistant', reasoning_content: '再查网页' }, { tool_calls: [{ index: 0, id: 'web-call', type: 'function',
        function: { name: 'read_web_links', arguments: '{}' } }] }], 'tool_calls'),
      deepSeekSSE([{ role: 'assistant' }, { content: '不完整的网页摘要', annotations: [webAnnotation] }], finishReason ?? null),
      deepSeekSSE([{ role: 'assistant', content: JSON.stringify({ answer: '书中的灯照亮了书页。网页未核实。',
        citations: [{ id: 'E1', quote: '灯把书页照亮' }, { url }] }) }], 'stop'),
    ];
    const model = createChatModel({ provider: 'deepseek', model: 'deepseek-flash', apiKey: 'synthetic', webSearch: { enabled: true },
      fetch: async (_input, init) => {
        const index = requests.length;
        requests.push(JSON.parse(String(init?.body)));
        if (index === 2 && status === 0) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
            startedReading();
          });
        }
        if (index === 2 && status !== 200) return Response.json({ error: { message: status === 400
          ? 'unsupported tool deepseek_read_url' : status === 401 ? 'unauthorized' : 'rate limit' } }, { status });
        return new Response(responses[index], { headers: { 'content-type': 'text/event-stream' } });
      },
    });
    (model.langChainModel as { getNumTokens(text: string): Promise<number> }).getNumTokens = async text => Math.ceil(text.length / 4);
    const session = runBookAgent({ model, source: fixtureSource(), book, question: '先查书里的灯，再打开 ' + url });
    const collected = collect(session);
    if (status === 0) {
      await readingStarted;
      session.cancel();
    }
    const events = await collected;
    expect(events.filter(event => event.type === 'webSource')).toEqual([]);
    if (!completes) {
      expect(events).toContainEqual(status === 0 ? { type: 'cancelled' }
        : expect.objectContaining({ type: 'failed', code: status === 401 ? 'authentication' : 'limited' }));
      expect(requests).toHaveLength(3);
      expect(await session.result).toBeNull();
      return;
    }
    expect(requests).toHaveLength(4);
    expect(events).toContainEqual(expect.objectContaining({ type: 'toolFinished', name: 'read_web_links', isError: true }));
    expect(requests[3]?.messages).toContainEqual(expect.objectContaining({ role: 'tool', tool_call_id: 'book-call', content: expect.stringContaining('[E1]') }));
    expect(requests[3]?.messages).toContainEqual(expect.objectContaining({ role: 'tool', tool_call_id: 'web-call', content: expect.stringContaining('网页') }));
    expect(JSON.stringify(requests[3]?.messages)).not.toContain('不完整的网页摘要');
    expect(requests[3]?.tools).not.toContainEqual({ type: 'deepseek_read_url' });
    expect(await session.result).toMatchObject({ citations: [expect.objectContaining({ id: 'E1' })], webSources: [], webSearch: { status: 'failed' } });
  });
});
