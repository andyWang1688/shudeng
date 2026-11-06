/** Exact literal reader search. Source text is streamed; result storage grows only with real hits. */
import { assertNotAborted, type CancellationSignal, type TextChunk } from '@shudeng/core';
import { graphemeSegments } from 'unicode-segmenter/grapheme';
export interface BookTextSearchHit { readonly id: string; readonly chapter: string; readonly context: string; readonly locator: string }
export interface BookTextSearchOptions { readonly signal?: CancellationSignal }
export class BookTextIndexIntegrityError extends Error {
  constructor() { super('书内文字的位置不一致，请重新准备后再搜索'); this.name = 'BookTextIndexIntegrityError'; }
}
interface Segment { readonly start: number; readonly end: number; readonly text: string }
interface Mapping { readonly start: number; readonly end: number; readonly boundary: boolean }
interface Match { readonly start: number; readonly end: number }
interface Draft extends Match { readonly context: string; readonly before: string; readonly after: string; readonly highlight: string }
interface Piece { start: number; readonly end: number; text: string }
const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().toLowerCase().replace(/\u03c2/g, '\u03c3').replace(/\u00df/g, 'ss');
const needleFor = (query: string): string => fold(query.trim());
const ordered = (left: TextChunk, right: TextChunk): number => left.chapterOrdinal - right.chapterOrdinal || left.startOffset - right.startOffset || left.endOffset - right.endOffset || left.id.localeCompare(right.id);

/** A single continuous source run. Retains a KMP candidate + 256 UTF16 units of context on
 * each side, expanded to complete graphemes. One arbitrarily long unfinished grapheme
 * is retained intact; there is no fabricated grapheme/query length cutoff. */
