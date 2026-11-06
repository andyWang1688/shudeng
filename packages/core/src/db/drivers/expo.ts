/**
 * expo-sqlite 适配：core 不 import expo-sqlite/react-native，只接收调用方注入的 Database 对象。
 *
 * 移动端接线（apps/mobile/src/platform，后续任务）大致为：
 *   import { openDatabaseAsync } from 'expo-sqlite';
 *   const db = await openDatabaseAsync('shudeng.db');
 *   const driver = createExpoSQLiteDriver(db);
 *   const database = createDatabase(driver);
 *   await migrate(driver);
 *
 * 注意：
 * - expo-sqlite 是异步 API（execAsync/runAsync/getAllAsync/getFirstAsync），
 *   与官方 @langchain/langgraph-checkpoint-sqlite 依赖的 better-sqlite3 同步 API 不同（见 checkpoint-saver.ts）。
 * - 根驱动调用串行化；事务优先使用原生能力，缺少时回退为 BEGIN IMMEDIATE。
 * - 事务 callback 只使用传入 driver；嵌套复用当前事务，不提供 savepoint。
 */
import type { SQLiteDriver, SQLiteRunResult, SQLiteValue } from '../driver.js';

/** expo-sqlite Database 的最小鸭子类型（只取本层用到的异步方法）。 */
export interface ExpoSQLiteDatabaseLike {
  execAsync(source: string): Promise<void>;
  runAsync(
    source: string,
    ...params: SQLiteValue[]
  ): Promise<{ changes?: number; lastInsertRowId?: number | bigint }>;
  getAllAsync<T = unknown>(source: string, ...params: SQLiteValue[]): Promise<T[]>;
  getFirstAsync<T = unknown>(source: string, ...params: SQLiteValue[]): Promise<T | null>;
  withExclusiveTransactionAsync?(task: (txn: ExpoSQLiteDatabaseLike) => Promise<void>): Promise<void>;
  withTransactionAsync?(task: () => Promise<void>): Promise<void>;
}

/** Transaction-local calls bypass the root queue without letting unrelated root calls enter the transaction. */
function transactionAdapter(db: ExpoSQLiteDatabaseLike): { driver: SQLiteDriver; close(): void } {
  let active = true;
  const check = (): void => {
    if (!active) throw new Error('事务已结束，不能继续使用其 driver');
  };
  const driver: SQLiteDriver = {
    async exec(sql) {
      check();
      await db.execAsync(sql);
    },
    async run(sql, params = []) {
      check();
      const result = await db.runAsync(sql, ...params);
      return { changes: Number(result?.changes ?? 0) };
    },
    async all<T extends Record<string, SQLiteValue>>(sql: string, params: ReadonlyArray<SQLiteValue> = []): Promise<T[]> {
      check();
      return db.getAllAsync<T>(sql, ...params);
    },
    async allValues(sql, params = []) {
      check();
      const rows = await db.getAllAsync<Record<string, SQLiteValue>>(sql, ...params);
      return rows.map(row => Object.values(row));
    },
    async transaction(fn) {
      check();
      return fn(driver);
    },
  };
  return { driver, close() { active = false; } };
}

class ExpoSQLiteDriver implements SQLiteDriver {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly db: ExpoSQLiteDatabaseLike) {}

  private async exclusive<R>(fn: () => Promise<R>): Promise<R> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous.catch(() => undefined);
    try { return await fn(); } finally { release(); }
  }

  exec(sql: string): Promise<void> { return this.exclusive(() => this.db.execAsync(sql)); }

  run(sql: string, params: ReadonlyArray<SQLiteValue> = []): Promise<SQLiteRunResult> {
    return this.exclusive(async () => { const result = await this.db.runAsync(sql, ...params); return { changes: Number(result?.changes ?? 0) }; });
  }

  all<T extends Record<string, SQLiteValue> = Record<string, SQLiteValue>>(sql: string, params: ReadonlyArray<SQLiteValue> = []): Promise<T[]> {
    return this.exclusive(() => this.db.getAllAsync<T>(sql, ...params));
  }

  async allValues(sql: string, params: ReadonlyArray<SQLiteValue> = []): Promise<SQLiteValue[][]> {
    const rows = await this.all(sql, params); return rows.map(row => Object.values(row));
  }

  transaction<R>(fn: (driver: SQLiteDriver) => Promise<R>): Promise<R> {
    return this.exclusive(async () => {
      const execute = async (db: ExpoSQLiteDatabaseLike): Promise<R> => {
        const adapter = transactionAdapter(db);
        try { return await fn(adapter.driver); } finally { adapter.close(); }
      };
      if (this.db.withExclusiveTransactionAsync) {
        let result!: R;
        await this.db.withExclusiveTransactionAsync(async txn => { result = await execute(txn); });
        return result;
      }
      if (this.db.withTransactionAsync) {
        let result!: R;
        await this.db.withTransactionAsync(async () => { result = await execute(this.db); });
        return result;
      }
      await this.db.execAsync('BEGIN IMMEDIATE');
      try {
        const result = await execute(this.db);
        await this.db.execAsync('COMMIT');
        return result;
      } catch (error) { await this.db.execAsync('ROLLBACK'); throw error; }
    });
  }
}

/** 把一个 expo-sqlite Database（或测试替身）包装成 core 的 SQLiteDriver。 */
export function createExpoSQLiteDriver(db: ExpoSQLiteDatabaseLike): SQLiteDriver {
  return new ExpoSQLiteDriver(db);
}
