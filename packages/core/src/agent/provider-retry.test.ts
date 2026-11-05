import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryBookSource, createChatModel, runBookAgent } from './index.js';
import { createProviderFetch } from './provider-transport.js';
import { resolveProviderEndpoint } from './provider-endpoint.js';
const providers = ['openai', 'deepseek', 'anthropic'] as const;
const redirectReason = "Redirect is not allowed when redirect mode is 'error'";
const book = { id: 'fixture', title: '内存材料', format: 'epub' as const, sourceHash: 'fixture' };
function nativeRedirect() {
  return new Error('fetch failed: ' + redirectReason + ' synthetic-secret-url-key-excerpt');
}
function source() {
  return new InMemoryBookSource({ book, chapters: [{ title: '本机材料', paragraphs: ['固定本机测试内容。'] }] });
}
function response(provider: typeof providers[number]) {
  const text = JSON.stringify({ answer: '连接成功', citations: [] });
  const events = provider === 'anthropic' ? [
    ['message_start', { type: 'message_start', message: { id: 'fixture', type: 'message', role: 'assistant', model: 'fixture', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }],
    ['message_stop', { type: 'message_stop' }],
  ].map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('') :
    'data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
  return new Response(events, { headers: { 'content-type': 'text/event-stream' } });
}
async function run(provider: typeof providers[number], fetch: typeof globalThis.fetch) {
  const model = createChatModel({ provider, model: 'fixture', apiKey: 'synthetic-only', baseUrl: 'http://127.0.0.1:8766/v1', fetch });
  // Tokenizer model downloads are outside this SDK transport/retry test.
  (model.langChainModel as { getNumTokens: (text: string) => Promise<number> }).getNumTokens = async (text) => Math.ceil(text.length / 4);
  const session = runBookAgent({ model, source: source(), book, question: '固定问题' });
  const events = [];
  for await (const event of session.events) events.push(event);
  return { events, result: await session.result };
}
async function finishTimers<T>(promise: Promise<T>, called: () => void) {
  await vi.waitFor(called);
  await vi.advanceTimersByTimeAsync(150_000);
  return promise;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network request')));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('permanent provider safety failures use the real SDK retry path', () => {
  it.each(providers)('%s stops a proved Expo redirect rejection after one request and emits a safe failure', async (provider) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(nativeRedirect());
    const pending = run(provider, fetch);
    const outcome = await finishTimers(pending, () => expect(fetch).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(outcome.result).toBeNull();
    const failed = outcome.events.find((event) => event.type === 'failed');
    expect(failed).toMatchObject({ code: 'configuration' });
    expect(failed?.message).toContain('重定向');
    expect(failed?.message).not.toContain('synthetic-secret');
    expect(failed?.message).not.toContain('超时');
    expect(outcome.events.some((event) => event.type === 'cancelled')).toBe(false);
  });
  it.each(providers)('%s preserves recovery from a temporary transport failure', async (provider) => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new Error('The network connection was lost.'))
      .mockResolvedValue(response(provider));
    const pending = run(provider, fetch);
    const outcome = await finishTimers(pending, () => expect(fetch).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(outcome.result?.answer).toBe('连接成功');
  });
  it.each(providers)('%s still refuses to retry HTTP authentication failures', async (provider) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { type: 'authentication_error', message: 'Unauthorized fixture' } }), { status: 401, headers: { 'content-type': 'application/json' } }));
    const pending = run(provider, fetch);
    const outcome = await finishTimers(pending, () => expect(fetch).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(outcome.events.find((event) => event.type === 'failed')).toMatchObject({ code: 'authentication' });
  });
  it.each(providers)('%s retains the SDK rate-limit retry policy', async (provider) => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { type: 'rate_limit_error', message: 'Rate limit fixture' } }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '0' } }))
      .mockResolvedValue(response(provider));
    const outcome = await finishTimers(run(provider, fetch), () => expect(fetch).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(outcome.result?.answer).toBe('连接成功');
  });
  it.each(['TimeoutError', 'AbortError', 'TypeError', 'APIConnectionError'])('does not infer a redirect or timeout from exception name %s', async (name) => {
    const error = Object.assign(new Error('An unspecified native transport failure'), { name });
    const transport = vi.fn<typeof globalThis.fetch>().mockRejectedValue(error);
    const endpoint = resolveProviderEndpoint('openai', 'http://127.0.0.1:8766/v1');
    await expect(createProviderFetch(endpoint, transport)(endpoint.sdkEndpoint)).rejects.toBe(error);
  });
});

