/**
 * Expo/RN 端侧 MiniLM embedding（onnxruntime-react-native + @huggingface/tokenizers）。
 *
 * 模型不提交仓库：把 ios/Shudeng/Resources/SemanticModel 解压后放到 App Documents/SemanticModel/
 * （model.onnx + tokenizer.json + tokenizer_config.json），或用 EXPO_PUBLIC_SHUDENG_SEMANTIC_MODEL_DIR
 * 指向已解压目录。缺模型时返回明确 unavailable stub，不伪造向量。
 */
import { Directory, File, Paths } from 'expo-file-system';
import { Tokenizer } from '@huggingface/tokenizers';
import { InferenceSession, Tensor } from 'onnxruntime-react-native';
import type { EmbeddingOptions } from '@shudeng/core/rag';
import {
  EMBEDDING_DIMENSION,
  EMBEDDING_MAX_TOKENS,
  EMBEDDING_MODEL_ID,
  EmbeddingUnavailableError,
  type EmbeddingDiagnostics,
  type EmbeddingStatus,
  type ExpoEmbeddingProvider,
} from './embeddingShared';
import { parseReferenceBundle, compareEmbeddings, type ActualEmbedding, type ReferenceComparison } from './embeddingCompare';
import { l2Norm, meanPoolAndNormalize, truncateTokenIds } from './embeddingMath';

const MODEL_FILE = 'model.onnx';
const TOKENIZER_FILE = 'tokenizer.json';
const TOKENIZER_CONFIG_FILE = 'tokenizer_config.json';

type LoadedTokenizer = { readonly tokenizer: Tokenizer; readonly loadMs: number };

let tokenizerPromise: Promise<LoadedTokenizer> | null = null;
let sessionPromise: Promise<{ session: InferenceSession; loadMs: number }> | null = null;
let lastEmbedMs: number | null = null;
let lastTokenCount: number | null = null;
let lastNorm: number | null = null;

function modelDirectory(): Directory {
  const configured = process.env.EXPO_PUBLIC_SHUDENG_SEMANTIC_MODEL_DIR;
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return new Directory(configured.trim());
  }
  return new Directory(Paths.document, 'SemanticModel');
}

function requiredFiles(directory: Directory): { model: File; tokenizer: File; tokenizerConfig: File } {
  return {
    model: new File(directory, MODEL_FILE),
    tokenizer: new File(directory, TOKENIZER_FILE),
    tokenizerConfig: new File(directory, TOKENIZER_CONFIG_FILE),
  };
}

function missingReason(directory: Directory, files: ReturnType<typeof requiredFiles>): string {
  const missing: string[] = [];
  if (!files.model.exists) missing.push(`${MODEL_FILE}（需预先解压 gz）`);
  if (!files.tokenizer.exists) missing.push(TOKENIZER_FILE);
  if (!files.tokenizerConfig.exists) missing.push(TOKENIZER_CONFIG_FILE);
  return missing.length > 0
    ? `模型未放置：${directory.uri} 缺少 ${missing.join(', ')}`
    : '';
}

export async function embeddingStatus(): Promise<EmbeddingStatus> {
  const directory = modelDirectory();
  const files = requiredFiles(directory);
  const reason = missingReason(directory, files);
  if (reason) {
    return {
      available: false,
      modelId: EMBEDDING_MODEL_ID,
      dimension: EMBEDDING_DIMENSION,
      modelDirectory: directory.uri,
      reason,
    };
  }
  return {
    available: true,
    modelId: EMBEDDING_MODEL_ID,
    dimension: EMBEDDING_DIMENSION,
    modelDirectory: directory.uri,
    fileBytes: files.model.info().size ?? 0,
  };
}

function toNativePath(uri: string): string {
  if (uri.startsWith('file://')) {
    try {
      return decodeURIComponent(uri.slice('file://'.length));
    } catch {
      return uri.slice('file://'.length);
    }
  }
  return uri;
}

async function loadTokenizer(): Promise<LoadedTokenizer> {
  tokenizerPromise ??= (async () => {
    const directory = modelDirectory();
    const files = requiredFiles(directory);
    const reason = missingReason(directory, files);
    if (reason) throw new EmbeddingUnavailableError(reason);
    const startedAt = Date.now();
    const tokenizerJson = JSON.parse(await files.tokenizer.text()) as object;
    const tokenizerConfig = files.tokenizerConfig.exists
      ? (JSON.parse(await files.tokenizerConfig.text()) as object)
      : {};
    return { tokenizer: new Tokenizer(tokenizerJson, tokenizerConfig), loadMs: Date.now() - startedAt };
  })();
  return tokenizerPromise;
}

async function loadSession(): Promise<{ session: InferenceSession; loadMs: number }> {
  sessionPromise ??= (async () => {
    const directory = modelDirectory();
    const files = requiredFiles(directory);
    const reason = missingReason(directory, files);
    if (reason) throw new EmbeddingUnavailableError(reason);
    const startedAt = Date.now();
    const modelPath = toNativePath(files.model.uri);
    const session = await InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    });
    return { session, loadMs: Date.now() - startedAt };
  })();
  return sessionPromise;
}

function encode(text: string, tokenizer: Tokenizer): { ids: number[]; tokenCount: number } {
  const encoding = tokenizer.encode(text, { add_special_tokens: true });
  if (encoding.ids.length > EMBEDDING_MAX_TOKENS) {
    // 防 tokenizer 行为变化时静默把内容 token 当 eos：截断前最后一位必须是 </s>。
    const eosId = tokenizer.token_to_id('</s>');
    if (eosId === undefined || encoding.ids[encoding.ids.length - 1] !== eosId) {
      throw new Error(`截断前文本未以 eos 结尾（tokenizer 行为变化？最后 id=${String(encoding.ids[encoding.ids.length - 1])}）`);
    }
  }
  const ids = truncateTokenIds(encoding.ids);
  lastTokenCount = ids.length;
  return { ids, tokenCount: ids.length };
}

