/**
 * Drizzle 数据库工厂：把异步 SQLiteDriver 桥接成 drizzle 的 sqlite-proxy 驱动。
 * drizzle 类型只在 db 内部使用；调用方拿到的数据库对象只需配合 store 使用。
 */
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { AsyncRemoteCallback } from 'drizzle-orm/sqlite-proxy';
import type { SQLiteDriver, SQLiteValue } from './driver.js';
import { schema } from './schema.js';

export type ShudengDatabase = ReturnType<typeof createDatabase>;

function driverCallback(driver: SQLiteDriver): AsyncRemoteCallback {
  // Drizzle sqlite-proxy 要求位置数组行（mapResultRow 用 row[columnIndex]）；
  // get 需要返回“单行数组本身”，无行时返回 undefined 让 drizzle 得到 undefined。
  const queryArrays = async (sql: string, values: readonly SQLiteValue[]): Promise<SQLiteValue[][]> => {
    if (driver.allValues) return driver.allValues(sql, values);
    const rows = await driver.all(sql, values);
    return rows.map((row) => Object.values(row));
  };
  return async (sql, params, method) => {
    const values = (params ?? []) as SQLiteValue[];
    if (method === 'run') {
      await driver.run(sql, values);
      return { rows: [] };
    }
    const rows = await queryArrays(sql, values);
    if (method === 'get') {
      const first = rows[0];
      return { rows: first as unknown as SQLiteValue[] };
    }
    return { rows };
  };
}

/** 用注入驱动创建 drizzle 数据库（schema 共享，纯 TS）。 */
export function createDatabase(driver: SQLiteDriver) {
  return drizzle(driverCallback(driver), { schema });
}
