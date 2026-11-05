import { decodeEpubAnchor, type ReadiumLocator } from '@shudeng/core/domain';
import { epubCssSelector, rangeFromReadium } from './epub-selection';
import { textRangeForQuote } from './epub-location';

export type EpubViewport = { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
const viewportOf = (doc: Document): EpubViewport => ({ left: 0, right: doc.defaultView?.innerWidth ?? 0, top: 0, bottom: doc.defaultView?.innerHeight ?? 0 });
const intersects = (rect: DOMRect, viewport: EpubViewport) => rect.width > 0 && rect.height > 0 && rect.right > viewport.left && rect.left < viewport.right && rect.bottom > viewport.top && rect.top < viewport.bottom;

/** Original iOS bookmark capture: the first fully visible nonspace character, scoped to its parent. */
export function visibleBookmark(doc: Document, href: string, viewport = viewportOf(doc)): { selection: ReadiumLocator; range: Range } | null {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let item: Node | null;
  while ((item = walker.nextNode())) {
    const node = item as Text;
    if (!node.data.trim() || !node.parentElement || node.parentElement.closest('script,style,noscript,template')) continue;
    const range = doc.createRange(); range.selectNodeContents(node);
    if (!Array.from(range.getClientRects()).some(rect => intersects(rect, viewport))) continue;
    for (let offset = 0; offset < node.length; offset++) {
      if (!node.data[offset]?.trim()) continue;
      range.setStart(node, offset); range.setEnd(node, offset + 1);
      const rect = range.getBoundingClientRect();
      if (!intersects(rect, viewport) || rect.left < viewport.left || rect.right > viewport.right || rect.top < viewport.top || rect.bottom > viewport.bottom) continue;
      const prefix = doc.createRange(); prefix.selectNodeContents(node.parentElement); prefix.setEnd(node, offset);
      const start = prefix.toString().length, text = node.parentElement.textContent ?? '';
      const highlight = node.data.slice(offset, offset + 32);
      range.setEnd(node, offset + highlight.length);
      return { selection: { href, locations: { cssSelector: epubCssSelector(node.parentElement) }, text: { highlight, before: text.slice(0, start), after: text.slice(start + highlight.length) } }, range };
    }
  }
  return null;
}

export function bookmarkRange(doc: Document, value: unknown): Range | null {
  const location = decodeEpubAnchor(value), selection = location?.selection;
  const exact = rangeFromReadium(doc, selection?.locations?.domRange);
  if (exact) return exact;
  const quote = selection?.text?.highlight;
  if (!quote) return null;
  return textRangeForQuote(doc, quote, { ...(selection?.locations?.cssSelector ? { selector: selection.locations.cssSelector } : {}), ...(selection?.text?.before === undefined ? {} : { before: selection.text.before }), ...(selection?.text?.after === undefined ? {} : { after: selection.text.after }) });
}

export function rangeIsVisible(doc: Document, range: Range, viewport = viewportOf(doc)): boolean {
  return Array.from(range.getClientRects()).some(rect => intersects(rect, viewport));
}
