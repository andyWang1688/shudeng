/**
 * 数据层装配（平台无关）：注入 SQLiteDriver → 迁移 → Drizzle → store / LangGraph checkpoint saver。
 * 不 import expo-sqlite / Node 驱动；native 初始化、Web stub、Node dev check 复用同一装配逻辑。
 */
import {
  createDatabase,
  migrate,
  ShudengStore,
  SqliteCheckpointSaver,
  type MigrateResult,
  type SQLiteDriver,
  type ShudengDatabase,
} from '@shudeng/core/db';

export interface ShudengDataLayer {
  readonly driver: SQLiteDriver;
  readonly db: ShudengDatabase;
  readonly store: ShudengStore;
  readonly saver: SqliteCheckpointSaver;
  readonly migration: MigrateResult;
}

/** 顺序固定：先迁移，再创建 drizzle/store/saver（迁移幂等）。 */
export async function createShudengDataLayer(driver: SQLiteDriver): Promise<ShudengDataLayer> {
  const migration = await migrate(driver);
  const db = createDatabase(driver);
  return {
    driver,
    db,
    store: new ShudengStore(db),
    saver: new SqliteCheckpointSaver(driver),
    migration,
  };
}
