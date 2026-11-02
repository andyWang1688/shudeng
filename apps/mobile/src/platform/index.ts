export type DatabaseStatus = {
  readonly ok: boolean;
  readonly engine: 'expo-sqlite';
  readonly detail: string;
};

export { initializeDatabase } from './sqlite';
export { embeddingStatus, getEmbeddingProvider, EmbeddingUnavailableError } from './embedding';
export type { EmbeddingStatus, EmbeddingDiagnostics, ExpoEmbeddingProvider } from './embeddingShared';
