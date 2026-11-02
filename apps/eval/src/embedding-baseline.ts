/**
 * 跨端 embedding 对照基线（Node 参考向量）：
 * 与 `OnnxEmbeddingProvider` 完全相同的模型/tokenizer/预处理，输出 384 维 Float32 向量，
 * 供 Expo/Hermes 端（apps/mobile/src/platform/embedding.native.ts）做 cosine 一致性校验。
 *
 * 运行：
 *   pnpm --filter @shudeng/eval exec tsx src/embedding-baseline.ts            # stdout
 *   pnpm --filter @shudeng/eval exec tsx src/embedding-baseline.ts --out <file.json>
 *
 * 输出字段：modelId/dimension/manifestSha256/addSpecialTokens/truncation + sentences[]
 * （tokenIds 完整编码、vector 数组、vectorBase64 = little-endian Float32）。
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cosineSimilarity } from '@shudeng/core/rag';
import { OnnxEmbeddingProvider, prepareOnnxModel } from '@shudeng/core/rag/onnx';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const modelDir =
  process.env.SHUDENG_SEMANTIC_MODEL_DIR ?? join(repoRoot, 'ios/Shudeng/Resources/SemanticModel');
const cacheDir = resolve(repoRoot, 'node_modules/.cache/shudeng-semantic-model');

const outIndex = process.argv.indexOf('--out');
const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;

const sentences = [
  { id: 'zh-lamp', text: '灯把书页照亮，也把问题留在纸上。' },
  { id: 'en-lamp', text: 'The lamp lights the page and leaves the question on the paper.' },
];

function toBase64(vector: Float32Array): string {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString('base64');
}

function norm(vector: Float32Array): number {
  let sum = 0;
  for (const value of vector) sum += value * value;
  return Math.sqrt(sum);
}

async function main(): Promise<void> {
  const provider = await OnnxEmbeddingProvider.create({ modelDir, cacheDir });
  try {
    const cache = await prepareOnnxModel({ modelDir, cacheDir });
    const vectors = await provider.embed(sentences.map((sentence) => sentence.text));
    const entries = sentences.map((sentence, index) => {
      const encoding = provider.tokenize(sentence.text);
      const vector = vectors[index]!;
      return {
        id: sentence.id,
        text: sentence.text,
        tokenCount: encoding.ids.length,
        tokenIds: encoding.ids,
        tokensPreview: encoding.tokens.slice(0, 8),
        firstTokenId: encoding.ids[0],
        lastTokenId: encoding.ids[encoding.ids.length - 1],
        norm: Number(norm(vector).toFixed(8)),
        vector: Array.from(vector),
        vectorBase64: toBase64(vector),
      };
    });
    const baseline = {
      schema: 'shudeng-embedding-baseline-v1',
      generatedAt: new Date().toISOString(),
      runtime: `node ${process.version} / onnxruntime-node`,
      platform: `${process.platform}-${process.arch}`,
      modelId: provider.modelId,
      dimension: provider.dimension,
      addSpecialTokens: true,
      truncation: 'ids.length > 128 时：保留前 127 个 id，再追加 eos（</s>, id=2）',
      manifestSha256: cache.sha256,
      embeddingMetrics: provider.metricsSnapshot(),
      pairCosineZhEn: cosineSimilarity(vectors[0]!, vectors[1]!),
      sentences: entries,
    };
    const json = JSON.stringify(baseline, null, 2);
    if (outPath) {
      writeFileSync(outPath, `${json}\n`);
      console.log(`基线已写入：${outPath}`);
    } else {
      console.log(json);
    }
    console.log(
      `modelId=${baseline.modelId} dim=${baseline.dimension} zhTokens=${entries[0]!.tokenCount} enTokens=${entries[1]!.tokenCount} cos(zh,en)=${baseline.pairCosineZhEn.toFixed(6)}`,
    );
  } finally {
    await provider.dispose();
  }
}

void main();
