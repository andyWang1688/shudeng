import { describe, expect, it } from 'vitest';
import { captureQuestionOrigin, parseQuestionOrigin, resolveQuestionOrigin } from '../questionOrigin';

const scope = { bookId: 'book-a', format: 'epub' };
const native = { href: 'OEBPS/chapter.xhtml', type: 'application/xhtml+xml', title: '第一章',
  locations: { position: 2, progression: .2, totalProgression: .1, domRange: {
    start: { cssSelector: '#p', textNodeIndex: 0, charOffset: 2 }, end: { cssSelector: '#p', textNodeIndex: 0, charOffset: 8 } } },
  text: { before: '前', highlight: '选中的原文', after: '后' } };
const legacy = { version: 1, bookId: 'book-a', originJSON: JSON.stringify(native), selection: { locatorJSON: JSON.stringify({ ...native, href: 'different.xhtml' }) } };
const readPosition = (value: ReturnType<typeof captureQuestionOrigin>) => value ? JSON.parse(value.readingPosition) : undefined;

describe('per-question original reading location', () => {
  it('uses Native originJSON before selection and preserves valid locator detail without mutating the source', () => {
    const bytes = JSON.stringify(legacy);
    const origin = resolveQuestionOrigin({ ...scope, legacyNative: legacy });
    expect(origin).toMatchObject({ version: 1, bookId: 'book-a', format: 'epub' });
    expect(readPosition(origin)).toEqual(native); expect(JSON.stringify(legacy)).toBe(bytes);
    expect(readPosition(resolveQuestionOrigin({ ...scope, legacyNative: { ...legacy, originJSON: undefined } }))).toEqual({ ...native, href: 'different.xhtml' });
  });

  it('never substitutes selection or citations when the explicit Native origin is invalid', () => {
    for (const originJSON of ['', 'broken JSON', null, JSON.stringify([]), JSON.stringify('chapter.xhtml'), 'epubcfi(/6/2)']) {
      expect(resolveQuestionOrigin({ ...scope, legacyNative: { ...legacy, originJSON } })).toBeUndefined();
    }
    expect(resolveQuestionOrigin({ ...scope, legacyNative: { version: 1, bookId: 'book-a', citations: [legacy.selection], evidence: [legacy.selection] } })).toBeUndefined();
  });

  it('makes an existing per-turn snapshot authoritative and fails closed for invalid versions, scope, or format', () => {
    const own = captureQuestionOrigin({ ...scope, readingPosition: { type: 'epub', cfi: 'epubcfi(/6/8!/4/2:1)', href: 'own.xhtml' } })!;
    expect(resolveQuestionOrigin({ ...scope, questionOrigin: own, legacyNative: legacy })).toEqual(own);
    for (const questionOrigin of [null, {}, { ...own, version: 2 }, { ...own, bookId: 'book-b' }, { ...own, format: 'pdf' }, { ...own, readingPosition: '{}' }]) {
      expect(resolveQuestionOrigin({ ...scope, questionOrigin, legacyNative: legacy })).toBeUndefined();
    }
    expect(resolveQuestionOrigin({ ...scope, legacyNative: { ...legacy, bookId: 'other-book' } })).toBeUndefined();
    expect(parseQuestionOrigin({ ...own, format: 'EPUB' })).toBeUndefined();
  });

  it('captures actual new RN reader positions, CFI and known V3 anchor forms into a stable safe snapshot', () => {
    const position = { type: 'epub', cfi: 'epubcfi(/6/4!/4/2:0)', href: native.href, chapter: '第一章', selection: native, totalProgression: .1, position: 2 };
    const captured = captureQuestionOrigin({ bookId: 'book-a', format: 'EPUB', readingPosition: JSON.stringify(position) })!;
    expect(readPosition(captured)).toEqual(position); expect(parseQuestionOrigin(captured)).toEqual(captured);
    expect(readPosition(captureQuestionOrigin({ ...scope, readingPosition: 'epubcfi(/6/4!/4/2:0)' }))).toEqual({ type: 'epub', cfi: 'epubcfi(/6/4!/4/2:0)' });
    const nested = readPosition(captureQuestionOrigin({ ...scope, readingPosition: { type: 'epub', cfi: JSON.stringify(native), selection: native } }));
    expect(nested.selection).toEqual(native); expect(JSON.parse(nested.cfi)).toEqual(native);
    for (const kind of ['readium', 'offset']) expect(readPosition(captureQuestionOrigin({ ...scope, readingPosition: { schema: 'shudeng.anchor.v3', version: 3, kind, locator: native, readium: native } }))).toEqual(native);
    expect(readPosition(captureQuestionOrigin({ ...scope, readingPosition: { schema: 'shudeng.anchor.v3', version: 3, kind: 'cfi', locator: { cfi: 'epubcfi(/6/2)' } } }))).toEqual({ type: 'epub', cfi: 'epubcfi(/6/2)' });
  });

  it('supports Native/RN/PDF V3 page origins and rejects mismatched pages or EPUB/PDF formats', () => {
    const pdfScope = { bookId: 'book-a', format: 'pdf' };
    const page = { href: 'pdf://page/12', type: 'application/pdf', title: '第 12 页', locations: { page: 12, position: 12, fragments: ['page=12'], progression: .1 } };
    expect(readPosition(captureQuestionOrigin({ ...pdfScope, readingPosition: page }))).toEqual(page);
    expect(readPosition(captureQuestionOrigin({ ...pdfScope, readingPosition: { type: 'pdf', page: 12, rects: [{ x: .1, y: .2, width: .3, height: .1 }] } }))).toMatchObject({ type: 'pdf', page: 12 });
    expect(readPosition(captureQuestionOrigin({ ...pdfScope, readingPosition: { schema: 'shudeng.anchor.v3', version: 3, kind: 'pdf', locator: { page: 12 }, readium: page } }))).toEqual({ type: 'pdf', page: 12 });
    for (const value of [{ ...page, locations: { page: 13 } }, { ...page, locations: { fragments: ['page=13'] } }, { type: 'pdf', page: 0 }, { type: 'pdf', page: 1.5 },
      { schema: 'shudeng.anchor.v3', version: 3, kind: 'pdf', locator: { page: 13 }, readium: page }, native]) expect(captureQuestionOrigin({ ...pdfScope, readingPosition: value })).toBeUndefined();
    expect(captureQuestionOrigin({ ...scope, readingPosition: page })).toBeUndefined();
    expect(captureQuestionOrigin({ ...scope, readingPosition: { type: 'pdf', page: 1 } })).toBeUndefined();
  });

  it('rejects unsupported locators, cross-book tags, unsafe resource paths and invalid positional values', () => {
    for (const readingPosition of ['chapter.xhtml', 'not a locator', '{}', '[]', 'epubcfi(broken)', { href: 'https://other/book.xhtml' }, { href: '../other.xhtml' },
      { href: '%2e%2e/other.xhtml' }, { href: 'file:///book.xhtml' }, { href: '//host/chapter.xhtml' }, { href: '/private/book.xhtml' },
      { href: 'folder%5c..%5cother.xhtml' },
      { ...native, bookID: 'book-b' }, { type: 'epub', selection: { ...native, bookId: 'book-b' } },
      { ...native, locations: { progression: 2 } }, { ...native, locations: { position: -1 } }, { ...native, type: 'application/pdf' },
      { schema: 'shudeng.anchor.v3', version: 4, kind: 'readium', locator: native }, { engine: 'rag-chunk-v1', href: native.href },
      { type: 'epub', cfi: 'epubcfi(/6/2)', selection: { ...native, href: 'javascript:alert(1)' } }]) {
      expect(captureQuestionOrigin({ ...scope, readingPosition })).toBeUndefined();
    }
  });

  it('whitelists only position data and does not use later history when selecting an origin', () => {
    const snapshot = captureQuestionOrigin({ ...scope, readingPosition: { ...native, apiKey: 'SYNTHETIC-SECRET', requestMaterials: [{ content: 'unrelated' }], citations: [] } });
    expect(JSON.stringify(snapshot)).not.toContain('SYNTHETIC'); expect(readPosition(snapshot)).toEqual(native);
    const first = resolveQuestionOrigin({ ...scope, legacyNative: legacy });
    const later = captureQuestionOrigin({ ...scope, readingPosition: { type: 'epub', cfi: 'epubcfi(/6/12)' } });
    expect(resolveQuestionOrigin({ ...scope, questionOrigin: first, legacyNative: { ...legacy, originJSON: later!.readingPosition } })).toEqual(first);
  });

  it('rejects data after the root CFI closes and unbalanced root delimiters', () => {
    for (const invalid of ['epubcfi(/6/8)garbage)', 'epubcfi(/6/8)(extra)', 'epubcfi(/6/8))', 'epubcfi(/6/8', 'epubcfi(/6/8(x)']) {
      expect(captureQuestionOrigin({ ...scope, readingPosition: invalid })).toBeUndefined();
      expect(captureQuestionOrigin({ ...scope, readingPosition: { type: 'epub', cfi: invalid } })).toBeUndefined();
    }
    expect(captureQuestionOrigin({ ...scope, readingPosition: 'epubcfi(/6/8[id^),x]!/4/2:1)' })).toBeDefined();
  });
});
