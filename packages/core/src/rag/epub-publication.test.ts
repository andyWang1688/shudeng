import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { extractEpubContent } from './epub-content.js';
import { decodeEpubXml } from './epub-xml.js';
import { inspectEpubResources, inspectEpubCover, readEpubChapter, validateEpubChapter } from './epub-publication.js';
import { ParagraphTextChunker } from './chunker.js';
import type { EpubResourceArchive } from './epub-resources.js';

async function fixture(name: string) {
  const bytes = new Uint8Array(await readFile(new URL('../../../../ios/ShudengTests/Fixtures/' + name, import.meta.url)));
  const files = unzipSync(bytes), reads: string[] = [];
  const archive: EpubResourceArchive = {
    entries: Object.entries(files).filter(([path]) => !path.endsWith('/')).map(([path, data], index) => ({ path, resourceID: String(index), size: data.length })),
    getSize: path => files[path]?.length ?? 0,
    async readText(path, options) { if (options?.signal?.aborted) throw new Error('cancelled'); reads.push(path); return files[path] ? decodeEpubXml(files[path]) : null; },
    async materialize() { throw new Error('text tests must not materialize resources'); }, async close() {},
  };
  return { archive, bytes, files, reads };
}

describe('file-backed EPUB publication', () => {
  it.each(['search-fixture.epub', 'pride-and-prejudice.epub', 'semantic-fixture.epub'])('preserves exact chapters/chunk IDs/UTF16 positions: %s', async name => {
    const { archive, bytes, reads } = await fixture(name), old = extractEpubContent(bytes);
    const publication = await inspectEpubResources(archive);
    const chapters = [];
    for (const resource of publication.chapters) {
      if (!reads.includes(resource.href)) continue;
      // A nav resource may itself appear in the spine. Ordinary chapter bodies stay unread.
      expect(archive.entries.find(entry => entry.path === resource.href)).toBeDefined();
    }
    for (const resource of publication.chapters) { const chapter = await readEpubChapter(archive, resource); if (chapter.text) chapters.push(chapter); }
    expect(publication.title).toBe(old.title); expect(publication.author).toBe(old.author);
    expect(chapters).toEqual(old.chapters);
    const book = { id: 'same-book-id', title: old.title ?? '', format: 'epub' as const, sourceHash: 'same-hash' }, chunker = new ParagraphTextChunker();
    const original = chunker.chunk({ book, chapters: old.chapters });
    expect(chapters.flatMap(chapter => [...chunker.iterate({ book, chapters: [chapter] })])).toEqual(original);
    for (const chunk of original) expect(chapters.find(chapter => chapter.ordinal === chunk.chapterOrdinal)?.text?.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.text);
  });

  it('metadata and cover discovery do not visit ordinary spine or nav bodies', async () => {
    const { archive, reads } = await fixture('search-fixture.epub');
    const publication = await inspectEpubResources(archive);
    expect(reads).not.toContain(publication.chapters[0]!.href);
    reads.length = 0;
    await inspectEpubCover(archive);
    expect(reads.every(path => path === 'mimetype' || path === 'META-INF/container.xml' || path === 'META-INF/encryption.xml' || path.endsWith('.opf'))).toBe(true);
  });

  it('rejects fixed layouts, encrypted spine, missing and malformed chapters before publishing', async () => {
    const fixed = await fixture('fixed-layout.epub');
    await expect(inspectEpubResources(fixed.archive)).rejects.toThrow(/固定版式/);
    const { archive, files } = await fixture('search-fixture.epub');
    const publication = await inspectEpubResources(archive), chapter = publication.chapters[0]!;
    delete files[chapter.href];
    await expect(validateEpubChapter(archive, chapter)).rejects.toThrow(/缺少/);
    files[chapter.href] = new TextEncoder().encode('<not-html/>');
    await expect(validateEpubChapter(archive, chapter)).rejects.toThrow(/HTML/);
    const original = archive.readText.bind(archive);
    archive.readText = async (path, options) => path === 'META-INF/encryption.xml' ? '<encryption><CipherReference URI="' + chapter.href + '"/></encryption>' : original(path, options);
    await expect(inspectEpubResources(archive)).rejects.toThrow(/已加密/);
  });
});