class RunSearch {
  readonly start: number;
  end: number;
  private tail = '';
  private tailStart: number;
  private segments: Segment[] = [];
  private segmentHead = 0;
  private foldedLength = 0;
  private matched = 0;
  private readonly recent: Mapping[] = [];
  private readonly pending: Match[] = [];
  private pendingHead = 0;
  private readonly drafts: Draft[] = [];
  constructor(readonly first: TextChunk, private readonly needle: string, private readonly failure: readonly number[], private readonly options: BookTextSearchOptions) {
    this.start = first.startOffset; this.end = first.startOffset; this.tailStart = first.startOffset;
  }
  get bufferedUnits(): number { const first = this.segments[this.segmentHead]; return (first ? this.segments[this.segments.length - 1]!.end - first.start : 0) + this.tail.length; }
  sameSource(chunk: TextChunk): boolean { return chunk.bookId === this.first.bookId && chunk.chapterOrdinal === this.first.chapterOrdinal && chunk.locator.href === this.first.locator.href && chunk.locator.page === this.first.locator.page; }
  feed(text: string, start: number): void {
    if (start !== this.end) throw new BookTextIndexIntegrityError();
    this.end += text.length;
    const input = this.tail + text, base = this.tailStart;
    // An incomplete surrogate at the transport boundary must not falsely terminate
    // the preceding ZWJ grapheme before its low surrogate arrives in the next chunk.
    const incomplete = /[\uD800-\uDBFF]/.test(input.slice(-1)) ? input.slice(-1) : '';
    const available = incomplete ? input.slice(0, -1) : input;
    let last: { segment: string; index: number } | undefined;
    for (const segment of graphemeSegments(available)) {
      assertNotAborted(this.options.signal);
      if (last) this.accept({ start: base + last.index, end: base + last.index + last.segment.length, text: last.segment });
      last = segment;
    }
    this.tail = (last?.segment ?? '') + incomplete;
    this.tailStart = last ? base + last.index : this.end - incomplete.length;
  }
  private accept(segment: Segment): void {
    this.segments.push(segment);
    const value = fold(segment.text);
    for (let index = 0; index < value.length; index += 1) {
      assertNotAborted(this.options.signal);
      this.recent[this.foldedLength % this.needle.length] = { start: segment.start, end: segment.end, boundary: index === 0 };
      const character = value[index]!;
      while (this.matched && this.needle[this.matched] !== character) this.matched = this.failure[this.matched - 1]!;
      if (this.needle[this.matched] === character) this.matched += 1;
      this.foldedLength += 1;
      if (this.matched === this.needle.length) {
        const first = this.recent[(this.foldedLength - this.needle.length) % this.needle.length]!;
        if (first.boundary && index === value.length - 1) {
          this.pending.push({ start: first.start, end: segment.end });
          this.matched = 0; // Full accepted matches never overlap, matching NSString search.
        } else this.matched = this.failure[this.matched - 1]!;
      }
    }
    this.emitReady(segment.end, false);
    this.trim(segment.end);
  }
  private floor(offset: number): number {
    let low = this.segmentHead, high = this.segments.length;
    while (low < high) { const middle = Math.floor((low + high) / 2); if (this.segments[middle]!.start <= offset) low = middle + 1; else high = middle; }
    return Math.max(this.segmentHead, low - 1);
  }
  private bounds(match: Match, before: number, after: number): Match {
    const lower = Math.max(this.start, match.start - before), upper = Math.min(this.end, match.end + after);
    return { start: this.segments[this.floor(lower)]?.start ?? lower, end: this.segments[this.floor(Math.max(lower, upper - 1))]?.end ?? upper };
  }
  private slice(start: number, end: number): string {
    const parts: string[] = [];
    for (let index = this.floor(start); index < this.segments.length; index += 1) {
      const segment = this.segments[index]!;
      if (segment.start >= end) break;
      if (segment.end > start) parts.push(segment.text.slice(Math.max(0, start - segment.start), Math.min(segment.text.length, end - segment.start)));
    }
    return parts.join('');
  }
  private emitReady(completedEnd: number, final: boolean): void {
    while (this.pendingHead < this.pending.length) {
      const match = this.pending[this.pendingHead]!;
      if (!final && completedEnd < match.end + 256) break;
      const context = this.bounds(match, 35, 55), quote = this.bounds(match, 256, 256);
      this.drafts.push({ ...match, context: this.slice(context.start, context.end), before: this.slice(quote.start, match.start), after: this.slice(match.end, quote.end), highlight: this.slice(match.start, match.end) });
      this.pendingHead += 1;
    }
    if (this.pendingHead > 256 && this.pendingHead * 2 > this.pending.length) { this.pending.splice(0, this.pendingHead); this.pendingHead = 0; }
  }
  private trim(completedEnd: number): void {
    let keep = completedEnd - 256;
    if (this.matched) keep = Math.min(keep, this.recent[(this.foldedLength - this.matched) % this.needle.length]!.start - 256);
    if (this.pendingHead < this.pending.length) keep = Math.min(keep, this.pending[this.pendingHead]!.start - 256);
    while (this.segmentHead < this.segments.length && this.segments[this.segmentHead]!.end <= keep) this.segmentHead += 1;
    if (this.segmentHead > 256 && this.segmentHead * 2 > this.segments.length) { this.segments = this.segments.slice(this.segmentHead); this.segmentHead = 0; }
  }
  finish(): readonly BookTextSearchHit[] {
    // EOF can leave a held high surrogate without a low surrogate. Segment the
    // final carry again so it cannot absorb an otherwise valid preceding grapheme.
    for (const segment of graphemeSegments(this.tail)) this.accept({ start: this.tailStart + segment.index, end: this.tailStart + segment.index + segment.segment.length, text: segment.segment });
    this.tail = ''; this.emitReady(this.end, true);
    const hits: BookTextSearchHit[] = [];
    for (const draft of this.drafts) {
      assertNotAborted(this.options.signal);
      const locator = { ...this.first.locator, charStart: draft.start, charEnd: draft.end, text: { highlight: draft.highlight, before: draft.before, after: draft.after }, locations: { progression: draft.start / Math.max(1, this.end) } };
      hits.push({ id: this.first.bookId + ':c' + this.first.chapterOrdinal + ':' + draft.start + '-' + draft.end, chapter: this.first.chapter, context: draft.context, locator: JSON.stringify(locator) });
    }
    return hits;
  }
}

function prefixTable(needle: string, signal?: CancellationSignal): number[] {
  const failure = Array<number>(needle.length).fill(0);
  for (let index = 1, matched = 0; index < needle.length; index += 1) {
    if (index % 1024 === 0) assertNotAborted(signal);
    while (matched && needle[index] !== needle[matched]) matched = failure[matched - 1]!;
    if (needle[index] === needle[matched]) matched += 1;
    failure[index] = matched;
  }
  return failure;
}

/** Ordered chunks enter once. Overlap validation retains at most the still-overlapping input
 * chunk span, so arbitrary overlaps stay exact without reconstructing the complete chapter. */
