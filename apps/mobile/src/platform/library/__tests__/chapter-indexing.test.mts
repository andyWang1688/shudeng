import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParagraphTextChunker, SqliteSearchIndex, type EmbeddingProvider, type EpubResourceArchive } from '@shudeng/core';
import { createNodeSQLiteDriver, type NodeSQLiteDriver } from '@shudeng/core/db/testing';
import { createShudengDataLayer, type ShudengDataLayer } from '../../db/engine';
const digest = 'c'.repeat(64);
const state = vi.hoisted(() => ({ layer: null as ShudengDataLayer | null, embed: null as EmbeddingProvider['embed'] | null, files: new Map<string, Uint8Array>(), reads: [] as string[], closes: 0 }));
vi.mock('../../db', () => ({ getDataLayer: async () => state.layer }));
vi.mock('../../embedding', () => ({ embeddingStatus: async () => ({ available: true, modelId: 'test', dimension: 1 }), getEmbeddingProvider: () => ({ modelId: 'test', dimension: 1, embed: (...args: Parameters<EmbeddingProvider['embed']>) => state.embed!(...args) }) }));
vi.mock('expo-file-system', () => {
  const join = (values: readonly (string | { uri: string })[]) => values.map(value => typeof value === 'string' ? value : value.uri).join('/');
  class File {
    uri: string; constructor(...values: (string | { uri: string })[]) { this.uri = join(values); }
    get exists() { return state.files.has(this.uri); }
    async digest() { return 'c'.repeat(64); }
    async copy(target: File) { state.files.set(target.uri, state.files.get(this.uri)!); }
    async move(target: File) { const bytes = state.files.get(this.uri); if (!bytes) throw new Error('missing'); state.files.set(target.uri, bytes); state.files.delete(this.uri); this.uri = target.uri; }
    delete() { state.files.delete(this.uri); }
    create() {}
  }
  return { File, Directory: File, Paths: { document: { uri: 'file:///documents' } } };
});
vi.mock('../../epubArchive', () => ({ openEpubArchive: async (): Promise<EpubResourceArchive> => {
  const resources: Record<string, string> = {
    mimetype: 'application/epub+zip', 'META-INF/container.xml': '<container><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></container>',
    'book.opf': '<package><metadata><title>真实书名</title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>',
    'one.xhtml': '<html><body><p>' + '第一章的文字。'.repeat(360) + '</p></body></html>', 'two.xhtml': '<html><body><p>结束</p></body></html>',
  };
  return { entries: Object.entries(resources).map(([path, text]) => ({ path, resourceID: path, size: text.length })), getSize: path => resources[path]?.length ?? 0, async readText(path, options) { if (options?.signal?.aborted) throw new Error('cancelled'); state.reads.push(path); return resources[path] ?? null; }, async materialize() { throw new Error('not needed'); }, async close() { state.closes += 1; } };
} }));
vi.mock('../progress', () => ({ ensureProgressTable: async () => state.layer, loadAllBookProgress: async () => new Map() }));
vi.mock('../conversations', () => ({ loadConversationSummaries: async () => [], markConversationsDeleted: () => () => {}, cancelConversationRun: () => {} }));
vi.mock('../bookCovers', () => ({ loadBookCover: async () => undefined }));
import { cancelBookIndexing, getLocalBookIndexStatus, indexImportedBook, rebuildBookIndex, resumeAvailableBookIndexes } from '../../ai/bookIndex';
import { importBookAsset, deleteShelfBook } from '../import';

let driver: NodeSQLiteDriver;
const book = { id: 'batch-book', title: '批次书', format: 'epub' as const, sourceHash: digest };
const content = { title: null, author: null, chapters: [{ ordinal: 1, title: '章', href: 'one.xhtml', text: '第一章的文字。'.repeat(360) }, { ordinal: 2, title: '结束', text: '结束' }] };
const chunks = new ParagraphTextChunker().chunk({ book, chapters: content.chapters });
beforeEach(async () => { driver = createNodeSQLiteDriver(); state.layer = await createShudengDataLayer(driver); state.files.clear(); state.reads = []; state.closes = 0; await state.layer.store.saveBook(book); state.embed = async texts => texts.map(() => new Float32Array([1])); });
afterEach(async () => { await cancelBookIndexing(book.id); await cancelBookIndexing('queued-book'); await cancelBookIndexing(digest); await driver.close(); });

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

