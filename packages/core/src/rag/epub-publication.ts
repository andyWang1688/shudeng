/** File-backed EPUB publication parsing. ZIP and byte budgets belong to the resource port. */
import type { Document } from '@xmldom/xmldom';
import type { EpubCoverResource, EpubResourceArchive } from './epub-resources.js';
import { epubDocumentText, epubElements, normalizedEpubText, parseEpubXml, resolveEpubPath } from './epub-xml.js';
import { assertNotAborted, type CancellationSignal, type RagChapter } from './types.js';

export interface EpubChapterResource {
  readonly ordinal: number;
  readonly href: string;
  readonly mediaType: string;
  readonly title: string | null;
}

export interface EpubPublication {
  readonly title: string | null;
  readonly author: string | null;
  readonly chapters: readonly EpubChapterResource[];
}

interface ManifestItem { readonly href: string; readonly mediaType: string; readonly properties: string }
interface PackageMetadata {
  readonly title: string | null;
  readonly author: string | null;
  readonly manifest: ReadonlyMap<string, ManifestItem>;
  readonly chapters: readonly EpubChapterResource[];
  readonly cover: ManifestItem | undefined;
}

async function read(archive: EpubResourceArchive, path: string, signal?: CancellationSignal): Promise<string> {
  assertNotAborted(signal);
  const text = await archive.readText(path, signal ? { signal } : {});
  assertNotAborted(signal);
  if (!text) throw new Error('EPUB 文件缺少 ' + path);
  return text;
}

/** This reads container/package/encryption only. Cover discovery must never visit spine/nav text. */
async function inspectPackage(archive: EpubResourceArchive, signal?: CancellationSignal): Promise<PackageMetadata> {
  assertNotAborted(signal);
  const mimetype = await archive.readText('mimetype', signal ? { signal } : {});
  if (mimetype?.trim() && mimetype.trim() !== 'application/epub+zip') throw new Error('所选文件不是 EPUB 书籍');
  const container = parseEpubXml(await read(archive, 'META-INF/container.xml', signal), 'container.xml');
  const roots = epubElements(container, 'rootfile');
  const packagePath = (roots.find(item => item.getAttribute('media-type') === 'application/oebps-package+xml') ?? roots[0])?.getAttribute('full-path');
  if (!packagePath) throw new Error('EPUB 文件没有书籍内容');
  const path = resolveEpubPath('', packagePath);
  const opf = parseEpubXml(await read(archive, path, signal), path);
  const metadata = epubElements(opf, 'metadata')[0];
  const references = epubElements(opf, 'spine')[0] ? epubElements(epubElements(opf, 'spine')[0]!, 'itemref') : [];
  const fixed = metadata && epubElements(metadata, 'meta').some(item => item.getAttribute('property') === 'rendition:layout' && item.textContent?.trim() === 'pre-paginated');
  if (fixed || references.some(item => item.getAttribute('properties')?.split(/\s+/).includes('rendition:layout-pre-paginated'))) throw new Error('仅支持未加密的可重排 EPUB，暂不支持固定版式 EPUB');
  if (!references.length) throw new Error('EPUB 文件没有阅读顺序');
  const manifest = new Map<string, ManifestItem>();
  for (const item of epubElements(opf, 'item')) {
    const id = item.getAttribute('id'), href = item.getAttribute('href');
    if (!id || !href) continue;
    if (manifest.has(id)) throw new Error('EPUB 目录包含重复资源');
    // Optional remote resources are not needed by the offline reader/index/cover.
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
    manifest.set(id, { href: resolveEpubPath(path, href), mediaType: item.getAttribute('media-type') ?? '', properties: item.getAttribute('properties') ?? '' });
  }
  const encrypted = new Set<string>();
  const encryption = await archive.readText('META-INF/encryption.xml', signal ? { signal } : {});
  if (encryption) for (const cipher of epubElements(parseEpubXml(encryption, 'encryption.xml'), 'CipherReference')) {
    const uri = cipher.getAttribute('URI');
    if (uri) encrypted.add(resolveEpubPath('', uri));
  }
  const paths = new Set(archive.entries.map(entry => entry.path));
  const chapters = references.map((reference, index): EpubChapterResource => {
    const id = reference.getAttribute('idref'), item = id ? manifest.get(id) : undefined;
    if (!item) throw new Error('EPUB 阅读顺序引用了不存在的章节');
    if (!/^(application\/xhtml\+xml|text\/html)$/.test(item.mediaType)) throw new Error('EPUB 阅读顺序包含不受支持的内容');
    if (encrypted.has(item.href)) throw new Error('这本 EPUB 的正文已加密，无法导入');
    if (!paths.has(item.href)) throw new Error('EPUB 文件缺少 ' + item.href);
    return { ordinal: index + 1, href: item.href, mediaType: item.mediaType, title: null };
  });
  const imageCover = [...manifest.values()].find(item => item.properties.split(/\s+/).includes('cover-image'));
  const coverId = metadata ? epubElements(metadata, 'meta').find(item => item.getAttribute('name') === 'cover')?.getAttribute('content') : null;
  let cover = imageCover ?? (coverId ? manifest.get(coverId) : undefined);
  if (!cover) {
    const guide = epubElements(opf, 'reference').find(item => item.getAttribute('type') === 'cover')?.getAttribute('href');
    if (guide && !/^[a-z][a-z0-9+.-]*:/i.test(guide)) {
      const href = resolveEpubPath(path, guide);
      cover = [...manifest.values()].find(item => item.href === href);
    }
  }
  return { title: metadata ? normalizedEpubText(epubElements(metadata, 'title')[0]?.textContent ?? '') || null : null, author: metadata ? epubElements(metadata, 'creator').map(item => normalizedEpubText(item.textContent ?? '')).filter(Boolean).join('、') || null : null, manifest, chapters, cover };
}

