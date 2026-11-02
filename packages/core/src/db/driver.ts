/**
 * SQLite 驱动注入接口：core 只依赖这个异步接口，不 import expo-sqlite / better-sqlite3 / node:sqlite。
 *
 * 平台实现：
 * - Expo/Hermes：packages/core/src/db/drivers/expo.ts（包一层 expo-sqlite 的 Database 对象，不 import expo）
 * - Node 测试/评测：packages/core/src/db/testing/node-sqlite-driver.ts（node:sqlite 内置，无原生依赖）
 *
 * 约束：所有语句按调用顺序串行执行；transaction() 内使用 BEGIN IMMEDIATE 保证单写者。
 */
export type SQLiteValue = string | number | bigint | null | Uint8Array;

export interface SQLiteRunResult {
  changes: number;
}

export interface SQLiteDriver {
  /** 执行任意 SQL（允许多条语句，用于迁移 DDL）。 */
  exec(sql: string): Promise<void>;
  /** 写入/DDL，返回影响行数。 */
  run(sql: string, params?: ReadonlyArray<SQLiteValue>): Promise<SQLiteRunResult>;
  /** 查询多行（对象形式，按列名）。 */
  all<T extends Record<string, SQLiteValue> = Record<string, SQLiteValue>>(
    sql: string,
    params?: ReadonlyArray<SQLiteValue>,
  ): Promise<T[]>;
  /**
   * 查询多行（按 SELECT 列顺序返回数组）。Drizzle sqlite-proxy 需要位置数组；
   * 未实现时 drizzle.ts 会用 all() + Object.values() 退化转换。
   */
  allValues?(sql: string, params?: ReadonlyArray<SQLiteValue>): Promise<SQLiteValue[][]>;
  /** 事务：回调内使用传入的 driver（同一事务）；抛错回滚。 */
  transaction<T>(fn: (driver: SQLiteDriver) => Promise<T>): Promise<T>;
}

/** 单行查询便捷方法。 */
export async function getRow<T extends Record<string, SQLiteValue> = Record<string, SQLiteValue>>(
  driver: SQLiteDriver,
  sql: string,
  params?: ReadonlyArray<SQLiteValue>,
): Promise<T | undefined> {
  const rows = await driver.all<T>(sql, params);
  return rows[0];
}
