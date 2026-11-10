import { decodeEpubAnchor, encodeEpubAnchor, epubDestination } from '@shudeng/core/domain';
/** 数据层纯函数：无 IO / 无 RN 依赖，便于单测（旧 locator、进度文案、旧对话清洗）。 */
import type {
  BookFormat,
  SaveReaderAnnotationInput,
  StoredPdfRect,
  StoredReaderLocator,
} from './types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function formatOf(value: unknown): BookFormat {
  return value === 'pdf' ? 'PDF' : 'EPUB';
}

/** 平台表内格式（与 @shudeng/core schema 一致）。 */
export function engineFormatOf(format: BookFormat): 'epub' | 'pdf' {
  return format === 'PDF' ? 'pdf' : 'epub';
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 读库里的 percent 列；非数字按 0。 */
export function percentOf(value: unknown): number {
  return typeof value === 'number' ? clampPercent(value) : 0;
}

/** 旧 PDF 标注矩形（Swift 用 w/h）与新 locator（width/height）共用一套归一化解析。 */
function pdfRectsFrom(
  value: unknown,
  widthKey: 'width' | 'w',
  heightKey: 'height' | 'h',
): StoredPdfRect[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).map((rect) => ({
    x: Number(rect.x) || 0,
    y: Number(rect.y) || 0,
    width: Number(rect[widthKey]) || 0,
    height: Number(rect[heightKey]) || 0,
  }));
}

export function storedPdfRects(value: unknown): StoredPdfRect[] | undefined {
  return pdfRectsFrom(value, 'width', 'height');
}

export function legacyPdfRects(value: unknown): StoredPdfRect[] | undefined {
  return pdfRectsFrom(value, 'w', 'h');
}

/** Read-only ordering metadata; keep native local fallback separate from whole-book progress. */
export function annotationReadingOrder(value: unknown): { readonly progression?: number; readonly localProgression?: number; readonly position?: number } {
  const candidates: Record<string, unknown>[] = [];
  const visit = (input: unknown, depth = 0): void => {
    if (depth > 8) return;
    if (typeof input === 'string') {
      try { visit(JSON.parse(input), depth + 1); } catch { /* Plain href/CFI is not ordering metadata. */ }
      return;
    }
    if (!isRecord(input)) return;
    candidates.push(input);
    visit(input.locations, depth + 1);
    visit(input.locator, depth + 1);
    visit(input.readium, depth + 1);
    visit(input.selection, depth + 1);
    if (isRecord(input.legacy)) visit(input.legacy.raw, depth + 1);
    visit(input.cfi, depth + 1);
  };
  visit(value);
  const validProgress = (input: unknown): input is number => typeof input === 'number' && Number.isFinite(input) && input >= 0 && input <= 1;
  const validPosition = (input: unknown): input is number => typeof input === 'number' && Number.isFinite(input) && input >= 0;
  const progression = candidates.map(candidate => candidate.totalProgression).find(validProgress)
    ?? candidates.filter(candidate => candidate.type === 'epub').map(candidate => candidate.fraction).find(validProgress);
  const localProgression = candidates.map(candidate => candidate.progression).find(validProgress);
  const position = candidates.map(candidate => candidate.position).find(validPosition);
  return { ...(progression === undefined ? {} : { progression }), ...(localProgression === undefined ? {} : { localProgression }), ...(position === undefined ? {} : { position }) };
}

/** 新写入的 ReaderLocator JSON（reader-web 与 saveReaderAnnotation 产生的结构）。 */
export function storedLocatorFromUnknown(value: unknown): StoredReaderLocator | null {
  if (!isRecord(value)) return null;
  if (value.type === 'pdf' && typeof value.page === 'number') {
    const rects = storedPdfRects(value.rects);
    return { type: 'pdf', page: value.page, ...(rects ? { rects } : {}) };
  }
  if (value.type === 'epub') {
    const location = decodeEpubAnchor(value);
    if (location) return { type: 'epub', ...location, cfi: epubDestination(location) };
  }
  return null;
}

