import { afterEach, describe, expect, it } from 'vitest';
import { createNodeSQLiteDriver, type NodeSQLiteDriver } from './testing/node-sqlite-driver.js';
import { migrate, MIGRATIONS } from './migrations.js';
import type { SQLiteDriver } from './driver.js';
import { SqliteSearchIndex } from '../rag/search-index.js';
const opened: NodeSQLiteDriver[] = [];
const indexNames = ['rag_chunks_book_id', 'rag_chunks_reading_order'];
async function through0004() {
  const driver = createNodeSQLiteDriver(); opened.push(driver);
  await driver.exec('CREATE TABLE _migrations (id TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)');
  for (const migration of MIGRATIONS.slice(0, 4)) await driver.transaction(async tx => { for (const statement of migration.statements) await tx.exec(statement); await tx.run('INSERT INTO _migrations VALUES (?, ?)', [migration.id, 1]); });
  await driver.run('INSERT INTO rag_chunks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', ['original-chunk', 'original-book', 1, '原章', null, 0, 2, '原文', '{}']);
  await driver.run('INSERT INTO rag_chunks_fts VALUES (?, ?, ?)', ['original-chunk', 'original-book', '原 文']);
  await driver.run('INSERT INTO rag_chunk_vectors VALUES (?, ?, ?, ?)', ['original-chunk', 'existing-model', 1, new Uint8Array(4)]);
  return driver;
}
async function names(driver: SQLiteDriver) { return (await driver.all<{ name: string }>('SELECT name FROM sqlite_master WHERE type = ? AND name IN (?, ?) ORDER BY name', ['index', ...indexNames])).map(row => row.name); }
afterEach(async () => { for (const driver of opened.splice(0)) await driver.close(); });

describe('0005 keyset query indexes', () => {
  it('creates both indexes on a new database and remains idempotent', async () => {
    const driver = createNodeSQLiteDriver(); opened.push(driver);
    expect((await migrate(driver)).applied).toEqual(MIGRATIONS.map(item => item.id)); expect(await names(driver)).toEqual(indexNames);
    expect((await migrate(driver)).applied).toEqual([]);
  });
  it('upgrades an existing 0004 database without changing any chunk/vector/FTS data', async () => {
    const driver = await through0004(), tables = ['rag_chunks', 'rag_chunk_vectors', 'rag_chunks_fts'];
    const before = await Promise.all(tables.map(table => driver.all('SELECT * FROM ' + table)));
    expect(await migrate(driver)).toMatchObject({ applied: ['0005_rag_keyset_indexes'], skipped: MIGRATIONS.slice(0, 4).map(item => item.id) });
    expect(await names(driver)).toEqual(indexNames);
    expect(await Promise.all(tables.map(table => driver.all('SELECT * FROM ' + table)))).toEqual(before);
  });
  it('rolls back the first index and migration marker if the second DDL fails, then retries successfully', async () => {
    const driver = await through0004();
    const failing: SQLiteDriver = { exec: driver.exec.bind(driver), run: driver.run.bind(driver), all: driver.all.bind(driver), transaction: task => driver.transaction(tx => task({ exec: async sql => { if (sql.includes('CREATE INDEX IF NOT EXISTS rag_chunks_reading_order')) throw new Error('simulated index DDL failure'); await tx.exec(sql); }, run: tx.run.bind(tx), all: tx.all.bind(tx), transaction: tx.transaction.bind(tx) })) };
    await expect(migrate(failing)).rejects.toThrow('simulated index DDL failure');
    expect(await names(driver)).toEqual([]); expect(await driver.all('SELECT * FROM _migrations WHERE id = ?', ['0005_rag_keyset_indexes'])).toEqual([]);
    expect((await migrate(driver)).applied).toEqual(['0005_rag_keyset_indexes']); expect(await names(driver)).toEqual(indexNames);
    expect((await driver.all('SELECT * FROM rag_chunks')).length).toBe(1);
  });
});

