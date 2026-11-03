import { describe, expect, it } from 'vitest';
import {
  anchorJsonForSelection,
  clampPercent,
  cleanLegacyAssistantContent,
  detectBookFormat,
  formatProgressLabel,
  legacyProgression,
  parseStoredLocatorJson,
  percentOf,
  readerLocatorFromLegacy,
} from '../pure';
import {
  annotationSeedFromShelfAnnotation,
  readerLocatorFromStoredLocator,
  storedLocatorFromReaderLocator,
} from '../../../reader/readerMapping';
import type { ShelfAnnotation } from '../types';

describe('parseStoredLocatorJson', () => {
  it('parses pdf page and normalizes rects', () => {
    const raw = JSON.stringify({ type: 'pdf', page: 3, rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }] });
    expect(parseStoredLocatorJson(raw)).toEqual({
      type: 'pdf',
      page: 3,
      rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }],
    });
  });

  it('parses epub cfi and ignores malformed JSON', () => {
    expect(parseStoredLocatorJson(JSON.stringify({ type: 'epub', cfi: 'epubcfi(/6/4)', href: 'ch1' })))
      .toEqual({ type: 'epub', cfi: 'epubcfi(/6/4)', href: 'ch1' });
    expect(parseStoredLocatorJson('{not json')).toBeNull();
    expect(parseStoredLocatorJson(null)).toBeNull();
  });
});

describe('readerLocatorFromLegacy', () => {
  it('maps PDF href/fragments/page to a pdf page locator', () => {
    expect(readerLocatorFromLegacy(JSON.stringify({ href: 'pdf://page/34', locations: {} }), 'PDF'))
      .toEqual({ type: 'pdf', page: 34 });
    expect(readerLocatorFromLegacy(JSON.stringify({ href: 'x', locations: { fragments: ['page=7'] } }), 'PDF'))
      .toEqual({ type: 'pdf', page: 7 });
    expect(readerLocatorFromLegacy(JSON.stringify({ locations: { page: 9 } }), 'PDF'))
      .toEqual({ type: 'pdf', page: 9 });
    expect(readerLocatorFromLegacy(JSON.stringify({ href: 'pdf://page/0' }), 'PDF')).toBeNull();
  });

  it('maps EPUB CFI/href with chapter title', () => {
    expect(readerLocatorFromLegacy(
      JSON.stringify({ href: 'ch1.xhtml', title: '第一章', locations: { cfi: 'epubcfi(/6/4)' } }),
      'EPUB',
    )).toEqual({ type: 'epub', cfi: 'epubcfi(/6/4)', href: 'ch1.xhtml', chapter: '第一章' });
    expect(readerLocatorFromLegacy(JSON.stringify({ href: 'ch2.xhtml' }), 'EPUB'))
      .toEqual({ type: 'epub', cfi: 'ch2.xhtml', href: 'ch2.xhtml' });
    expect(readerLocatorFromLegacy('', 'EPUB')).toBeNull();
  });
});

describe('legacyProgression', () => {
  it('clamps totalProgression/progression to 0..1', () => {
    expect(legacyProgression(JSON.stringify({ locations: { totalProgression: 1.7 } }))).toBe(1);
    expect(legacyProgression(JSON.stringify({ locations: { progression: -0.2 } }))).toBe(0);
    expect(legacyProgression(JSON.stringify({ locations: { progression: 0.42 } }))).toBe(0.42);
    expect(legacyProgression('nope')).toBe(0);
  });
});

describe('progress helpers', () => {
  it('formats PDF/EPUB progress labels', () => {
    expect(formatProgressLabel('PDF', 12, 30)).toBe('第 12 页');
    expect(formatProgressLabel('PDF', null, 30)).toBe('已读 30%');
    expect(formatProgressLabel('PDF', null, null)).toBe('未开始');
    expect(formatProgressLabel('EPUB', null, 30)).toBe('已读 30%');
  });

  it('clamps percents', () => {
    expect(clampPercent(1.4)).toBe(1);
    expect(clampPercent(-1)).toBe(0);
    expect(clampPercent(Number.NaN)).toBe(0);
    expect(percentOf('x')).toBe(0);
    expect(percentOf(0.25)).toBe(0.25);
  });

  it('detects formats from name/mime', () => {
    expect(detectBookFormat('book.epub', undefined)).toBe('EPUB');
    expect(detectBookFormat(undefined, 'application/pdf')).toBe('PDF');
    expect(detectBookFormat('book.txt', 'text/plain')).toBeNull();
  });
});

