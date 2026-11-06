import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loader } from '../../../ui/settings/__tests__/platformHarness.mts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function handle(options: { pragma?: () => Promise<void>; close?: () => Promise<void> } = {}) {
  return {
    closed: 0,
    execAsync: () => options.pragma?.() ?? Promise.resolve(),
    async closeAsync() { this.closed++; await options.close?.(); },
  };
}
function setup(open: () => Promise<ReturnType<typeof handle>>, assemble: (db: ReturnType<typeof handle>) => Promise<unknown> = async db => ({ db })) {
  let opens = 0;
  const api = loader({
    'expo-sqlite': { openDatabaseAsync: () => { opens++; return open(); } },
    '@shudeng/core/db': { createExpoSQLiteDriver: (db: unknown) => db },
    './engine': { createShudengDataLayer: assemble },
  })('apps/mobile/src/platform/db/initialize.native.ts');
  return { api, opens: () => opens };
}

test('concurrent initialization shares a handle and a rejected open can retry', async () => {
  const db = handle(); let fail = true;
  const h = setup(async () => { if (fail) throw Error('open failed'); return db; });
  const first = h.api.getDataLayer();
  assert.equal(h.api.getDataLayer(), first);
  await assert.rejects(first, /open failed/);
  fail = false;
  const second = h.api.getDataLayer();
  assert.equal(h.api.getDataLayer(), second);
  assert.equal((await second).db, db);
  assert.equal(h.opens(), 2);
  await h.api.closeDatabase();
  assert.equal(db.closed, 1);
});

for (const phase of ['pragma', 'migration']) {
  test(`${phase} failure closes its own handle before a retry publishes another one`, async () => {
    const failed = handle({ pragma: phase === 'pragma' ? async () => { throw Error('pragma failed'); } : undefined });
    const healthy = handle(); let calls = 0;
    const h = setup(async () => calls++ ? healthy : failed, async db => {
      if (db === failed && phase === 'migration') throw Error('migration failed');
      return { db };
    });
    await assert.rejects(h.api.getDataLayer(), new RegExp(phase + ' failed'));
    assert.equal(failed.closed, 1);
    assert.equal((await h.api.getDataLayer()).db, healthy);
    await h.api.closeDatabase();
    assert.equal(failed.closed, 1); assert.equal(healthy.closed, 1);
  });
}

test('closing during an open waits for it, closes once, and defers new readers until close completes', async () => {
  const opening = deferred<ReturnType<typeof handle>>(); const closing = deferred<void>();
  const first = handle({ close: () => closing.promise }); const second = handle();
  let calls = 0;
  const h = setup(() => calls++ ? Promise.resolve(second) : opening.promise);
  const initial = h.api.getDataLayer();
  const close = h.api.closeDatabase();
  assert.equal(h.api.closeDatabase(), close);
  const next = h.api.getDataLayer();
  opening.resolve(first);
  await initial;
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(first.closed, 1); assert.equal(h.opens(), 1);
  closing.resolve();
  await close;
  assert.equal((await next).db, second); assert.equal(h.opens(), 2);
  await h.api.closeDatabase();
  assert.equal(first.closed, 1); assert.equal(second.closed, 1);
});

test('close racing a failed migration does not close twice or clear the next initialization', async () => {
  const migration = deferred<unknown>(); const failed = handle(); const healthy = handle();
  let calls = 0;
  const h = setup(async () => calls++ ? healthy : failed, db => db === failed ? migration.promise : Promise.resolve({ db }));
  const initial = h.api.getDataLayer();
  const rejected = assert.rejects(initial, /migration failed/);
  const close = h.api.closeDatabase(); const next = h.api.getDataLayer();
  migration.reject(Error('migration failed'));
  await rejected; await close;
  assert.equal((await next).db, healthy); assert.equal(failed.closed, 1);
  await h.api.closeDatabase(); assert.equal(healthy.closed, 1);
});

test('a failed cleanup reports both failures and still resets the initialization for retry', async () => {
  const failed = handle({ pragma: async () => { throw Error('pragma failed'); }, close: async () => { throw Error('close failed'); } });
  const healthy = handle(); let calls = 0;
  const h = setup(async () => calls++ ? healthy : failed);
  await assert.rejects(h.api.getDataLayer(), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors.map((item: Error) => item.message), ['pragma failed', 'close failed']);
    return true;
  });
  assert.equal((await h.api.getDataLayer()).db, healthy);
  await h.api.closeDatabase();
});
