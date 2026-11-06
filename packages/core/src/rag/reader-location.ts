import { resolveEpubPath } from './epub-xml.js';

export interface ReaderTextLocation {
  href?: string; page?: number; highlight?: string; before?: string; after?: string; progression?: number; cfi?: string;
}
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => typeof value === 'object' && value !== null && !Array.isArray(value);

/** ReaderLocator / Readium 的位置只在当前书内解析；DOM 的 charOffset 不是章节 offset。 */
export function parseReaderTextLocation(value: unknown, bookId: string, depth = 0): ReaderTextLocation | null {
  if (depth > 5) throw new Error('阅读位置嵌套过深');
  if (typeof value === 'string') {
    if (value.startsWith('epubcfi(')) return { cfi: value };
    try { return parseReaderTextLocation(JSON.parse(value), bookId, depth + 1); } catch { throw new Error('阅读位置无法解析'); }
  }
  if (!object(value)) return null;
  for (const key of ['bookId', 'bookID']) if (value[key] !== undefined && value[key] !== bookId) throw new Error('阅读位置不属于当前书');
  if (value.selection !== undefined) {
    const selection = parseReaderTextLocation(value.selection, bookId, depth + 1);
    if (selection) return selection;
  }
  if (value.schema === 'shudeng.anchor.v3') return parseReaderTextLocation(value.readium ?? value.locator, bookId, depth + 1);
  if (value.type === 'epub' && typeof value.cfi === 'string' && value.cfi.trim().startsWith('{')) {
    const nested = parseReaderTextLocation(value.cfi, bookId, depth + 1);
    if (nested) return nested;
  }
  const locations = object(value.locations) ? value.locations : {};
  const text = object(value.text) ? value.text : {};
  const result: ReaderTextLocation = {};
  for (const key of ['before', 'highlight', 'after'] as const) {
    if (text[key] !== undefined) {
      if (typeof text[key] !== 'string') throw new Error('选文上下文格式无效');
      result[key] = text[key];
    }
  }
  if (typeof value.text === 'string') result.highlight = value.text;
  const pages: number[] = [];
  for (const page of [value.type === 'pdf' ? value.page : undefined, locations.page]) {
    if (page !== undefined) {
      if (typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1) throw new Error('PDF 页码无效');
      pages.push(page);
    }
  }
  if (typeof value.href === 'string') {
    const pdf = new RegExp('^pdf://page/([1-9][0-9]*)$').exec(value.href);
    if (pdf) pages.push(Number(pdf[1]));
    else if (value.href.startsWith('epubcfi(')) result.cfi = value.href;
    else result.href = resolveEpubPath('', value.href);
  }
  if (Array.isArray(locations.fragments)) for (const fragment of locations.fragments) {
    const match = typeof fragment === 'string' ? /^page=([1-9]\d*)$/.exec(fragment) : null;
    if (match) pages.push(Number(match[1]));
  }
  if (pages.length) {
    if (pages.some(page => page !== pages[0])) throw new Error('PDF 定位中的页码不一致');
    result.page = pages[0]!;
  }
  if (locations.progression !== undefined) {
    if (typeof locations.progression !== 'number' || !Number.isFinite(locations.progression) || locations.progression < 0 || locations.progression > 1) throw new Error('章节阅读进度无效');
    result.progression = locations.progression;
  }
  if (typeof value.cfi === 'string') result.cfi = value.cfi;
  return result.href || result.page || result.cfi ? result : null;
}

/** 空白归一化同时保留每个 UTF-16 字符在原文中的位置。 */
export function normalizedReaderText(text: string): { text: string; offsets: number[] } {
  let value = ''; const offsets: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (/\s/.test(char)) {
      if (value && !value.endsWith(' ')) { value += ' '; offsets.push(index); }
    } else { value += char; offsets.push(index); }
  }
  if (value.endsWith(' ')) { value = value.slice(0, -1); offsets.pop(); }
  return { text: value, offsets };
}
