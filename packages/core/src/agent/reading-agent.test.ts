import { describe, expect, it } from 'vitest';
import { runBookAgent } from './agent.js';
import { InMemoryBookSource } from './book-source.js';
import type { AgentEvent, AgentRunSession } from './events.js';
import { createChatModel } from './providers.js';
import { createScriptedModel, ScriptedChatModel } from './testing.js';
import { ProviderWebSearch, resolveWebSearchPolicy } from './web-search.js';
import { EvidenceRegistry, verifyCitations } from './evidence.js';

const book = { id: 'reading-agent', title: '阅读工具', format: 'epub' as const, sourceHash: 'book-v1' };
const source = () => new InMemoryBookSource({ book, chapters: [{ title: '第一章', paragraphs: ['灯照亮纸上的文字。'] }] });
async function collect(session: AgentRunSession) { const events: AgentEvent[] = []; for await (const event of session.events) events.push(event); return events; }
const answer = JSON.stringify({ answer: '网页补充说明。', citations: [] });
const citation = { type: 'url_citation', url: 'https://example.org/article', title: '实际网页', start_index: 0, end_index: 2 };

function responseSSE(text = answer, withSearch = true, functionCall = false, searchIds = ['ws_1']) {
  const searches = withSearch ? searchIds.map(id => ({ type: 'web_search_call', id, status: 'completed', action: { type: 'search', query: '阅读' } })) : [];
  const message = { type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: withSearch ? [citation] : [] }] };
  const fn = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'search_book', arguments: JSON.stringify({ query: '灯' }), status: 'completed' };
  const output = [...searches, functionCall ? fn : message];
  const response = { id: 'resp_1', object: 'response', status: 'completed', created_at: 1, model: 'test-model', output,
    usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } };
  const events: Record<string, unknown>[] = [{ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } }];
  for (const [index, search] of searches.entries()) events.push({ type: 'response.web_search_call.searching', item_id: search.id, output_index: index },
    { type: 'response.output_item.done', item: search, output_index: index });
  if (functionCall) events.push({ type: 'response.output_item.added', item: fn, output_index: searches.length });
  else {
    events.push({ type: 'response.output_text.delta', delta: text, item_id: 'msg_1', content_index: 0, output_index: searches.length });
    if (withSearch) events.push({ type: 'response.output_text.annotation.added', annotation: citation, item_id: 'msg_1', content_index: 0, annotation_index: 0, output_index: searches.length });
  }
  events.push({ type: 'response.completed', response });
  return events.map(event => 'event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n').join('');
}

function anthropicSSE(options: { searchError?: boolean; withAnswer?: boolean; withSearch?: boolean } = {}) {
  const withSearch = options.withSearch !== false;
  const textIndex = withSearch ? 2 : 0;
  const events = [
    { type: 'message_start', message: { id: 'msg_a', type: 'message', role: 'assistant', model: 'claude-test', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 20, output_tokens: 0 } } },
    ...(withSearch ? [
    { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"阅读"}' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: options.searchError
      ? { type: 'web_search_tool_result_error', error_code: 'unavailable' }
      : [{ type: 'web_search_result', url: citation.url, title: citation.title, encrypted_content: 'opaque' }] } },
    { type: 'content_block_stop', index: 1 },
    ] : []),
    ...(options.withAnswer !== false ? [
    { type: 'content_block_start', index: textIndex, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: textIndex, delta: { type: 'text_delta', text: answer } },
    ...(withSearch && !options.searchError ? [
      { type: 'content_block_delta', index: textIndex, delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', url: citation.url, title: citation.title, cited_text: '阅读', encrypted_index: 'opaque' } } },
    ] : []),
    { type: 'content_block_stop', index: textIndex },
    ] : []),
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } },
    { type: 'message_stop' },
  ];
  return events.map(event => 'event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n').join('');
}

