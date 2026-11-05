import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { createChatModel, type AgentProvider } from './providers.js';
import { resolveProviderEndpoint } from './provider-endpoint.js';
import { createProviderFetch } from './provider-transport.js';

afterEach(() => vi.unstubAllGlobals());
beforeEach(() =>
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected external request in fixture test'))),
);

describe('provider endpoint address contract', () => {
  it.each([
    ['openai', 'https://example.test', '/v1/chat/completions'],
    ['openai', 'https://example.test/', '/v1/chat/completions'],
    ['openai', 'https://example.test/v1', '/v1/chat/completions'],
    ['openai', 'https://example.test/v1/', '/v1/chat/completions'],
    ['openai', 'https://example.test/v1/chat/completions', '/v1/chat/completions'],
    ['openai', 'https://example.test/chat/completions/', '/chat/completions'],
    ['openai', 'https://example.test/proxy/v2', '/proxy/v2/chat/completions'],
    ['deepseek', 'https://example.test', '/v1/chat/completions'],
    ['deepseek', 'https://example.test/v1/chat/completions', '/v1/chat/completions'],
    ['anthropic', 'https://example.test', '/v1/messages'],
    ['anthropic', 'https://example.test/v1', '/v1/messages'],
    ['anthropic', 'https://example.test/v1/messages/', '/v1/messages'],
    ['anthropic', 'https://example.test/messages', '/messages'],
    ['anthropic', 'https://example.test/proxy/v2', '/proxy/v2/messages'],
    ['anthropic', 'https://example.test/proxy/v2/messages', '/proxy/v2/messages'],
  ] as const)('%s accepts %s', (provider, address, path) => {
    expect(resolveProviderEndpoint(provider, address).endpoint).toBe('https://example.test' + path);
  });

  it('has explicit default endpoints instead of depending on SDK environment defaults', () => {
    expect(resolveProviderEndpoint('openai').endpoint).toBe('https://api.openai.com/v1/chat/completions');
    expect(resolveProviderEndpoint('deepseek').endpoint).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(resolveProviderEndpoint('anthropic').endpoint).toBe('https://api.anthropic.com/v1/messages');
  });

  it.each([
    '',
    'http://remote.test/v1',
    'https://user:secret@example.test/v1',
    'https://example.test/v1?key=secret',
    'https://example.test/v1#fragment',
    'file:///tmp/key',
  ])('rejects ambiguous or unsafe endpoint %s before a request', (address) => {
    expect(() => resolveProviderEndpoint('openai', address)).toThrow();
  });

  it.each(['http://127.0.0.1:8765', 'http://localhost:8765', 'http://[::1]:8765'])(
    'accepts local fixture %s',
    (address) => {
      expect(resolveProviderEndpoint('openai', address).endpoint).toBe(address + '/v1/chat/completions');
    },
  );
});

describe('provider network boundary', () => {
  it('requires an explicitly injected native transport', () => {
    vi.stubGlobal('navigator', { product: 'ReactNative' });
    expect(() => createProviderFetch(resolveProviderEndpoint('openai'))).toThrow('原生网络适配器');
  });

  it('forces redirect:error before invoking the transport, retaining credentials/body/signal', async () => {
    const native = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    const endpoint = resolveProviderEndpoint('openai', 'http://127.0.0.1:8765');
    const fetch = createProviderFetch(endpoint, native);
    const controller = new AbortController();
    const init: RequestInit = {
      method: 'POST',
      headers: { Authorization: 'Bearer synthetic-fixture' },
      body: 'synthetic-book-excerpt',
      signal: controller.signal,
      redirect: 'follow',
      credentials: 'include',
    };
    await fetch(endpoint.sdkEndpoint, init);
    expect(native).toHaveBeenCalledWith(endpoint.endpoint, {
      ...init,
      redirect: 'error',
      credentials: 'omit',
    });
    expect(init.redirect).toBe('follow');
  });

  it('refuses SDK attempts to send to another initial host/path without calling the transport', async () => {
    const native = vi.fn<typeof fetch>();
    const fetch = createProviderFetch(resolveProviderEndpoint('openai', 'https://approved.test/v1'), native);
    await expect(fetch('https://other.test/v1/chat/completions')).rejects.toThrow('文字端点以外');
    await expect(fetch('https://approved.test/v1/embeddings')).rejects.toThrow('文字端点以外');
    expect(native).not.toHaveBeenCalled();
  });

  it('maps Anthropic SDK versioning to the configured endpoint without a duplicate /v1', async () => {
    const native = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    const endpoint = resolveProviderEndpoint('anthropic', 'https://approved.test/proxy/v2/messages');
    const fetch = createProviderFetch(endpoint, native);
    await fetch(endpoint.sdkEndpoint, { method: 'POST', body: '{}' });
    expect(native.mock.calls[0]?.[0]).toBe('https://approved.test/proxy/v2/messages');
  });
});

