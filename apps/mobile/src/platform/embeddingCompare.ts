/** Expo embedding 与 Node 基线向量的对照（纯函数，无 RN 依赖）。 */
import { l2Norm } from './embeddingMath';

export interface ReferenceSentence {
  readonly id: string;
  readonly text: string;
  readonly tokenIds: ReadonlyArray<number>;
  readonly vector: ReadonlyArray<number>;
  /** 截断前的原始 token 数（新基线有）。 */
  readonly rawTokenCount?: number;
  /** 该句是否走截断分支（新基线有）。 */
  readonly truncated?: boolean;
  /** 实际参与 embedding 的 token 数（新基线 tokenCount）。 */
  readonly tokenCount?: number;
}

export interface ReferenceBundle {
  readonly schema?: number;
  readonly modelId: string;
  readonly dimension: number;
  readonly addSpecialTokens: boolean;
  readonly truncation?: string;
  readonly manifestSha256?: string;
  readonly pairCosineZhEn?: number;
  readonly sentences: ReadonlyArray<ReferenceSentence>;
}

export interface ActualEmbedding {
  readonly id: string;
  readonly tokenIds: ReadonlyArray<number>;
  readonly vector: Float32Array;
}

export interface SentenceComparison {
  readonly id: string;
  readonly tokenIdsMatch: boolean;
  readonly expectedTokenIds: ReadonlyArray<number>;
  readonly actualTokenIds: ReadonlyArray<number>;
  readonly cosine: number;
  readonly maxAbsDiff: number;
  readonly meanAbsDiff: number;
  readonly expectedNorm: number;
  readonly actualNorm: number;
}

export interface ReferenceComparison {
  readonly modelId: string;
  readonly dimension: number;
  readonly sentences: ReadonlyArray<SentenceComparison>;
  readonly allTokenIdsMatch: boolean;
  readonly minCosine: number;
  readonly maxAbsDiff: number;
  readonly meanAbsDiff: number;
  /** 本次判定使用的 cosine 阈值。 */
  readonly cosineThreshold: number;
  /** tokenIds 全一致且每条 cosine > cosineThreshold。 */
  readonly passed: boolean;
}

export interface CompareOptions {
  /** 默认 0.999（同 ORT 版本的 native 参考）；用 1.31.1 Node 基线时可放宽到 0.997。 */
  readonly cosineThreshold?: number;
}

export const DEFAULT_COSINE_PASS_THRESHOLD = 0.999;

export function parseReferenceBundle(value: unknown): ReferenceBundle {
  if (typeof value !== 'object' || value === null) throw new Error('参考向量不是对象');
  const record = value as Record<string, unknown>;
  if (typeof record.modelId !== 'string') throw new Error('参考向量缺 modelId');
  if (typeof record.dimension !== 'number') throw new Error('参考向量缺 dimension');
  if (typeof record.addSpecialTokens !== 'boolean') throw new Error('参考向量缺 addSpecialTokens');
  if (!Array.isArray(record.sentences)) throw new Error('参考向量缺 sentences');
  const sentences = record.sentences.map((item, index): ReferenceSentence => {
    if (typeof item !== 'object' || item === null) throw new Error(`sentences[${index}] 不是对象`);
    const entry = item as Record<string, unknown>;
    if (typeof entry.id !== 'string' || typeof entry.text !== 'string') {
      throw new Error(`sentences[${index}] 缺 id/text`);
    }
    if (!Array.isArray(entry.tokenIds) || !entry.tokenIds.every((id) => typeof id === 'number')) {
      throw new Error(`sentences[${index}].tokenIds 非法`);
    }
    if (!Array.isArray(entry.vector) || !entry.vector.every((value) => typeof value === 'number')) {
      throw new Error(`sentences[${index}].vector 非法`);
    }
    if (entry.vector.length !== record.dimension) {
      throw new Error(`sentences[${index}].vector 长度 ${entry.vector.length} != dimension ${record.dimension}`);
    }
    return {
      id: entry.id,
      text: entry.text,
      tokenIds: entry.tokenIds as number[],
      vector: entry.vector as number[],
      ...(typeof entry.tokenCount === 'number' ? { tokenCount: entry.tokenCount } : {}),
      ...(typeof entry.rawTokenCount === 'number' ? { rawTokenCount: entry.rawTokenCount } : {}),
      ...(typeof entry.truncated === 'boolean' ? { truncated: entry.truncated } : {}),
    };
  });
  return {
    modelId: record.modelId,
    dimension: record.dimension,
    addSpecialTokens: record.addSpecialTokens,
    sentences,
    ...(typeof record.schema === 'number' ? { schema: record.schema } : {}),
    ...(typeof record.truncation === 'string' ? { truncation: record.truncation } : {}),
    ...(typeof record.manifestSha256 === 'string' ? { manifestSha256: record.manifestSha256 } : {}),
    ...(typeof record.pairCosineZhEn === 'number' ? { pairCosineZhEn: record.pairCosineZhEn } : {}),
  };
}

