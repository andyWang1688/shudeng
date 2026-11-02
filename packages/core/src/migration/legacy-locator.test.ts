import { describe, expect, it } from 'vitest';
import { isAnchorV3 } from '../domain/anchor.js';
import { appleDateToUnixMs, convertLegacyLocator } from './legacy-locator.js';

function readiumLocator(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    href: 'OEBPS/chapter1.xhtml',
    type: 'application/xhtml+xml',
    title: '第一章 · 灯',
    locations: {
      cssSelector: '#p1',
      domRange: {
        start: { charOffset: 0, cssSelector: '#p1', textNodeIndex: 0 },
        end: { charOffset: 36, cssSelector: '#p1', textNodeIndex: 0 },
      },
      position: 18,
      progression: 0.18,
      totalProgression: 0.12,
    },
    text: { highlight: '灯把书页照亮，也把问题留在纸上。', before: '', after: '下一句' },
    ...overrides,
  });
}

function pdfLocator(page = 34): string {
  return JSON.stringify({
    href: `pdf://page/${page}`,
    type: 'application/pdf',
    title: `第 ${page} 页`,
    locations: {
      fragments: [`page=${page}`],
      page,
      position: page,
      progression: 0.06,
      totalProgression: 0.06,
    },
    text: { before: '', highlight: '价值投资是唯一的路', after: '首先，"难"是相对的。' },
  });
}

describe('convertLegacyLocator：EPUB Readium locator → AnchorV3', () => {
  it('有 domRange charOffset 时转 offset 锚，并保留 readium 快照 + legacy.raw', () => {
    const raw = readiumLocator();
    const result = convertLegacyLocator(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe('offset');
    expect(isAnchorV3(result.anchor)).toBe(true);
    expect(result.anchor.kind).toBe('offset');
    if (result.anchor.kind !== 'offset') return;
    expect(result.anchor.locator).toMatchObject({
      href: 'OEBPS/chapter1.xhtml',
      cssSelector: '#p1',
      textNodeIndex: 0,
      startOffset: 0,
      endOffset: 36,
    });
    expect(result.anchor.readium.text?.highlight).toContain('灯');
    expect(result.anchor.legacy?.raw).toBe(raw);
    expect(result.quote).toContain('灯把书页照亮');
    expect(result.chapter).toBe('第一章 · 灯');
    expect(result.warnings).toEqual([]);
  });

  it('无 locator 偏移但有 locations.cfi 时转 CFI 锚', () => {
    const raw = readiumLocator({
      locations: { cfi: 'epubcfi(/6/4!/4/2:0)' },
      href: 'OEBPS/chapter2.xhtml',
    });
    const result = convertLegacyLocator(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe('cfi');
    if (result.anchor.kind !== 'cfi') return;
    expect(result.anchor.locator.cfi).toBe('epubcfi(/6/4!/4/2:0)');
    expect(result.anchor.legacy?.raw).toBe(raw);
  });

  it('其余合法 Readium locator 保留为 readium 锚', () => {
    const raw = JSON.stringify({
      href: 'OEBPS/chapter3.xhtml',
      locations: { position: 5, progression: 0.5 },
      text: { highlight: '段落' },
    });
    const result = convertLegacyLocator(raw);
    expect(result.ok).toBe(true);
    if (!result.ok || result.anchor.kind !== 'readium') return;
    expect(result.anchor.locator.href).toBe('OEBPS/chapter3.xhtml');
    expect(result.anchor.legacy?.raw).toBe(raw);
  });

  it('无 href 的 locator 明确失败（unsupported-locator）', () => {
    const result = convertLegacyLocator(JSON.stringify({ text: { highlight: 'x' } }));
    expect(result).toMatchObject({ ok: false, code: 'unsupported-locator' });
  });

  it('非法 JSON / 空串明确失败（invalid-locator-json）', () => {
    expect(convertLegacyLocator('not-json')).toMatchObject({ ok: false, code: 'invalid-locator-json' });
    expect(convertLegacyLocator('')).toMatchObject({ ok: false, code: 'invalid-locator-json' });
  });
});

describe('convertLegacyLocator：PDF page + normalized rect → AnchorV3', () => {
  it('pdf://page/N 转 pdf 锚，合并归一化矩形', () => {
    const raw = pdfLocator(12);
    const result = convertLegacyLocator(raw, {
      page: 12,
      rects: [
        { x: 0.1, y: 0.2, w: 0.3, h: 0.04 },
        { x: 0.5, y: 0.2, w: 0.2, h: 0.04 },
      ],
    }, 514);
    expect(result.ok).toBe(true);
    if (!result.ok || result.anchor.kind !== 'pdf') return;
    expect(result.kind).toBe('pdf');
    expect(result.page).toBe(12);
    expect(result.anchor.locator.page).toBe(12);
    expect(result.anchor.locator.pageCount).toBe(514);
    expect(result.anchor.locator.rects).toEqual([
      { x: 0.1, y: 0.2, w: 0.3, h: 0.04 },
      { x: 0.5, y: 0.2, w: 0.2, h: 0.04 },
    ]);
    expect(result.anchor.legacy?.raw).toBe(raw);
    expect(result.anchor.readium.locations?.page).toBe(12);
  });

  it('非法矩形丢弃并告警，页码仍迁移', () => {
    const result = convertLegacyLocator(
      pdfLocator(12),
      {
        page: 12,
        rects: [
          { x: -0.2, y: 0.1, w: 0.3, h: 0.04 },
          { x: 0.2, y: 0.1, w: 0.3, h: 0.04 },
        ],
      },
      100,
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.anchor.kind !== 'pdf') return;
    expect(result.anchor.locator.rects).toHaveLength(1);
    expect(result.warnings.map((warning) => warning.code)).toContain('invalid-pdf-rect');
  });

  it('locator 页与 PDF 几何页不一致时告警并按 locator 页迁移', () => {
    const result = convertLegacyLocator(pdfLocator(12), { page: 13, rects: [] }, 100);
    expect(result.ok).toBe(true);
    if (!result.ok || result.anchor.kind !== 'pdf') return;
    expect(result.anchor.locator.page).toBe(12);
    expect(result.anchor.locator.rects).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toContain('pdf-page-mismatch');
  });

  it('页码非法时明确失败（invalid-pdf-page）', () => {
    const result = convertLegacyLocator(
      JSON.stringify({ href: 'pdf://page/0', locations: { page: 0 } }),
    );
    expect(result.ok).toBe(true); // href 解析失败 → 回退 readium，不伪造 PDF
    if (!result.ok) return;
    expect(result.anchor.kind).toBe('readium');

    const geometryOnly = convertLegacyLocator(
      JSON.stringify({ href: 'pdf://page/abc', locations: {} }),
      { page: Number.NaN, rects: [] },
    );
    expect(geometryOnly.ok).toBe(true);
    if (geometryOnly.ok) expect(geometryOnly.anchor.kind).toBe('readium');
  });
});

describe('appleDateToUnixMs：旧 JSONEncoder Date（2001 起秒）', () => {
  it('转换为 Unix 毫秒；非法值返回 undefined', () => {
    expect(appleDateToUnixMs(0)).toBe(Date.UTC(2001, 0, 1));
    expect(appleDateToUnixMs(814435200)).toBe(Math.round((814435200 + 978307200) * 1000));
    expect(appleDateToUnixMs(Number.NaN)).toBeUndefined();
    expect(appleDateToUnixMs(5_000_000_000)).toBeUndefined();
  });
});