describe('reading Agent official infrastructure', () => {
  it('loads user memory and skill metadata, then reads a skill through the official read_file tool', async () => {
    const model = createScriptedModel([
      { chunks: [{ toolCalls: [{ id: 'skill_1', name: 'read_file', args: { file_path: '/reader/skills/explain-selection/SKILL.md' } }] }] },
      { chunks: [{ text: '{"answer":"按前后文解释","citations":[]}' }] },
    ]);
    const session = runBookAgent({ model, source: source(), book, question: '这句话什么意思', assistantInstructions: '像苏格拉底一样先提一个问题。' });
    const events = await collect(session);
    expect((await session.result)?.answer).toBe('按前后文解释');
    const scripted = model.langChainModel as ScriptedChatModel;
    const firstPrompt = JSON.stringify(scripted.calls[0]);
    expect(firstPrompt).toContain('像苏格拉底一样');
    expect(firstPrompt).toContain('explain-selection');
    expect(firstPrompt).toContain('cover-whole-book');
    const loaded = events.find(event => event.type === 'toolFinished' && event.name === 'read_file');
    expect(loaded).toMatchObject({ isError: false });
    expect(loaded?.type === 'toolFinished' && loaded.content).toContain('读取有界前后文');
    const names = scripted.boundTools.map(item => (item as { name?: string }).name);
    expect(names).toContain('read_file');
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('execute');
    expect(names).not.toContain('task');
  });

  it('keeps identical text at different original locations as different evidence', () => {
    const registry = new EvidenceRegistry();
    const excerpt = { context: '相同文字', quote: '相同文字', chapter: '一章', locator: 'first', chunkId: 'a', readRef: 'r-a', sourceVersion: 'v1' };
    const first = registry.register(excerpt);
    const duplicate = registry.register({ ...excerpt });
    const elsewhere = registry.register({ ...excerpt, locator: 'second', chunkId: 'b', readRef: 'r-b' });
    expect(first.id).toBe(duplicate.id);
    expect(elsewhere.id).not.toBe(first.id);
    registry.recordTransmitted(elsewhere.id, elsewhere.quote);
    expect(verifyCitations({ answer: '答', citations: [{ id: elsewhere.id, quote: '相同文字' }] }, registry).citations[0]).toMatchObject({ locator: 'second', chunkId: 'b', readRef: 'r-b', sourceVersion: 'v1' });
  });

  it('does not infer gateway search support from an OpenAI model name', () => {
    const model = createChatModel({ provider: 'openai', model: 'gpt-5', apiKey: 'test', baseUrl: 'https://gateway.example/v1', webSearch: { enabled: true } });
    expect(model.webSearch?.state.status).toBe('unsupported');
    expect(resolveWebSearchPolicy('deepseek', undefined, { enabled: true }).state.status).toBe('unsupported');
    expect(resolveWebSearchPolicy('openai', undefined, { enabled: false }).state.status).toBe('disabled');
    expect(() => createChatModel({ provider: 'openai', model: 'test', apiKey: 'test', baseUrl: 'invalid-url', webSearch: { enabled: true } })).toThrow('AI 服务地址无效');
  });

  it('does not send a server search tool or switch protocols when networking is disabled', async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    const completion = { id: 'chat_1', object: 'chat.completion.chunk', created: 1, model: 'test-model',
      choices: [{ index: 0, delta: { role: 'assistant', content: answer }, finish_reason: 'stop' }] };
    const model = createChatModel({ provider: 'openai', model: 'test-model', apiKey: 'test', webSearch: { enabled: false },
      fetch: async (input, init) => {
        requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
        return new Response('data: ' + JSON.stringify(completion) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
      },
    });
    (model.langChainModel as { getNumTokens(text: string): Promise<number> }).getNumTokens = async text => Math.ceil(text.length / 4);
    const session = runBookAgent({ model, source: source(), book, question: '书中观点' });
    await collect(session);
    expect(requests[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect((requests[0]?.body.tools as Array<{ type: string }>).every(item => item.type === 'function')).toBe(true);
    expect((await session.result)?.webSources).toEqual([]);
    expect((await session.result)?.webSearch?.status).toBe('disabled');
  });

  it('uses the official Responses search tool, forwards a bounded budget and streams actual annotations', async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    const model = createChatModel({ provider: 'openai', model: 'test-model', apiKey: 'test', webSearch: { enabled: true, maxUses: 2 },
      fetch: async (input, init) => {
        requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
        return new Response(responseSSE(), { headers: { 'content-type': 'text/event-stream' } });
      },
    });
    const session = runBookAgent({ model, source: source(), book, question: '补充最新资料' });
    const events = await collect(session);
    expect(requests[0]?.url).toBe('https://api.openai.com/v1/responses');
    expect(requests[0]?.body.max_tool_calls).toBe(2);
    expect(requests[0]?.body.store).toBe(false);
    expect(requests[0]?.body.tools).toContainEqual(expect.objectContaining({ type: 'web_search' }));
    const result = await session.result;
    expect(result?.answer).toBe('网页补充说明。');
    expect(result?.webSources).toEqual([{ id: 'W1', url: citation.url, title: citation.title, provider: 'openai' }]);
    expect(events.findIndex(event => event.type === 'webSource')).toBeLessThan(events.findIndex(event => event.type === 'completed'));
    expect(result?.webSearch?.status).toBe('complete');
  });

  it('removes server search after its per-run budget is spent while allowing book tools to continue', async () => {
    const requests: Record<string, unknown>[] = [];
    const model = createChatModel({ provider: 'openai', model: 'test-model', apiKey: 'test', webSearch: { enabled: true, maxUses: 1 },
      fetch: async (_input, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return new Response(responseSSE(answer, requests.length === 1, requests.length === 1), { headers: { 'content-type': 'text/event-stream' } });
      },
    });
    const session = runBookAgent({ model, source: source(), book, question: '查书并补充' });
    await collect(session);
    expect((await session.result)?.answer).toBe('网页补充说明。');
    expect(requests).toHaveLength(2);
    expect(requests[1]?.tools).not.toContainEqual(expect.objectContaining({ type: 'web_search' }));
    expect(requests[1]?.tools).toContainEqual(expect.objectContaining({ name: 'search_book' }));
  });

  it('fails outside SDK callbacks if a provider returns more searches than the requested budget', async () => {
    const model = createChatModel({ provider: 'openai', model: 'test-model', apiKey: 'test', webSearch: { enabled: true, maxUses: 1 },
      fetch: async () => new Response(responseSSE(answer, true, false, ['ws_1', 'ws_2']), { headers: { 'content-type': 'text/event-stream' } }),
    });
    const session = runBookAgent({ model, source: source(), book, question: '联网补充' });
    const events = await collect(session);
    expect(await session.result).toBeNull();
    expect(events).toContainEqual(expect.objectContaining({ type: 'failed', message: '服务商返回的联网搜索次数超过本次预算' }));
    expect(events.some(event => event.type === 'completed')).toBe(false);
    expect(events.filter(event => event.type === 'webSearchStatus').at(-1)).toMatchObject({ status: 'failed' });
  });

  it('continues with book tools after an explicit unsupported search request and keeps networking marked failed', async () => {
    const requests: Record<string, unknown>[] = [];
    const model = createChatModel({ provider: 'openai', model: 'test-model', apiKey: 'test', webSearch: { enabled: true },
      fetch: async (_input, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return requests.length === 1
          ? new Response(JSON.stringify({ error: { message: 'web_search is not supported by this model', type: 'invalid_request_error' } }),
            { status: 400, headers: { 'content-type': 'application/json' } })
          : new Response(responseSSE(answer, false), { headers: { 'content-type': 'text/event-stream' } });
      },
    });
    const session = runBookAgent({ model, source: source(), book, question: '联网补充' });
    const events = await collect(session);
    expect((await session.result)?.answer).toBe('网页补充说明。');
    expect((await session.result)?.webSearch?.status).toBe('failed');
    expect(requests).toHaveLength(2);
    expect(requests[1]?.tools).not.toContainEqual(expect.objectContaining({ type: 'web_search' }));
    expect(requests[1]?.tools).toContainEqual(expect.objectContaining({ name: 'search_book' }));
    expect(events.filter(event => event.type === 'webSearchStatus').at(-1)).toMatchObject({ status: 'failed' });
    expect(events.some(event => event.type === 'failed' || event.type === 'webSource')).toBe(false);
  });

  it('does not retry unrelated bad requests or unsupported search failures after text has already streamed', async () => {
    let requests = 0;
    const invalid = createChatModel({ provider: 'openai', model: 'test-model', apiKey: 'test', webSearch: { enabled: true },
      fetch: async () => {
        requests += 1;
        return new Response(JSON.stringify({ error: { message: 'max_output_tokens must be a positive integer', type: 'invalid_request_error' } }),
          { status: 400, headers: { 'content-type': 'application/json' } });
      },
    });
    const session = runBookAgent({ model: invalid, source: source(), book, question: '联网补充' });
    await collect(session);
    expect(await session.result).toBeNull();
    expect(requests).toBe(1);

    const scripted = createScriptedModel([{ chunks: [{ text: '已输出的部分答案' }] }]);
    const model = scripted.langChainModel as ScriptedChatModel;
    const generate = model._generate.bind(model);
    model._generate = async (...args: Parameters<typeof generate>) => {
      await generate(...args);
      throw Object.assign(new Error('web_search is not supported by this model'), { status: 400 });
    };
    const partial = runBookAgent({ model: { ...scripted, webSearch: resolveWebSearchPolicy('openai', undefined, { enabled: true }) }, source: source(), book, question: '联网补充' });
    const events = await collect(partial);
    expect(await partial.result).toBeNull();
    expect(model.calls).toHaveLength(1);
    expect(events.filter(event => event.type === 'textDelta')).toHaveLength(1);
    expect(events.some(event => event.type === 'completed')).toBe(false);
  });

  it('uses Anthropic server search and preserves actual tool-result and citation sources', async () => {
    const requests: Record<string, unknown>[] = [];
    const model = createChatModel({ provider: 'anthropic', model: 'claude-test', apiKey: 'test', webSearch: { enabled: true, maxUses: 2 },
      fetch: async (_input, init) => { requests.push(JSON.parse(String(init?.body))); return new Response(anthropicSSE(), { headers: { 'content-type': 'text/event-stream' } }); },
    });
    const session = runBookAgent({ model, source: source(), book, question: '查最新资料' });
    await collect(session);
    expect(requests[0]?.tools).toContainEqual(expect.objectContaining({ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }));
    expect((await session.result)?.webSources).toEqual([{ id: 'W1', url: citation.url, title: citation.title, provider: 'anthropic' }]);
  });

  it('continues after a native search-tool failure, retrying only when no answer has been returned', async () => {
    for (const withAnswer of [false, true]) {
      const requests: Record<string, unknown>[] = [];
      const model = createChatModel({ provider: 'anthropic', model: 'claude-test', apiKey: 'test', webSearch: { enabled: true },
        fetch: async (_input, init) => {
          requests.push(JSON.parse(String(init?.body)));
          return new Response(anthropicSSE(requests.length === 1
            ? { searchError: true, withAnswer } : { withSearch: false }), { headers: { 'content-type': 'text/event-stream' } });
        },
      });
      const session = runBookAgent({ model, source: source(), book, question: '查最新资料' });
      const events = await collect(session);
      expect((await session.result)?.answer).toBe('网页补充说明。');
      expect((await session.result)?.webSearch?.status).toBe('failed');
      expect((await session.result)?.webSources).toEqual([]);
      expect(requests).toHaveLength(withAnswer ? 1 : 2);
      if (!withAnswer) {
        expect(requests[1]?.tools).not.toContainEqual(expect.objectContaining({ name: 'web_search' }));
        expect(requests[1]?.tools).toContainEqual(expect.objectContaining({ name: 'search_book' }));
      }
      expect(events.some(event => event.type === 'failed')).toBe(false);
    }
  });

  it('ignores model-written URLs and rejects unsafe provider citation URLs', () => {
    const events: AgentEvent[] = [];
    const runtime = new ProviderWebSearch(resolveWebSearchPolicy('openai', undefined, { enabled: true }), event => events.push(event));
    runtime.observeMessage({ content: 'https://fabricated.example' });
    runtime.observeMessage({ content: [{ type: 'text', text: 'text', annotations: [
      { type: 'url_citation', url: 'javascript:alert(1)' }, { type: 'url_citation', url: 'https://user:pass@example.org' },
    ] }] });
    expect(runtime.allSources).toEqual([]);
    expect(events).toEqual([]);
  });

  it('terminates searching status on cancellation or failure', () => {
    const runtime = new ProviderWebSearch(resolveWebSearchPolicy('openai', undefined, { enabled: true }), () => {});
    runtime.observeMessage({ additional_kwargs: { tool_outputs: [{ type: 'web_search_call', id: 'ws1', status: 'in_progress' }] } });
    expect(runtime.snapshot.status).toBe('searching');
    runtime.failed(new Error('已取消'));
    expect(runtime.snapshot.status).toBe('failed');
  });
});
