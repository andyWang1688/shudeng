export type DatabaseStatus = {
  readonly ok: boolean;
  readonly engine: 'expo-sqlite';
  readonly detail: string;
};

export { initializeDatabase } from './sqlite';
export {
  embeddingStatus,
  getEmbeddingProvider,
  EmbeddingUnavailableError,
  runEmbeddingReferenceCheck,
} from './embedding';
export type { ReferenceComparison, ReferenceBundle, SentenceComparison } from './embeddingCompare';
export type { EmbeddingStatus, EmbeddingDiagnostics, ExpoEmbeddingProvider } from './embeddingShared';
