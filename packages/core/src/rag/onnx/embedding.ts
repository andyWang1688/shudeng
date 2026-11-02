/**
 * Node 侧真实 Embedding：本地 MiniLM int8 ONNX（与 iOS App 同一份模型文件）。
 *
 * 重要：该文件依赖 Node 专属模块（fs/zlib/crypto/onnxruntime-node），只通过
 * `@shudeng/core/rag/onnx` 子路径导出，不进入 `packages/core/src/rag/index.ts`
 * 主入口（移动端/Web bundle 不应 import 它；Expo 侧后续用 onnxruntime-react-native 适配）。
 *
 * 模型来源（不提交、不修改）：`ios/Shudeng/Resources/SemanticModel`
 * - model.onnx.gz → 流式解压到 cache（默认 node_modules/.cache），校验 manifest 的 sha256；
 * - tokenizer.json / tokenizer_config.json → @huggingface/tokenizers（纯 JS，Unigram/XLMRoberta）；
 * - max 128 tokens（含 special）、mean pooling（含 special tokens）、L2 归一化、384 维；
 * - 复用 0002 的 rag_chunk_vectors（modelId = manifest.vector_space）。
 */
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { Tokenizer } from '@huggingface/tokenizers';
import * as ort from 'onnxruntime-node';
import { assertNotAborted, type EmbeddingOptions, type EmbeddingProvider } from '../types.js';

export interface OnnxModelManifest {
  model: string;
  revision?: string;
  dimension: number;
  vector_space?: string;
  max_window_tokens_including_specials?: number;
  pooling?: string;
  uncompressed_model?: { sha256?: string; bytes?: number };
  [key: string]: unknown;
}

export interface OnnxEmbeddingProviderOptions {
  /** 包含 model.onnx.gz / tokenizer.json / tokenizer_config.json / manifest.json 的目录。 */
  modelDir: string;
  /** 解压缓存目录；默认 <cwd>/node_modules/.cache/shudeng-semantic-model。 */
  cacheDir?: string;
  /** 覆盖模型最大 token 数（默认 manifest 的 128）。 */
  maxTokens?: number;
  /** ORT intra-op 线程数（默认 2，与 iOS 一致）。 */
  intraOpThreads?: number;
  /** 校验解压后模型 sha256（默认 true）。 */
  verifySha256?: boolean;
}

export interface OnnxModelCacheInfo {
  modelPath: string;
  sha256: string;
  uncompressedBytes: number;
  fromCache: boolean;
}

export interface OnnxEmbeddingMetrics {
  embeddedTexts: number;
  lastEmbedMs: number;
  totalEmbedMs: number;
}

