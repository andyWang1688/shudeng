import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatModel } from './providers.js';
import { runBookAgent } from './agent.js';
import { InMemoryBookSource } from './book-source.js';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AgentEvent } from './events.js';
import { createScriptedModel } from './testing.js';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { observeResponseActivity } from './response-activity.js';
const StreamingResponse = globalThis.Response;
const rnRequire = createRequire(realpathSync(new URL('../../../../apps/mobile/node_modules/react-native/package.json', import.meta.url)));
const RNResponse = rnRequire('whatwg-fetch').Response as typeof Response;
const book = { id: 'sse-idle-book', title: '书', format: 'epub' as const, sourceHash: 'sse-idle' };
const source = () => new InMemoryBookSource({ book, chapters: [{ title: '章', paragraphs: ['原文'] }] });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function sse(delta: Record<string, unknown>, stop = false): string {
  return 'data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'deepseek-fixture',
    choices: [{ index: 0, delta, finish_reason: stop ? 'stop' : null }] }) + '\n\n';
}

function delayedSSE(events: readonly { at: number; text: string }[], requests: RequestInit[]) {
  const encoder = new TextEncoder();
  return async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push(init!);
    const timers: ReturnType<typeof setTimeout>[] = [];
    return new StreamingResponse(new ReadableStream<Uint8Array>({ start(controller) {
      let closed = false;
      const cleanup = () => { for (const timer of timers) clearTimeout(timer); init?.signal?.removeEventListener('abort', abort); };
      const abort = () => { if (closed) return; closed = true; cleanup(); const error = new Error('aborted'); error.name = 'AbortError'; controller.error(error); };
      init?.signal?.addEventListener('abort', abort, { once: true });
      for (const [i, event] of events.entries()) timers.push(setTimeout(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(event.text));
        if (i === events.length - 1) { closed = true; cleanup(); controller.close(); }
      }, event.at));
    } }), { headers: { 'content-type': 'text/event-stream' } });
  };
}

async function run(transport: typeof fetch) {
  const model = createChatModel({ provider: 'deepseek', model: 'deepseek-fixture', apiKey: 'synthetic',
    baseUrl: 'http://127.0.0.1:8766/v1', fetch: transport });
  // Avoid tokenizer downloads: this test observes the real SDK/parser/fetch/callback path.
  (model.langChainModel as BaseChatModel).getNumTokens = async text => Math.ceil(text.length / 4);
  const session = runBookAgent({ model, source: source(), book, question: '问题', modelIdleTimeoutMs: 180000, runTimeoutMs: 300000 });
  const pending = (async () => { const events: AgentEvent[] = []; for await (const event of session.events) events.push(event); return events; })();
  return { session, pending };
}

