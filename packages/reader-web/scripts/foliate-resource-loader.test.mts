import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foliateResourceLoader } from '../src/foliate-resource-loader.ts';
const sessionID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const resourceID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const descriptor = { sessionID, resourceBaseURL: `shudeng-epub://reader/${sessionID}/`, entries: [{ path: 'OPS/../literal-%2e.xhtml', resourceID, size: 23 }] };

test('maps exact ZIP names to opaque IDs and never constructs paths from untrusted names', async () => {
  const requested: string[] = [];
  const loader = foliateResourceLoader(descriptor, (async input => { requested.push(String(input)); return new Response('正文'); }) as typeof fetch);
  assert.equal(await loader.loadText(descriptor.entries[0]!.path), '正文');
  assert.deepEqual(requested, [`shudeng-epub://reader/${sessionID}/${resourceID}`]);
  assert.equal(await loader.loadText('../outside'), null);
  assert.equal(loader.getSize(descriptor.entries[0]!.path), 23);
  loader.close();
  await assert.rejects(loader.loadText(descriptor.entries[0]!.path), /closed/);
});

test('close aborts even after response headers while the body is pending', async () => {
  let bodyStarted!: () => void;
  const started = new Promise<void>(resolve => { bodyStarted = resolve; });
  const loader = foliateResourceLoader(descriptor, (async (_input, options) => ({
    ok: true,
    arrayBuffer: () => new Promise((_resolve, reject) => {
      bodyStarted();
      options!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  })) as typeof fetch);
  const body = loader.loadText(descriptor.entries[0]!.path);
  await started; loader.close();
  await assert.rejects(body, /aborted/);
});

test('rejects remote origins, mismatched sessions and ambiguous archive names', () => {
  assert.throws(() => foliateResourceLoader({ ...descriptor, resourceBaseURL: 'https://example.com/' }), /origin/);
  assert.throws(() => foliateResourceLoader({ ...descriptor, sessionID: 'wrong' }), /session/);
  assert.throws(() => foliateResourceLoader({ ...descriptor, entries: [...descriptor.entries, ...descriptor.entries] }), /Ambiguous/);
});

test('preserves UTF16 XML without routing text through base64', async () => {
  const bytes = new Uint8Array([0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65]);
  const loader = foliateResourceLoader(descriptor, (async () => new Response(bytes)) as typeof fetch);
  assert.equal(await loader.loadText(descriptor.entries[0]!.path), '中文');
  loader.close();
});
