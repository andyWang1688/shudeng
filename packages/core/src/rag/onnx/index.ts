/**
 * Node 专属 ONNX embedding 入口（子路径导出 `@shudeng/core/rag/onnx`）。
 * 依赖 node:fs/zlib/crypto 与 onnxruntime-node，**不要**在移动端/Web bundle 中 import。
 */
export {
  OnnxEmbeddingProvider,
  prepareOnnxModel,
  type OnnxEmbeddingMetrics,
  type OnnxEmbeddingProviderOptions,
  type OnnxModelCacheInfo,
  type OnnxModelManifest,
} from './embedding.js';
