import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const sessionID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', resourceID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  return { sessionID, resourceID, descriptor: { sessionID, resourceBaseURL: 'shudeng-epub://reader/' + sessionID + '/', entries: [{ path: 'OPS/chapter.xhtml', resourceID, size: 7 }] },
    open: vi.fn(), read: vi.fn(), materialize: vi.fn(), release: vi.fn(), close: vi.fn() };
});
vi.mock('expo', () => ({ requireOptionalNativeModule: () => ({ openEpubArchive: state.open, readEpubArchiveText: state.read, materializeEpubResource: state.materialize, releaseEpubResource: state.release, closeEpubArchive: state.close }) }));
const { openEpubArchive, openReaderEpubArchive } = await import('../epubArchive');

beforeEach(() => {
  vi.useRealTimers(); vi.clearAllMocks();
  state.open.mockResolvedValue(state.descriptor); state.read.mockResolvedValue('正文'); state.close.mockResolvedValue(undefined); state.release.mockResolvedValue(undefined);
  state.materialize.mockResolvedValue({ sessionID: state.sessionID, leaseID: 'lease', uri: 'file:///owned/cache/resource', bytes: 7 });
});

describe('native EPUB resource adapter', () => {
  it('passes only opaque IDs and transfers owned cover files without bytes/base64', async () => {
    const archive = await openEpubArchive('file:///books/book.epub');
    expect(await archive.readText('OPS/chapter.xhtml')).toBe('正文');
    expect(state.read).toHaveBeenCalledWith(state.sessionID, state.resourceID);
    expect(await archive.readText('../outside')).toBeNull();
    const lease = await archive.materialize('OPS/chapter.xhtml');
    expect(lease?.uri).toBe('file:///owned/cache/resource');
    await lease?.release(); await lease?.release();
    expect(state.release).toHaveBeenCalledTimes(1);
    await archive.close(); await archive.close();
    expect(state.close).toHaveBeenCalledTimes(1);
    await expect(archive.readText('OPS/chapter.xhtml')).rejects.toThrow('关闭');
  });
  it('cancels a pending native read even with a plain boolean cancellation signal', async () => {
    vi.useFakeTimers();
    const signal = { aborted: false };
    let reject!: (error: Error) => void;
    state.read.mockImplementation(() => new Promise((_resolve, failure) => { reject = failure; }));
    state.close.mockImplementation(async () => { reject(new Error('native closed')); });
    const archive = await openEpubArchive('file:///books/book.epub', { signal });
    const read = archive.readText('OPS/chapter.xhtml');
    const rejected = expect(read).rejects.toThrow();
    signal.aborted = true;
    await vi.advanceTimersByTimeAsync(25); await rejected;
    expect(state.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('closes a materialized resource completed at the cancellation boundary', async () => {
    const signal = { aborted: false };
    state.materialize.mockImplementation(async () => { signal.aborted = true; return { sessionID: state.sessionID, leaseID: 'race', uri: 'file:///owned/race', bytes: 7 }; });
    const archive = await openEpubArchive('file:///books/book.epub', { signal });
    await expect(archive.materialize('OPS/chapter.xhtml')).rejects.toThrow();
    expect(state.close).toHaveBeenCalledTimes(1);
  });
  it('closes a malformed native descriptor before rejecting it', async () => {
    state.open.mockResolvedValue({ ...state.descriptor, resourceBaseURL: 'https://remote.invalid/' });
    await expect(openReaderEpubArchive('file:///books/book.epub')).rejects.toThrow('会话');
    expect(state.close).toHaveBeenCalledWith(state.sessionID);
  });
});