describe('real SDK SSE body idle contract', () => {
  it('preserves a streaming Expo response when RN installs the legacy global Response constructor', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Response', RNResponse);
    const unsupported = new RNResponse(new ReadableStream());
    expect(unsupported.body?.getReader).toBeUndefined();
    expect(await unsupported.text()).toBe('[object ReadableStream]');
    const requests: RequestInit[] = [];
    const { session, pending } = await run(delayedSSE([
      { at: 100000, text: ': keepalive\n\n' }, { at: 200000, text: ': keepalive\n\n' },
      { at: 300000, text: sse({ role: 'assistant', content: '{"answer":"RN流保持完整","citations":[]}' }, true) + 'data: [DONE]\n\n' },
    ], requests));
    await vi.advanceTimersByTimeAsync(300001);
    const events = await pending;
    expect((await session.result)?.answer).toBe('RN流保持完整');
    expect(events.some(event => event.type === 'failed')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains original response metadata, clone and private-brand methods without eagerly locking its body', async () => {
    vi.stubGlobal('Response', RNResponse);
    const original = new StreamingResponse('原始响应', { status: 201, statusText: 'Created', headers: { 'x-fixture': 'yes' } });
    const activity = vi.fn();
    const wrapped = observeResponseActivity(original, activity);
    expect(wrapped).toBeInstanceOf(StreamingResponse);
    expect(wrapped.status).toBe(201);
    expect(wrapped.statusText).toBe('Created');
    expect(wrapped.headers.get('x-fixture')).toBe('yes');
    expect(wrapped.bodyUsed).toBe(false);
    expect(wrapped.body?.locked).toBe(false);
    const clone = wrapped.clone();
    expect(await clone.text()).toBe('原始响应');
    expect(wrapped.bodyUsed).toBe(false);
    const reader = wrapped.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('原始响应');
    expect((await reader.read()).done).toBe(true);
    reader.releaseLock();
    expect(wrapped.bodyUsed).toBe(true);
    expect(activity).toHaveBeenCalledTimes(1);
  });
  it('keeps the ordinary 90-second stream idle budget alive on raw heartbeats', async () => {
    vi.useFakeTimers();
    const requests: RequestInit[] = [];
    const model = createChatModel({ provider: 'openai', model: 'fixture', apiKey: 'synthetic',
      baseUrl: 'http://127.0.0.1:8766/v1', fetch: delayedSSE([
        { at: 80000, text: ': keepalive\n\n' }, { at: 160000, text: ': keepalive\n\n' },
        { at: 240000, text: sse({ role: 'assistant', content: '{"answer":"普通服务回答","citations":[]}' }, true) + 'data: [DONE]\n\n' },
      ], requests) });
    (model.langChainModel as BaseChatModel).getNumTokens = async text => Math.ceil(text.length / 4);
    const session = runBookAgent({ model, source: source(), book, question: '问题' });
    const observed: AgentEvent[] = [];
    const pending = (async () => { for await (const event of session.events) observed.push(event); })();
    await vi.advanceTimersByTimeAsync(240001);
    await pending;
    expect((await session.result)?.answer, JSON.stringify(observed)).toBe('普通服务回答');
    expect(requests[0]!.signal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses raw bytes for the independent 45-second summary idle budget too', async () => {
    vi.useFakeTimers();
    const requests: RequestInit[] = [];
    const summaryModel = createChatModel({ provider: 'openai', model: 'fixture', apiKey: 'synthetic',
      baseUrl: 'http://127.0.0.1:8766/v1', maxTokens: 2000, fetch: delayedSSE([
        { at: 30000, text: ': keepalive\n\n' }, { at: 60000, text: ': keepalive\n\n' },
        { at: 90000, text: sse({ content: '真实摘要。' }, true) + 'data: [DONE]\n\n' },
      ], requests) });
    (summaryModel.langChainModel as BaseChatModel).getNumTokens = async text => Math.ceil(text.length / 4);
    const session = runBookAgent({ model: createScriptedModel([{ chunks: [{ text: '{"answer":"整理后回答","citations":[]}' }] }]),
      summaryModel, source: source(), book, question: '新问', contextWindowTokens: 2000,
      history: Array.from({ length: 5 }, () => ({ question: '旧问'.repeat(100), answer: '旧答'.repeat(100) })),
    });
    const pending = (async () => { for await (const _event of session.events) { /* consume */ } })();
    await vi.advanceTimersByTimeAsync(90001);
    await pending;
    expect((await session.result)?.answer).toBe('整理后回答');
    expect((await session.result)?.contextSummary).toBe('真实摘要。');
    expect(JSON.parse(String(requests[0]!.body))).toMatchObject({ max_tokens: 2000 });
    expect(JSON.parse(String(requests[0]!.body))).not.toHaveProperty('tools');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('never delivers a previous response activity to a later subscription on a reused model', async () => {
    vi.useFakeTimers();
    const requests: RequestInit[] = [];
    const model = createChatModel({ provider: 'deepseek', model: 'deepseek-fixture', apiKey: 'synthetic',
      baseUrl: 'http://127.0.0.1:8766/v1', fetch: delayedSSE([
        { at: 100000, text: ': keepalive\n\n' },
        { at: 200000, text: sse({ role: 'assistant', content: '回答' }, true) + 'data: [DONE]\n\n' },
      ], requests) });
    const first = vi.fn(); const second = vi.fn();
    const stopFirst = model.subscribeActivity!(first);
    const pending = (async () => {
      const stream = await (model.langChainModel as BaseChatModel).stream('问题');
      for await (const _chunk of stream) { /* consume the actual SDK body */ }
    })();
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toHaveLength(1);
    expect(first).toHaveBeenCalled();
    stopFirst();
    const oldCount = first.mock.calls.length;
    const stopSecond = model.subscribeActivity!(second);
    await vi.advanceTimersByTimeAsync(200000);
    await pending;
    expect(first).toHaveBeenCalledTimes(oldCount);
    expect(second).not.toHaveBeenCalled();
    stopSecond();
  });
  it('counts raw SSE keepalive bytes even when the SDK does not emit model chunks', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Error('unexpected external request')));
    const requests: RequestInit[] = [];
    const { session, pending } = await run(delayedSSE([
      { at: 100000, text: ': keepalive\n\n' },
      { at: 200000, text: ': keepalive\n\n' },
      { at: 300000, text: sse({ role: 'assistant', content: '{"answer":"心跳后回答","citations":[]}' }, true) + 'data: [DONE]\n\n' },
    ], requests));
    await vi.advanceTimersByTimeAsync(300001);
    const events = await pending;
    expect((await session.result)?.answer).toBe('心跳后回答');
    expect(events.some(event => event.type === 'reasoningDelta')).toBe(false);
    expect(events.some(event => event.type === 'failed')).toBe(false);
    expect(requests[0]!.signal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps an active DeepSeek reasoning stream alive past the SDK 180-second header timeout and 300-second run checkpoint', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Error('unexpected external request')));
    const requests: RequestInit[] = [];
    const { session, pending } = await run(delayedSSE([
      { at: 100000, text: sse({ role: 'assistant', reasoning_content: '第一段思考' }) },
      { at: 200000, text: sse({ reasoning_content: '第二段思考' }) },
      { at: 300000, text: sse({ reasoning_content: '第三段思考' }) },
      { at: 400000, text: sse({ content: '{"answer":"持续流回答","citations":[]}' }, true) + 'data: [DONE]\n\n' },
    ], requests));
    await vi.advanceTimersByTimeAsync(400001);
    const events = await pending;
    expect(requests).toHaveLength(1);
    expect(requests[0]!.signal?.aborted).toBe(false);
    expect((await session.result)?.answer).toBe('持续流回答');
    expect(events.flatMap(event => event.type === 'reasoningDelta' ? [event.delta] : []).join('')).toContain('第三段思考');
    expect(events.some(event => event.type === 'failed')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts the real SDK response body after 180 seconds without another chunk and emits timeout once', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Error('unexpected external request')));
    const requests: RequestInit[] = [];
    const { session, pending } = await run(delayedSSE([
      { at: 100000, text: sse({ role: 'assistant', reasoning_content: '先有思考' }) },
      { at: 400000, text: sse({ content: '{"answer":"迟到","citations":[]}' }, true) + 'data: [DONE]\n\n' },
    ], requests));
    await vi.advanceTimersByTimeAsync(280001);
    const events = await pending;
    expect(requests).toHaveLength(1);
    expect(requests[0]!.signal?.aborted).toBe(true);
    expect(events.filter(event => event.type === 'failed')).toEqual([
      { type: 'failed', code: 'timeout', message: 'AI 服务响应超时，请稍后重试。' },
    ]);
    expect(events.some(event => event.type === 'completed' || event.type === 'cancelled')).toBe(false);
    expect(await session.result).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
