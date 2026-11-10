import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatOpenAICompletions } from '@langchain/openai';
import { parseContextWindowTokens } from './context-window.js';
import { inspectModelContext, resolveModelContextBudget } from './model-context.js';
import { NativeContextManager, nativeContextBudget } from './context-manager.js';
import { HumanMessage } from '@langchain/core/messages';

afterEach(() => vi.restoreAllMocks());

describe('context capacity input', () => {
  it.each([['1M', 1_000_000], ['1047576', 1_047_576], ['1.05M', 1_050_000],
    ['1.001M', 1_001_000], ['1.01K', 1010], ['128k', 128_000], [' 2 M ', 2_000_000],
    ['1.000001M', 1_000_001], ['9007199254.740991M', Number.MAX_SAFE_INTEGER]])(
    'parses %s exactly', (text, expected) => expect(parseContextWindowTokens(text)).toBe(expected),
  );
  it('uses automatic metadata for blank input', () => expect(parseContextWindowTokens('  ')).toBeUndefined());
  it.each(['999', '-1000', '1e6', 'Infinity', 'NaN', '1.0000001M', '1.0001K',
    '9007199254740992', '9007199254.740992M', '1Kextra', '1,000', '.5M'])('rejects %s', (value) => {
    expect(() => parseContextWindowTokens(value)).toThrow();
  });
});

describe('local model context inspection', () => {
  it('reads LangChain profiles without an API key or network request', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network prohibited'));
    const info = inspectModelContext({ provider: 'openai', model: 'gpt-4.1', baseUrl: 'https://api.openai.com/v1' });
    expect(info).toMatchObject({ source: 'profile', endpoint: 'official', limitKind: 'input',
      maxInputTokens: 1_047_576, contextWindowTokens: 1_047_576, maxOutputTokens: 32_768 });
    expect(info.notice).toContain('输入上限');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps gateway profile inference separate from endpoint proof', () => {
    const info = inspectModelContext({ provider: 'openai', model: 'claude-sonnet-4-5', baseUrl: 'https://gateway.example/v1' });
    expect(info).toMatchObject({ source: 'profile', endpoint: 'custom', profileProvider: 'anthropic' });
    expect(info.notice).toContain('未验证');
    expect(inspectModelContext({ provider: 'openai', model: 'gpt-4.1',
      baseUrl: 'https://api.openai.com/custom-proxy' }).endpoint).toBe('custom');
  });
  it('reports conservative fallback for unknown models, keeping DeepSeek output room', () => {
    const info = inspectModelContext({ provider: 'deepseek', model: 'private-unknown-model' });
    expect(info).toMatchObject({ source: 'fallback', limitKind: 'conservative', contextWindowTokens: 32_768 });
    expect(info.maxInputTokens).toBeUndefined();
    expect(resolveModelContextBudget(info, 16_384)).toEqual({ contextWindowTokens: 32_768, outputReserveTokens: 16_384 });
  });
  it.each([1_000_000, 1_047_576, 2_000_000, Number.MAX_SAFE_INTEGER])('gives manual %i precedence without truncation', (size) => {
    const info = inspectModelContext({ provider: 'openai', model: 'gpt-4.1', contextWindowTokens: size });
    expect(info).toMatchObject({ source: 'manual', limitKind: 'shared', contextWindowTokens: size });
    expect(resolveModelContextBudget(info, 4096).contextWindowTokens).toBe(size);
  });
  it.each([NaN, Infinity, -Infinity, 999, 1000.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid manual %s', (size) => {
    expect(() => inspectModelContext({ provider: 'openai', model: 'gpt-4.1', contextWindowTokens: size })).toThrow();
  });
  it('ignores zero, non-finite and unsafe profile limits', () => {
    const spy = vi.spyOn(ChatOpenAICompletions.prototype, 'profile', 'get');
    for (const [index, value] of [0, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].entries()) {
      spy.mockReturnValue({ maxInputTokens: value, maxOutputTokens: value });
      const info = inspectModelContext({ provider: 'openai', model: 'invalid-profile-' + index });
      expect(info.source).toBe('fallback');
      expect(info.maxOutputTokens).toBeUndefined();
    }
  });
  it('does not confuse output-only profile data with a context window', () => {
    vi.spyOn(ChatOpenAICompletions.prototype, 'profile', 'get').mockReturnValue({ maxOutputTokens: 1024 });
    const info = inspectModelContext({ provider: 'openai', model: 'output-only-profile' });
    expect(info.source).toBe('fallback');
    expect(resolveModelContextBudget(info, 4096).outputReserveTokens).toBe(1024);
  });
  it('does not enlarge a known profile window below the supported runtime minimum', () => {
    vi.spyOn(ChatOpenAICompletions.prototype, 'profile', 'get').mockReturnValue({ maxInputTokens: 999 });
    const info = inspectModelContext({ provider: 'openai', model: 'tiny-profile-window' });
    expect(info).toMatchObject({ source: 'profile', contextWindowTokens: 999 });
    expect(() => resolveModelContextBudget(info, 4096)).toThrow('1,000');
  });
});

describe('shared window and output reservation', () => {
  it('preserves an input-profile window and subtracts output only in the context manager', () => {
    const info = inspectModelContext({ provider: 'openai', model: 'gpt-4.1' });
    const runtime = resolveModelContextBudget(info, 4096);
    const budget = nativeContextBudget(runtime.contextWindowTokens, runtime.outputReserveTokens);
    expect(runtime.contextWindowTokens).toBe(info.maxInputTokens);
    expect(budget.window).toBe(1_047_576);
    expect(budget.threshold + runtime.outputReserveTokens).toBeLessThanOrEqual(budget.window);
    expect(runtime.outputReserveTokens).toBe(4096);
  });
  it('shrinks both answer output and reserve on a small manual window without enlarging it', async () => {
    const runtime = resolveModelContextBudget(inspectModelContext({ provider: 'openai', model: 'unknown-small', contextWindowTokens: 1000 }), 4096);
    expect(runtime).toEqual({ contextWindowTokens: 1000, outputReserveTokens: 500 });
    const manager = new NativeContextManager({ window: runtime.contextWindowTokens, outputReserve: runtime.outputReserveTokens }, async () => '');
    const prepared = await manager.prepare(undefined, [new HumanMessage('中'.repeat(300))]);
    expect(prepared.estimate.contextWindowTokens).toBe(1000);
    expect(prepared.overBudget).toBe(true);
  });
  it.each([NaN, Infinity, 999, 1000.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid runtime window %s', (window) => {
    expect(() => nativeContextBudget(window, 0)).toThrow();
    const info = inspectModelContext({ provider: 'openai', model: 'gpt-4.1' });
    expect(() => resolveModelContextBudget({ ...info, contextWindowTokens: window }, 4096)).toThrow();
  });
  it.each([NaN, Infinity, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid requested output %s', (output) => {
    const info = inspectModelContext({ provider: 'openai', model: 'gpt-4.1' });
    expect(() => resolveModelContextBudget(info, output)).toThrow();
    expect(() => resolveModelContextBudget({ ...info, maxOutputTokens: output }, 4096)).toThrow();
  });
  it.each([NaN, Infinity, -1, 1000, 1400, 1.5])('rejects invalid output reserve %s rather than exceeding the window', (reserve) => {
    expect(() => nativeContextBudget(1000, reserve)).toThrow();
  });
});