describe('cleanLegacyAssistantContent', () => {
  it('returns plain text untouched', () => {
    expect(cleanLegacyAssistantContent('  plain answer ')).toBe('plain answer');
  });

  it('extracts answer/reasoning from legacy JSON', () => {
    expect(cleanLegacyAssistantContent('{"answer":"真实回答","reasoning":"思考"}')).toBe('真实回答');
    expect(cleanLegacyAssistantContent('{"reasoning":"只有思考"}')).toBe('只有思考');
  });

  it('hides tool/citation-only JSON and strips envelopes', () => {
    expect(cleanLegacyAssistantContent('{"tool_calls":[{"name":"x"}]}')).toBe('');
    expect(cleanLegacyAssistantContent('{"answer":"前缀回答')).toBe('前缀回答');
  });
});

describe('anchorJsonForSelection', () => {
  it('writes AnchorV3 shapes for pdf / cfi / readium', () => {
    const pdf = JSON.parse(anchorJsonForSelection({
      kind: 'highlight',
      format: 'PDF',
      locator: { type: 'pdf', page: 5, rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }] },
    }));
    expect(pdf).toEqual({
      schema: 'shudeng.anchor.v3',
      version: 3,
      kind: 'pdf',
      locator: { page: 5, rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }] },
    });
    const cfi = JSON.parse(anchorJsonForSelection({
      kind: 'highlight',
      format: 'EPUB',
      locator: { type: 'epub', cfi: 'epubcfi(/6/4)', href: 'ch1' },
    }));
    expect(cfi).toEqual({ schema: 'shudeng.anchor.v3', version: 3, kind: 'cfi', locator: { cfi: 'epubcfi(/6/4)', href: 'ch1' } });
    const readium = JSON.parse(anchorJsonForSelection({
      kind: 'bookmark',
      format: 'EPUB',
      locator: { type: 'epub', cfi: '', href: 'ch2' },
    }));
    expect(readium).toEqual({ schema: 'shudeng.anchor.v3', version: 3, kind: 'readium', locator: { href: 'ch2' }, readium: { href: 'ch2' } });
  });
});

describe('readerMapping', () => {
  it('round-trips reader locators to stored locators', () => {
    expect(storedLocatorFromReaderLocator({ type: 'pdf', page: 2, rects: [{ x: 1, y: 2, width: 3, height: 4 }] }))
      .toEqual({ type: 'pdf', page: 2, rects: [{ x: 1, y: 2, width: 3, height: 4 }] });
    expect(storedLocatorFromReaderLocator({ type: 'epub', cfi: 'epubcfi(/6/4)' }))
      .toEqual({ type: 'epub', cfi: 'epubcfi(/6/4)' });
    expect(storedLocatorFromReaderLocator(undefined)).toBeNull();
    expect(readerLocatorFromStoredLocator({ type: 'epub', cfi: 'epubcfi(/6/4)', chapter: '第一章' }))
      .toEqual({ type: 'epub', cfi: 'epubcfi(/6/4)', chapter: '第一章' });
  });

  it('builds annotation seeds and skips bookmarks', () => {
    const annotation: ShelfAnnotation = {
      id: 'annotation-1',
      anchorId: 'anchor-1',
      kind: 'highlight',
      color: 'yellow',
      body: null,
      quote: '引用',
      chapter: '第一章',
      page: null,
      createdAt: 1,
      locator: { type: 'epub', cfi: 'epubcfi(/6/4)' },
    };
    expect(annotationSeedFromShelfAnnotation(annotation, 'EPUB')).toEqual({
      id: 'annotation-1',
      format: 'epub',
      locator: { type: 'epub', cfi: 'epubcfi(/6/4)' },
      text: '引用',
      color: 'yellow',
    });
    expect(annotationSeedFromShelfAnnotation({ ...annotation, kind: 'bookmark' }, 'EPUB')).toBeNull();
    expect(annotationSeedFromShelfAnnotation({ ...annotation, locator: null }, 'EPUB')).toBeNull();
  });
});
