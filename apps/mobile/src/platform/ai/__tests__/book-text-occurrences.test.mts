import { describe, expect, it } from 'vitest';
import { ParagraphTextChunker, type TextChunk } from '@shudeng/core';
import { BookTextIndexIntegrityError, findBookTextOccurrences } from '../bookTextOccurrences';

const book = { id: 'book', title: '测试', format: 'epub' as const, sourceHash: 'hash' };
function chunks(text: string, ordinal = 1): TextChunk[] { return new ParagraphTextChunker().chunk({ book, chapters: [{ ordinal, title: '章' + ordinal, href: 'chapter-' + ordinal + '.xhtml', text }] }, { maxChars: 80 }); }
const locator = (hit: { locator: string }) => JSON.parse(hit.locator);

describe('literal native reader search', () => {
  it('finds every occurrence across hard chunk boundaries, once, in reading order', () => {
    const text = 'x'.repeat(79) + 'needle' + 'z'.repeat(70) + 'needle';
    const source = chunks(text);
    expect(source).toHaveLength(3);
    const hits = findBookTextOccurrences(book.id, [...source].reverse().concat(source[0]!), 'needle');
    expect(hits.map(hit => locator(hit).charStart)).toEqual([79, 155]);
    expect(hits.map(hit => locator(hit).charEnd)).toEqual([85, 161]);
    expect(hits.map(hit => locator(hit).text.highlight)).toEqual(['needle', 'needle']);
    expect(new Set(hits.map(hit => hit.id)).size).toBe(2);
    expect(locator(hits[1]!)).toMatchObject({ href: 'chapter-1.xhtml', text: { before: text.slice(0, 155), after: '' } });
  });

  it('preserves original case, diacritics, decomposed marks, and UTF-16 coordinates', () => {
    const text = '🙂 CAFÉ Cafe\u0301 Straße STRASSE';
    const source = chunks(text);
    const accents = findBookTextOccurrences(book.id, source, ' café ');
    expect(accents.map(hit => locator(hit).text.highlight)).toEqual(['CAFÉ', 'Cafe\u0301']);
    expect(accents.map(hit => [locator(hit).charStart, locator(hit).charEnd])).toEqual([[3, 7], [8, 13]]);
    expect(findBookTextOccurrences(book.id, source, 'strasse').map(hit => locator(hit).text.highlight)).toEqual(['Straße', 'STRASSE']);
    expect(findBookTextOccurrences(book.id, chunks('Straße'), 's')).toHaveLength(1);
    expect(findBookTextOccurrences(book.id, chunks('ΟΣ οσ ος'), 'ος').map(hit => locator(hit).text.highlight)).toEqual(['ΟΣ', 'οσ', 'ος']);
    for (const query of ['ß', 'ẞ', 'ss', 'SS']) expect(findBookTextOccurrences(book.id, chunks('ß ẞ ss SS'), query).map(hit => locator(hit).text.highlight)).toEqual(['ß', 'ẞ', 'ss', 'SS']);
  });

  it('uses literal non-overlapping matches and keeps chapter order without relevance ranking', () => {
    const source = [...chunks('a.b banana 跨', 1), ...chunks('章 a.b', 2)];
    expect(findBookTextOccurrences(book.id, source.reverse(), 'a.b').map(hit => hit.chapter)).toEqual(['章1', '章2']);
    expect(findBookTextOccurrences(book.id, source, 'ana').map(hit => locator(hit).charStart)).toEqual([5]);
    expect(findBookTextOccurrences(book.id, source, '跨章')).toEqual([]);
  });

  it('returns every match rather than an FTS candidate or top-K cap', () => {
    const hits = findBookTextOccurrences(book.id, chunks('灯 '.repeat(300)), '灯');
    expect(hits).toHaveLength(300);
    expect(locator(hits[299]!).charStart).toBe(598);
    expect(locator(hits[299]!).text.before.length).toBeLessThanOrEqual(256);
  });

  it('uses the native 35/55 context window and expands composed-character boundaries', () => {
    const ascii = 'a'.repeat(60) + 'MATCH' + 'b'.repeat(90);
    expect(findBookTextOccurrences(book.id, chunks(ascii), 'match')[0]!.context).toBe(ascii.slice(25, 120));
    const family = '👨‍👩‍👧‍👦';
    const unicode = 'x'.repeat(20) + family + 'a'.repeat(30) + 'MATCH' + 'b'.repeat(90);
    const result = findBookTextOccurrences(book.id, chunks(unicode), 'match')[0]!;
    expect(result.context.startsWith(family)).toBe(true);
    expect(result.context).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
  });

  it('deduplicates identical overlaps and refuses conflicting or foreign chunks', () => {
    const original = chunks('abcd needle efgh')[0]!;
    const overlap = { ...original, id: 'overlap', startOffset: 5, text: original.text.slice(5), locator: { ...original.locator, charStart: 5 } };
    expect(findBookTextOccurrences(book.id, [original, overlap], 'needle')).toHaveLength(1);
    expect(() => findBookTextOccurrences(book.id, [original, { ...overlap, text: 'X' + overlap.text.slice(1) }], 'needle')).toThrow(BookTextIndexIntegrityError);
    expect(() => findBookTextOccurrences('other', [original], 'needle')).toThrow(BookTextIndexIntegrityError);
  });

  it('does not fabricate a match across unknown source gaps', () => {
    const left = chunks('left')[0]!;
    const right = { ...chunks('right')[0]!, startOffset: 10, endOffset: 15, locator: { ...left.locator, charStart: 10, charEnd: 15 } };
    expect(findBookTextOccurrences(book.id, [left, right], 'leftright')).toEqual([]);
    expect(findBookTextOccurrences(book.id, [left, right], 'right').map(hit => locator(hit).charStart)).toEqual([10]);
  });

  it('short-circuits blank queries and cancels before or during traversal', () => {
    expect(findBookTextOccurrences(book.id, [], '  ' )).toEqual([]);
    expect(() => findBookTextOccurrences(book.id, chunks('灯'), '灯', { signal: { aborted: true } })).toThrow('检索已取消');
    let checks = 0;
    expect(() => findBookTextOccurrences(book.id, chunks('灯'.repeat(1000)), '灯', { signal: { get aborted() { return ++checks > 30; } } })).toThrow('检索已取消');
  });

  it('segments emoji and combining marks without the Hermes-absent Intl.Segmenter', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
    Object.defineProperty(Intl, 'Segmenter', { value: undefined, configurable: true });
    try {
      const hits = findBookTextOccurrences(book.id, chunks('👨‍👩‍👧‍👦 Cafe\u0301 CAFÉ'), 'cafe');
      expect(hits.map(hit => locator(hit).text.highlight)).toEqual(['Cafe\u0301', 'CAFÉ']);
      expect(hits[0]!.context.startsWith('👨‍👩‍👧‍👦')).toBe(true);
    } finally { if (descriptor) Object.defineProperty(Intl, 'Segmenter', descriptor); }
  });
});