it('uses real keyset seeks without TEMP sorting for first/later pages of 100000 chunks', async () => {
  const driver = await through0004();
  await driver.exec('WITH RECURSIVE seq(n) AS (VALUES(0) UNION ALL SELECT n + 1 FROM seq WHERE n < 99999) INSERT INTO rag_chunks SELECT printf(\'large:c1:%06d\', n), \'large\', 1, \'大章\', NULL, n * 8, n * 8 + 8, \'needle. \', json_object(\'engine\', \'rag-chunk-v1\', \'chapter\', \'大章\', \'chapterOrdinal\', 1, \'href\', \'one.xhtml\', \'charStart\', n * 8, \'charEnd\', n * 8 + 8) FROM seq');
  await driver.exec("INSERT INTO rag_chunk_vectors SELECT id, 'perf', 1, X'0000803f' FROM rag_chunks WHERE book_id = 'large'");
  const queries = [
    { label: 'vector-first', sql: 'SELECT c.id AS chunk_id, v.model, v.dim, v.vector FROM rag_chunks c JOIN rag_chunk_vectors v ON v.chunk_id = c.id WHERE c.book_id = ? ORDER BY c.id LIMIT 64', params: ['large'] },
    { label: 'vector-later', sql: 'SELECT c.id AS chunk_id, v.model, v.dim, v.vector FROM rag_chunks c JOIN rag_chunk_vectors v ON v.chunk_id = c.id WHERE c.book_id = ? AND c.id > ? ORDER BY c.id LIMIT 64', params: ['large', 'large:c1:090000'] },
    { label: 'text-first', sql: 'SELECT * FROM rag_chunks WHERE book_id = ? ORDER BY chapter_ordinal, start_offset, end_offset, id LIMIT ?', params: ['large', 64] },
    { label: 'text-later', sql: 'SELECT * FROM rag_chunks WHERE book_id = ? AND (chapter_ordinal, start_offset, end_offset, id) > (?, ?, ?, ?) ORDER BY chapter_ordinal, start_offset, end_offset, id LIMIT ?', params: ['large', 1, 720000, 720008, 'large:c1:090000', 64] },
  ];
  const before: unknown[] = [], report: { query: string; beforeMs: number; afterMs: number; beforePlan: string[]; afterPlan: string[] }[] = [];
  for (const query of queries) {
    const plan = await driver.all<{ detail: string }>('EXPLAIN QUERY PLAN ' + query.sql, query.params), started = performance.now(), rows = await driver.all(query.sql, query.params);
    before.push(rows); report.push({ query: query.label, beforeMs: performance.now() - started, afterMs: 0, beforePlan: plan.map(row => row.detail), afterPlan: [] });
  }
  await migrate(driver);
  for (let index = 0; index < queries.length; index += 1) {
    const query = queries[index]!, entry = report[index]!, plan = await driver.all<{ detail: string }>('EXPLAIN QUERY PLAN ' + query.sql, query.params), started = performance.now(), rows = await driver.all(query.sql, query.params);
    entry.afterMs = performance.now() - started; entry.afterPlan = plan.map(row => row.detail);
    expect(rows).toEqual(before[index]); expect(rows).toHaveLength(64); expect(entry.afterPlan.join(' ')).not.toContain('TEMP B-TREE');
    expect(entry.afterPlan.join(' ')).toContain(index < 2 ? 'rag_chunks_book_id' : 'rag_chunks_reading_order');
  }
  const index = new SqliteSearchIndex(driver, { modelId: 'perf', dimension: 1, embed: async () => [new Float32Array([1])] });
  const candidates = await index.search('needle', { bookId: 'large', mode: 'vector', topK: 17 });
  expect(candidates.map(hit => hit.chunk.id)).toEqual(Array.from({ length: 17 }, (_, position) => 'large:c1:' + String(position).padStart(6, '0')));
  const firstTextPage = [];
  for await (const chunk of index.iterateChunks('large')) { firstTextPage.push(chunk); if (firstTextPage.length === 64) break; }
  expect(firstTextPage.map(chunk => chunk.id)).toEqual((before[2] as { id: string }[]).map(row => row.id));
  console.log('100000 chunk keyset query evidence', JSON.stringify(report));
}, 30000);
