/**
 * iOS/Android（expo-sqlite）数据层初始化。
 *
 * 顺序固定：openDatabaseAsync → PRAGMA（WAL / foreign_keys）→ createExpoSQLiteDriver
 *          → createShudengDataLayer（migrate → drizzle → store/saver）。
 * 单例：initializeDatabase/getDataLayer 幂等；closeDatabase 供 dev/测试重置。
 *
 * Web 预览不会走到本文件（Metro 解析 initialize.web.ts，明确 stub，不加载 WASM）。
 */
import * as SQLite from 'expo-sqlite';
import { createExpoSQLiteDriver, type ExpoSQLiteDatabaseLike } from '@shudeng/core/db';
import { createShudengDataLayer, type ShudengDataLayer } from './engine';
import type { DatabaseInitResult } from './types';

export const DATABASE_NAME = 'shudeng.db';

let database: SQLite.SQLiteDatabase | null = null;
let layerPromise: Promise<ShudengDataLayer> | null = null;
let closingPromise: Promise<void> | null = null;

/** 幂等初始化：建立 schema 与数据层单例，返回可用于 UI 展示的状态。 */
export async function initializeDatabase(): Promise<DatabaseInitResult> {
  try {
    const layer = await getDataLayer();
    const rows = await layer.driver.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    );
    return {
      ok: true,
      engine: 'expo-sqlite',
      detail: `数据库已就绪（${rows.length} 张表）`,
      tableCount: rows.length,
      appliedMigrations: layer.migration.applied,
    };
  } catch (error) {
    return {
      ok: false,
      engine: 'expo-sqlite',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 获取数据层单例；失败后重置，允许下次重试。 */
export function getDataLayer(): Promise<ShudengDataLayer> {
  if (closingPromise) return closingPromise.then(() => getDataLayer());
  if (!layerPromise) {
    const pending = openDataLayer().catch((error: unknown) => {
      if (layerPromise === pending) layerPromise = null;
      throw error;
    });
    layerPromise = pending;
  }
  return layerPromise;
}

async function openDataLayer(): Promise<ShudengDataLayer> {
  const opened = await SQLite.openDatabaseAsync(DATABASE_NAME);
  try {
    await opened.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    const driver = createExpoSQLiteDriver(opened as unknown as ExpoSQLiteDatabaseLike);
    const layer = await createShudengDataLayer(driver);
    database = opened;
    return layer;
  } catch (error) {
    try {
      await opened.closeAsync();
    } catch (closeError) {
      throw new AggregateError([error, closeError], '数据库初始化失败，且连接未能关闭');
    }
    throw error;
  }
}

/** 关闭数据库连接（dev/测试重置用；关闭后下次 getDataLayer 会重新打开）。 */
export function closeDatabase(): Promise<void> {
  if (closingPromise) return closingPromise;
  const pending = layerPromise;
  const closing = (async () => {
    // A pending open owns its handle until it either publishes it or closes on failure.
    await pending?.catch(() => undefined);
    const opened = database;
    database = null;
    layerPromise = null;
    if (opened) await opened.closeAsync();
  })().finally(() => {
    if (closingPromise === closing) closingPromise = null;
  });
  closingPromise = closing;
  return closing;
}
