/** Per-question reading location, separate from citations, request materials and checkpoints. */
export interface QuestionOriginSnapshot {
  readonly version: 1;
  readonly bookId: string;
  readonly format: 'epub' | 'pdf';
  readonly readingPosition: string;
}

interface OriginScope { readonly bookId: string; readonly format: unknown }
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const progress = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
function formatOf(value: unknown): QuestionOriginSnapshot['format'] | undefined {
  return value === 'epub' || value === 'EPUB' ? 'epub' : value === 'pdf' || value === 'PDF' ? 'pdf' : undefined;
}
function cfi(value: unknown): value is string {
  if (typeof value !== 'string' || !/^epubcfi\(\/[0-9][^\r\n]*\)$/.test(value)) return false;
  let depth = 0;
  for (let i = 7; i < value.length; i++) {
    if (value[i] === '^') { i++; continue; }
    if (value[i] === '(') depth++;
    if (value[i] === ')') {
      depth--;
      if (depth < 0 || (depth === 0 && i !== value.length - 1)) return false;
    }
  }
  return depth === 0;
}
function href(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\\]/.test(value)) return false;
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { return false; }
  return !/[\u0000-\u001f\\]/.test(decoded) && !/^[a-z][a-z0-9+.-]*:/i.test(decoded) && !decoded.startsWith('/') && !decoded.split(/[/?#]/).includes('..');
}
function sameBook(value: ObjectValue, bookId: string): boolean {
  return ['bookId', 'bookID'].every(key => value[key] === undefined || value[key] === bookId);
}
function strings(value: ObjectValue, keys: readonly string[]): ObjectValue | undefined {
  const output: ObjectValue = {};
  for (const key of keys) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'string') return;
    output[key] = value[key];
  }
  return output;
}

function readium(value: unknown, bookId: string, format: 'epub' | 'pdf'): ObjectValue | undefined {
  if (!object(value) || !sameBook(value, bookId) || typeof value.href !== 'string') return;
  if (value.type !== undefined && value.type !== (format === 'pdf' ? 'application/pdf' : 'application/xhtml+xml') &&
      !(format === 'epub' && ['application/epub+zip', 'text/html', 'image/svg+xml'].includes(value.type as string))) return;
  if (format === 'epub' && !href(value.href) && !cfi(value.href)) return;
  if (format === 'pdf' && !/^pdf:\/\/page\/[1-9]\d*$/.test(value.href) && !href(value.href)) return;
  const labels = strings(value, ['title', 'type']); if (!labels) return;
  const result: ObjectValue = { href: value.href, ...labels };
  if (value.text !== undefined) {
    if (!object(value.text)) return;
    const text = strings(value.text, ['before', 'highlight', 'after']); if (!text) return; result.text = text;
  }
  if (value.locations !== undefined) {
    if (!object(value.locations)) return;
    const source = value.locations; const locations: ObjectValue = {};
    for (const key of ['progression', 'totalProgression']) { if (source[key] !== undefined) { if (!progress(source[key])) return; locations[key] = source[key]; } }
    for (const key of ['position', 'page']) { if (source[key] !== undefined) { if (!integer(source[key]) || source[key] < 1) return; locations[key] = source[key]; } }
    if (source.cfi !== undefined) { if (!cfi(source.cfi) || format !== 'epub') return; locations.cfi = source.cfi; }
    if (source.cssSelector !== undefined) { if (typeof source.cssSelector !== 'string') return; locations.cssSelector = source.cssSelector; }
    if (source.fragments !== undefined) {
      if (!Array.isArray(source.fragments) || !source.fragments.every(item => typeof item === 'string')) return; locations.fragments = [...source.fragments];
    }
    if (source.domRange !== undefined) {
      if (format !== 'epub' || !object(source.domRange)) return;
      const range: ObjectValue = {};
      for (const key of ['start', 'end']) {
        const sourcePoint = source.domRange[key]; if (!object(sourcePoint)) return;
        const point = strings(sourcePoint, ['cssSelector']); if (!point) return;
        for (const numberKey of ['textNodeIndex', 'charOffset']) {
          if (sourcePoint[numberKey] !== undefined) { if (!integer(sourcePoint[numberKey])) return; point[numberKey] = sourcePoint[numberKey]; }
        }
        range[key] = point;
      }
      locations.domRange = range;
    }
    result.locations = locations;
  }
  return result;
}

function pdf(value: ObjectValue, scope: OriginScope): ObjectValue | undefined {
  if (value.type === 'pdf') {
    if (!integer(value.page) || value.page < 1) return;
    const result: ObjectValue = { type: 'pdf', page: value.page };
    if (value.text !== undefined) { if (typeof value.text !== 'string') return; result.text = value.text; }
    if (value.rects !== undefined) {
      if (!Array.isArray(value.rects)) return;
      const rects: ObjectValue[] = [];
      for (const rect of value.rects) {
        if (!object(rect) || !progress(rect.x) || !progress(rect.y) || !progress(rect.width) || !progress(rect.height) ||
            rect.width <= 0 || rect.height <= 0 || rect.x + rect.width > 1.000001 || rect.y + rect.height > 1.000001) return;
        rects.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      }
      result.rects = rects;
    }
    return result;
  }
  const native = readium(value, scope.bookId, 'pdf'); if (!native) return;
  const locations = object(native.locations) ? native.locations : {};
  const pages: number[] = [];
  const match = /^pdf:\/\/page\/([1-9]\d*)$/.exec(native.href as string); if (match) pages.push(Number(match[1]));
  if (locations.page !== undefined) pages.push(locations.page as number);
  if (Array.isArray(locations.fragments)) for (const fragment of locations.fragments) {
    if (typeof fragment !== 'string' || !/^page=[1-9]\d*$/.test(fragment)) return; pages.push(Number(fragment.slice(5)));
  }
  if (!pages.length || pages.some(page => !integer(page) || page < 1 || page !== pages[0])) return;
  return native;
}

