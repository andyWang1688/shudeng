export type DatabaseStatus = {
  readonly ok: boolean;
  readonly engine: 'expo-sqlite';
  readonly detail: string;
};

export { initializeDatabase } from './sqlite';
