import type { EmbeddingProvider } from '@shudeng/core/rag';

/** 与 iOS/Node 共用的向量空间标识（manifest.vector_space）。 */
export const EMBEDDING_MODEL_ID = 'minilm-e8f8c211-arm64-int8-128-mean-l2-v1';
export const EMBEDDING_DIMENSION = 384;
/** 含 specials 的最大 token 数；超限保留前 127 + eos。 */
export const EMBEDDING_MAX_TOKENS = 128;

export type EmbeddingStatus =
  | {
      readonly available: true;
      readonly modelId: string;
      readonly dimension: number;
      readonly modelDirectory: string;
      readonly fileBytes: number;
    }
  | {
      readonly available: false;
      readonly modelId: string;
      readonly dimension: number;
      readonly modelDirectory: string;
      readonly reason: string;
    };

export interface EmbeddingDiagnostics {
  readonly runtime: 'onnxruntime-react-native';
  readonly modelId: string;
  readonly dimension: number;
  /** 首次创建 session 的耗时（ms）；未加载为 null。 */
  readonly sessionLoadMs: number | null;
  /** tokenizer JSON 解析 + 首次构造耗时（ms）。 */
  readonly tokenizerLoadMs: number | null;
  /** 最近一次单条 embed 耗时（ms）。 */
  readonly lastEmbedMs: number | null;
  readonly lastTokenCount: number | null;
  /** 最近一次输出向量的 L2 范数（应接近 1）。 */
  readonly lastNorm: number | null;
}

export interface ExpoEmbeddingProvider extends EmbeddingProvider {
  readonly runtime: 'onnxruntime-react-native';
  diagnostics(): Promise<EmbeddingDiagnostics>;
}

export class EmbeddingUnavailableError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = 'EmbeddingUnavailableError';
    this.reason = reason;
  }
}
