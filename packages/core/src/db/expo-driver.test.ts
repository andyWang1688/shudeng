import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from './drizzle.js';
import { createExpoSQLiteDriver, type ExpoSQLiteDatabaseLike } from './drivers/expo.js';
import { migrate } from './migrations.js';
import { ShudengStore } from './store.js';
import type { SQLiteValue } from './driver.js';

/** 用 node:sqlite 模拟 expo-sqlite 的异步 Database 形状（不 import expo）。 */
class FakeExpoDatabase implements ExpoSQLiteDatabaseLike {
  private readonly db = new DatabaseSync(':memory:');

  async execAsync(source: string): Promise<void> {
    this.db.exec(source);
  }

  async runAsync(
    source: string,
    ...params: SQLiteValue[]
  ): Promise<{ changes?: number; lastInsertRowId?: number | bigint }> {
    const result = this.db.prepare(source).run(...(params as SQLiteValue[]));
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  }

  async getAllAsync<T = unknown>(source: string, ...params: SQLiteValue[]): Promise<T[]> {
    return this.db.prepare(source).all(...(params as SQLiteValue[])) as T[];
  }

  async getFirstAsync<T = unknown>(source: string, ...params: SQLiteValue[]): Promise<T | null> {
    const rows = this.db.prepare(source).all(...(params as SQLiteValue[])) as T[];
    return rows[0] ?? null;
  }

  close(): void {
    this.db.close();
  }
}

/** 带 withExclusiveTransactionAsync 的变体（走 expo 原生事务分支）。 */
class FakeExclusiveExpoDatabase extends FakeExpoDatabase implements ExpoSQLiteDatabaseLike {
  async withExclusiveTransactionAsync<R>(task: (txn: ExpoSQLiteDatabaseLike) => Promise<R>): Promise<R> {
    await this.execAsync('BEGIN IMMEDIATE');
    try {
      const result = await task(this);
      await this.execAsync('COMMIT');
      return result;
    } catch (error) {
      await this.execAsync('ROLLBACK');
      throw error;
    }
  }
}

const fakes: Array<{ close(): void }> = [];

afterEach(() => {
  for (const fake of fakes.splice(0)) fake.close();
});

async function exercise(fake: FakeExpoDatabase & ExpoSQLiteDatabaseLike): Promise<void> {
  fakes.push(fake);
  const driver = createExpoSQLiteDriver(fake);
  const migration = await migrate(driver);
  expect(migration.applied).toEqual(['0001_initial', '0002_rag']);

  const store = new ShudengStore(createDatabase(driver));
  await store.saveBook({ id: 'book-1', title: '移动书', format: 'epub', sourceHash: 'h' });
  await store.appendMessage({ conversationId: 'conv-1', role: 'user', content: '问题' });
  await store.saveCheckpoint('conv-1', { messages: [] }, 1);
  expect((await store.getBook('book-1'))?.title).toBe('移动书');
  expect(await store.listMessages('conv-1')).toHaveLength(1);
  expect((await store.loadCheckpoint('conv-1'))?.step).toBe(1);

  // 事务回滚
  await expect(
    driver.transaction(async (tx) => {
      await tx.run(
        'INSERT INTO books (id,title,format,source_hash,imported_at,updated_at) VALUES (?,?,?,?,?,?)',
        ['book-tx', '事务', 'epub', 'h', Date.now(), Date.now()],
      );
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  expect(await store.getBook('book-tx')).toBeNull();
}

describe('expo-sqlite 驱动注入适配（用鸭子类型替身验证，无 expo 依赖）', () => {
  it('手动 BEGIN IMMEDIATE 分支：建表/读写/回滚', async () => {
    await exercise(new FakeExpoDatabase());
  });

  it('withExclusiveTransactionAsync 分支：建表/读写/回滚', async () => {
    await exercise(new FakeExclusiveExpoDatabase());
  });
});