function location(value: unknown, scope: OriginScope, depth = 0): ObjectValue | undefined {
  if (depth > 5) return;
  const format = formatOf(scope.format); if (!format) return;
  if (typeof value === 'string') {
    if (!value.trim() || value.length > 131072) return;
    if (format === 'epub' && cfi(value)) return { type: 'epub', cfi: value };
    try { return location(JSON.parse(value), scope, depth + 1); } catch { return; }
  }
  if (!object(value) || !sameBook(value, scope.bookId) || value.engine !== undefined) return;
  if (value.schema !== undefined || value.version !== undefined || value.kind !== undefined) {
    if (value.schema !== 'shudeng.anchor.v3' || value.version !== 3 || !object(value.locator) || !sameBook(value.locator, scope.bookId)) return;
    if (value.kind === 'pdf') {
      if (format !== 'pdf' || !sameBook(value.locator, scope.bookId) || !integer(value.locator.page) || value.locator.page < 1) return;
      if (value.readium !== undefined) {
        if (!object(value.readium)) return;
        const native = pdf(value.readium, scope); if (!native) return;
        const nativeLocations = object(native.locations) ? native.locations : {};
        const nativePage = /^pdf:\/\/page\/([1-9]\d*)$/.exec(native.href as string)?.[1];
        const page = nativeLocations.page ?? (nativePage ? Number(nativePage) : Array.isArray(nativeLocations.fragments) ? Number(String(nativeLocations.fragments[0]).slice(5)) : undefined);
        if (page !== value.locator.page) return;
      }
      return { type: 'pdf', page: value.locator.page };
    }
    if (format !== 'epub') return;
    if (value.readium !== undefined && !readium(value.readium, scope.bookId, 'epub')) return;
    if (value.kind === 'readium') return readium(value.locator, scope.bookId, 'epub');
    if (value.kind === 'offset') return readium(value.readium, scope.bookId, 'epub');
    if (value.kind === 'cfi') return location({ ...value.locator, type: 'epub' }, scope, depth + 1);
    return;
  }
  if (format === 'pdf') return pdf(value, scope);
  if (value.type === 'epub') {
    const result: ObjectValue = { type: 'epub' };
    if (value.cfi !== undefined) {
      if (cfi(value.cfi)) result.cfi = value.cfi;
      else {
        // ReaderLocator.cfi may hold epubDestination's serialized Readium locator.
        const fallback = location(value.cfi, scope, depth + 1); if (!fallback || fallback.type === 'epub') return;
        result.cfi = JSON.stringify(fallback);
      }
    }
    if (value.href !== undefined) { if (!href(value.href)) return; result.href = value.href; }
    if (value.selection !== undefined) { const selection = readium(value.selection, scope.bookId, 'epub'); if (!selection) return; result.selection = selection; }
    if (!result.cfi && !result.href && !result.selection) return;
    const labels = strings(value, ['chapter']); if (!labels) return; Object.assign(result, labels);
    if (value.totalProgression !== undefined) { if (!progress(value.totalProgression)) return; result.totalProgression = value.totalProgression; }
    if (value.position !== undefined) { if (!integer(value.position) || value.position < 1) return; result.position = value.position; }
    return result;
  }
  return readium(value, scope.bookId, 'epub');
}

/** Capture only a caller-provided reading/selection location, never a retrieved citation. */
export function captureQuestionOrigin(input: OriginScope & { readonly readingPosition: unknown }): QuestionOriginSnapshot | undefined {
  const format = formatOf(input.format);
  if (!format || !input.bookId.trim()) return;
  const safe = location(input.readingPosition, input);
  return safe ? { version: 1, bookId: input.bookId, format, readingPosition: JSON.stringify(safe) } : undefined;
}

/** Untrusted details JSON is revalidated and rebuilt with no unrelated fields. */
export function parseQuestionOrigin(value: unknown): QuestionOriginSnapshot | undefined {
  if (!object(value) || value.version !== 1 || typeof value.bookId !== 'string' ||
      (value.format !== 'epub' && value.format !== 'pdf') || typeof value.readingPosition !== 'string') return;
  return captureQuestionOrigin({ bookId: value.bookId, format: value.format, readingPosition: value.readingPosition });
}

/**
 * Each turn owns its original position. A present invalid primary fails closed:
 * Native origin() falls back to selection only when originJSON is absent.
 * The caller decides when a new follow-up inherits the first turn's origin.
 */
export function resolveQuestionOrigin(input: OriginScope & { readonly questionOrigin?: unknown; readonly legacyNative?: unknown }): QuestionOriginSnapshot | undefined {
  const format = formatOf(input.format); if (!format) return;
  if (input.questionOrigin !== undefined) {
    const snapshot = parseQuestionOrigin(input.questionOrigin);
    return snapshot?.bookId === input.bookId && snapshot.format === format ? snapshot : undefined;
  }
  const legacy = input.legacyNative;
  if (!object(legacy) || legacy.version !== 1 || legacy.bookId !== input.bookId) return;
  const raw = legacy.originJSON !== undefined ? legacy.originJSON : object(legacy.selection) ? legacy.selection.locatorJSON : undefined;
  if (typeof raw !== 'string') return;
  try {
    const parsed: unknown = JSON.parse(raw);
    return object(parsed) ? captureQuestionOrigin({ bookId: input.bookId, format, readingPosition: parsed }) : undefined;
  } catch { return; }
}
