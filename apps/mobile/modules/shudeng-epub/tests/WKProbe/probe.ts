import { EPUB } from 'foliate-js/epub.js';
import { foliateResourceLoader } from '../../../../../../packages/reader-web/src/foliate-resource-loader.ts';
import type { EpubArchiveDescriptor } from '../../../../../../packages/core/src/rag/epub-resources.ts';

declare global { interface Window { __archive: EpubArchiveDescriptor; webkit: { messageHandlers: { probe: { postMessage(message: string): void } } } } }
const report = (result: unknown) => window.webkit.messageHandlers.probe.postMessage(JSON.stringify(result));

try {
  const requested: string[] = [];
  const paths = new Map(window.__archive.entries.map(entry => [entry.resourceID, entry.path]));
  const loader = foliateResourceLoader(window.__archive, ((input, init) => {
    requested.push(paths.get(new URL(String(input)).pathname.split('/').at(-1)!)!);
    return fetch(input, init);
  }) as typeof fetch);
  const book = await new EPUB(loader).init();
  const loaded: { stylesheetCount: number; imageCount: number; loadedImages: number; textLength: number }[] = [];
  for (const section of book.sections.slice(0, 2)) {
    const url = await section.load();
    const frame = document.createElement('iframe');
    frame.src = url; document.body.append(frame);
    await new Promise<void>((resolve, reject) => { frame.onload = () => resolve(); frame.onerror = () => reject(new Error('frame failed')); setTimeout(() => reject(new Error('frame timeout')), 8000); });
    const doc = frame.contentDocument!;
    await Promise.all(Array.from(doc.images).map(image => image.complete ? Promise.resolve() : new Promise<void>(resolve => { image.onload = () => resolve(); image.onerror = () => resolve(); })));
    loaded.push({ stylesheetCount: doc.styleSheets.length, imageCount: doc.images.length, loadedImages: Array.from(doc.images).filter(image => image.naturalWidth > 0).length, textLength: doc.body.textContent?.length ?? 0 });
    frame.remove(); section.unload();
  }
  const binary = window.__archive.entries.find(entry => entry.path.endsWith('.dat')) ?? window.__archive.entries.find(entry => entry.path.endsWith('.jpg'));
  let abortRejected = false;
  if (binary) {
    const controller = new AbortController();
    try {
      const response = await fetch(new URL(binary.resourceID, window.__archive.resourceBaseURL), { signal: controller.signal });
      const reader = response.body!.getReader();
      await reader.read();
      controller.abort();
      while (!(await reader.read()).done) {}
    } catch { abortRejected = true; }
  }
  // An aborted request must not poison a subsequent unrelated resource read.
  const afterAbort = await loader.loadText('META-INF/container.xml');
  loader.close();
  let closedRejected = false;
  try { await loader.loadText('META-INF/container.xml'); } catch { closedRejected = true; }
  report({ ok: true, origin: location.origin, title: book.metadata.title, sections: book.sections.length, requested, loaded, abortRejected, afterAbort: afterAbort?.includes('rootfile'), closedRejected });
} catch (error) { report({ ok: false, error: String(error), stack: error instanceof Error ? error.stack : '' }); }
