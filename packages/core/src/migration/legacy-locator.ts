/**
 * 旧 Readium Locator JSON → 版本化 AnchorV3（纯函数，无 IO）。
 *
 * 支持的真实旧数据形态（样本来自 .scratch 备份，已核对）：
 * - EPUB：{href, type, title, locations:{cssSelector, domRange:{start/end:{charOffset,textNodeIndex,cssSelector}}, position, progression, totalProgression}, text:{highlight,before,after}}
 * - PDF：{href:"pdf://page/34", type:"application/pdf", title:"第 34 页", locations:{page,fragments:["page=34"],position,progression,totalProgression}, text:{...}}
 * - 旧数据未出现但格式允许：locations.cfi（CFI 锚）、domRange 字符 offset（offset 锚）。
 *
 * 转换规则：
 * 1. PDF 页（href/pdf page/fragments/geometry）→ kind='pdf'（page + 归一化 rects）
 * 2. locations.cfi → kind='cfi'
 * 3. domRange 有有效 charOffset → kind='offset'（文本节点字符偏移；EPUB 最精确）
 * 4. 其余合法 Readium locator → kind='readium'
 * 任何情况下都保留 legacy.raw 原始字符串；无效矩形只丢弃该矩形并告警。
 */
import {
  ANCHOR_SCHEMA,
  ANCHOR_VERSION,
  type AnchorKind,
  type AnchorV3,
  type PdfNormRect,
  type ReadiumDomPosition,
  type ReadiumDomRange,
  type ReadiumLocations,
  type ReadiumLocator,
  type ReadiumTextQuote,
} from '../domain/anchor.js';
import type { LegacyPdfNoteGeometry, MigrationWarning } from './types.js';

export type LocatorFailureCode = 'invalid-locator-json' | 'unsupported-locator' | 'invalid-pdf-page';

export interface LocatorConversionFailure {
  readonly ok: false;
  readonly code: LocatorFailureCode;
  readonly message: string;
}

export interface LocatorConversionSuccess {
  readonly ok: true;
  readonly anchor: AnchorV3;
  readonly kind: AnchorKind;
  readonly quote: string;
  readonly chapter?: string;
  readonly page?: number;
  /** 旧 locator 原文（= anchor.legacy.raw）。 */
  readonly legacyRaw: string;
  readonly warnings: ReadonlyArray<MigrationWarning>;
}

