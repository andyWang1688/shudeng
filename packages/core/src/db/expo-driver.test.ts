import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from './drizzle.js';
import { createExpoSQLiteDriver, type ExpoSQLiteDatabaseLike } from './drivers/expo.js';
import { MIGRATIONS, migrate } from './migrations.js';
import { ShudengStore } from './store.js';
import type { SQLiteDriver, SQLiteValue } from './driver.js';
import { ChapterIndexBuild } from '../rag/checkpoint-index.js';
import { ParagraphTextChunker } from '../rag/chunker.js';
import { SqliteSearchIndex } from '../rag/search-index.js';

/** 用 node:sqlite 模拟 expo-sqlite 的异步 Database 形状（不 import expo）。 */
class FakeExpoDatabase implements ExpoSQLiteDatabaseLike {
  private readonly db = new DatabaseSync(':memory:');
  failCommit = false;

  async execAsync(source: string): Promise<void> {
    if (source === 'COMMIT' && this.failCommit) {
      this.failCommit = false;
      throw new Error('native commit rejected');
    }
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
  async withExclusiveTransactionAsync(task: (txn: ExpoSQLiteDatabaseLike) => Promise<void>): Promise<void> {
    await this.execAsync('BEGIN IMMEDIATE');
    try {
      // Real expo-sqlite deliberately discards the callback's return value.
      await task(this);
      await this.execAsync('COMMIT');
    } catch (error) {
      await this.execAsync('ROLLBACK');
      throw error;
    }
  }
}

class FakeTransactionExpoDatabase extends FakeExpoDatabase {
  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    await this.execAsync('BEGIN IMMEDIATE');
    try { await task(); await this.execAsync('COMMIT'); }
    catch (error) { await this.execAsync('ROLLBACK'); throw error; }
  }
}

