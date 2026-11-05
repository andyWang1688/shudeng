import { describe, expect, it } from 'vitest';
import { epubDocumentText, epubElements, normalizedEpubText, parseEpubXml } from './epub-xml.js';

describe('EPUB shared XML rules', () => {
  it('preserves normalized paragraph boundaries, hidden content and UTF16 text', () => {
    const xml = parseEpubXml('<html><head><title>omit</title></head><body><h1>标题</h1><p> 中😀文 <b> 继续</b> </p><p hidden="hidden">omit</p><nav>omit</nav><p>最后<br/>一行</p></body></html>', 'chapter', true);
    expect(epubDocumentText(xml)).toBe('标题\n\n中😀文 继续\n\n最后\n\n一行');
    expect(normalizedEpubText(' a\t b \n c ')).toBe('a b\nc');
  });
  it('handles deeply nested content without recursive traversal', () => {
    const count = 12000;
    const xml = parseEpubXml('<html><body>' + '<div>'.repeat(count) + '正文' + '</div>'.repeat(count) + '</body></html>', 'nested', true);
    expect(epubElements(xml, 'div')).toHaveLength(count);
    expect(epubDocumentText(xml)).toBe('正文');
  });
  it('rejects entity declarations before parsing', () => {
    expect(() => parseEpubXml('<!DOCTYPE html [<!ENTITY x "expanded">]><html>&x;</html>', 'entity', true)).toThrow('实体声明');
  });
});