function defaultCacheDir(): string {
  return join(process.cwd(), 'node_modules', '.cache', 'shudeng-semantic-model');
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk: string | Buffer) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** 流式解压 model.onnx.gz → cache，并用 manifest sha256 校验（失败抛错，不写坏缓存）。 */
export async function prepareOnnxModel(
  options: Pick<OnnxEmbeddingProviderOptions, 'modelDir' | 'cacheDir' | 'verifySha256'>,
): Promise<OnnxModelCacheInfo> {
  const modelDir = options.modelDir;
  const cacheDir = options.cacheDir ?? defaultCacheDir();
  const manifestPath = join(modelDir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`ONNX 模型 manifest 不存在：${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as OnnxModelManifest;
  const expectedSha = manifest.uncompressed_model?.sha256;
  const gzPath = join(modelDir, 'model.onnx.gz');
  const modelPath = join(cacheDir, 'model.onnx');
  const metaPath = join(cacheDir, 'model.meta.json');
  mkdirSync(cacheDir, { recursive: true });
  const verify = options.verifySha256 !== false;

  // 缓存命中：meta 存在、文件大小对、sha 对（或调用方关闭校验）。
  if (existsSync(modelPath) && existsSync(metaPath) && existsSync(gzPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
        sha256?: string;
        bytes?: number;
        sourceSize?: number;
        sourceMtimeMs?: number;
      };
      const gzStat = statSync(gzPath);
      const sourceMatches =
        meta.sourceSize === undefined ||
        meta.sourceMtimeMs === undefined ||
        (meta.sourceSize === gzStat.size && meta.sourceMtimeMs === gzStat.mtimeMs);
      if (!sourceMatches) throw new Error('模型压缩包已变化，重新解压');
      const size = statSync(modelPath).size;
      const sizeMatches = meta.bytes === undefined || size === meta.bytes;
      const shaMatches = !verify || !expectedSha || meta.sha256 === expectedSha;
      if (sizeMatches && shaMatches && (meta.sha256 || !verify)) {
        const cachedSha = meta.sha256 ?? (verify ? await sha256File(modelPath) : 'unverified');
        if (!verify || !expectedSha || cachedSha === expectedSha) {
          return { modelPath, sha256: cachedSha, uncompressedBytes: size, fromCache: true };
        }
      }
    } catch {
      // meta 损坏 → 重新解压
    }
  }

  if (!existsSync(gzPath)) throw new Error(`ONNX 模型压缩包不存在：${gzPath}`);
  const tempPath = `${modelPath}.tmp-${Date.now()}`;
  let bytes = 0;
  const hasher = createHash('sha256');
  const hashTransform = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      hasher.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(createReadStream(gzPath), createGunzip(), hashTransform, createWriteStream(tempPath));
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
  const sha = hasher.digest('hex');
  if (verify && expectedSha && sha !== expectedSha) {
    rmSync(tempPath, { force: true });
    throw new Error(`ONNX 模型 sha256 校验失败：${sha} != ${expectedSha}`);
  }
  if (manifest.uncompressed_model?.bytes !== undefined && bytes !== manifest.uncompressed_model.bytes) {
    rmSync(tempPath, { force: true });
    throw new Error(`ONNX 模型大小校验失败：${bytes} != ${manifest.uncompressed_model.bytes}`);
  }
  renameSync(tempPath, modelPath);
  const gzStat = statSync(gzPath);
  writeFileSync(
    metaPath,
    JSON.stringify({
      sha256: sha,
      bytes,
      source: gzPath,
      sourceSize: gzStat.size,
      sourceMtimeMs: gzStat.mtimeMs,
      createdAt: Date.now(),
    }),
  );
  return { modelPath, sha256: sha, uncompressedBytes: bytes, fromCache: false };
}

function resolveEosTokenId(tokenizer: Tokenizer, tokenizerConfig: Record<string, unknown>): number | undefined {
  const eosToken = typeof tokenizerConfig.eos_token === 'string' ? tokenizerConfig.eos_token : '</s>';
  const id = tokenizer.token_to_id(eosToken);
  return typeof id === 'number' ? id : undefined;
}

export class OnnxEmbeddingProvider implements EmbeddingProvider {
  readonly dimension: number;
  readonly modelId: string;
  private readonly session: ort.InferenceSession;
  private readonly tokenizer: Tokenizer;
  private readonly maxTokens: number;
  private readonly eosTokenId: number | undefined;
  private readonly metrics: OnnxEmbeddingMetrics = { embeddedTexts: 0, lastEmbedMs: 0, totalEmbedMs: 0 };

  private constructor(
    session: ort.InferenceSession,
    tokenizer: Tokenizer,
    manifest: OnnxModelManifest,
    maxTokens: number,
    eosTokenId: number | undefined,
  ) {
    this.session = session;
    this.tokenizer = tokenizer;
    this.dimension = manifest.dimension;
    this.modelId = typeof manifest.vector_space === 'string' ? manifest.vector_space : `onnx:${manifest.model}`;
    this.maxTokens = maxTokens;
    this.eosTokenId = eosTokenId;
  }

  /** 加载/解压模型 + tokenizer + ORT session（异步工厂）。 */
  static async create(options: OnnxEmbeddingProviderOptions): Promise<OnnxEmbeddingProvider> {
    const modelDir = options.modelDir;
    const manifestPath = join(modelDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as OnnxModelManifest;
    if (!Number.isInteger(manifest.dimension) || manifest.dimension <= 0) {
      throw new Error('manifest.dimension 无效');
    }
    const cache = await prepareOnnxModel(options);
    const tokenizerJson = JSON.parse(readFileSync(join(modelDir, 'tokenizer.json'), 'utf8')) as object;
    const tokenizerConfig = JSON.parse(
      readFileSync(join(modelDir, 'tokenizer_config.json'), 'utf8'),
    ) as Record<string, unknown>;
    const tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig);
    const session = await ort.InferenceSession.create(cache.modelPath, {
      executionProviders: ['cpu'],
      intraOpNumThreads: options.intraOpThreads ?? 2,
      interOpNumThreads: 1,
    });
    const maxTokens = Math.max(
      2,
      Math.min(options.maxTokens ?? manifest.max_window_tokens_including_specials ?? 128, 512),
    );
    return new OnnxEmbeddingProvider(session, tokenizer, manifest, maxTokens, resolveEosTokenId(tokenizer, tokenizerConfig));
  }

  /** 跨端 tokenizer 对齐/基线生成用：与 embed 相同的 add_special_tokens=true 编码（未截断）。 */
  tokenize(text: string): { ids: number[]; tokens: string[] } {
    const encoding = this.tokenizer.encode(text, { add_special_tokens: true });
    return { ids: [...encoding.ids], tokens: [...encoding.tokens] };
  }

  metricsSnapshot(): OnnxEmbeddingMetrics {
    return { ...this.metrics };
  }

  async embed(texts: ReadonlyArray<string>, options: EmbeddingOptions = {}): Promise<Float32Array[]> {
    const startedAt = Date.now();
    const vectors: Float32Array[] = [];
    for (const text of texts) {
      assertNotAborted(options.signal);
      vectors.push(await this.embedOne(text));
    }
    this.metrics.lastEmbedMs = Date.now() - startedAt;
    this.metrics.totalEmbedMs += this.metrics.lastEmbedMs;
    this.metrics.embeddedTexts += texts.length;
    return vectors;
  }

  private async embedOne(text: string): Promise<Float32Array> {
    const encoding = this.tokenizer.encode(text, { add_special_tokens: true });
    let ids = encoding.ids;
    if (ids.length > this.maxTokens) {
      ids = ids.slice(0, this.maxTokens - 1);
      if (this.eosTokenId !== undefined) ids.push(this.eosTokenId);
    }
    if (ids.length === 0) {
      ids = [this.eosTokenId ?? 0];
    }
    const sequenceLength = ids.length;
    const attention = ids.map(() => 1);
    const feeds: Record<string, ort.Tensor> = {
      input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map((id) => BigInt(id))), [1, sequenceLength]),
      attention_mask: new ort.Tensor(
        'int64',
        BigInt64Array.from(attention.map((value) => BigInt(value))),
        [1, sequenceLength],
      ),
    };
    if (this.session.inputNames.includes('token_type_ids')) {
      feeds.token_type_ids = new ort.Tensor(
        'int64',
        new BigInt64Array(sequenceLength),
        [1, sequenceLength],
      );
    }
    const output = await this.session.run(feeds);
    const first = output[this.session.outputNames[0] ?? 'last_hidden_state'];
    if (!first) throw new Error('ONNX 输出为空');
    const dims = first.dims;
    if (dims.length !== 3 || dims[2] !== this.dimension) {
      throw new Error(`ONNX 输出维度异常：${dims.join('x')}，期望 [1, seq, ${this.dimension}]`);
    }
    const sequence = dims[1] ?? 0;
    const data = first.data as Float32Array;
    if (data.length !== sequence * this.dimension) throw new Error('ONNX 输出数据长度与维度不一致');
    const vector = new Float32Array(this.dimension);
    let count = 0;
    for (let token = 0; token < sequence; token += 1) {
      if (!attention[token]) continue;
      count += 1;
      for (let dim = 0; dim < this.dimension; dim += 1) {
        vector[dim] = (vector[dim] ?? 0) + (data[token * this.dimension + dim] ?? 0);
      }
    }
    if (count === 0) throw new Error('没有有效 token，无法计算 embedding');
    let norm = 0;
    for (let dim = 0; dim < this.dimension; dim += 1) {
      vector[dim] = (vector[dim] ?? 0) / count;
      norm += (vector[dim] ?? 0) ** 2;
    }
    norm = Math.sqrt(norm);
    if (norm === 0) throw new Error('embedding 归一化失败（零向量）');
    for (let dim = 0; dim < this.dimension; dim += 1) vector[dim] = (vector[dim] ?? 0) / norm;
    return vector;
  }

  async dispose(): Promise<void> {
    const releasable = this.session as unknown as { release?: () => Promise<void> | void };
    await releasable.release?.();
  }
}
