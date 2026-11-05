import { graphemeSegments } from 'unicode-segmenter/grapheme';

/** Native PDF bookmarks show the first nonblank line, capped at 160 Swift Characters.
 * Keep an empty summary on scanned pages; the panel already supplies the page title. */
export function pdfBookmarkSummary(pageText: string): string {
  // Foundation .newlines and .whitespaces differ from JavaScript trim(): a BOM
  // is content; Unicode space separators, tab and U+200B are edge whitespace.
  for (const line of pageText.split(/[\n\r\v\f\u0085\u2028\u2029]/u)) {
    const trimmed = line.replace(/^[\t\p{Zs}\u200B]+|[\t\p{Zs}\u200B]+$/gu, '');
    if (!trimmed) continue;
    let summary = '';
    let count = 0;
    for (const { segment } of graphemeSegments(trimmed)) {
      summary += segment;
      if (++count === 160) break;
    }
    return summary;
  }
  return '';
}