describe('mobile chapter indexing lifecycle', () => {
  it('persists the first 16 chunks, cancels a later model batch, and resumes without replacing old text early', async () => {
    const old = { book, chapters: [{ ordinal: 1, title: '旧章', text: '原有可查文字' }] };
    await new SqliteSearchIndex(driver, null).indexBook(old, new ParagraphTextChunker().chunk(old), []);
    let calls = 0, waitingSignal: { readonly aborted: boolean } | undefined;
    const entered = deferred<void>(), release = deferred<Float32Array[]>();
    state.embed = async (texts, options) => { calls += 1; if (calls === 2) { waitingSignal = options?.signal; entered.resolve(); return release.promise; } return texts.map(() => new Float32Array([1])); };
    const first = indexImportedBook(book, content); const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await entered.promise;
    expect((await new SqliteSearchIndex(driver, null).listChunks(book.id))[0]?.text).toBe('原有可查文字');
    expect((await driver.all<{ c: number }>('SELECT count(*) AS c FROM rag_chunks'))[0]?.c).toBe(17);
    const stopping = cancelBookIndexing(book.id); expect(waitingSignal?.aborted).toBe(true); release.resolve(Array.from({ length: 6 }, () => new Float32Array([1]))); await stopping; await rejected;
    const seen: string[] = []; state.embed = async texts => { seen.push(...texts); return texts.map(() => new Float32Array([1])); };
    expect(await indexImportedBook(book, content)).toMatchObject({ available: true, semantic: true });
    expect(seen[0]).toBe(chunks[16]!.text); expect(seen.length).toBe(chunks.length - 16);
    expect(await new SqliteSearchIndex(driver, null).listChunks(book.id)).toEqual(chunks);
  });

  it('cancels a queued book immediately while another book is inside the model', async () => {
    const entered = deferred<void>(), release = deferred<Float32Array[]>();
    state.embed = async texts => { entered.resolve(); await release.promise; return texts.map(() => new Float32Array([1])); };
    const running = indexImportedBook(book, content); const runningRejected = expect(running).rejects.toMatchObject({ name: 'AbortError' }); await entered.promise;
    const other = { ...book, id: 'queued-book' }; await state.layer!.store.saveBook(other);
    const queued = indexImportedBook(other, content), queuedRejected = expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(async () => { expect((await getLocalBookIndexStatus(other.id)).state).toBe('missing'); });
    await cancelBookIndexing(other.id); await queuedRejected;
    const stopping = cancelBookIndexing(book.id); release.resolve([]); await stopping; await runningRejected;
  });

  it('a second caller can cancel a shared queued job with its own AbortSignal', async () => {
    const entered = deferred<void>(), release = deferred<Float32Array[]>();
    state.embed = async texts => { entered.resolve(); await release.promise; return texts.map(() => new Float32Array([1])); };
    const running = indexImportedBook(book, content), runningRejected = expect(running).rejects.toMatchObject({ name: 'AbortError' }); await entered.promise;
    const other = { ...book, id: 'queued-book' }; await state.layer!.store.saveBook(other);
    const waiting = indexImportedBook(other, content), rejected = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    const controller = new AbortController(), joined = rebuildBookIndex(other.id, { signal: controller.signal }), joinedRejected = expect(joined).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve(); await Promise.resolve(); controller.abort();
    await rejected; await joinedRejected;
    const stopping = cancelBookIndexing(book.id); release.resolve([]); await stopping; await runningRejected;
  });

  it('a duplicate import cancels/joins its old writer and resumes despite the startup attempt marker', async () => {
    state.files.set('file:///documents/Books/' + book.id + '.epub', new Uint8Array([1, 2]));
    const entered = deferred<void>(), release = deferred<Float32Array[]>(); let signal: { readonly aborted: boolean } | undefined;
    state.embed = async (texts, options) => { signal = options?.signal; entered.resolve(); await release.promise; return texts.map(() => new Float32Array([1])); };
    await resumeAvailableBookIndexes([(await state.layer!.store.getBook(book.id))!]); await entered.promise;
    const asset = { uri: 'file:///picked/duplicate.epub', name: 'duplicate.epub', mimeType: 'application/epub+zip' }; state.files.set(asset.uri, new Uint8Array([1, 2]));
    const duplicate = importBookAsset(asset);
    await vi.waitFor(() => { expect(signal?.aborted).toBe(true); });
    state.embed = async texts => texts.map(() => new Float32Array([1])); release.resolve([]);
    expect(await duplicate).toMatchObject({ status: 'imported', book: { id: book.id } });
    await vi.waitFor(async () => { expect(await getLocalBookIndexStatus(book.id)).toMatchObject({ state: 'ready', available: true, semantic: true }); });
  });

  it('keeps valid import readable while model preparation is still pending and records failure afterwards', async () => {
    await driver.run('DELETE FROM books WHERE id = ?', [book.id]);
    const entered = deferred<void>(), release = deferred<Float32Array[]>(); state.embed = async () => { entered.resolve(); return release.promise; };
    const asset = { uri: 'file:///picked/book.epub', name: 'book.epub', mimeType: 'application/epub+zip' }; state.files.set(asset.uri, new Uint8Array([1, 2]));
    const result = await importBookAsset(asset);
    expect(result).toMatchObject({ status: 'imported', book: { id: digest, title: '真实书名' } });
    expect(state.files.has('file:///documents/Books/' + digest + '.epub')).toBe(true);
    expect(state.reads).toContain('one.xhtml'); expect(state.reads).toContain('two.xhtml'); expect(state.closes).toBeGreaterThan(0);
    await entered.promise;
    expect(await getLocalBookIndexStatus(digest)).toMatchObject({ state: 'building', available: false });
    release.resolve([]);
    await vi.waitFor(async () => { expect(await getLocalBookIndexStatus(digest)).toMatchObject({ state: 'fts', available: true, semantic: false }); });
    expect(await state.layer!.store.getBook(digest)).not.toBeNull();
  });

  it('delete while a model callback is pending removes official and pending rows and does not poison a reimport', async () => {
    const entered = deferred<void>(), release = deferred<Float32Array[]>(); state.embed = async texts => { entered.resolve(); await release.promise; return texts.map(() => new Float32Array([1])); };
    const preparing = indexImportedBook(book, content), rejected = expect(preparing).rejects.toMatchObject({ name: 'AbortError' }); await entered.promise;
    const deleting = deleteShelfBook(book.id); release.resolve([]); await deleting; await rejected;
    expect(await driver.all('SELECT * FROM rag_chunks')).toEqual([]); expect(await driver.all('SELECT * FROM rag_chunk_vectors')).toEqual([]);
    expect(await driver.all('SELECT * FROM app_preferences WHERE key = ?', ['rag-index-build:' + book.id])).toEqual([]);
    await state.layer!.store.saveBook(book); state.embed = async texts => texts.map(() => new Float32Array([1]));
    expect(await indexImportedBook(book, content)).toMatchObject({ available: true, semantic: true });
    expect((await getLocalBookIndexStatus(book.id)).state).toBe('ready');
  });
});