export function parseStoredLocatorJson(raw: string | null): StoredReaderLocator | null {
  if (!raw) return null;
  try {
    return storedLocatorFromUnknown(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 旧 Readium locator → reader-web / PDF 页可用的 ReaderLocator。 */
export function readerLocatorFromLegacy(raw: unknown, format: BookFormat): StoredReaderLocator | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  if (format === 'EPUB') {
    const location = decodeEpubAnchor(raw);
    return location ? { type: 'epub', ...location, cfi: epubDestination(location) } : null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const href = typeof parsed.href === 'string' ? parsed.href : undefined;
  const locations = isRecord(parsed.locations) ? parsed.locations : undefined;
  if (format === 'PDF') {
    const fromHref = href ? /^pdf:\/\/page\/(\d+)(?:$|[/?#])/i.exec(href)?.[1] : undefined;
    const fromFragment = Array.isArray(locations?.fragments)
      ? locations.fragments.find((item): item is string => typeof item === 'string' && /^page=\d+$/i.test(item))?.slice(5)
      : undefined;
    const pageValue = locations?.page;
    const page = typeof pageValue === 'number' && Number.isInteger(pageValue) && pageValue >= 1
      ? pageValue
      : Number(fromHref ?? fromFragment);
    return Number.isInteger(page) && page >= 1 ? { type: 'pdf', page } : null;
  }
  return null;
}

export function legacyProgression(raw: unknown): number {
  if (typeof raw !== 'string') return 0;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.locations)) return 0;
    const value = parsed.locations.totalProgression ?? parsed.locations.progression;
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
  } catch {
    return 0;
  }
}

export function formatProgressLabel(
  format: BookFormat,
  page: number | null,
  percent: number | null,
): string {
  if (format === 'PDF') {
    if (page !== null) return `第 ${page} 页`;
    return percent !== null ? `已读 ${percent}%` : '未开始';
  }
  return percent !== null ? `已读 ${percent}%` : '未开始';
}

export function detectBookFormat(name: string | undefined, mimeType: string | undefined): BookFormat | null {
  const lowerName = (name ?? '').toLowerCase();
  const lowerMime = (mimeType ?? '').toLowerCase();
  if (lowerName.endsWith('.epub') || lowerMime.includes('epub')) return 'EPUB';
  if (lowerName.endsWith('.pdf') || lowerMime.includes('pdf')) return 'PDF';
  return null;
}

/** 旧 Agent 有时把模型 JSON（{"answer":...,"citations":...}）直接写进 assistant content；预览前清洗。 */
function readableTextField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function decodeJsonStringLiteral(raw: string): string | null {
  try {
    const value: unknown = JSON.parse(`"${raw}"`);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function stripLegacyJsonEnvelope(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^\{?\s*"answer"\s*:\s*/i, '');
  text = text.replace(/^"/, '');
  text = text.replace(/"?\s*,\s*"(reasoning|citations|tool_calls|steps|usage|model|book)"\s*:[\s\S]*$/i, '');
  text = text.replace(/"?\s*\{\s*$/, '');
  text = text.replace(/"?\s*\}\s*$/, '');
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .trim();
}

/**
 * 只用于旧对话展示：把 assistant content 里的模型 JSON 提取成纯文本。
 * 优先 JSON.parse 的 answer/reasoning；解析失败用正则；再失败去 JSON 前后缀。
 * 不修改数据库内容。
 */
export function cleanLegacyAssistantContent(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  const looksLikeJson = text.startsWith('{') || /"answer"\s*:/.test(text) || /"tool_calls"\s*:/.test(text);
  if (!looksLikeJson) return text;

  const objectStart = text.indexOf('{');
  const objectEnd = text.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    try {
      const parsed: unknown = JSON.parse(text.slice(objectStart, objectEnd + 1));
      if (isRecord(parsed)) {
        const answer = readableTextField(parsed, 'answer');
        if (answer) return answer;
        const reasoning = readableTextField(parsed, 'reasoning');
        if (reasoning) return reasoning;
        // 只有 tool_calls/citations 等内部字段：不把原始 JSON 当回答展示。
        if (Object.keys(parsed).some((key) => key === 'tool_calls' || key === 'citations' || key === 'steps')) {
          return '';
        }
      }
    } catch {
      // 继续走正则/前后缀兜底。
    }
  }

  const answerMatch = /"answer"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(text);
  const answerFromRegex = answerMatch?.[1] ? decodeJsonStringLiteral(answerMatch[1]) : null;
  if (answerFromRegex?.trim()) return answerFromRegex.trim();
  const reasoningMatch = /"reasoning"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(text);
  const reasoningFromRegex = reasoningMatch?.[1] ? decodeJsonStringLiteral(reasoningMatch[1]) : null;
  if (reasoningFromRegex?.trim()) return reasoningFromRegex.trim();
  if (/"tool_calls"\s*:/.test(text) && !/"answer"\s*:/.test(text)) return '';

  return stripLegacyJsonEnvelope(text);
}

export function citationHref(locatorJson: string | null): string | null {
  if (!locatorJson) return null;
  const match = /"href"\s*:\s*"([^"]+)"/.exec(locatorJson);
  return match?.[1] ?? null;
}

/** 选区 → 旧 AnchorV3 的 locatorJson（保持既有存储形状，读写两侧一致）。 */
export function anchorJsonForSelection(input: SaveReaderAnnotationInput): string {
  const base = { schema: 'shudeng.anchor.v3', version: 3 } as const;
  if (input.locator.type === 'pdf') {
    return JSON.stringify({
      ...base,
      kind: 'pdf',
      locator: {
        page: input.locator.page,
        rects: (input.locator.rects ?? []).map((rect) => ({ x: rect.x, y: rect.y, w: rect.width, h: rect.height })),
      },
    });
  }
  const location = decodeEpubAnchor(input.locator);
  if (!location) throw new Error('这条标注没有可用的原文位置');
  return encodeEpubAnchor(location);
}
