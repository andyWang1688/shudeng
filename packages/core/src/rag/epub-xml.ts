/** Shared EPUB XML and text rules. Pure TypeScript; no browser or platform runtime. */
import { DOMParser, type Document, type Element, type Node } from '@xmldom/xmldom';
import { strFromU8 } from 'fflate';

const BLOCK = new Set(['p', 'div', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'blockquote', 'br', 'hr']);
const OMIT = new Set(['script', 'style', 'head', 'noscript', 'nav']);

export function normalizedEpubText(value: string): string {
  return value.replace(/[\t\r\f ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function decodeEpubXml(bytes: Uint8Array): string {
  const littleEndian = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0);
  const bigEndian = (bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0x3c);
  if (!littleEndian && !bigEndian) return strFromU8(bytes);
  const start = bytes[0] === 0xff || bytes[0] === 0xfe ? 2 : 0;
  const pieces: string[] = [];
  let units: number[] = [];
  for (let index = start; index + 1 < bytes.length; index += 2) {
    units.push(littleEndian ? bytes[index]! + bytes[index + 1]! * 256 : bytes[index]! * 256 + bytes[index + 1]!);
    if (units.length === 4096) { pieces.push(String.fromCharCode(...units)); units = []; }
  }
  pieces.push(String.fromCharCode(...units));
  return pieces.join('');
}

export function epubElements(root: Document | Element, localName: string): Element[] {
  const result: Element[] = [];
  const stack: Node[] = [];
  for (let i = root.childNodes.length - 1; i >= 0; i -= 1) { const child = root.childNodes.item(i); if (child) stack.push(child); }
  while (stack.length) {
    const node = stack.pop()!;
    if (node.nodeType !== 1) continue;
    if ((node as Element).localName === localName) result.push(node as Element);
    for (let i = node.childNodes.length - 1; i >= 0; i -= 1) { const child = node.childNodes.item(i); if (child) stack.push(child); }
  }
  return result;
}

export function parseEpubXml(source: string, name: string, xhtml = false): Document {
  if (/<!ENTITY\s/i.test(source)) throw new Error('EPUB 包含不受支持的实体声明');
  try {
    return new DOMParser({
      onError(level, message) { if (level !== 'warning') throw new Error(message); },
    }).parseFromString(source, xhtml ? 'application/xhtml+xml' : 'application/xml');
  } catch {
    throw new Error('EPUB 文件损坏：无法读取 ' + name);
  }
}

/** Resolve archive paths without Node path/URL APIs or access outside the publication. */
export function resolveEpubPath(baseFile: string, href: string): string {
  const withoutFragment = href.split('#', 1)[0]!.split('?', 1)[0]!;
  if (!withoutFragment && baseFile && href.startsWith('#')) return baseFile;
  let decoded: string;
  try { decoded = decodeURIComponent(withoutFragment); } catch { throw new Error('EPUB 中的文件路径无效'); }
  if (!decoded || /^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\u0000')) {
    throw new Error('EPUB 中的文件路径无效');
  }
  const parts = baseFile.includes('/') ? baseFile.slice(0, baseFile.lastIndexOf('/')).split('/') : [];
  for (const part of decoded.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) throw new Error('EPUB 中的文件路径超出书籍范围');
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}

export function epubDocumentText(document: Document): string {
  const body = epubElements(document, 'body')[0] ?? document.documentElement;
  if (!body) return '';
  const pieces: string[] = [];
  const stack: { node: Node; after: boolean }[] = [{ node: body, after: false }];
  while (stack.length) {
    const { node, after } = stack.pop()!;
    if (node.nodeType === 3 || node.nodeType === 4) { pieces.push(node.nodeValue ?? ''); continue; }
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    const name = element.localName?.toLowerCase() ?? '';
    if (OMIT.has(name) || element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') continue;
    if (BLOCK.has(name)) pieces.push('\n');
    if (!after) {
      stack.push({ node, after: true });
      for (let index = element.childNodes.length - 1; index >= 0; index -= 1) {
        const child = element.childNodes.item(index);
        if (child) stack.push({ node: child, after: false });
      }
    }
  }
  return normalizedEpubText(pieces.join(''));
}