function int64Tensor(values: readonly number[]): Tensor {
  return new Tensor('int64', BigInt64Array.from(values, (value) => BigInt(value)), [1, values.length]);
}

export function createExpoEmbeddingProvider(): ExpoEmbeddingProvider {
  return {
    runtime: 'onnxruntime-react-native',
    modelId: EMBEDDING_MODEL_ID,
    dimension: EMBEDDING_DIMENSION,
    async embed(texts: ReadonlyArray<string>, options?: EmbeddingOptions): Promise<Float32Array[]> {
      const signal = options?.signal;
      if (signal?.aborted) throw Object.assign(new Error('embedding 已取消'), { name: 'AbortError' });
      const [{ tokenizer }, { session }] = await Promise.all([loadTokenizer(), loadSession()]);
      const results: Float32Array[] = [];
      const inputNames = new Set(session.inputNames);
      for (const text of texts) {
        if (signal?.aborted) throw Object.assign(new Error('embedding 已取消'), { name: 'AbortError' });
        const startedAt = Date.now();
        const { ids } = encode(text, tokenizer);
        const feeds: Record<string, Tensor> = {
          input_ids: int64Tensor(ids),
          attention_mask: int64Tensor(new Array<number>(ids.length).fill(1)),
        };
        if (inputNames.has('token_type_ids')) {
          feeds.token_type_ids = int64Tensor(new Array<number>(ids.length).fill(0));
        }
        const outputs = await session.run(feeds);
        const outputName = session.outputNames[0];
        const output = outputName === undefined ? undefined : outputs[outputName];
        if (!output || !(output.data instanceof Float32Array)) {
          throw new Error('ONNX 输出 last_hidden_state 缺失或不是 Float32Array');
        }
        const dims = output.dims;
        const sequenceLength = dims.length >= 3 ? dims[1] : ids.length;
        const hidden = dims.length >= 3 ? dims[2] : EMBEDDING_DIMENSION;
        if (sequenceLength === undefined || hidden === undefined || hidden !== EMBEDDING_DIMENSION) {
          throw new Error(`ONNX 输出维度异常：${JSON.stringify(dims)}（期望 [1,seq,${EMBEDDING_DIMENSION}]）`);
        }
        const pooled = meanPoolAndNormalize(output.data, sequenceLength, hidden);
        lastEmbedMs = Date.now() - startedAt;
        lastNorm = l2Norm(pooled);
        results.push(pooled);
      }
      return results;
    },
    async diagnostics(): Promise<EmbeddingDiagnostics> {
      return {
        runtime: 'onnxruntime-react-native',
        modelId: EMBEDDING_MODEL_ID,
        dimension: EMBEDDING_DIMENSION,
        sessionLoadMs: sessionPromise === null ? null : (await sessionPromise).loadMs,
        tokenizerLoadMs: tokenizerPromise === null ? null : (await tokenizerPromise).loadMs,
        lastEmbedMs,
        lastTokenCount,
        lastNorm,
      };
    },
  };
}

let provider: ExpoEmbeddingProvider | null = null;

export function getEmbeddingProvider(): ExpoEmbeddingProvider {
  provider ??= createExpoEmbeddingProvider();
  return provider;
}

/**
 * 与 Node 基线向量对照（需真机/模拟器 dev build；模型与参考 JSON 已放置到 App Documents）：
 * - 逐句先比 tokenIds（Hermes tokenizer 冒烟），再算 cosine/maxAbsDiff/meanAbsDiff；
 * - 参考文件默认 Paths.document/embedding-reference.json，可用 EXPO_PUBLIC_SHUDENG_EMBEDDING_REFERENCE 覆盖。
 */
export async function runEmbeddingReferenceCheck(
  referencePath?: string,
  options?: { readonly cosineThreshold?: number },
): Promise<ReferenceComparison> {
  const configured = process.env.EXPO_PUBLIC_SHUDENG_EMBEDDING_REFERENCE;
  const file = referencePath
    ? new File(referencePath)
    : typeof configured === 'string' && configured.trim().length > 0
      ? new File(configured.trim())
      : new File(Paths.document, 'embedding-reference.json');
  if (!file.exists) throw new EmbeddingUnavailableError(`参考向量不存在：${file.uri}`);
  const bundle = parseReferenceBundle(JSON.parse(await file.text()) as unknown);
  if (bundle.modelId !== EMBEDDING_MODEL_ID || bundle.dimension !== EMBEDDING_DIMENSION) {
    throw new Error(`参考向量模型不匹配：${bundle.modelId} / ${bundle.dimension}`);
  }
  const [{ tokenizer }] = await Promise.all([loadTokenizer(), loadSession()]);
  const eosId = tokenizer.token_to_id('</s>');
  if (eosId !== 2) throw new Error(`tokenizer 的 </s> 不是 2（实际 ${String(eosId)}），截断基线需复核`);
  const provider = getEmbeddingProvider();
  const actuals: ActualEmbedding[] = [];
  for (const sentence of bundle.sentences) {
    const encoding = tokenizer.encode(sentence.text, { add_special_tokens: true });
    const tokenIds = truncateTokenIds(encoding.ids);
    const vectors = await provider.embed([sentence.text]);
    const vector = vectors[0];
    if (!vector) throw new Error(`embed 未返回向量：${sentence.id}`);
    actuals.push({ id: sentence.id, tokenIds, vector });
  }
  return compareEmbeddings(actuals, bundle, options ?? {});
}

export { EmbeddingUnavailableError } from './embeddingShared';
