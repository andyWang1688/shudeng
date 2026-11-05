import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNodeSQLiteDriver, type NodeSQLiteDriver } from '@shudeng/core/db/testing';
import { createShudengDataLayer, type ShudengDataLayer } from '../../db/engine';
import type { EpubResourceArchive } from '@shudeng/core';
const state = vi.hoisted(() => ({ layer: null as ShudengDataLayer | null, files: new Map<string, Uint8Array>(), reads: [] as string[], release: 0, close: 0, sizeHint: 10, actualBytes: 10, copyFailure: false, materializeFailure: false, wait: null as Promise<void> | null }));
vi.mock('../../db', () => ({ getDataLayer: async () => state.layer }));
vi.mock('expo-file-system', () => {
  const join = (values: readonly (string | { uri: string })[]) => values.map(value => typeof value === 'string' ? value : value.uri).join('/');
  class File {
    uri: string; constructor(...values: (string | { uri: string })[]) { this.uri = join(values); }
    get exists() { return state.files.has(this.uri); } create() {}
    async copy(target: File) { state.files.set(target.uri, state.files.get(this.uri)!); if (state.copyFailure) throw new Error('partial copy'); }
    async move(target: File) { state.files.set(target.uri, state.files.get(this.uri)!); state.files.delete(this.uri); this.uri = target.uri; }
    delete() { state.files.delete(this.uri); }
  }
  return { File, Directory: File, Paths: { document: { uri: 'file:///documents' } } };
});
vi.mock('../../epubArchive', () => ({ openEpubArchive: async (): Promise<EpubResourceArchive> => {
  const resources: Record<string, string> = { mimetype: 'application/epub+zip', 'META-INF/container.xml': '<container><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></container>', 'book.opf': '<package><manifest><item id="cover" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="one"/></spine></package>' };
  return { entries: [...Object.keys(resources), 'cover.jpg', 'one.xhtml', 'nav.xhtml'].map(path => ({ path, resourceID: path, size: state.sizeHint })), getSize: path => path === 'cover.jpg' ? state.sizeHint : 10, async readText(path) { state.reads.push(path); return resources[path] ?? null; }, async materialize(path) { expect(path).toBe('cover.jpg'); if (state.wait) await state.wait; if (state.materializeFailure) throw new Error('oversized image'); return { uri: 'file:///lease/cover', bytes: state.actualBytes, release: async () => { state.release += 1; state.files.delete('file:///lease/cover'); } }; }, async close() { state.close += 1; } };
} }));
import { loadBookCover } from '../bookCovers';
import { removeBookIndexRecords } from '../bookFileOperations';
let driver: NodeSQLiteDriver, serial = 0, id: string;
beforeEach(async () => { driver = createNodeSQLiteDriver(); state.layer = await createShudengDataLayer(driver); id = 'cover-' + (++serial); await state.layer.store.saveBook({ id, title: '图片书', format: 'epub', sourceHash: 'hash' }); state.files.clear(); state.files.set('file:///documents/Books/' + id + '.epub', new Uint8Array([0])); state.files.set('file:///lease/cover', new Uint8Array([1, 2, 3])); state.reads = []; state.release = 0; state.close = 0; state.sizeHint = 10; state.actualBytes = 10; state.copyFailure = false; state.materializeFailure = false; state.wait = null; });
afterEach(async () => { await driver.close(); });
const current = async () => (await state.layer!.store.getBook(id))!;

describe('EPUB cover file leases', () => {
  it('reads only metadata/image and retains the cover after Expo move mutates the File receiver', async () => {
    const uri = await loadBookCover(await current());
    expect(uri).toBe('file:///documents/Covers/' + id + '.jpg'); expect(state.files.has(uri!)).toBe(true);
    expect(state.reads).not.toContain('one.xhtml'); expect(state.reads).not.toContain('nav.xhtml'); expect(state.release).toBe(1); expect(state.close).toBe(1);
    expect([...state.files.keys()].some(path => path.includes('.partial'))).toBe(false);
  });
  it.each(['hint', 'actual', 'materialize', 'copy'])('downgrades an optional %s image failure and releases every owned resource', async kind => {
    if (kind === 'hint') state.sizeHint = 9 * 1024 * 1024;
    if (kind === 'actual') state.actualBytes = 9 * 1024 * 1024;
    if (kind === 'materialize') state.materializeFailure = true;
    if (kind === 'copy') state.copyFailure = true;
    expect(await loadBookCover(await current())).toBeUndefined(); expect(await current()).not.toBeNull(); expect(state.close).toBe(1);
    expect(state.release).toBe(kind === 'hint' || kind === 'materialize' ? 0 : 1);
    expect([...state.files.keys()].some(path => path.includes('/Covers/'))).toBe(false);
  });
  it('cannot restore a cover after deletion while materialization is delayed', async () => {
    let release!: () => void; state.wait = new Promise<void>(resolve => { release = resolve; });
    const pending = loadBookCover(await current());
    await vi.waitFor(() => { expect(state.reads).toContain('book.opf'); });
    await driver.transaction(async tx => { await removeBookIndexRecords(tx, id); await tx.run('DELETE FROM books WHERE id = ?', [id]); });
    release(); expect(await pending).toBeUndefined(); expect(state.release).toBe(1); expect(state.close).toBe(1);
    expect([...state.files.keys()].some(path => path.includes('/Covers/'))).toBe(false);
  });
  it('an old failed cover request cannot mark a reimported generation permanently absent', async () => {
    let release!: () => void; state.wait = new Promise<void>(resolve => { release = resolve; }); state.materializeFailure = true;
    const book = await current(), pending = loadBookCover(book);
    await vi.waitFor(() => { expect(state.reads).toContain('book.opf'); });
    await driver.transaction(async tx => { await removeBookIndexRecords(tx, id); await tx.run('DELETE FROM books WHERE id = ?', [id]); });
    await state.layer!.store.saveBook(book); release(); expect(await pending).toBeUndefined();
    state.wait = null; state.materializeFailure = false;
    const uri = await loadBookCover(await current());
    expect(uri).toBe('file:///documents/Covers/' + id + '.jpg'); expect(state.files.has(uri!)).toBe(true);
  });
});
