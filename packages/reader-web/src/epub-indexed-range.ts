/** Maps ingestion/quote text to DOM nodes without one object per UTF-16 unit. */
type Point = { node: Text; offset: number };
export type TextSpan = { readonly start: number; readonly end: number; readonly node: Text; readonly offset: number };
export interface MappedText {
  readonly text: string;
  /** Half-open output intervals. Gaps are synthetic text with no DOM endpoint. */
  readonly spans: readonly TextSpan[];
  pointAt(index: number): Point | null;
}
const BLOCK = new Set(['p', 'div', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'blockquote', 'br', 'hr']);
const OMIT = new Set(['script', 'style', 'head', 'noscript', 'nav']);

class SpanBuilder {
  readonly spans: Array<{ start: number; end: number; node: Text; offset: number }> = [];
  length = 0;

  append(length: number, node?: Text, offset = 0): void {
    if (length <= 0) return;
    const start = this.length;
    this.length += length;
    if (!node) return; // A synthetic newline remains an unmapped gap.
    const last = this.spans[this.spans.length - 1];
    if (last && last.end === start && last.node === node && last.offset + last.end - last.start === offset) {
      last.end = this.length;
    } else {
      this.spans.push({ start, end: this.length, node, offset });
    }
  }
}

function pointAt(spans: readonly TextSpan[], index: number): Point | null {
  if (!Number.isSafeInteger(index) || index < 0) return null;
  let low = 0, high = spans.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2), span = spans[middle]!;
    if (index < span.start) high = middle - 1;
    else if (index >= span.end) low = middle + 1;
    else return { node: span.node, offset: span.offset + index - span.start };
  }
  return null;
}

function mappedText(text: string, spans: readonly TextSpan[]): MappedText {
  return { text, spans, pointAt: index => pointAt(spans, index) };
}

/** Copy only interval intersections; each normalization pass moves forward. */
function sliceAppender(source: readonly TextSpan[], target: SpanBuilder): (start: number, end: number) => void {
  let index = 0;
  return (start, end) => {
    let cursor = start;
    while (index < source.length && source[index]!.end <= cursor) index++;
    while (cursor < end) {
      const span = source[index];
      if (!span || span.start >= end) { target.append(end - cursor); break; }
      if (cursor < span.start) { target.append(span.start - cursor); cursor = span.start; }
      const stop = Math.min(end, span.end);
      target.append(stop - cursor, span.node, span.offset + cursor - span.start);
      cursor = stop;
      if (cursor === span.end) index++;
    }
  };
}

export function indexedDocumentText(doc: Document): MappedText {
  const pieces: string[] = [], original = new SpanBuilder();
  const append = (value: string, node?: Text) => {
    if (!value.length) return;
    pieces.push(value); original.append(value.length, node);
  };
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) { append(node.nodeValue ?? '', node as Text); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element, name = element.localName.toLowerCase();
    if (OMIT.has(name) || element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') return;
    if (BLOCK.has(name)) append('\n');
    for (const child of Array.from(element.childNodes)) walk(child);
    if (BLOCK.has(name)) append('\n');
  };
  walk(doc.body ?? doc.documentElement);
  let text = pieces.join(''), spans: readonly TextSpan[] = original.spans;
  const replace = (pattern: RegExp, replacement: string) => {
    // Delay rebuilding until a match actually changes the text/mapping. Single
    // spaces and bare newlines retain their existing continuous node interval.
    let strings: string[] | undefined, mapped: SpanBuilder | undefined;
    let copy: ((start: number, end: number) => void) | undefined, cursor = 0;
    for (const match of text.matchAll(pattern)) {
      if (match[0] === replacement) continue;
      if (!mapped) { strings = []; mapped = new SpanBuilder(); copy = sliceAppender(spans, mapped); }
      const at = match.index ?? 0;
      strings!.push(text.slice(cursor, at), replacement); copy!(cursor, at);
      const newline = match[0].indexOf('\n');
      for (let index = 0; index < replacement.length; index++) {
        const point = pointAt(spans, at + (replacement[index] === '\n' && newline >= 0 ? newline + index : index));
        mapped.append(1, point?.node, point?.offset);
      }
      cursor = at + match[0].length;
    }
    if (!mapped) return;
    strings!.push(text.slice(cursor)); copy!(cursor, text.length);
    text = strings!.join(''); spans = mapped.spans;
  };
  // Exact ingestion contract, including each pass's original UTF-16 endpoints.
  replace(/[\t\r\f ]+/g, ' '); replace(/ *\n */g, '\n'); replace(/\n{3,}/g, '\n\n'); replace(/^\s+|\s+$/g, '');
  return mappedText(text, spans);
}

/** Quote fallback deliberately includes hidden/nav text, unlike ingestion. */
export function quoteDocumentText(doc: Document, root: Node): MappedText {
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT), pieces: string[] = [], mapped = new SpanBuilder();
  let item: Node | null;
  while ((item = walker.nextNode())) {
    if (item.parentElement?.closest('script,style,noscript')) continue;
    const node = item as Text, value = node.data;
    let cursor = 0;
    const append = (start: number, end: number) => {
      if (end <= start) return;
      pieces.push(value.slice(start, end)); mapped.append(end - start, node, start);
    };
    // No Unicode flag: this removes the same individual UTF-16 whitespace units
    // as the old loop, retaining both halves of a surrogate pair independently.
    for (const match of value.matchAll(/\s+/g)) {
      const at = match.index ?? 0;
      append(cursor, at); cursor = at + match[0].length;
    }
    append(cursor, value.length);
  }
  return mappedText(pieces.join(''), mapped.spans);
}

export function rangeAtIndexedOffset(doc: Document, start: number, end: number, quote: string): Range | null {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) return null;
  const mapped = indexedDocumentText(doc);
  if (mapped.text.slice(start, end) !== quote) return null;
  const first = mapped.pointAt(start), last = mapped.pointAt(end - 1);
  if (!first || !last) return null;
  try { const range = doc.createRange(); range.setStart(first.node, first.offset); range.setEnd(last.node, last.offset + 1); return range; } catch { return null; }
}