function gate(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

const fakes: Array<{ close(): void }> = [];

afterEach(() => {
  for (const fake of fakes.splice(0)) fake.close();
});

async function exercise(fake: FakeExpoDatabase & ExpoSQLiteDatabaseLike): Promise<void> {
  fakes.push(fake);
  const driver = createExpoSQLiteDriver(fake);
  const migration = await migrate(driver);
  expect(migration.applied).toEqual(MIGRATIONS.map((entry) => entry.id));

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

  it('withTransactionAsync 分支：建表/读写/回滚', async () => {
    await exercise(new FakeTransactionExpoDatabase());
  });

  describe.each([
    ['manual', () => new FakeExpoDatabase()],
    ['exclusive native', () => new FakeExclusiveExpoDatabase()],
    ['native', () => new FakeTransactionExpoDatabase()],
  ] as const)('%s transaction', (_name, makeDatabase) => {
    it('preserves callback values and nested transactions; failures release the queue', async () => {
      const fake = makeDatabase(); fakes.push(fake);
      const driver = createExpoSQLiteDriver(fake);
      await driver.exec('CREATE TABLE fixture (value TEXT NOT NULL)');
      const result = { nextChapter: 3, nextChunk: 16 };
      expect(await driver.transaction(async tx => {
        await tx.run('INSERT INTO fixture (value) VALUES (?)', ['committed']);
        return tx.transaction(async nested => {
          expect(nested).toBe(tx);
          return result;
        });
      })).toBe(result);
      const callbackError = new Error('callback rejected');
      await expect(driver.transaction(async tx => {
        await tx.run('INSERT INTO fixture (value) VALUES (?)', ['rolled-back-callback']);
        throw callbackError;
      })).rejects.toBe(callbackError);
      fake.failCommit = true;
      await expect(driver.transaction(async tx => {
        await tx.run('INSERT INTO fixture (value) VALUES (?)', ['rolled-back-commit']);
        return result;
      })).rejects.toThrow('native commit rejected');
      expect(await driver.transaction(async tx => {
        await tx.run('INSERT INTO fixture (value) VALUES (?)', ['after-rejection']);
        return null;
      })).toBeNull();
      expect(await driver.all('SELECT value FROM fixture ORDER BY rowid')).toEqual([{ value: 'committed' }, { value: 'after-rejection' }]);
      expect(await driver.transaction(async () => undefined)).toBeUndefined();
    });

    it('keeps concurrent root operations outside the transaction and expires its callback adapter', async () => {
      const fake = makeDatabase(); fakes.push(fake);
      const driver = createExpoSQLiteDriver(fake);
      await driver.exec('CREATE TABLE fixture (value TEXT NOT NULL)');
      const entered = gate(), resume = gate();
      let escaped!: SQLiteDriver;
      const pending = driver.transaction(async tx => {
        escaped = tx;
        await tx.run('INSERT INTO fixture VALUES (?)', ['rolled-back']);
        entered.resolve(); await resume.promise;
        throw new Error('rollback gated transaction');
      });
      await entered.promise;
      let outsideDone = false;
      const outside = driver.run('INSERT INTO fixture VALUES (?)', ['outside']).then(() => { outsideDone = true; });
      const read = driver.all('SELECT value FROM fixture ORDER BY rowid');
      await Promise.resolve(); await Promise.resolve();
      expect(outsideDone).toBe(false);
      resume.resolve();
      await expect(pending).rejects.toThrow('rollback gated transaction');
      await outside;
      expect(await read).toEqual([{ value: 'outside' }]);
      await expect(escaped.run('INSERT INTO fixture VALUES (?)', ['escaped'])).rejects.toThrow('事务已结束');
      await expect(escaped.transaction(async () => undefined)).rejects.toThrow('事务已结束');
    });

    it('keeps unrelated writes out of a failing production conversation deletion', async () => {
      const fake = makeDatabase(); fakes.push(fake);
      const driver = createExpoSQLiteDriver(fake); await migrate(driver);
      const store = new ShudengStore(createDatabase(driver));
      await driver.exec('CREATE TABLE outside_log (value TEXT NOT NULL)');
      await store.appendMessage({ conversationId: 'conv-failure', role: 'user', content: '保留的问题' });
      const entered = gate(), resume = gate();
      const getAll = fake.getAllAsync.bind(fake), run = fake.runAsync.bind(fake);
      fake.getAllAsync = async <T>(sql: string, ...params: SQLiteValue[]): Promise<T[]> => {
        const rows = await getAll<T>(sql, ...params);
        if (sql.startsWith('select "id" from "messages"')) { entered.resolve(); await resume.promise; }
        return rows;
      };
      fake.runAsync = async (sql: string, ...params: SQLiteValue[]) => {
        if (sql.startsWith('delete from "citations"')) throw new Error('forced delete failure');
        return run(sql, ...params);
      };
      // Attach the rejection handler before resuming the failed transaction.
      const deletion = expect(store.deleteConversation('conv-failure')).rejects.toThrow('Failed query');
      await entered.promise;
      let outsideDone = false;
      const outside = driver.run('INSERT INTO outside_log VALUES (?)', ['survive']).then(() => { outsideDone = true; });
      await Promise.resolve(); await Promise.resolve();
      expect(outsideDone).toBe(false);
      resume.resolve();
      await deletion; await outside;
      expect(await driver.all('SELECT value FROM outside_log')).toEqual([{ value: 'survive' }]);
      expect((await store.listMessages('conv-failure')).map(message => message.content)).toEqual(['保留的问题']);
    });
  });

  it('opens, checkpoints, resumes and promotes chapter indexes through the actual void Expo transaction contract', async () => {
    const fake = new FakeExclusiveExpoDatabase(); fakes.push(fake);
    const driver = createExpoSQLiteDriver(fake); await migrate(driver);
    const book = { id: 'expo-resume', title: '恢复索引', format: 'epub' as const, sourceHash: 'same-source' };
    const chunker = new ParagraphTextChunker();
    const old = { book, chapters: [{ ordinal: 1, title: '旧章', text: '此前可查文字' }] };
    const replacement = { book, chapters: [{ ordinal: 1, title: '新章', text: '新的原文。'.repeat(120) }] };
    const expected = chunker.chunk(replacement); expect(expected.length).toBeGreaterThan(2);
    const index = new SqliteSearchIndex(driver, null);
    await index.indexBook(old, chunker.chunk(old), []);
    const options = { book, generation: '0', extractionVersion: 'fixture-v1', chapterCount: 1, model: null, guard: async () => {} };
    const first = await ChapterIndexBuild.open(driver, options);
    expect(first.cursor).toMatchObject({ nextChapter: 0, nextChunk: 0 });
    await first.append(0, 0, expected.slice(0, 2), []);
    const resumed = await ChapterIndexBuild.open(driver, options);
    expect(resumed.cursor).toMatchObject({ nextChapter: 0, nextChunk: 2, chunkCount: 2 });
    expect((await index.listChunks(book.id)).map(chunk => chunk.text)).toEqual(['此前可查文字']);
    await resumed.append(0, 2, expected.slice(2), []);
    await resumed.finishChapter(0, expected.length);
    expect(resumed.cursor.nextChapter).toBe(1);
    expect(await resumed.promote(async () => {})).toMatchObject({ chunkCount: expected.length, vectorCount: 0 });
    expect(await index.listChunks(book.id)).toEqual(expected);
    expect(await driver.all('SELECT * FROM app_preferences WHERE key = ?', ['rag-index-build:' + book.id])).toEqual([]);
  });
});
