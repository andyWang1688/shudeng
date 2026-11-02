/** 纯函数预处理：截断 / mean pooling / L2；Node 对照脚本与原生适配器共用。 */
import { EMBEDDING_MAX_TOKENS } from './embeddingShared';

/** >128 时保留前 127 个 id，再追加 eos（通常 id=2，与 iOS/Node 一致）。 */
export function truncateTokenIds(ids: ReadonlyArray<number>, maxTokens: number = EMBEDDING_MAX_TOKENS): number[] {
  if (ids.length <= maxTokens) return [...ids];
  const eos = ids[ids.length - 1] ?? 2;
  return [...ids.slice(0, maxTokens - 1), eos];
}

export function meanPoolAndNormalize(
  data: ArrayLike<number>,
  sequenceLength: number,
  dimension: number,
): Float32Array {
  const pooled = new Float32Array(dimension);
  for (let token = 0; token < sequenceLength; token += 1) {
    const offset = token * dimension;
    for (let index = 0; index < dimension; index += 1) {
      pooled[index] = (pooled[index] ?? 0) + (data[offset + index] ?? 0);
    }
  }
  for (let index = 0; index < dimension; index += 1) {
    pooled[index] = (pooled[index] ?? 0) / Math.max(1, sequenceLength);
  }
  return normalizeInPlace(pooled);
}

export function normalizeInPlace(vector: Float32Array): Float32Array {
  const norm = l2Norm(vector);
  if (norm > 0) {
    for (let index = 0; index < vector.length; index += 1) vector[index] = (vector[index] ?? 0) / norm;
  }
  return vector;
}

export function l2Norm(vector: ArrayLike<number>): number {
  let sum = 0;
  for (let index = 0; index < vector.length; index += 1) {
    const value = vector[index] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum);
}
