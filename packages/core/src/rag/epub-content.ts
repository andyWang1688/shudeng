/** EPUB ingestion runs unchanged in Hermes and Node; ZIP/XML never use DOM globals. */
import { strFromU8, unzipSync } from 'fflate';
import type { RagChapter } from './types.js';
import { normalizedEpubText as normalizedText, decodeEpubXml as decodeXml, epubElements as elements, parseEpubXml as parseXml, epubDocumentText as documentText, resolveEpubPath } from './epub-xml.js';
export { resolveEpubPath } from './epub-xml.js';

export interface EpubContent {
  readonly title: string | null;
  readonly author: string | null;
  readonly chapters: readonly RagChapter[];
  readonly cover?: { readonly bytes: Uint8Array; readonly mimeType: string; readonly extension: 'jpg' | 'png' | 'svg' | 'webp' };
}

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
const MAX_TEXT_BYTES = 128 * 1024 * 1024;
/** Validate container/manifest/spine before accepting the book; images/fonts never inflate into JS. */
export function extractEpubContent(bytes: Uint8Array): EpubContent {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error('EPUB 文件超过 100 MB，请使用较小的文件');
  let extractedBytes = 0;
  const entries: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  const inflate = (names: ReadonlySet<string>): void => {
    try {
      Object.assign(entries, unzipSync(bytes, {
        filter(entry) {
          if (!names.has(entry.name) || entries[entry.name]) return false;
          if (entry.originalSize > MAX_DOCUMENT_BYTES) throw new Error('EPUB 章节过大');
          extractedBytes += entry.originalSize;
          if (extractedBytes > MAX_TEXT_BYTES) throw new Error('EPUB 正文过大');
          return true;
        },
      }));
    } catch (error) {
      throw new Error('无法读取 EPUB：' + (error instanceof Error ? error.message : '文件损坏或已加密'));
    }
  };
  inflate(new Set(['mimetype', 'META-INF/container.xml', 'META-INF/encryption.xml']));
  const read = (name: string): string => {
    if (!entries[name]) inflate(new Set([name]));
    const entry = entries[name];
    if (!entry) throw new Error('EPUB 文件缺少 ' + name);
    if (entry.byteLength > MAX_DOCUMENT_BYTES) throw new Error('EPUB 章节过大');
    return decodeXml(entry);
  };
  const mime = entries.mimetype ? strFromU8(entries.mimetype).trim() : '';
  if (mime && mime !== 'application/epub+zip') throw new Error('所选文件不是 EPUB 书籍');
  const container = parseXml(read('META-INF/container.xml'), 'container.xml');
  const packagePath = elements(container, 'rootfile').find((item) => item.getAttribute('media-type') === 'application/oebps-package+xml')?.getAttribute('full-path')
    ?? elements(container, 'rootfile')[0]?.getAttribute('full-path');
  if (!packagePath) throw new Error('EPUB 文件没有书籍内容');
  const opfPath = resolveEpubPath('', packagePath);
  const opf = parseXml(read(opfPath), opfPath);
  const metadata = elements(opf, 'metadata')[0];
  const title = metadata ? normalizedText(elements(metadata, 'title')[0]?.textContent ?? '') || null : null;
  const author = metadata ? elements(metadata, 'creator').map((item) => normalizedText(item.textContent ?? '')).filter(Boolean).join('、') || null : null;
  const manifest = new Map<string, { href: string; mediaType: string; properties: string }>();
  for (const item of elements(opf, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    const mediaType = item.getAttribute('media-type') ?? '';
    // Remote cover/audio assets are valid EPUB resources but are never needed for offline text ingestion.
    if (href && /^[a-z][a-z0-9+.-]*:/i.test(href) && !/^(application\/xhtml\+xml|text\/html|image\/svg\+xml)$/.test(mediaType)) continue;
    if (id && href) manifest.set(id, {
      href: resolveEpubPath(opfPath, href),
      mediaType,
      properties: item.getAttribute('properties') ?? '',
    });
  }
  const spine = elements(opf, 'spine')[0];
  const references = spine ? elements(spine, 'itemref') : [];
  if (references.length === 0) throw new Error('EPUB 文件没有阅读顺序');
  // EPUB paths need not have extensions. Inflate exactly manifest content, never images or fonts.
  inflate(new Set([...manifest.values()].filter((item) => /^(application\/xhtml\+xml|text\/html)$/.test(item.mediaType) || item.properties.split(/\s+/).includes('nav')).map((item) => item.href)));
  const encrypted = new Set<string>();
  if (entries['META-INF/encryption.xml']) {
    const encryption = parseXml(read('META-INF/encryption.xml'), 'encryption.xml');
    for (const cipher of elements(encryption, 'CipherReference')) {
      const uri = cipher.getAttribute('URI');
      if (uri) encrypted.add(resolveEpubPath('', uri));
    }
  }
  const labels = new Map<string, string>();
  for (const item of manifest.values()) {
    if (!item.properties.split(/\s+/).includes('nav')) continue;
    const nav = parseXml(read(item.href), item.href, true);
    for (const link of elements(nav, 'a')) {
      const href = link.getAttribute('href');
      const label = normalizedText(link.textContent ?? '');
      if (href && label) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
        const path = resolveEpubPath(item.href, href);
        if (!labels.has(path)) labels.set(path, label);
      }
    }
  }
  const chapters: RagChapter[] = [];
  references.forEach((reference, index) => {
    const id = reference.getAttribute('idref');
    const item = id ? manifest.get(id) : undefined;
    if (!item) throw new Error('EPUB 阅读顺序引用了不存在的章节');
    if (!/^(application\/xhtml\+xml|text\/html|image\/svg\+xml)$/.test(item.mediaType)) return;
    if (encrypted.has(item.href)) throw new Error('这本 EPUB 的正文已加密，无法导入');
    const document = parseXml(read(item.href), item.href, true);
    const text = documentText(document);
    if (!text) return;
    const heading = ['h1', 'h2', 'h3'].map((name) => normalizedText(elements(document, name)[0]?.textContent ?? '')).find(Boolean);
    const chapterTitle = labels.get(item.href) ?? heading ?? (normalizedText(elements(document, 'title')[0]?.textContent ?? '') || '第 ' + (index + 1) + ' 节');
    chapters.push({ ordinal: index + 1, title: chapterTitle, href: item.href, text });
  });
  const imageCover = [...manifest.values()].find((item) => item.properties.split(/\s+/).includes('cover-image'));
  const legacyCoverId = metadata ? elements(metadata, 'meta').find((item) => item.getAttribute('name') === 'cover')?.getAttribute('content') : null;
  let coverItem = imageCover ?? (legacyCoverId ? manifest.get(legacyCoverId) : undefined);
  if (!coverItem) {
    const guideCover = elements(opf, 'reference').find((item) => item.getAttribute('type') === 'cover')?.getAttribute('href');
    if (guideCover) {
      const path = resolveEpubPath(opfPath, guideCover);
      coverItem = [...manifest.values()].find((item) => item.href === path);
    }
  }
  let cover: EpubContent['cover'];
  if (coverItem) {
    if (/^(application\/xhtml\+xml|text\/html)$/.test(coverItem.mediaType)) {
      const document = parseXml(read(coverItem.href), coverItem.href, true);
      const image = elements(document, 'img')[0];
      const imageHref = image?.getAttribute('src');
      if (imageHref && !/^[a-z][a-z0-9+.-]*:/i.test(imageHref)) {
        const path = resolveEpubPath(coverItem.href, imageHref);
        coverItem = [...manifest.values()].find((item) => item.href === path);
      } else coverItem = undefined;
    }
    if (coverItem) {
      const extension = coverItem.mediaType === 'image/png' ? 'png' : coverItem.mediaType === 'image/svg+xml' ? 'svg' : coverItem.mediaType === 'image/webp' ? 'webp' : /^image\/(jpe?g)$/.test(coverItem.mediaType) ? 'jpg' : null;
      if (extension) {
        inflate(new Set([coverItem.href]));
        const bytes = entries[coverItem.href];
        if (bytes && bytes.length > 0) cover = { bytes, mimeType: coverItem.mediaType, extension };
      }
    }
  }
  // Image-only publications remain readable even though they cannot supply AI evidence.
  return { title, author, chapters, ...(cover ? { cover } : {}) };
}
