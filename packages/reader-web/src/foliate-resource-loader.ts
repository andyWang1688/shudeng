import type { EpubArchiveDescriptor } from '@shudeng/core';

/** An EPUB(loader) adapter. Caller passes the resulting EPUB book to view.open(book).
 * view.open(resourceBaseURL) would recreate a complete Blob/File and must not be used. */
export function foliateResourceLoader(archive: EpubArchiveDescriptor, fetchResource: typeof fetch = fetch) {
  const base = new URL(archive.resourceBaseURL);
  if (base.protocol !== 'shudeng-epub:' || base.hostname !== 'reader' || base.username || base.password || base.search || base.hash) {
    throw new Error('Invalid EPUB resource origin');
  }
  if (base.pathname !== '/' + archive.sessionID + '/') throw new Error('Invalid EPUB resource session');
  const resources = new Map(archive.entries.map(entry => [entry.path, entry]));
  if (resources.size !== archive.entries.length) throw new Error('Ambiguous EPUB resource');
  const pending = new Set<AbortController>();
  let closed = false;

  // Keep the abort controller alive until the response body is fully consumed too.
  const consume = async <T>(path: string, body: (response: Response) => Promise<T>): Promise<T | null> => {
    if (closed) throw new Error('EPUB resource session is closed');
    const controller = new AbortController(); pending.add(controller);
    // Foliate resolves relative URLs. The resulting exact ZIP name is a lookup key,
    // never a URL path: do not decode or normalize it again.
    const entry = resources.get(path);
    try {
      if (!entry) return null;
      if (!/^[a-f0-9-]{36}$/.test(entry.resourceID)) throw new Error('Invalid EPUB resource ID');
      const response = await fetchResource(new URL(entry.resourceID, base), { signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error' });
      if (!response.ok) throw new Error('Cannot read EPUB resource: ' + response.status);
      const result = await body(response);
      if (closed || controller.signal.aborted) throw new Error('EPUB resource session is closed');
      return result;
    } finally { pending.delete(controller); }
  };
  return {
    // Foliate indexes ZIP metadata without reading each resource. Keep exact
    // archive names here; native UUIDs remain private to consume().
    entries: archive.entries.map(entry => ({ filename: entry.path, uncompressedSize: entry.size })),
    loadText: (path: string) => consume(path, async response => {
      const bytes = new Uint8Array(await response.arrayBuffer());
      const little = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0);
      const big = (bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0x3c);
      return new TextDecoder(little ? 'utf-16le' : big ? 'utf-16be' : 'utf-8').decode(bytes);
    }),
    loadBlob: (path: string, mimeType?: string) => consume(path, async response => {
      const blob = await response.blob();
      return mimeType ? blob.slice(0, blob.size, mimeType) : blob;
    }),
    getSize: (path: string) => resources.get(path)?.size ?? 0,
    /** view.close() first revokes Foliate Blob URLs; this cancels pending native reads. */
    close() { closed = true; pending.forEach(controller => controller.abort()); pending.clear(); },
  };
}
