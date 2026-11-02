/**
 * 真实 ONNX embedding 测试（Node）：加载本地模型 → 384 维归一化向量 → 语义相似度/缓存/截断。
 * 模型或依赖缺失时整组 skip（不伪造结果）。
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cosineSimilarity } from '../embedding.js';
import { OnnxEmbeddingProvider, prepareOnnxModel } from './embedding.js';

const modelDir =
  process.env.SHUDENG_SEMANTIC_MODEL_DIR ?? resolve(process.cwd(), '../../ios/Shudeng/Resources/SemanticModel');
const cacheDir = resolve(process.cwd(), 'node_modules/.cache/shudeng-semantic-model');
const available =
  existsSync(join(modelDir, 'model.onnx.gz')) && existsSync(join(modelDir, 'tokenizer.json'));

const suite = available ? describe : describe.skip;

suite('OnnxEmbeddingProvider（真实 MiniLM int8 ONNX）', () => {
  let provider: OnnxEmbeddingProvider;

  beforeAll(async () => {
    provider = await OnnxEmbeddingProvider.create({ modelDir, cacheDir });
  }, 180_000);

  afterAll(async () => {
    await provider?.dispose();
  });

  it(
    '加载本地模型：384 维、modelId 来自 manifest.vector_space',
    async () => {
      expect(provider.dimension).toBe(384);
      expect(provider.modelId).toContain('minilm');
      const [vector] = await provider.embed(['灯把书页照亮。']);
      expect(vector).toBeInstanceOf(Float32Array);
      expect(vector).toHaveLength(384);
      const norm = Math.sqrt([...vector!].reduce((sum, value) => sum + value * value, 0));
      expect(norm).toBeCloseTo(1, 5);
    },
    120_000,
  );

  it(
    '中文/跨语言语义相似度：同义翻译 > 无关句，且确定性可复现',
    async () => {
      const [zh, en, unrelated, zhAgain] = await provider.embed([
        '灯把书页照亮，也把问题留在纸上。',
        'The lamp lights the page and leaves the question on paper.',
        '月亮挂在窗外，河流安静地流。',
        '灯把书页照亮，也把问题留在纸上。',
      ]);
      const zhEn = cosineSimilarity(zh!, en!);
      const zhUnrelated = cosineSimilarity(zh!, unrelated!);
      expect(zhEn).toBeGreaterThan(0.6);
      expect(zhEn).toBeGreaterThan(zhUnrelated + 0.2);
      expect([...zh!]).toEqual([...zhAgain!]);
    },
    120_000,
  );

  it(
    '超过 128 token 的文本截断后仍返回合法归一化向量',
    async () => {
      const longText = '灯把书页照亮，也把问题留在纸上。'.repeat(300);
      const [vector] = await provider.embed([longText]);
      expect(vector).toHaveLength(384);
      const norm = Math.sqrt([...vector!].reduce((sum, value) => sum + value * value, 0));
      expect(norm).toBeCloseTo(1, 5);
    },
    120_000,
  );

  it(
    'tokenizer 基线：中文/英文 fixture 均为 17 tokens、首 0 尾 2（与 Expo 端对照）',
    () => {
      const zh = provider.tokenize('灯把书页照亮，也把问题留在纸上。');
      expect(zh.ids).toHaveLength(17);
      expect(zh.ids[0]).toBe(0);
      expect(zh.ids[zh.ids.length - 1]).toBe(2);
      expect(zh.tokens[0]).toBe('<s>');
      expect(zh.tokens[zh.tokens.length - 1]).toBe('</s>');

      const en = provider.tokenize('The lamp lights the page and leaves the question on the paper.');
      expect(en.ids).toHaveLength(17);
      expect(en.ids[0]).toBe(0);
      expect(en.ids[en.ids.length - 1]).toBe(2);
    },
    120_000,
  );

  it(
    '解压缓存：第二次命中缓存，sha256/大小与 manifest 一致',
    async () => {
      const first = await prepareOnnxModel({ modelDir, cacheDir });
      expect(first.sha256).toHaveLength(64);
      expect(first.uncompressedBytes).toBeGreaterThan(100 * 1024 * 1024);
      const second = await prepareOnnxModel({ modelDir, cacheDir });
      expect(second.fromCache).toBe(true);
      expect(second.sha256).toBe(first.sha256);
      expect(existsSync(join(cacheDir, 'model.onnx'))).toBe(true);
    },
    120_000,
  );

  it(
    'metrics 记录真实 embedding 文本数与耗时',
    async () => {
      const before = provider.metricsSnapshot();
      await provider.embed(['阅读不是把答案抄下来。', '书页记录作者写下的句子。']);
      const after = provider.metricsSnapshot();
      expect(after.embeddedTexts).toBe(before.embeddedTexts + 2);
      expect(after.totalEmbedMs).toBeGreaterThan(0);
    },
    120_000,
  );
});
