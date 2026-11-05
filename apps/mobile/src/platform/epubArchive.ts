import { requireOptionalNativeModule } from 'expo';
import { assertNotAborted, type EpubArchiveDescriptor, type EpubResourceArchive, type EpubResourceLease, type EpubResourceOptions } from '@shudeng/core';

type NativeLease = { readonly sessionID: string; readonly leaseID: string; readonly uri: string; readonly bytes: number };
type EpubNativeModule = {
  openEpubArchive(uri: string): Promise<EpubArchiveDescriptor>;
  readEpubArchiveText(sessionID: string, resourceID: string): Promise<string>;
  materializeEpubResource(sessionID: string, resourceID: string): Promise<NativeLease>;
  releaseEpubResource(sessionID: string, leaseID: string): Promise<void>;
  closeEpubArchive(sessionID: string): Promise<void>;
};

function epubModule(): EpubNativeModule {
  const module = requireOptionalNativeModule<EpubNativeModule>('ShudengEpub');
  if (!module || typeof module.openEpubArchive !== 'function') throw new Error('当前版本无法读取 EPUB 文件，请安装完整版本后重试');
  return module;
}

function validateDescriptor(value: EpubArchiveDescriptor): void {
  if (!/^[a-f0-9-]{36}$/.test(value.sessionID) || value.resourceBaseURL !== 'shudeng-epub://reader/' + value.sessionID + '/') throw new Error('EPUB 读取会话无效');
  const paths = new Set<string>(), ids = new Set<string>();
  for (const entry of value.entries) {
    if (!entry.path || paths.has(entry.path) || ids.has(entry.resourceID) || !/^[a-f0-9-]{36}$/.test(entry.resourceID) || !Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error('EPUB 资源目录无效');
    paths.add(entry.path); ids.add(entry.resourceID);
  }
}

export async function openReaderEpubArchive(uri: string): Promise<EpubArchiveDescriptor> {
  const native = epubModule(), descriptor = await native.openEpubArchive(uri);
  try { validateDescriptor(descriptor); return descriptor; }
  catch (error) { await native.closeEpubArchive(descriptor.sessionID); throw error; }
}

export async function closeReaderEpubArchive(sessionID: string): Promise<void> { await epubModule().closeEpubArchive(sessionID); }

export interface EpubArchiveHandle extends EpubResourceArchive { readonly descriptor: EpubArchiveDescriptor }

/** ZIP bytes never enter Hermes. This adapter transfers one native string or an owned
 * temporary file per resource. Aborting any operation closes its exclusive session. */
export async function openEpubArchive(uri: string, options: EpubResourceOptions = {}): Promise<EpubArchiveHandle> {
  assertNotAborted(options.signal);
  const native = epubModule(), descriptor = await openReaderEpubArchive(uri);
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => closing ??= native.closeEpubArchive(descriptor.sessionID);
  try { assertNotAborted(options.signal); } catch (error) { await close(); throw error; }
  const entries = new Map(descriptor.entries.map(entry => [entry.path, entry]));
  const run = async <T>(operation: () => Promise<T>, requestOptions: EpubResourceOptions): Promise<T> => {
    const signal = requestOptions.signal || options.signal ? { get aborted() { return requestOptions.signal?.aborted === true || options.signal?.aborted === true; } } : undefined;
    assertNotAborted(signal);
    if (closing) throw new Error('EPUB 读取已关闭');
    // Core cancellation can be a plain readonly boolean, so it cannot rely only on
    // DOM AbortSignal events. Polling exists solely while a native request is pending.
    const timer = signal ? setInterval(() => { if (signal.aborted) void close().catch(() => {}); }, 25) : undefined;
    try {
      const result = await operation();
      if (signal?.aborted) await close();
      assertNotAborted(signal);
      if (closing) throw new Error('EPUB 读取已关闭');
      return result;
    } catch (error) {
      if (signal?.aborted) { await close(); assertNotAborted(signal); }
      throw error;
    } finally { if (timer !== undefined) clearInterval(timer); }
  };
  return {
    descriptor, entries: descriptor.entries, getSize: path => entries.get(path)?.size ?? 0, close,
    async readText(path, requestOptions = {}) {
      const entry = entries.get(path);
      if (!entry) { assertNotAborted(options.signal); assertNotAborted(requestOptions.signal); if (closing) throw new Error('EPUB 读取已关闭'); return null; }
      return run(() => native.readEpubArchiveText(descriptor.sessionID, entry.resourceID), requestOptions);
    },
    async materialize(path, requestOptions = {}): Promise<EpubResourceLease | null> {
      const entry = entries.get(path);
      if (!entry) { assertNotAborted(options.signal); assertNotAborted(requestOptions.signal); if (closing) throw new Error('EPUB 读取已关闭'); return null; }
      let lease: NativeLease | undefined;
      try {
        lease = await run(() => native.materializeEpubResource(descriptor.sessionID, entry.resourceID), requestOptions);
        let releasing: Promise<void> | undefined;
        const owned = lease;
        return { uri: owned.uri, bytes: owned.bytes, release: () => releasing ??= native.releaseEpubResource(owned.sessionID, owned.leaseID) };
      } catch (error) {
        // Native close cancels/joins a resource completed just before cancellation.
        if (lease) await native.releaseEpubResource(lease.sessionID, lease.leaseID);
        throw error;
      }
    },
  };
}