/** Metadata and navigation labels only; import must validate each spine before publishing. */
export async function inspectEpubResources(archive: EpubResourceArchive, signal?: CancellationSignal): Promise<EpubPublication> {
  const publication = await inspectPackage(archive, signal);
  const labels = new Map<string, string>();
  for (const item of publication.manifest.values()) {
    if (!item.properties.split(/\s+/).includes('nav')) continue;
    const nav = parseEpubXml(await read(archive, item.href, signal), item.href, true);
    for (const link of epubElements(nav, 'a')) {
      const href = link.getAttribute('href'), label = normalizedEpubText(link.textContent ?? '');
      if (!href || !label || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
      const target = resolveEpubPath(item.href, href);
      if (!labels.has(target)) labels.set(target, label);
    }
  }
  return { title: publication.title, author: publication.author, chapters: publication.chapters.map(chapter => ({ ...chapter, title: labels.get(chapter.href) ?? null })) };
}

async function chapterDocument(archive: EpubResourceArchive, chapter: EpubChapterResource, signal?: CancellationSignal): Promise<Document> {
  const document = parseEpubXml(await read(archive, chapter.href, signal), chapter.href, true);
  if (chapter.mediaType === 'application/xhtml+xml' && document.documentElement?.localName !== 'html') throw new Error('EPUB 章节不是有效的 HTML');
  return document;
}

/** Matches native import: every spine resource must be nonempty, well-formed and supported. */
export async function validateEpubChapter(archive: EpubResourceArchive, chapter: EpubChapterResource, signal?: CancellationSignal): Promise<void> {
  await chapterDocument(archive, chapter, signal);
  assertNotAborted(signal);
}

/** Only one chapter is retained. UTF16 text/href/ordinal contracts match the original extractor. */
export async function readEpubChapter(archive: EpubResourceArchive, chapter: EpubChapterResource, signal?: CancellationSignal): Promise<RagChapter> {
  const document = await chapterDocument(archive, chapter, signal);
  const text = epubDocumentText(document);
  assertNotAborted(signal);
  const heading = ['h1', 'h2', 'h3'].map(name => normalizedEpubText(epubElements(document, name)[0]?.textContent ?? '')).find(Boolean);
  const title = chapter.title ?? heading ?? (normalizedEpubText(epubElements(document, 'title')[0]?.textContent ?? '') || '第 ' + chapter.ordinal + ' 节');
  return { ordinal: chapter.ordinal, href: chapter.href, title, text };
}

/** Cover-only discovery reads metadata plus at most the cover wrapper; no body/nav extraction. */
export async function inspectEpubCover(archive: EpubResourceArchive, signal?: CancellationSignal): Promise<EpubCoverResource | undefined> {
  const publication = await inspectPackage(archive, signal);
  let item = publication.cover;
  if (item && /^(application\/xhtml\+xml|text\/html)$/.test(item.mediaType)) {
    const wrapper = parseEpubXml(await read(archive, item.href, signal), item.href, true);
    const href = epubElements(wrapper, 'img')[0]?.getAttribute('src') ?? epubElements(wrapper, 'image')[0]?.getAttribute('href') ?? epubElements(wrapper, 'image')[0]?.getAttribute('xlink:href');
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) return undefined;
    const path = resolveEpubPath(item.href, href);
    item = [...publication.manifest.values()].find(resource => resource.href === path);
  }
  if (!item) return undefined;
  const extension = item.mediaType === 'image/png' ? 'png' : item.mediaType === 'image/svg+xml' ? 'svg' : item.mediaType === 'image/webp' ? 'webp' : /^image\/(jpe?g)$/.test(item.mediaType) ? 'jpg' : null;
  return extension ? { href: item.href, mediaType: item.mediaType, extension } : undefined;
}