describe('actual SDK endpoint requests', () => {
  it.each(['gpt-5.6', 'gpt-5.6-sol-codex', 'custom-compatible-model'])(
    'keeps model %s on the configured Chat Completions protocol',
    async (modelName) => {
      const calls: string[] = [];
      const handle = createChatModel({
        provider: 'openai',
        model: modelName,
        apiKey: 'synthetic-fixture',
        baseUrl: 'http://127.0.0.1:8765/v1/chat/completions',
        fetch: async (input) => {
          calls.push(String(input));
          const lf = String.fromCharCode(10);
          return new Response(
            'data: ' +
              JSON.stringify({
                id: 'fixture',
                object: 'chat.completion.chunk',
                created: 1,
                model: modelName,
                choices: [
                  { index: 0, delta: { role: 'assistant', content: 'same protocol' }, finish_reason: 'stop' },
                ],
              }) +
              lf +
              lf +
              'data: [DONE]' +
              lf +
              lf,
            { headers: { 'content-type': 'text/event-stream' } },
          );
        },
      });
      let answer = '';
      for await (const chunk of await (handle.langChainModel as BaseChatModel).stream('synthetic fixture'))
        answer += chunk.content;
      expect(answer).toBe('same protocol');
      expect(calls).toEqual(['http://127.0.0.1:8765/v1/chat/completions']);
    },
  );

  it.each([
    ['openai', 'http://127.0.0.1:8765', '/v1/chat/completions'],
    ['openai', 'http://127.0.0.1:8765/v1/chat/completions', '/v1/chat/completions'],
    ['deepseek', 'http://127.0.0.1:8765/v1', '/v1/chat/completions'],
    ['deepseek', 'http://127.0.0.1:8765/v1/chat/completions', '/v1/chat/completions'],
    ['anthropic', 'http://127.0.0.1:8765', '/v1/messages'],
    ['anthropic', 'http://127.0.0.1:8765/v1', '/v1/messages'],
    ['anthropic', 'http://127.0.0.1:8765/v1/messages', '/v1/messages'],
    ['anthropic', 'http://127.0.0.1:8765/custom/v2/messages', '/custom/v2/messages'],
  ] as const)('%s invokes the configured endpoint %s', async (provider, baseUrl, path) => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const transport: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      if (provider !== 'anthropic' && JSON.parse(String(init?.body)).stream) {
        const chunks = [{ role: 'assistant', content: '' }, { content: 'fixture answer' }, {}].map(
          (delta, index) => ({
            id: 'chatcmpl_fixture',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'local-mock',
            choices: [{ index: 0, delta, finish_reason: index === 2 ? 'stop' : null }],
            ...(index === 2 ? { usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } } : {}),
          }),
        );
        const lf = String.fromCharCode(10);
        return new Response(
          chunks.map((chunk) => 'data: ' + JSON.stringify(chunk)).join(lf + lf) +
            lf +
            lf +
            'data: [DONE]' +
            lf +
            lf,
          { headers: { 'content-type': 'text/event-stream' } },
        );
      }
      return new Response(
        JSON.stringify(
          provider === 'anthropic'
            ? {
                id: 'msg_fixture',
                type: 'message',
                role: 'assistant',
                model: 'local-mock',
                content: [{ type: 'text', text: 'fixture answer' }],
                stop_reason: 'end_turn',
                stop_sequence: null,
                usage: { input_tokens: 12, output_tokens: 3 },
              }
            : {
                id: 'chatcmpl_fixture',
                object: 'chat.completion',
                created: 1,
                model: 'local-mock',
                choices: [
                  {
                    index: 0,
                    message: { role: 'assistant', content: 'fixture answer' },
                    finish_reason: 'stop',
                  },
                ],
                usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
              },
        ),
        { headers: { 'content-type': 'application/json' } },
      );
    };
    const handle = createChatModel({
      provider: provider as AgentProvider,
      model: 'local-mock',
      apiKey: 'synthetic-fixture',
      baseUrl,
      fetch: transport,
    });
    const model = handle.langChainModel as BaseChatModel & { streaming: boolean };
    model.streaming = false;
    let content = '';
    if (provider === 'anthropic')
      content = String((await model.invoke('synthetic fixture question')).content);
    else for await (const chunk of await model.stream('synthetic fixture question')) content += chunk.content;
    expect(content).toBe('fixture answer');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('http://127.0.0.1:8765' + path);
    expect(requests[0]?.init?.redirect).toBe('error');
    const body = JSON.parse(String(requests[0]?.init?.body));
    expect(
      body.messages.some((message: { content: unknown }) =>
        JSON.stringify(message.content).includes('synthetic fixture question'),
      ),
    ).toBe(true);
  });
});
