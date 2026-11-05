import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { createChatModel, type AgentProvider } from './providers.js';

// The orchestrator starts/stops the fixture; this suite never opens a listener.
const enabled = process.env.SHUDENG_REDIRECT_FIXTURE === '1';
const base = 'http://127.0.0.1:8766';
const nativeFetch = globalThis.fetch;

describe.runIf(enabled)('controlled provider redirect with real loopback HTTP', () => {
  beforeAll(async () => {
    await nativeFetch(base + '/__reset', { method: 'POST', redirect: 'error' });
  });
  afterAll(async () => {
    const stats = await (await nativeFetch(base + '/__status')).json();
    expect(stats.targetHits).toBe(0);
    expect(stats.targetBytes).toBe(0);
    expect(stats.targetAuthHeaders).toBe(0);
    expect(stats.redirects307).toBeGreaterThan(0);
    expect(stats.redirects308).toBeGreaterThan(0);
    console.info('Synthetic redirect counts:', JSON.stringify(stats));
  });

  for (const provider of ['openai', 'deepseek', 'anthropic'] as const) {
    for (const route of ['ok', 'r307', 'r308'] as const) {
      it(
        provider + ' ' + route + ' transmits only to the configured initial endpoint',
        { timeout: 30_000 },
        async () => {
          const handle = createChatModel({
            provider: provider as AgentProvider,
            model: 'local-mock',
            apiKey: 'local-only-synthetic-key',
            baseUrl: base + '/' + route + '/v1',
            fetch: async (input, init) => {
              // Any unintended SDK auxiliary network is rejected even in the test.
              if (new URL(String(input)).origin !== base)
                throw new Error('Fixture forbids external requests');
              return nativeFetch(input, init);
            },
          });
          const model = handle.langChainModel as BaseChatModel;
          const run = async () => {
            let text = '';
            for await (const chunk of await model.stream(
              'Synthetic local network fixture; no real book text.',
              { maxRetries: 0 } as never,
            ))
              text += chunk.content;
            return text;
          };
          if (route === 'ok') expect(await run()).toContain('本机网络边界检查成功');
          else await expect(run()).rejects.toThrow();
          const stats = await (await nativeFetch(base + '/__status')).json();
          expect(stats.targetHits).toBe(0);
          expect(stats.targetBytes).toBe(0);
        },
      );
    }
  }
});