export class BookTextOccurrenceScanner {
  private readonly needle: string;
  private readonly failure: readonly number[];
  private run: RunSearch | undefined;
  private previous: TextChunk | undefined;
  private pieces: Piece[] = [];
  private peak = 0;
  constructor(private readonly bookId: string, query: string, private readonly options: BookTextSearchOptions = {}) { assertNotAborted(options.signal); this.needle = needleFor(query); this.failure = prefixTable(this.needle, options.signal); }
  /** Diagnostic excludes output hits and query-sized KMP state. It counts retained source UTF16 units. */
  get peakRetainedSourceUnits(): number { return this.peak; }
  get empty(): boolean { return !this.needle; }
  push(chunk: TextChunk): readonly BookTextSearchHit[] {
    assertNotAborted(this.options.signal);
    if (this.empty) return [];
    if (chunk.bookId !== this.bookId || !Number.isSafeInteger(chunk.startOffset) || !Number.isSafeInteger(chunk.endOffset) || chunk.startOffset < 0 || chunk.endOffset <= chunk.startOffset || chunk.text.length !== chunk.endOffset - chunk.startOffset || chunk.locator.charStart !== chunk.startOffset || chunk.locator.charEnd !== chunk.endOffset || (this.previous && (chunk.chapterOrdinal < this.previous.chapterOrdinal || (chunk.chapterOrdinal === this.previous.chapterOrdinal && chunk.startOffset < this.previous.startOffset)))) throw new BookTextIndexIntegrityError();
    this.previous = chunk;
    let completed: readonly BookTextSearchHit[] = [];
    if (!this.run || !this.run.sameSource(chunk) || chunk.startOffset > this.run.end) {
      completed = this.run?.finish() ?? [];
      this.run = new RunSearch(chunk, this.needle, this.failure, this.options); this.pieces = [];
    }
    const overlapEnd = Math.min(this.run.end, chunk.endOffset);
    let checked = chunk.startOffset;
    for (const piece of this.pieces) {
      if (piece.end <= checked) continue;
      if (checked >= overlapEnd) break;
      const end = Math.min(piece.end, overlapEnd);
      if (piece.start > checked || piece.text.slice(checked - piece.start, end - piece.start) !== chunk.text.slice(checked - chunk.startOffset, end - chunk.startOffset)) throw new BookTextIndexIntegrityError();
      checked = end;
    }
    if (checked < overlapEnd) throw new BookTextIndexIntegrityError();
    while (this.pieces[0] && this.pieces[0].end <= chunk.startOffset) this.pieces.shift();
    const first = this.pieces[0];
    if (first && first.start < chunk.startOffset) { first.text = first.text.slice(chunk.startOffset - first.start); first.start = chunk.startOffset; }
    if (chunk.endOffset > this.run.end) {
      const start = this.run.end, text = chunk.text.slice(start - chunk.startOffset);
      this.pieces.push({ start, end: chunk.endOffset, text }); this.run.feed(text, start);
    }
    this.peak = Math.max(this.peak, this.run.bufferedUnits + this.pieces.reduce((total, piece) => total + piece.text.length, 0));
    return completed;
  }
  finish(): readonly BookTextSearchHit[] { assertNotAborted(this.options.signal); const hits = this.run?.finish() ?? []; this.run = undefined; this.pieces = []; this.previous = undefined; return hits; }
}

/** Compatibility entry point for callers that already have unordered chunks in memory. */
export function findBookTextOccurrences(bookId: string, chunks: readonly TextChunk[], query: string, options: BookTextSearchOptions = {}): readonly BookTextSearchHit[] {
  assertNotAborted(options.signal);
  const scanner = new BookTextOccurrenceScanner(bookId, query, options), hits: BookTextSearchHit[] = [];
  if (scanner.empty) return hits;
  for (const chunk of [...chunks].sort(ordered)) for (const hit of scanner.push(chunk)) hits.push(hit);
  for (const hit of scanner.finish()) hits.push(hit);
  return hits;
}

/** Product path: ordered keyset chunks, a finite adjacent window, and every real occurrence. */
export async function findBookTextOccurrencesFromChunks(bookId: string, chunks: AsyncIterable<TextChunk>, query: string, options: BookTextSearchOptions = {}): Promise<readonly BookTextSearchHit[]> {
  assertNotAborted(options.signal);
  const scanner = new BookTextOccurrenceScanner(bookId, query, options), hits: BookTextSearchHit[] = [];
  if (scanner.empty) return hits;
  for await (const chunk of chunks) for (const hit of scanner.push(chunk)) hits.push(hit);
  for (const hit of scanner.finish()) hits.push(hit);
  return hits;
}
