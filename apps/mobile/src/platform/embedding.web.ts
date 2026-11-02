/** Web 端显式 stub：本 spike 不接 onnxruntime-web，也不把原生模块打进 Web bundle。 */
import type { EmbeddingOptions } from '@shudeng/core/rag';
import {
  EMBEDDING_DIMENSION,
  EMBEDDING_MODEL_ID,
  EmbeddingUnavailableError,
  type EmbeddingDiagnostics,
  type EmbeddingStatus,
  type ExpoEmbeddingProvider,
} from './embeddingShared';
import type { ReferenceComparison } from './embeddingCompare';

const WEB_REASON = 'Web 端未接入 onnxruntime-web（本 spike 只验证 iOS/Android onnxruntime-react-native 打包）';

export async function embeddingStatus(): Promise<EmbeddingStatus> {
  return {
    available: false,
    modelId: EMBEDDING_MODEL_ID,
    dimension: EMBEDDING_DIMENSION,
    modelDirectory: '',
    reason: WEB_REASON,
  };
}

export function getEmbeddingProvider(): ExpoEmbeddingProvider {
  return {
    runtime: 'onnxruntime-react-native',
    modelId: EMBEDDING_MODEL_ID,
    dimension: EMBEDDING_DIMENSION,
    embed(_texts: ReadonlyArray<string>, _options?: EmbeddingOptions): Promise<Float32Array[]> {
      return Promise.reject(new EmbeddingUnavailableError(WEB_REASON));
    },
    diagnostics(): Promise<EmbeddingDiagnostics> {
      return Promise.resolve({
        runtime: 'onnxruntime-react-native',
        modelId: EMBEDDING_MODEL_ID,
        dimension: EMBEDDING_DIMENSION,
        sessionLoadMs: null,
        tokenizerLoadMs: null,
        lastEmbedMs: null,
        lastTokenCount: null,
        lastNorm: null,
      });
    },
  };
}

export async function runEmbeddingReferenceCheck(
  _referencePath?: string,
  _options?: { readonly cosineThreshold?: number },
): Promise<ReferenceComparison> {
  throw new EmbeddingUnavailableError(WEB_REASON);
}

export { EmbeddingUnavailableError };
