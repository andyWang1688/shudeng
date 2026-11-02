/**
 * Node 测试/评测专用驱动：node:sqlite 内置模块（Node >=22.5，无需原生依赖）。
 *
 * 该文件不在 db/index.ts 公共导出中：生产 core 不 import Node 驱动；
 * 只允许测试 / Node 评测通过 `@shudeng/core/db/testing` 使用。
 * 若以后要换 better-sqlite3，只需实现同一个 SQLiteDriver 接口。
 */
import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDriver, SQLiteRunResult, SQLiteValue } from '../driver.js';

export interface NodeSQLiteDriverOptions {
  /** 文件路径；默认 ':memory:'。 */
  location?: string;
  /** 打开 WAL；内存库忽略。 */
  wal?: boolean;
}

export interface NodeSQLiteDriver extends SQLiteDriver {
  close(): Promise<void>;
}

class NodeSQLiteDriverImpl implements NodeSQLiteDriver {
  private readonly db: DatabaseSync;
  private tail: Promise<unknown> = Promise.resolve();
  private depth = 0;

  constructor(options: NodeSQLiteDriverOptions) {
    this.db = new DatabaseSync(options.location ?? ':memory:');
    if (options.wal !== false) {
      try {
        this.db.exec('PRAGMA journal_mode = WAL;');
      } catch {
        // 内存库不支持 WAL 时忽略。
      }
    }
  }

  private async exclusive<R>(fn: () => R | Promise<R>): Promise<R> {
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

  private execDirect(sql: string): void {
    this.db.exec(sql);
  }

  private runDirect(sql: string, params: ReadonlyArray<SQLiteValue>): SQLiteRunResult {
    const statement = this.db.prepare(sql);
    const result = statement.run(...(params as SQLiteValue[]));
    return { changes: Number(result.changes) };
  }

  private allDirect<T extends Record<string, SQLiteValue>>(
    sql: string,
    params: ReadonlyArray<SQLiteValue>,
  ): T[] {
    const statement = this.db.prepare(sql);
    return statement.all(...(params as SQLiteValue[])) as T[];
  }

  async exec(sql: string): Promise<void> {
    // 事务内直接执行（外层已持有串行锁，避免事务内再取锁死锁）。
    if (this.depth > 0) return this.execDirect(sql);
    await this.exclusive(() => this.execDirect(sql));
  }

  async run(sql: string, params: ReadonlyArray<SQLiteValue> = []): Promise<SQLiteRunResult> {
    if (this.depth > 0) return this.runDirect(sql, params);
    return this.exclusive(() => this.runDirect(sql, params));
  }

  async all<T extends Record<string, SQLiteValue> = Record<string, SQLiteValue>>(
    sql: string,
    params: ReadonlyArray<SQLiteValue> = [],
  ): Promise<T[]> {
    if (this.depth > 0) return this.allDirect<T>(sql, params);
    return this.exclusive(() => this.allDirect<T>(sql, params));
  }

  async allValues(
    sql: string,
    params: ReadonlyArray<SQLiteValue> = [],
  ): Promise<SQLiteValue[][]> {
    const execute = (): SQLiteValue[][] => {
      const statement = this.db.prepare(sql);
      statement.setReturnArrays(true);
      return statement.all(...(params as SQLiteValue[])) as unknown as SQLiteValue[][];
    };
    if (this.depth > 0) return execute();
    return this.exclusive(execute);
  }

  async transaction<R>(fn: (driver: SQLiteDriver) => Promise<R>): Promise<R> {
    if (this.depth > 0) return fn(this);
    return this.exclusive(async () => {
      this.db.exec('BEGIN IMMEDIATE');
      this.depth += 1;
      try {
        const result = await fn(this);
        this.depth -= 1;
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        this.depth = Math.max(0, this.depth - 1);
        try {
          this.db.exec('ROLLBACK');
        } catch {
          // 回滚失败时保留原始错误。
        }
        throw error;
      }
    });
  }

  async close(): Promise<void> {
    await this.exclusive(() => this.db.close());
  }
}

/** Node 侧测试/评测驱动（node:sqlite）。 */
export function createNodeSQLiteDriver(options: NodeSQLiteDriverOptions = {}): NodeSQLiteDriver {
  return new NodeSQLiteDriverImpl(options);
}
