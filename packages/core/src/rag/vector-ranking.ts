import { cosineSimilarity } from './embedding.js';
import { assertNotAborted, type CancellationSignal } from './types.js';

interface VectorCandidate<Id extends string | number, Payload> {
  readonly id: Id;
  readonly vector: unknown;
  readonly model?: string;
  readonly dimension?: number;
  readonly payload: Payload;
}

/** Scan paged vectors while retaining only the best distinct sources and their winning payloads. */
export async function rankVectorCandidates<Id extends string | number, Payload>(
  candidates: AsyncIterable<VectorCandidate<Id, Payload>>,
  query: Float32Array,
  options: { limit: number; compatibleModels: ReadonlyArray<string>; signal?: CancellationSignal | undefined },
): Promise<Array<{ id: Id; score: number; payload: Payload }>> {
  assertNotAborted(options.signal);
  const limit = Math.max(0, Math.floor(options.limit));
  if (!Number.isFinite(limit) || !limit) return [];
  const models = new Set(options.compatibleModels);
  const ranked: Array<{ id: Id; score: number; payload: Payload }> = [];
  const compare = (a: typeof ranked[number], b: typeof ranked[number]): number => b.score - a.score
    || (typeof a.id === 'number' && typeof b.id === 'number' ? a.id - b.id : String(a.id).localeCompare(String(b.id)));
  for await (const candidate of candidates) {
    assertNotAborted(options.signal);
    // Missing model metadata never proves that equal-sized vectors share a space.
    if (!candidate.model || !models.has(candidate.model) || (candidate.dimension !== undefined && candidate.dimension !== query.length)) continue;
    let vector: Float32Array;
    if (candidate.vector instanceof Float32Array) vector = candidate.vector;
    else if (candidate.vector instanceof Uint8Array && candidate.vector.byteLength === query.byteLength) {
      vector = new Float32Array(new Uint8Array(candidate.vector).buffer);
    } else continue;
    if (vector.length !== query.length) continue;
    const score = cosineSimilarity(query, vector);
    if (!Number.isFinite(score)) continue;
    const entry = { id: candidate.id, score, payload: candidate.payload };
    const previous = ranked.findIndex(value => value.id === entry.id);
    if (previous >= 0) {
      if (ranked[previous]!.score >= score) continue;
      ranked.splice(previous, 1);
    }
    if (ranked.length === limit && compare(entry, ranked[ranked.length - 1]!) >= 0) continue;
    let low = 0, high = ranked.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (compare(ranked[middle]!, entry) <= 0) low = middle + 1; else high = middle;
    }
    ranked.splice(low, 0, entry);
    if (ranked.length > limit) ranked.pop();
  }
  assertNotAborted(options.signal);
  return ranked;
}
