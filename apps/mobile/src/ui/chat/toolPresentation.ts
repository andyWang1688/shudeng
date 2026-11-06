import { graphemeSegments } from 'unicode-segmenter/grapheme';

/** Foundation whitespacesAndNewlines includes U+200B and excludes U+FEFF. */
export function trimNativeWhitespace(text: string): string {
  return text.replace(/^[\p{White_Space}\u200B]+|[\p{White_Space}\u200B]+$/gu, '');
}

function previewPrefix(text: string, maximum: number): string {
  let prefix = '';
  let count = 0;
  for (const { segment } of graphemeSegments(text)) {
    if (count === maximum) return prefix + '…';
    prefix += segment;
    count += 1;
  }
  return prefix;
}

/** ReadingQuestion.agentToolTitle: names describe the reader action, including unknown tools. */
export function nativeToolTitle(name: string): string {
  switch (name) {
    case 'search_book': return '查书内资料';
    case 'read_page': return '读原文';
    case 'read_chapter': return '读章节';
    case 'book_toc': return '查看目录';
    case 'search_notes': return '查看笔记';
    case 'current_location': return '定位阅读位置';
    default: return '查书';
  }
}

/** Matches Native parameter precedence; duration is a separate stored value. */
export function nativeToolDetail(args: unknown): string {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return '';
  const value = args as Record<string, unknown>;
  if (typeof value.query === 'string' && value.query.length) return '「' + value.query + '」';
  if (typeof value.reference === 'string' && value.reference.length) return '「' + value.reference + '」';
  // JSONSerialization bridges JSON booleans to Int as 1/0 as well.
  const page = typeof value.page === 'boolean' ? Number(value.page) : value.page;
  if (typeof page === 'number' && Number.isSafeInteger(page)) return `第 ${page} 页/章`;
  if (typeof value.title === 'string' && value.title.length) return '「' + value.title + '」';
  return '';
}

/** Native first stores a 160-Character preview; only LF and literal spaces are folded. */
export function nativeToolPreview(content: string): string {
  return previewPrefix(trimNativeWhitespace(content.replace(/\n/g, ' ').split(' ').filter(Boolean).join(' ')), 160);
}

export function nativeToolSummary(steps: number, citations: number, warnings: readonly string[]): string {
  const base = `查书 ${Math.max(1, steps)} 步`;
  return citations > 0 ? `${base} · 参考 ${citations} 段原文` : warnings.length ? base + ' · 未找到可核查引用' : base;
}