export function compareEmbeddings(
  actuals: ReadonlyArray<ActualEmbedding>,
  reference: ReferenceBundle,
  options: CompareOptions = {},
): ReferenceComparison {
  const cosineThreshold = options.cosineThreshold ?? DEFAULT_COSINE_PASS_THRESHOLD;
  const byId = new Map(actuals.map((actual) => [actual.id, actual]));
  const sentences = reference.sentences.map((expected): SentenceComparison => {
    const actual = byId.get(expected.id);
    if (!actual) throw new Error(`缺少实际向量：${expected.id}`);
    if (actual.vector.length !== reference.dimension) {
      throw new Error(`${expected.id} 实际向量长度 ${actual.vector.length} != ${reference.dimension}`);
    }
    return {
      id: expected.id,
      tokenIdsMatch: arraysEqual(actual.tokenIds, expected.tokenIds),
      expectedTokenIds: expected.tokenIds,
      actualTokenIds: actual.tokenIds,
      cosine: cosineSimilarity(actual.vector, expected.vector),
      expectedNorm: l2Norm(expected.vector),
      actualNorm: l2Norm(actual.vector),
      maxAbsDiff: maxAbsDiff(actual.vector, expected.vector),
      meanAbsDiff: meanAbsDiff(actual.vector, expected.vector),
    };
  });
  let diffTotal = 0;
  let diffCount = 0;
  let maxDiff = 0;
  for (const sentence of sentences) {
    maxDiff = Math.max(maxDiff, sentence.maxAbsDiff);
    diffTotal += sentence.meanAbsDiff;
    diffCount += 1;
  }
  const minCosine = sentences.reduce((min, sentence) => Math.min(min, sentence.cosine), Number.POSITIVE_INFINITY);
  const meanAbsDiffValue = diffCount === 0 ? 0 : diffTotal / diffCount;
  return {
    modelId: reference.modelId,
    dimension: reference.dimension,
    sentences,
    allTokenIdsMatch: sentences.every((sentence) => sentence.tokenIdsMatch),
    minCosine,
    maxAbsDiff: maxDiff,
    meanAbsDiff: meanAbsDiffValue,
    cosineThreshold,
    passed:
      sentences.length > 0 &&
      sentences.every((sentence) => sentence.tokenIdsMatch && sentence.cosine > cosineThreshold),
  };
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new Error(`cosine 维度不一致：${a.length} vs ${b.length}`);
  let dot = 0;
  for (let index = 0; index < a.length; index += 1) dot += (a[index] ?? 0) * (b[index] ?? 0);
  const denominator = l2Norm(a) * l2Norm(b);
  return denominator === 0 ? 0 : dot / denominator;
}

export function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new Error(`diff 维度不一致：${a.length} vs ${b.length}`);
  let maximum = 0;
  for (let index = 0; index < a.length; index += 1) {
    maximum = Math.max(maximum, Math.abs((a[index] ?? 0) - (b[index] ?? 0)));
  }
  return maximum;
}

export function meanAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new Error(`diff 维度不一致：${a.length} vs ${b.length}`);
  if (a.length === 0) return 0;
  let total = 0;
  for (let index = 0; index < a.length; index += 1) {
    total += Math.abs((a[index] ?? 0) - (b[index] ?? 0));
  }
  return total / a.length;
}

function arraysEqual(a: ReadonlyArray<number>, b: ReadonlyArray<number>): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}