export type LocatorConversionResult = LocatorConversionSuccess | LocatorConversionFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parsePdfPageFromHref(href: string): number | undefined {
  const match = /^pdf:\/\/page\/(\d+)(?:$|[/?#])/i.exec(href);
  if (!match?.[1]) return undefined;
  return positiveInt(Number(match[1]));
}

function parsePageFromFragments(fragments: ReadonlyArray<string> | undefined): number | undefined {
  if (!fragments) return undefined;
  for (const fragment of fragments) {
    const match = /^page=(\d+)$/i.exec(fragment.trim());
    if (match?.[1]) return positiveInt(Number(match[1]));
  }
  return undefined;
}

function parseDomRange(value: unknown): ReadiumDomRange | undefined {
  if (!isRecord(value)) return undefined;
  const start = parseDomPosition(value.start);
  const end = parseDomPosition(value.end);
  if (!start && !end) return undefined;
  return {
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
  };
}

function parseDomPosition(value: unknown): ReadiumDomPosition | undefined {
  if (!isRecord(value)) return undefined;
  const charOffset = finiteNumber(value.charOffset);
  const textNodeIndex = finiteNumber(value.textNodeIndex);
  const cssSelector = nonEmptyString(value.cssSelector);
  if (charOffset === undefined && textNodeIndex === undefined && cssSelector === undefined) return undefined;
  return {
    ...(charOffset !== undefined ? { charOffset } : {}),
    ...(textNodeIndex !== undefined ? { textNodeIndex } : {}),
    ...(cssSelector !== undefined ? { cssSelector } : {}),
  };
}

function parseLocations(value: unknown): ReadiumLocations | undefined {
  if (!isRecord(value)) return undefined;
  const cssSelector = nonEmptyString(value.cssSelector);
  const domRange = parseDomRange(value.domRange);
  const position = finiteNumber(value.position);
  const progression = finiteNumber(value.progression);
  const totalProgression = finiteNumber(value.totalProgression);
  const page = positiveInt(value.page);
  const cfi = nonEmptyString(value.cfi);
  const fragments =
    Array.isArray(value.fragments) && value.fragments.every((item) => typeof item === 'string')
      ? (value.fragments as string[])
      : undefined;
  const locations: ReadiumLocations = {
    ...(cssSelector ? { cssSelector } : {}),
    ...(domRange ? { domRange } : {}),
    ...(position !== undefined ? { position } : {}),
    ...(progression !== undefined ? { progression } : {}),
    ...(totalProgression !== undefined ? { totalProgression } : {}),
    ...(fragments ? { fragments } : {}),
    ...(page !== undefined ? { page } : {}),
    ...(cfi !== undefined ? { cfi } : {}),
  };
  return Object.keys(locations).length > 0 ? locations : undefined;
}

function parseText(value: unknown): ReadiumTextQuote | undefined {
  if (!isRecord(value)) return undefined;
  const before = nonEmptyString(value.before);
  const highlight = typeof value.highlight === 'string' ? value.highlight : undefined;
  const after = nonEmptyString(value.after);
  if (before === undefined && highlight === undefined && after === undefined) return undefined;
  return {
    ...(before !== undefined ? { before } : {}),
    ...(highlight !== undefined ? { highlight } : {}),
    ...(after !== undefined ? { after } : {}),
  };
}

function validateRects(
  geometry: LegacyPdfNoteGeometry | undefined,
  path: string,
  warnings: MigrationWarning[],
): PdfNormRect[] {
  if (!geometry || !Array.isArray(geometry.rects)) return [];
  const rects: PdfNormRect[] = [];
  geometry.rects.forEach((rect, index) => {
    if (!isRecord(rect)) {
      warnings.push({
        code: 'invalid-pdf-rect',
        path: `${path}.pdf.rects[${index}]`,
        message: 'PDF 矩形不是对象，已丢弃',
      });
      return;
    }
    const x = finiteNumber(rect.x);
    const y = finiteNumber(rect.y);
    const w = finiteNumber(rect.w);
    const h = finiteNumber(rect.h);
    const inRange =
      x !== undefined &&
      y !== undefined &&
      w !== undefined &&
      h !== undefined &&
      x >= -1e-6 &&
      y >= -1e-6 &&
      w > 0 &&
      h > 0 &&
      x + w <= 1 + 1e-6 &&
      y + h <= 1 + 1e-6;
    if (!inRange) {
      warnings.push({
        code: 'invalid-pdf-rect',
        path: `${path}.pdf.rects[${index}]`,
        message: 'PDF 归一化矩形非法（需 0..1、w/h>0），已丢弃该矩形',
      });
      return;
    }
    rects.push({ x, y, w, h });
  });
  return rects;
}

/** 把旧 locatorJSON 转换成 AnchorV3；失败返回明确错误码（不抛异常）。 */
export function convertLegacyLocator(
  raw: unknown,
  pdfGeometry?: LegacyPdfNoteGeometry,
  pdfPageCount?: number,
  path = 'locator',
): LocatorConversionResult {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, code: 'invalid-locator-json', message: 'locatorJSON 为空或不是字符串' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      code: 'invalid-locator-json',
      message: `locatorJSON 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!isRecord(parsed)) {
    return { ok: false, code: 'unsupported-locator', message: 'locator JSON 不是对象' };
  }
  const href = nonEmptyString(parsed.href);
  if (!href) {
    return { ok: false, code: 'unsupported-locator', message: 'locator 缺 href' };
  }

  const title = nonEmptyString(parsed.title);
  const type = nonEmptyString(parsed.type);
  const locations = parseLocations(parsed.locations);
  const text = parseText(parsed.text);
  const readium: ReadiumLocator = {
    href,
    ...(type ? { type } : {}),
    ...(title ? { title } : {}),
    ...(locations ? { locations } : {}),
    ...(text ? { text } : {}),
  };
  const warnings: MigrationWarning[] = [];
  const legacy = { format: 'readium-locator-json', raw } as const;
  const quote = text?.highlight ?? '';
  const chapter = title;

  const geometryPage = positiveInt(pdfGeometry?.page);
  const pdfPage = parsePdfPageFromHref(href) ?? parsePageFromFragments(locations?.fragments) ?? locations?.page ?? geometryPage;

  if (pdfPage !== undefined) {
    if (pdfPage < 1) {
      return { ok: false, code: 'invalid-pdf-page', message: `PDF 页码非法：${String(pdfPage)}` };
    }
    if (geometryPage !== undefined && geometryPage !== pdfPage) {
      warnings.push({
        code: 'pdf-page-mismatch',
        path: `${path}.pdf.page`,
        message: `locator 页码 ${pdfPage} 与 PDF 几何页码 ${geometryPage} 不一致，按 locator 页码迁移`,
      });
    }
    if (pdfGeometry && geometryPage === undefined) {
      warnings.push({
        code: 'invalid-pdf-geometry',
        path: `${path}.pdf`,
        message: 'PDF 几何页码非法，仅迁移页码，丢弃矩形',
      });
    }
    const rects = geometryPage === pdfPage ? validateRects(pdfGeometry, path, warnings) : [];
    const pageCountValue = positiveInt(pdfPageCount);
    const anchor: AnchorV3 = {
      schema: ANCHOR_SCHEMA,
      version: ANCHOR_VERSION,
      kind: 'pdf',
      locator: {
        page: pdfPage,
        ...(pageCountValue !== undefined ? { pageCount: pageCountValue } : {}),
        rects,
      },
      readium,
      legacy,
    };
    return { ok: true, anchor, kind: 'pdf', quote, ...(chapter ? { chapter } : {}), page: pdfPage, legacyRaw: raw, warnings };
  }

  const cfi =
    nonEmptyString(locations?.cfi) ?? (href.startsWith('epubcfi(') ? href.slice(href.indexOf('epubcfi(')) : undefined);
  if (cfi) {
    const anchor: AnchorV3 = {
      schema: ANCHOR_SCHEMA,
      version: ANCHOR_VERSION,
      kind: 'cfi',
      locator: { cfi, ...(href.startsWith('epubcfi(') ? {} : { href }) },
      readium,
      legacy,
    };
    return { ok: true, anchor, kind: 'cfi', quote, ...(chapter ? { chapter } : {}), legacyRaw: raw, warnings };
  }

  const start = locations?.domRange?.start;
  const end = locations?.domRange?.end;
  const startOffset = finiteNumber(start?.charOffset);
  const endOffset = finiteNumber(end?.charOffset);
  if (startOffset !== undefined && endOffset !== undefined && endOffset > startOffset && startOffset >= 0) {
    const cssSelector = start?.cssSelector ?? locations?.cssSelector;
    const textNodeIndex = finiteNumber(start?.textNodeIndex);
    const offsetLocator = {
      href,
      ...(cssSelector !== undefined ? { cssSelector } : {}),
      ...(textNodeIndex !== undefined ? { textNodeIndex } : {}),
      startOffset,
      endOffset,
    };
    const anchor: AnchorV3 = {
      schema: ANCHOR_SCHEMA,
      version: ANCHOR_VERSION,
      kind: 'offset',
      locator: offsetLocator,
      readium,
      legacy,
    };
    return { ok: true, anchor, kind: 'offset', quote, ...(chapter ? { chapter } : {}), legacyRaw: raw, warnings };
  }
  if (startOffset !== undefined || endOffset !== undefined) {
    warnings.push({
      code: 'invalid-pdf-rect',
      path: `${path}.locations.domRange`,
      message: 'domRange 字符 offset 非法（end 必须大于 start），降级为 readium 锚',
    });
  }

  const anchor: AnchorV3 = {
    schema: ANCHOR_SCHEMA,
    version: ANCHOR_VERSION,
    kind: 'readium',
    locator: readium,
    legacy,
  };
  return { ok: true, anchor, kind: 'readium', quote, ...(chapter ? { chapter } : {}), legacyRaw: raw, warnings };
}

/** 旧 Swift 日期（JSONEncoder 默认 Date：2001-01-01 起秒）→ Unix 毫秒。 */
export function appleDateToUnixMs(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  const unixMs = Math.round((value + 978_307_200) * 1000);
  const min = Date.UTC(2001, 0, 1);
  const max = Date.UTC(2100, 0, 1);
  if (unixMs < min || unixMs > max) return undefined;
  return unixMs;
}