import { BookTextOccurrenceScanner, findBookTextOccurrencesFromChunks } from '../bookTextOccurrences';
function arbitraryChunks(text: string, sizes: readonly number[], ordinal = 1): TextChunk[] {
  const source = chunks('placeholder', ordinal)[0]!, result: TextChunk[] = [];
  let start = 0, index = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + sizes[index++ % sizes.length]!);
    const locator = { ...source.locator, charStart: start, charEnd: end };
    result.push({ ...source, id: 'part-' + ordinal + '-' + start, startOffset: start, endOffset: end, text: text.slice(start, end), locator, locatorJson: JSON.stringify(locator) }); start = end;
  }
  return result;
}
const asyncChunks = async function* (source: readonly TextChunk[]) { for (const chunk of source) yield chunk; };

describe('bounded streaming reader search', () => {
  it('does not lose valid text before an unmatched high surrogate at EOF', async () => {
    const text = 'a' + String.fromCharCode(0xd83d);
    for (const sizes of [[1], [2]]) {
      const hits = await findBookTextOccurrencesFromChunks(book.id, asyncChunks(arbitraryChunks(text, sizes)), 'a');
      expect(hits.map(hit => [locator(hit).charStart, locator(hit).charEnd, locator(hit).text.highlight])).toEqual([[0, 1, 'a']]);
    }
  });
  it('has exactly the same hit payload for every split, including surrogate/ZWJ/combining and folds', async () => {
    const text = ('🙂 CAFÉ Cafe\u0301 Straße STRASSE 👨‍👩‍👧‍👦 a.b banana 灯 ').repeat(70);
    const whole = arbitraryChunks(text, [text.length]);
    for (const query of ['café', 'strasse', 's', '👨‍👩‍👧‍👦', 'a.b', 'ana', '灯']) {
      const expected = findBookTextOccurrences(book.id, whole, query);
      for (const sizes of [[1], [2, 3, 7], [79, 120, 17]]) {
        expect(await findBookTextOccurrencesFromChunks(book.id, asyncChunks(arbitraryChunks(text, sizes)), query)).toEqual(expected);
      }
    }
  });

  it('handles queries far longer than a page and arbitrarily long combining sequences without truncation', async () => {
    const query = 'abc'.repeat(400), text = 'x'.repeat(300) + query + 'y'.repeat(300);
    const results = await findBookTextOccurrencesFromChunks(book.id, asyncChunks(arbitraryChunks(text, [13, 17])), query);
    expect(results).toHaveLength(1); expect(locator(results[0]!).text.highlight).toBe(query); expect(locator(results[0]!).charStart).toBe(300);
    const marked = 'q'.repeat(350) + 'e' + '\u0301'.repeat(5000) + 'Z' + 'w'.repeat(350);
    const hits = await findBookTextOccurrencesFromChunks(book.id, asyncChunks(arbitraryChunks(marked, [31])), 'éz');
    expect(hits).toHaveLength(1); expect(locator(hits[0]!).text.highlight).toBe('e' + '\u0301'.repeat(5000) + 'Z');
    expect(locator(hits[0]!).charStart).toBe(350); expect(locator(hits[0]!).charEnd).toBe(5352);
  });

  it('retains a constant source window for a long no-hit book and preserves overlap/gap semantics', async () => {
    const scanner = new BookTextOccurrenceScanner(book.id, 'needle'), text = 'abcd '.repeat(100000);
    for (const chunk of arbitraryChunks(text, [120])) expect(scanner.push(chunk)).toEqual([]);
    expect(scanner.finish()).toEqual([]); expect(scanner.peakRetainedSourceUnits).toBeLessThan(1000);
    const source = arbitraryChunks('left needle right', [8, 9]);
    const duplicate = { ...source[0]!, id: 'duplicate' };
    expect(await findBookTextOccurrencesFromChunks(book.id, asyncChunks([source[0]!, duplicate, source[1]!]), 'needle')).toHaveLength(1);
    const conflict = { ...duplicate, text: 'X' + duplicate.text.slice(1) };
    await expect(findBookTextOccurrencesFromChunks(book.id, asyncChunks([source[0]!, conflict, source[1]!]), 'needle')).rejects.toThrow(BookTextIndexIntegrityError);
    const gap = { ...source[1]!, startOffset: source[1]!.startOffset + 5, endOffset: source[1]!.endOffset + 5, locator: { ...source[1]!.locator, charStart: source[1]!.startOffset + 5, charEnd: source[1]!.endOffset + 5 } };
    expect(await findBookTextOccurrencesFromChunks(book.id, asyncChunks([source[0]!, gap]), 'needle')).toEqual([]);
  });
});
