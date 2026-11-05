import { graphemeSegments } from 'unicode-segmenter/grapheme';

export type PdfTextRange = { readonly offset: number; readonly length: number };
type PdfRect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
export type PdfSearchMatch = PdfTextRange & { readonly rects: readonly PdfRect[] };
export type PdfSearchHit = { readonly page: number; readonly text: string; readonly rects: readonly PdfRect[] };
export type PdfSearchPage = { readonly pageCount: number; readonly cancelled: boolean; readonly matches: readonly PdfSearchMatch[] };

/** Foundation .whitespacesAndNewlines includes U+200B and keeps a BOM. */
export function trimPdfSearchQuery(text: string): string {
  return text.replace(/^[\t\p{Zs}\u200B\n\r\v\f\u0085\u2028\u2029]+|[\t\p{Zs}\u200B\n\r\v\f\u0085\u2028\u2029]+$/gu, '');
}

/** Same original-text ranges as BookText.pdfFragments; this is presentation data,
 * not an index. UTF-16 offsets continue to refer to the untouched PDFKit page. */
export function pdfSearchFragmentRanges(text: string): readonly PdfTextRange[] {
  const runs: PdfTextRange[] = [];
  let runStart = -1;
  let runEnd = 0;
  let composedEnds: number[] | undefined;
  const composedEndAt = (offset: number) => {
    composedEnds ??= Array.from(graphemeSegments(text), ({ index, segment }) => index + segment.length);
    let low = 0, high = composedEnds.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (composedEnds[middle]! <= offset) low = middle + 1; else high = middle;
    }
    return composedEnds[low] ?? text.length;
  };
  const flush = () => {
    if (runStart >= 0 && runEnd > runStart) runs.push({ offset: runStart, length: runEnd - runStart });
    runStart = -1; runEnd = 0;
  };
  const appendLine = (start: number, end: number) => {
    const line = text.slice(start, end);
    const trimmed = trimPdfSearchQuery(line);
    if (!trimmed) return;
    const contentStart = start + line.indexOf(trimmed);
    const contentEnd = contentStart + trimmed.length;
    for (let sliceStart = contentStart; sliceStart < contentEnd;) {
      let sliceEnd = Math.min(sliceStart + 360, contentEnd);
      if (sliceEnd < contentEnd) sliceEnd = Math.max(sliceStart + 1, Math.min(composedEndAt(sliceEnd - 1), contentEnd));
      if (runStart < 0) { runStart = sliceStart; runEnd = sliceEnd; }
      else if (sliceEnd - runStart <= 360) runEnd = sliceEnd;
      else { flush(); runStart = sliceStart; runEnd = sliceEnd; }
      sliceStart = sliceEnd;
    }
  };
  // NSString .byLines treats CRLF as one separator; VT/FF are whitespace, not lines.
  const newline = /\r\n|[\n\r\u0085\u2028\u2029]/gu;
  let lineStart = 0;
  for (let match = newline.exec(text); match; match = newline.exec(text)) {
    appendLine(lineStart, match.index);
    lineStart = newline.lastIndex;
  }
  appendLine(lineStart, text.length);
  flush();
  return runs;
}

/** Preserve source newlines and clip to the original fragment before expanding
 * the 35-before/55-after UTF-16 window to complete composed characters. */
export function pdfSearchSnippet(text: string, fragment: PdfTextRange, match: PdfTextRange): string {
  const original = text.slice(fragment.offset, fragment.offset + fragment.length);
  const offset = match.offset - fragment.offset;
  let start = Math.max(0, offset - 35);
  let end = Math.min(original.length, offset + match.length + 55);
  for (const { index, segment } of graphemeSegments(original)) {
    const next = index + segment.length;
    if (index <= start && start < next) start = index;
    if (index < end && end < next) end = next;
    if (index >= end) break;
  }
  return original.slice(start, end);
}

export type PdfSearchIO = {
  /** Empty bounds probes for one occurrence; explicit bounds return every match. */
  readonly searchPage: (page: number, bounds: readonly PdfTextRange[]) => Promise<PdfSearchPage>;
  readonly readPage: (page: number) => Promise<string>;
  readonly isCurrent: () => boolean;
};

/** Only the current hit page is held in JS. A second, bounded native match pass
 * preserves per-fragment occurrence semantics, including overlapping boundary words. */
export async function collectPdfSearch(io: PdfSearchIO): Promise<readonly PdfSearchHit[]> {
  const hits: PdfSearchHit[] = [];
  let pageCount = 1;
  for (let page = 1; page <= pageCount; page += 1) {
    if (!io.isCurrent()) return [];
    const probe = await io.searchPage(page, []);
    if (!io.isCurrent() || probe.cancelled) return [];
    pageCount = probe.pageCount;
    if (!probe.matches.length) continue;
    const text = await io.readPage(page);
    if (!io.isCurrent()) return [];
    const fragments = pdfSearchFragmentRanges(text);
    if (!fragments.length) continue;
    const result = await io.searchPage(page, fragments);
    if (!io.isCurrent() || result.cancelled) return [];
    for (const match of result.matches) {
      const fragment = fragments.find(range => match.offset >= range.offset && match.offset + match.length <= range.offset + range.length);
      if (!fragment) throw new Error('PDF 搜索结果不在原文范围内，请重新打开这本书后重试');
      hits.push({ page, text: pdfSearchSnippet(text, fragment, match), rects: match.rects });
    }
  }
  return hits;
}
