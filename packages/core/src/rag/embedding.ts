/**
 * 确定性 Embedding stub（Node 测试/评测默认实现，无网络、无原生依赖）。
 *
 * 语义：CJK 单字/拉丁词 → FNV-1a hash → 固定维度符号向量 → L2 归一化。
 * 同 token 文本相似度高，足以验证检索链路；**不代表真实语义相似度**。
 * 真实 embedding（MiniLM int8 ONNX）见报告「真实 embedding 状态」。
 */
import { ftsTokens } from './text.js';
import { assertNotAborted, type EmbeddingOptions, type EmbeddingProvider } from './types.js';

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface DeterministicEmbeddingOptions {
  /** 维度，默认 128。 */
  dimension?: number;
}

export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly dimension: number;
  readonly modelId: string;

  constructor(options: DeterministicEmbeddingOptions = {}) {
    this.dimension = Math.max(8, Math.floor(options.dimension ?? 128));
    this.modelId = `deterministic-hash-v1-${this.dimension}`;
  }

  async embed(texts: ReadonlyArray<string>, options: EmbeddingOptions = {}): Promise<Float32Array[]> {
    const vectors: Float32Array[] = [];
    for (const text of texts) {
      assertNotAborted(options.signal);
      vectors.push(this.vector(text));
    }
    return vectors;
  }

  /** 单条文本 → 归一化向量（同步，便于测试）。 */
  vector(text: string): Float32Array {
    const vector = new Float32Array(this.dimension);
    let tokens = ftsTokens(text);
    if (tokens.length === 0) tokens = ['_empty'];
    for (const token of tokens) {
      const hash = fnv1a(token);
      const index = hash % this.dimension;
      const sign = ((hash >>> 16) & 1) === 0 ? 1 : -1;
      vector[index] = (vector[index] ?? 0) + sign;
    }
    let norm = 0;
    for (let index = 0; index < vector.length; index += 1) norm += (vector[index] ?? 0) ** 2;
    norm = Math.sqrt(norm);
    if (norm === 0) {
      vector[0] = 1;
      return vector;
    }
    for (let index = 0; index < vector.length; index += 1) vector[index] = (vector[index] ?? 0) / norm;
    return vector;
  }
}

/** 余弦相似度；输入应为归一化向量时等价于点积（仍做通用归一化兜底）。 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error(`向量维度不一致：${a.length} vs ${b.length}`);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
