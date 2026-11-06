import { normalizedReaderText, type ReaderTextLocation } from './reader-location.js';
import { assertNotAborted, type CancellationSignal } from './types.js';

/** A cursor identifies a book/version, while each index validates its own persisted position fields. */
export function decodeReadCursor(raw: string, bookId: string, type: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('续读游标无效'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('续读游标无效');
  const record = value as Record<string, unknown>;
  if (record.type !== type || record.bookId !== bookId) throw new Error('续读游标不属于当前书或格式无效');
  return record;
}

/** Return an exact UTF-16 slice; zero remaining space never advances the source cursor. */
export function passageSliceEnd(text: string, start: number, remaining: number): number {
  if (!Number.isSafeInteger(start) || start < 0 || start >= text.length
    || (start > 0 && text.charCodeAt(start) >= 0xdc00 && text.charCodeAt(start) <= 0xdfff
      && text.charCodeAt(start - 1) >= 0xd800 && text.charCodeAt(start - 1) <= 0xdbff)) throw new Error('续读游标超出原文范围或切断字符');
  let end = Math.min(text.length, start + Math.max(0, Math.floor(remaining)));
  if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff
    && text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff) end -= 1;
  return end;
}

interface SelectionPart<Key> {
  readonly key: Key;
  readonly text: string;
  /** Absolute source offset when available, otherwise the returned offset is relative to this part. */
  readonly offset?: number;
  readonly separatorBefore?: string;
}

/** Parts arrive in reading order. Keys identify sources and never determine that order. */
export async function scanTextSelection<Key extends string | number>(
  parts: AsyncIterable<SelectionPart<Key>>,
  selection: Pick<ReaderTextLocation, 'highlight' | 'before' | 'after'>,
  signal?: CancellationSignal,
): Promise<{ key: Key; offset: number }> {
  const highlight = normalizedReaderText(selection.highlight ?? '').text;
  if (!highlight) throw new Error('选中文字为空');
  const before = normalizedReaderText(selection.before ?? '').text.slice(-160);
  const after = normalizedReaderText(selection.after ?? '').text.slice(0, 160);
  const windowSize = Math.max(1024, highlight.length + before.length + after.length + 512);
  let window = '';
  let spans: Array<{ start: number; end: number; sourceStart: number; part: SelectionPart<Key> }> = [];
  let found: { key: Key; offset: number; absolute: boolean } | undefined;
  for await (const part of parts) {
    assertNotAborted(signal);
    if (window) window += part.separatorBefore ?? '';
    for (let sourceStart = 0; sourceStart < part.text.length; sourceStart += windowSize) {
      assertNotAborted(signal);
      const start = window.length; window += part.text.slice(sourceStart, sourceStart + windowSize);
      spans.push({ start, end: window.length, sourceStart, part });
      const normalized = normalizedReaderText(window);
      let at = normalized.text.indexOf(highlight);
      while (at >= 0) {
        if ((!before || normalized.text.slice(0, at).trimEnd().endsWith(before))
          && (!after || normalized.text.slice(at + highlight.length).trimStart().startsWith(after))) {
          const rawOffset = normalized.offsets[at]!;
          const span = spans.find(item => item.start <= rawOffset && item.end > rawOffset);
          if (span) {
            const offset = (span.part.offset ?? 0) + span.sourceStart + rawOffset - span.start;
            const absolute = span.part.offset !== undefined;
            if (found && (found.offset !== offset || (!(found.absolute && absolute) && found.key !== span.part.key))) {
              throw new Error('选中文字在本章多次出现，现有前后文无法确定位置；请补充上下文或使用明确的 readRef');
            }
            found = { key: span.part.key, offset, absolute };
          }
        }
        // Overlapping occurrences also make a selection ambiguous.
        at = normalized.text.indexOf(highlight, at + 1);
      }
      if (window.length > windowSize) {
        const remove = window.length - windowSize; window = window.slice(remove);
        spans = spans.filter(item => item.end > remove).map(item => ({ ...item, start: item.start - remove, end: item.end - remove }));
      }
    }
  }
  assertNotAborted(signal);
  if (!found) throw new Error('当前章节未能核对选中文字及前后文，请用 search_book 检索后读取明确的 readRef');
  return { key: found.key, offset: found.offset };
}
