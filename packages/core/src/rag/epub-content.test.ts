import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { extractEpubContent, resolveEpubPath } from './epub-content.js';
import { ParagraphTextChunker } from './chunker.js';

const container = '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="Book/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
const opf = '<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>灯 &amp; 书</dc:title><dc:creator>作者甲</dc:creator><dc:creator>作者乙</dc:creator></metadata><manifest><item id="b" href="Text/two" media-type="application/xhtml+xml"/><item id="a" href="Text/one.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>';

function fixture(overrides: Record<string, string | Uint8Array> = {}): Uint8Array {
  const entries: Record<string, string | Uint8Array> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': container,
    'Book/content.opf': opf,
    'Book/nav.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body><nav><a href="Text/one.xhtml#start">目录第一章</a><a href="#toc">本页</a></nav></body></html>',
    'Book/Text/one.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>标题</title><style>.noise {}</style></head><body><h1>灯</h1><p>灯照着 <em>书页</em> &amp; 原文。</p><script>private()</script><p hidden="hidden">隐藏文字</p></body></html>',
    'Book/Text/two': '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>第二章</h1><p>回到书中核查。</p></body></html>',
    'Book/cover.jpg': new Uint8Array(1024),
    ...overrides,
  };
  return zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, typeof value === 'string' ? strToU8(value) : value])));
}

describe('EPUB ingestion', () => {
  it('reads namespace metadata, spine order, extensionless sections and visible original text', () => {
    const content = extractEpubContent(fixture());
    expect(content.title).toBe('灯 & 书');
    expect(content.author).toBe('作者甲、作者乙');
    expect(content.chapters.map((chapter) => chapter.href)).toEqual(['Book/Text/one.xhtml', 'Book/Text/two']);
    expect(content.chapters[0]?.title).toBe('目录第一章');
    expect(content.chapters[0]?.text).toBe('灯\n\n灯照着 书页 & 原文。');
    expect(content.chapters[0]?.text).not.toContain('private');
    const chunks = new ParagraphTextChunker().chunk({ book: { id: 'b', title: '灯', format: 'epub', sourceHash: 'h' }, chapters: content.chapters });
    expect(chunks[0]?.locator).toMatchObject({ href: 'Book/Text/one.xhtml', locations: { progression: 0 }, text: { highlight: chunks[0]?.text } });
  });

  it('decodes UTF-16 chapter content without a browser or Node decoder', () => {
    const text = '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>中文原文</p></body></html>';
    const encoded = new Uint8Array(text.length * 2 + 2);
    encoded.set([0xff, 0xfe]);
    for (let index = 0; index < text.length; index += 1) { encoded[index * 2 + 2] = text.charCodeAt(index) & 255; encoded[index * 2 + 3] = text.charCodeAt(index) >> 8; }
    expect(extractEpubContent(fixture({ 'Book/Text/one.xhtml': encoded })).chapters[0]?.text).toBe('中文原文');
  });

  it('rejects missing and encrypted text instead of publishing a filename-only book', () => {
    expect(() => extractEpubContent(new Uint8Array([1, 2, 3]))).toThrow(/EPUB/);
    expect(() => extractEpubContent(fixture({ 'Book/content.opf': '<package><manifest/></package>' }))).toThrow(/阅读顺序/);
    expect(() => extractEpubContent(fixture({ 'META-INF/encryption.xml': '<encryption><EncryptedData><CipherData><CipherReference URI="Book/Text/one.xhtml"/></CipherData></EncryptedData></encryption>' }))).toThrow(/加密/);
  });

  it('accepts valid image-only chapters for reading while producing no fictional AI text', () => {
    const imagePage = '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="cover.jpg" alt=""/></body></html>';
    const content = extractEpubContent(fixture({ 'Book/Text/one.xhtml': imagePage, 'Book/Text/two': imagePage }));
    expect(content.chapters).toEqual([]);
    expect(content.title).toBe('灯 & 书');
  });

  it('extracts an actual EPUB cover from OPF cover-image and the EPUB2 meta pointer', () => {
    const withCover = opf.replace('<manifest>', '<manifest><item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>');
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const content = extractEpubContent(fixture({ 'Book/content.opf': withCover, 'Book/cover.png': png }));
    expect(content.cover).toEqual({ bytes: png, mimeType: 'image/png', extension: 'png' });
    const legacy = withCover.replace(' properties="cover-image"', '').replace('</metadata>', '<meta name="cover" content="cover"/></metadata>');
    expect(extractEpubContent(fixture({ 'Book/content.opf': legacy, 'Book/cover.png': png })).cover?.bytes).toEqual(png);
  });

  it('resolves encoded relative publication paths and rejects external/traversing paths', () => {
    expect(resolveEpubPath('Book/content.opf', '../Text/a%20b.xhtml#x')).toBe('Text/a b.xhtml');
    expect(resolveEpubPath('Book/nav.xhtml', '#toc')).toBe('Book/nav.xhtml');
    for (const path of ['../../outside.xhtml', 'https://example.com/a', '/etc/passwd', 'file:///a']) {
      expect(() => resolveEpubPath('Book/content.opf', path)).toThrow(/路径/);
    }
  });
});
