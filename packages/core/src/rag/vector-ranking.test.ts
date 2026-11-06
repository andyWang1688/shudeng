import { describe, expect, it } from 'vitest';
import { rankVectorCandidates } from './vector-ranking.js';

describe('bounded source vector ranking', () => {
  it('uses cosine, deduplicates by winning piece and rejects foreign or invalid vectors', async () => {
    async function* candidates() {
      yield { id: 9, model: 'm', vector: new Float32Array([10, 10]), payload: 'large norm' };
      yield { id: 2, model: 'm', vector: new Float32Array([0, 1]), payload: 'old piece' };
      yield { id: 1, model: 'foreign', vector: new Float32Array([1, 0]), payload: 'foreign' };
      yield { id: 3, model: 'm', vector: new Uint8Array(3), payload: 'bad blob' };
      yield { id: 4, model: 'm', vector: new Float32Array([Number.NaN, 0]), payload: 'nan' };
      yield { id: 2, model: 'm', vector: new Float32Array([0.1, 0]), payload: 'best piece' };
      yield { id: 5, model: 'm', dimension: 3, vector: new Float32Array([1, 0]), payload: 'wrong metadata' };
      yield { id: 6, vector: new Float32Array([1, 0]), payload: 'missing model' };
    }
    const ranked = await rankVectorCandidates(candidates(), new Float32Array([1, 0]), { limit: 2, compatibleModels: ['m'] });
    expect(ranked.map(({ id, payload }) => ({ id, payload }))).toEqual([{ id: 2, payload: 'best piece' }, { id: 9, payload: 'large norm' }]);
    expect(ranked[0]!.score).toBeCloseTo(1);
    expect(ranked[1]!.score).toBeCloseTo(Math.SQRT1_2);
  });

  it('propagates page failures and closes the source on cancellation', async () => {
    let closed = false, cancelled = false;
    async function* candidates() {
      try { cancelled = true; yield { id: 'a', model: 'm', vector: new Float32Array([1]), payload: null }; }
      finally { closed = true; }
    }
    await expect(rankVectorCandidates(candidates(), new Float32Array([1]), { limit: 2, compatibleModels: ['m'], signal: { get aborted() { return cancelled; } } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(closed).toBe(true);
    async function* broken() {
      yield { id: 'a', model: 'm', vector: new Float32Array([1]), payload: null };
      throw new Error('database page failed');
    }
    await expect(rankVectorCandidates(broken(), new Float32Array([1]), { limit: 2, compatibleModels: ['m'] })).rejects.toThrow('database page failed');
  });
});
