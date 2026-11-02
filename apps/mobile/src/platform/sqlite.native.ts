import * as SQLite from 'expo-sqlite';
import type { DatabaseStatus } from './index';

const databaseName = 'shudeng-spike.db';
let initialization: Promise<DatabaseStatus> | null = null;

/**
 * 手机端 SQLite 基础验证：建一张最小表并读写 schema_version。
 * Web 预览不配置 WASM 驱动，返回明确未验证状态；真实端（iOS/Android）走 expo-sqlite。
 */
export function initializeDatabase(): Promise<DatabaseStatus> {
  initialization ??= initialize();
  return initialization;
}

async function initialize(): Promise<DatabaseStatus> {
  try {
    const database = await SQLite.openDatabaseAsync(databaseName);
    await database.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    await database.runAsync(
      'INSERT OR REPLACE INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)',
      ['schema_version', '1', Date.now()],
    );
    const row = await database.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_meta WHERE key = ?',
      ['schema_version'],
    );
    return {
      ok: row?.value === '1',
      engine: 'expo-sqlite',
      detail: row?.value === '1' ? 'schema v1 可读写' : 'schema 读取为空',
    };
  } catch (error) {
    return {
      ok: false,
      engine: 'expo-sqlite',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
