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
 * - 所有驱动调用通过内部队列串行化；transaction 使用 BEGIN IMMEDIATE，保证单写者。
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

class ExpoSQLiteDriver implements SQLiteDriver {
  private readonly db: ExpoSQLiteDatabaseLike;
  private tail: Promise<unknown> = Promise.resolve();
  private depth = 0;

  constructor(db: ExpoSQLiteDatabaseLike) {
    this.db = db;
  }

  private async exclusive<R>(fn: () => Promise<R>): Promise<R> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async exec(sql: string): Promise<void> {
    // 事务内直接执行（外层已持有串行锁，避免事务内再取锁死锁）。
    if (this.depth > 0) return this.db.execAsync(sql);
    await this.exclusive(() => this.db.execAsync(sql));
  }

  async run(sql: string, params: ReadonlyArray<SQLiteValue> = []): Promise<SQLiteRunResult> {
    const execute = async (): Promise<SQLiteRunResult> => {
      const result = await this.db.runAsync(sql, ...params);
      return { changes: Number(result?.changes ?? 0) };
    };
    if (this.depth > 0) return execute();
    return this.exclusive(execute);
  }

  async all<T extends Record<string, SQLiteValue> = Record<string, SQLiteValue>>(
    sql: string,
    params: ReadonlyArray<SQLiteValue> = [],
  ): Promise<T[]> {
    if (this.depth > 0) return this.db.getAllAsync<T>(sql, ...params);
    return this.exclusive(() => this.db.getAllAsync<T>(sql, ...params));
  }

  async allValues(
    sql: string,
    params: ReadonlyArray<SQLiteValue> = [],
  ): Promise<SQLiteValue[][]> {
    const rows = await this.all<Record<string, SQLiteValue>>(sql, params);
    return rows.map((row) => Object.values(row));
  }

  async transaction<R>(fn: (driver: SQLiteDriver) => Promise<R>): Promise<R> {
    // 嵌套事务直接复用当前事务。
    if (this.depth > 0) return fn(this);
    return this.exclusive(async () => {
      if (this.db.withExclusiveTransactionAsync) {
        // Expo resolves with void, even when its callback returns a value. Preserve
        // the core transaction result separately and expose it only after commit.
        let result!: R;
        await this.db.withExclusiveTransactionAsync(async (txn) => {
          result = await fn(new ExpoSQLiteDriver(txn));
        });
        return result;
      }
      if (this.db.withTransactionAsync) {
        let result!: R;
        await this.db.withTransactionAsync(async () => {
          result = await fn(this);
        });
        return result;
      }
      await this.db.execAsync('BEGIN IMMEDIATE');
      this.depth += 1;
      try {
        const result = await fn(this);
        this.depth -= 1;
        await this.db.execAsync('COMMIT');
        return result;
      } catch (error) {
        this.depth = Math.max(0, this.depth - 1);
        await this.db.execAsync('ROLLBACK');
        throw error;
      }
    });
  }
}

/** 把一个 expo-sqlite Database（或测试替身）包装成 core 的 SQLiteDriver。 */
export function createExpoSQLiteDriver(db: ExpoSQLiteDatabaseLike): SQLiteDriver {
  return new ExpoSQLiteDriver(db);
}
