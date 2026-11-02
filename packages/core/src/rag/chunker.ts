/**
 * 章节/段落切块器：按段落聚合到 maxChars，长段落按句子贪心切分。
 * 每个 chunk 都记录相对章节原文的 [startOffset, endOffset)，可直接 slice 还原原文；
 * 同时生成 locator（章节/页码/字符 offset/段落区间）供引用回跳。
 *
 * V2 先不做重叠窗口（overlap）；如需提升跨块召回，再引入并保证 offset 语义不变。
 */
import {
  assertNotAborted,
  type ChunkLocator,
  type ChunkerOptions,
  type RagBook,
  type RagChapter,
  type TextChunk,
  type TextChunker,
} from './types.js';
import type { CancellationSignal } from './types.js';

interface Range {
  start: number;
  end: number;
  paragraphStart?: number;
  paragraphEnd?: number;
}

interface ChapterSource {
  text: string;
  /** 段落文本区间（已含段落间分隔符之外的位置）。 */
  paragraphs: ReadonlyArray<{ start: number; end: number }>;
}

function chapterSource(chapter: RagChapter): ChapterSource {
  if (chapter.paragraphs && chapter.paragraphs.length > 0) {
    let text = '';
    const paragraphs: Array<{ start: number; end: number }> = [];
    chapter.paragraphs.forEach((paragraph, index) => {
      if (index > 0) text += '\n\n';
      const start = text.length;
      text += paragraph;
      paragraphs.push({ start, end: text.length });
    });
    return { text, paragraphs };
  }
  return { text: chapter.text ?? '', paragraphs: [] };
}

function trimRange(text: string, range: { start: number; end: number }): Range | null {
  let start = range.start;
  let end = range.end;
  while (start < end && /\s/.test(text[start] ?? '')) start += 1;
  while (end > start && /\s/.test(text[end - 1] ?? '')) end -= 1;
  if (end <= start) return null;
  return { start, end };
}

function hardSplit(slice: string, maxChars: number): Array<{ start: number; end: number }> {
  const pieces: Array<{ start: number; end: number }> = [];
  let offset = 0;
  while (offset < slice.length) {
    let end = Math.min(offset + maxChars, slice.length);
    // 不把代理对（emoji 等）切半。
    if (end < slice.length && /[\uD800-\uDBFF]/.test(slice[end - 1] ?? '')) end += 1;
    pieces.push({ start: offset, end });
    offset = end;
  }
  return pieces;
}

/** 段落内按句子贪心切分（返回相对段落的片段）。 */
function splitParagraph(text: string, range: Range, maxChars: number): Array<{ start: number; end: number }> {
  const slice = text.slice(range.start, range.end);
  if (slice.length <= maxChars) return [{ start: range.start, end: range.end }];

  const segments: Array<{ start: number; end: number }> = [];
  const sentence = /[^。！？!?.\n]+[。！？!?.\n]*/g;
  for (const match of slice.matchAll(sentence)) {
    const value = match[0];
    if (value.length > 0) segments.push({ start: match.index ?? 0, end: (match.index ?? 0) + value.length });
  }
  if (segments.length === 0) segments.push({ start: 0, end: slice.length });

  const pieces: Array<{ start: number; end: number }> = [];
  for (const segment of segments) {
    for (const piece of hardSplit(slice.slice(segment.start, segment.end), maxChars)) {
      pieces.push({ start: segment.start + piece.start, end: segment.start + piece.end });
    }
  }
  const merged: Array<{ start: number; end: number }> = [];
  for (const piece of pieces) {
    const current = merged[merged.length - 1];
    if (current && piece.end - current.start <= maxChars) current.end = piece.end;
    else merged.push({ ...piece });
  }
  return merged.map((piece) => ({ start: range.start + piece.start, end: range.start + piece.end }));
}

function chunkChapter(chapter: RagChapter, maxChars: number, signal?: CancellationSignal): Range[] {
  const source = chapterSource(chapter);
  const hasParagraphs = source.paragraphs.length > 0;
  const paragraphs: ReadonlyArray<{ start: number; end: number }> = hasParagraphs
    ? source.paragraphs
    : [{ start: 0, end: source.text.length }];
  const ranges: Range[] = [];
  let current: Range | null = null;

  const flush = (): void => {
    if (current) ranges.push(current);
    current = null;
  };

  for (let index = 0; index < paragraphs.length; index += 1) {
    assertNotAborted(signal);
    const trimmed = trimRange(source.text, paragraphs[index] ?? { start: 0, end: 0 });
    if (!trimmed) continue;
    for (const piece of splitParagraph(source.text, trimmed, maxChars)) {
      if (!current) {
        current = { start: piece.start, end: piece.end };
        if (hasParagraphs) {
          current.paragraphStart = index;
          current.paragraphEnd = index;
        }
      } else if (piece.end - current.start <= maxChars) {
        current.end = piece.end;
        if (hasParagraphs) current.paragraphEnd = index;
      } else {
        flush();
        current = { start: piece.start, end: piece.end };
        if (hasParagraphs) {
          current.paragraphStart = index;
          current.paragraphEnd = index;
        }
      }
    }
  }
  flush();
  return ranges;
}

export class ParagraphTextChunker implements TextChunker {
  chunk(book: RagBook, options: ChunkerOptions = {}, context: { signal?: CancellationSignal } = {}): TextChunk[] {
    const maxChars = Math.max(80, Math.floor(options.maxChars ?? 120));
    const chunks: TextChunk[] = [];
    for (const chapter of book.chapters) {
      assertNotAborted(context.signal);
      const source = chapterSource(chapter);
      for (const range of chunkChapter(chapter, maxChars, context.signal)) {
        const text = source.text.slice(range.start, range.end);
        const locator: ChunkLocator = {
          engine: 'rag-chunk-v1',
          chapter: chapter.title,
          chapterOrdinal: chapter.ordinal,
          ...(chapter.page !== undefined ? { page: chapter.page } : {}),
          charStart: range.start,
          charEnd: range.end,
          ...(range.paragraphStart !== undefined ? { paragraphStart: range.paragraphStart } : {}),
          ...(range.paragraphEnd !== undefined ? { paragraphEnd: range.paragraphEnd } : {}),
        };
        chunks.push({
          id: `${book.book.id}:c${chapter.ordinal}:${range.start}-${range.end}`,
          bookId: book.book.id,
          chapter: chapter.title,
          chapterOrdinal: chapter.ordinal,
          ...(chapter.page !== undefined ? { page: chapter.page } : {}),
          startOffset: range.start,
          endOffset: range.end,
          text,
          locator,
          locatorJson: JSON.stringify(locator),
        });
      }
    }
    return chunks;
  }
}

/** 由 locator JSON 还原章节/页码（BookSource/UI 回跳用）。 */
export function parseChunkLocator(locatorJson: string): ChunkLocator | null {
  try {
    const value: unknown = JSON.parse(locatorJson);
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    if (record.engine !== 'rag-chunk-v1') return null;
    return value as ChunkLocator;
  } catch {
    return null;
  }
}
