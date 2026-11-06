import { describe, expect, it, vi } from 'vitest';
import { embedSearchQuery } from './query-embedding.js';
import type { EmbeddingOptions, EmbeddingProvider } from './types.js';

const provider = (overrides: Partial<EmbeddingProvider> = {}): EmbeddingProvider => ({
  modelId: 'query-test', dimension: 2,
  embed: async texts => texts.map(() => new Float32Array([3, 4])),
  ...overrides,
});

describe('embedSearchQuery', () => {
  it('prepares the tokenizer before counting and keeps a short query intact', async () => {
    let prepared = false;
    const embed = vi.fn(async (texts: ReadonlyArray<string>) => texts.map(() => new Float32Array([3, 4])));
    const embedding = provider({
      maxInputTokens: 10,
      prepare: async () => { prepared = true; },
      countTokens(text) { expect(prepared).toBe(true); return Array.from(text).length + 2; },
      embed,
    });
    const result = await embedSearchQuery(embedding, '书灯');
    expect(embed).toHaveBeenCalledWith(['书灯'], {});
    expect(result).toBeInstanceOf(Float32Array);
    expect(result[0]).toBeCloseTo(0.6);
    expect(result[1]).toBeCloseTo(0.8);
  });

  it('covers the entire long multilingual query within actual token limits in bounded batches', async () => {
    const calls: string[][] = [];
    const query = '第一句。🙂Moon文字重复第二段！\n空格  与最后一句'.repeat(12) + '尾部唯一关键词';
    const countTokens = (text: string) => Array.from(text).length * 3 + 2;
    const embedding = provider({
      maxInputTokens: 17, countTokens,
      embed: async texts => {
        calls.push([...texts]);
        for (const text of texts) {
          expect(countTokens(text)).toBeLessThanOrEqual(17);
          expect(text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
        }
        return texts.map(() => new Float32Array([1, 0]));
      },
    });
    expect(await embedSearchQuery(embedding, query)).toEqual(new Float32Array([1, 0]));
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every(batch => batch.length <= 8)).toBe(true);
    expect(calls.flat().join('')).toBe(query);
    expect(calls.flat().join('')).toContain('尾部唯一关键词');
  });

  it('averages every segment equally then normalizes, without losing tiny values', async () => {
    const embedding = provider({
      maxInputTokens: 3, countTokens: text => text.length + 2,
      embed: async texts => texts.map(text => new Float32Array(text === 'a' ? [1, 0] : [0, 1])),
    });
    const result = await embedSearchQuery(embedding, 'abb');
    expect(result[0]).toBeCloseTo(1 / Math.sqrt(5));
    expect(result[1]).toBeCloseTo(2 / Math.sqrt(5));
    expect(await embedSearchQuery(provider({
      ...embedding, embed: async texts => texts.map(() => new Float32Array([1e-45, 0])),
    }), 'abc')).toEqual(new Float32Array([1, 0]));
  });

  it('passes an unbounded provider the complete query without inventing a truncation limit', async () => {
    const query = '全文'.repeat(1000);
    const embed = vi.fn(async (texts: ReadonlyArray<string>) => texts.map(() => new Float32Array([1, 1])));
    await embedSearchQuery(provider({ embed }), query);
    expect(embed).toHaveBeenCalledExactlyOnceWith([query], {});
  });

  it('checks cancellation before preparation and after async preparation', async () => {
    const prepare = vi.fn(async () => {});
    const embed = vi.fn(async () => [new Float32Array([1, 0])]);
    await expect(embedSearchQuery(provider({ prepare, embed }), 'query', { aborted: true })).rejects.toMatchObject({ name: 'AbortError' });
    expect(prepare).not.toHaveBeenCalled();
    const signal = { aborted: false };
    await expect(embedSearchQuery(provider({
      prepare: async () => { signal.aborted = true; }, embed,
    }), 'query', signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(embed).not.toHaveBeenCalled();
  });

  it('stops after a batch even when the embedding provider ignores cancellation', async () => {
    const signal = { aborted: false };
    const embed = vi.fn(async (texts: ReadonlyArray<string>, options?: EmbeddingOptions) => {
      expect(options?.signal).toBe(signal);
      signal.aborted = true;
      return texts.map(() => new Float32Array([1, 0]));
    });
    await expect(embedSearchQuery(provider({ maxInputTokens: 3, countTokens: text => text.length + 2, embed }), '12345678901234567890', signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed.mock.calls[0]?.[0].length).toBe(8);
  });

  it.each([0, -1, 1.5, NaN, Infinity])('rejects an invalid token budget %s before embedding', async maxInputTokens => {
    const embed = vi.fn(async () => []);
    await expect(embedSearchQuery(provider({ maxInputTokens, countTokens: text => text.length, embed }), 'query')).rejects.toThrow(/预算/);
    expect(embed).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, NaN, Infinity])('rejects invalid tokenizer results %s before embedding', async count => {
    const embed = vi.fn(async () => []);
    await expect(embedSearchQuery(provider({ maxInputTokens: 8, countTokens: () => count, embed }), 'query')).rejects.toThrow(/tokenizer/);
    expect(embed).not.toHaveBeenCalled();
  });

  it('fails explicitly if a bounded model has no tokenizer or one character cannot fit', async () => {
    await expect(embedSearchQuery(provider({ maxInputTokens: 8 }), 'query')).rejects.toThrow(/tokenizer/);
    await expect(embedSearchQuery(provider({ maxInputTokens: 2, countTokens: text => text.length + 2 }), '字')).rejects.toThrow(/无损切块/);
  });

  it.each([[], [new Float32Array([1])], [new Float32Array([NaN, 1])],
    [new Float32Array([Infinity, 1])], [new Float32Array([0, 0])]].map(vectors => ({ vectors })))('rejects invalid embedding output $vectors', async ({ vectors }) => {
    await expect(embedSearchQuery(provider({ embed: async () => vectors }), 'query')).rejects.toThrow(/查询向量/);
  });

  it('preserves model preparation and inference errors for the caller fallback policy', async () => {
    await expect(embedSearchQuery(provider({ prepare: async () => { throw new Error('tokenizer unavailable'); } }), 'query')).rejects.toThrow('tokenizer unavailable');
    await expect(embedSearchQuery(provider({ embed: async () => { throw new Error('runtime unavailable'); } }), 'query')).rejects.toThrow('runtime unavailable');
  });
});
