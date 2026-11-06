import { embeddingChunkOptions, ParagraphTextChunker } from './chunker.js';
import { assertNotAborted, type CancellationSignal, type EmbeddingProvider } from './types.js';

const QUERY_EMBEDDING_BATCH_SIZE = 8;

/** 超长问题按实际 tokenizer 分段并平均；新索引与只读旧索引使用同一规则。 */
export async function embedSearchQuery(embedding: EmbeddingProvider, query: string, signal?: CancellationSignal): Promise<Float32Array> {
  assertNotAborted(signal);
  await embedding.prepare?.();
  assertNotAborted(signal);
  if (!Number.isSafeInteger(embedding.dimension) || embedding.dimension < 1) throw new Error('查询向量维度无效');
  const budget = embedding.maxInputTokens;
  if (budget !== undefined && (!Number.isSafeInteger(budget) || budget < 1)) throw new Error('查询向量 token 预算必须为正整数');
  if (budget !== undefined && !embedding.countTokens) throw new Error('查询向量模型缺少 tokenizer，无法保证输入不被截断');
  let inputs = [query];
  const countTokens = embedding.countTokens?.bind(embedding);
  const tokenCount = (text: string): number => {
    const count = countTokens!(text);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('tokenizer 返回了无效的 token 数');
    return count;
  };
  if (budget !== undefined && tokenCount(query) > budget) {
    // Character ranges retain the complete query content; only outer whitespace is trimmed by the chunker.
    inputs = new ParagraphTextChunker().chunk({
      book: { id: 'query', title: '', format: 'epub', sourceHash: '' },
      chapters: [{ ordinal: 1, title: '', text: query }],
    }, embeddingChunkOptions(embedding, { maxChars: query.length }), signal ? { signal } : {}).map(chunk => chunk.text);
  }
  assertNotAborted(signal);
  if (!inputs.length) throw new Error('查询文本无法在模型 token 预算内切块');
  // Accumulate outside Float32 to avoid underflow while averaging many small vectors.
  const sum = new Float64Array(embedding.dimension);
  for (let start = 0; start < inputs.length; start += QUERY_EMBEDDING_BATCH_SIZE) {
    assertNotAborted(signal);
    const batch = inputs.slice(start, start + QUERY_EMBEDDING_BATCH_SIZE);
    if (budget !== undefined && batch.some(text => tokenCount(text) > budget)) throw new Error('查询切片超过语义模型的 token 预算');
    assertNotAborted(signal);
    const vectors = await embedding.embed(batch, signal ? { signal } : {});
    assertNotAborted(signal);
    if (vectors.length !== batch.length) throw new Error('查询向量数量不一致');
    for (const vector of vectors) {
      if (vector.length !== sum.length || !vector.every(Number.isFinite)) throw new Error('查询向量内容无效');
      for (let index = 0; index < vector.length; index += 1) sum[index] = sum[index]! + vector[index]!;
    }
  }
  // Normalizing the sum is identical to normalizing the arithmetic mean.
  const norm = Math.sqrt(sum.reduce((total, value) => total + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) throw new Error('查询向量为零或无效');
  const result = Float32Array.from(sum, value => value / norm);
  assertNotAborted(signal);
  return result;
}
