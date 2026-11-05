import { ANCHOR_SCHEMA, ANCHOR_VERSION, type AnchorLegacyCopy, type AnchorV3, type ReadiumDomPosition, type ReadiumDomRange, type ReadiumLocator, type ReadiumLocations, type ReadiumTextQuote } from './anchor.js';

/** One compatibility boundary for live selections and historic EPUB anchors. */
export interface EpubAnchorLocation {
  readonly cfi?: string;
  readonly href?: string;
  readonly chapter?: string;
  readonly selection?: ReadiumLocator;
  readonly totalProgression?: number;
  readonly position?: number;
  readonly textOffset?: { readonly start: number; readonly end: number };
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const string = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const optional = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> => value === undefined ? {} : { [key]: value } as Record<K, V>;
const progress = (value: unknown): number | undefined => { const result = number(value); return result !== undefined && result >= 0 && result <= 1 ? result : undefined; };

function domPosition(value: unknown): ReadiumDomPosition | undefined {
  if (!record(value)) return undefined;
  const cssSelector = string(value.cssSelector);
  const textNodeIndex = number(value.textNodeIndex);
  const charOffset = number(value.charOffset);
  return { ...(cssSelector === undefined ? {} : { cssSelector }), ...(textNodeIndex === undefined ? {} : { textNodeIndex }), ...(charOffset === undefined ? {} : { charOffset }) };
}
function domRange(value: unknown): ReadiumDomRange | undefined {
  if (!record(value)) return undefined;
  const start = domPosition(value.start), end = domPosition(value.end);
  return start && end ? { start, end } : undefined;
}
function readium(value: unknown): ReadiumLocator | undefined {
  if (!record(value) || typeof value.href !== 'string') return undefined;
  const source = record(value.locations) ? value.locations : value;
  const locations: ReadiumLocations = {
    ...optional('cssSelector', string(source.cssSelector)),
    ...optional('domRange', domRange(source.domRange)),
    ...optional('position', number(source.position)),
    ...optional('progression', progress(source.progression)),
    ...optional('totalProgression', progress(source.totalProgression)),
    ...optional('cfi', string(source.cfi)),
    ...(Array.isArray(source.fragments) ? { fragments: source.fragments.filter((item): item is string => typeof item === 'string') } : {}),
  };
  const textSource = record(value.text) ? value.text : undefined;
  const text: ReadiumTextQuote | undefined = textSource ? {
    ...optional('before', string(textSource.before)),
    ...optional('highlight', string(textSource.highlight)),
    ...optional('after', string(textSource.after)),
  } : typeof value.text === 'string' ? { highlight: value.text } : undefined;
  return { href: value.href, ...optional('type', string(value.type)), ...optional('title', string(value.title)), locations, ...(text ? { text } : {}) };
}

/** Raw CFI, ReaderLocator, Readium and V3/legacy copies are decoded only here. */
export function decodeEpubAnchor(value: unknown, depth = 0): EpubAnchorLocation | null {
  if (depth > 8) return null;
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return null;
    if (raw.startsWith('epubcfi(')) return { cfi: raw };
    try { return decodeEpubAnchor(JSON.parse(raw), depth + 1); } catch {
      return raw.startsWith('{') || raw.startsWith('[') ? null : { href: raw };
    }
  }
  if (!record(value) || value.type === 'pdf' || value.kind === 'pdf') return null;
  const nested = record(value.locator) ? decodeEpubAnchor(value.locator, depth + 1) : null;
  const legacy = record(value.legacy) ? decodeEpubAnchor(value.legacy.raw, depth + 1) : null;
  const cfiSource = string(value.cfi);
  const cfiLocation = cfiSource ? decodeEpubAnchor(cfiSource, depth + 1) : null;
  const selection = readium(value.selection) ?? readium(value.readium) ?? (record(value.locations) || record(value.text) || value.kind === 'readium' ? readium(value) : undefined) ?? nested?.selection ?? cfiLocation?.selection ?? legacy?.selection;
  const locations = record(value.locations) ? value.locations : undefined;
  const cfi = cfiLocation?.cfi ?? (string(locations?.cfi)?.startsWith('epubcfi(') ? string(locations?.cfi) : undefined) ?? nested?.cfi ?? legacy?.cfi;
  const href = string(value.href) ?? selection?.href ?? nested?.href ?? cfiLocation?.href ?? legacy?.href;
  if (!cfi && !href) return null;
  const chapter = string(value.chapter) ?? string(value.title) ?? selection?.title ?? nested?.chapter ?? cfiLocation?.chapter ?? legacy?.chapter;
  const totalProgression = progress(value.totalProgression) ?? progress(locations?.totalProgression) ?? (value.type === 'epub' ? progress(value.fraction) : undefined) ?? selection?.locations?.totalProgression ?? nested?.totalProgression ?? cfiLocation?.totalProgression ?? legacy?.totalProgression;
  const offsetSource = record(value.textOffset) ? value.textOffset : value.engine === 'rag-chunk-v1' ? { start: value.charStart, end: value.charEnd } : undefined;
  const start = number(offsetSource?.start), end = number(offsetSource?.end);
  const textOffset = start !== undefined && end !== undefined && Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start ? { start, end } : nested?.textOffset ?? cfiLocation?.textOffset ?? legacy?.textOffset;
  const position = number(value.position) ?? number(locations?.position) ?? selection?.locations?.position ?? nested?.position ?? cfiLocation?.position ?? legacy?.position;
  return { ...(cfi ? { cfi } : {}), ...(href ? { href } : {}), ...(chapter ? { chapter } : {}), ...(selection ? { selection } : {}), ...(totalProgression === undefined ? {} : { totalProgression }), ...(position === undefined ? {} : { position }), ...(textOffset ? { textOffset } : {}) };
}

function preservedLegacy(previous: string | undefined): AnchorLegacyCopy | undefined {
  if (!previous) return undefined;
  try {
    const parsed: unknown = JSON.parse(previous);
    if (record(parsed) && record(parsed.legacy) && typeof parsed.legacy.format === 'string' && typeof parsed.legacy.raw === 'string') return { format: parsed.legacy.format, raw: parsed.legacy.raw };
    if (record(parsed) && parsed.schema === ANCHOR_SCHEMA && record(parsed.locator) && parsed.locator.selection) return undefined;
    return { format: record(parsed) && parsed.schema === ANCHOR_SCHEMA ? ANCHOR_SCHEMA : 'readium-locator-json', raw: previous };
  } catch { return { format: 'epub-cfi', raw: previous }; }
}

export function encodeEpubAnchor(location: EpubAnchorLocation, previous?: string): string {
  const legacy = preservedLegacy(previous);
  const base = { schema: ANCHOR_SCHEMA, version: ANCHOR_VERSION, ...(legacy ? { legacy } : {}) } as const;
  if (location.cfi) return JSON.stringify({ ...base, kind: 'cfi', locator: { ...location, cfi: location.cfi } } satisfies AnchorV3);
  const locator: ReadiumLocator = location.selection ?? { href: location.href ?? '', ...(location.chapter ? { title: location.chapter } : {}), locations: { ...(location.totalProgression === undefined ? {} : { totalProgression: location.totalProgression }), ...(location.position === undefined ? {} : { position: location.position }) } };
  return JSON.stringify({ ...base, kind: 'readium', locator } satisfies AnchorV3);
}

/** A reader destination remains a string for existing navigation/progress APIs. */
export function epubDestination(location: EpubAnchorLocation): string {
  return location.cfi ?? (location.selection ? JSON.stringify(location.selection) : location.href ?? '');
}

function hrefKey(href: string): string {
  let result = href.split('#')[0] ?? '';
  try { result = decodeURIComponent(result); } catch { /* Keep malformed historical URI verbatim. */ }
  return result.replace(/^\.\//, '').replace(/^\//, '');
}
function rangeKey(locator: ReadiumLocator | undefined): string | null {
  const range = locator?.locations?.domRange;
  const point = (value: ReadiumDomPosition | undefined) => value?.cssSelector && Number.isInteger(value.textNodeIndex) ? [value.cssSelector, value.textNodeIndex, value.charOffset ?? null] : null;
  const start = point(range?.start), end = point(range?.end);
  if (!start || !end) return null;
  const text = locator?.text;
  return JSON.stringify([start, end, text?.before ?? null, text?.highlight ?? null, text?.after ?? null]);
}

/** Equal text alone is never identity; exact DOM ranges outrank CFI fallback. */
export function sameEpubSelection(left: unknown, right: unknown): boolean {
  const a = decodeEpubAnchor(left), b = decodeEpubAnchor(right);
  if (!a || !b) return false;
  if (a.href && b.href && hrefKey(a.href) !== hrefKey(b.href)) return false;
  const aRange = rangeKey(a.selection), bRange = rangeKey(b.selection);
  if (aRange && bRange) return !!a.href && !!b.href && aRange === bRange;
  return !!a.cfi && a.cfi === b.cfi;
}

/** Bookmarks follow the original element-scoped quote identity, independent of reflow CFI. */
export function sameEpubBookmark(left: unknown, right: unknown): boolean {
  const a = decodeEpubAnchor(left), b = decodeEpubAnchor(right);
  if (!a || !b) return false;
  if (a.href && b.href && hrefKey(a.href) !== hrefKey(b.href)) return false;
  const key = (location: EpubAnchorLocation): string | null => {
    const selection = location.selection, text = selection?.text, selector = selection?.locations?.cssSelector;
    return selector && text?.highlight ? JSON.stringify([selector, text.before ?? null, text.highlight, text.after ?? null]) : null;
  };
  const aKey = key(a), bKey = key(b);
  if (aKey && bKey) return !!a.href && !!b.href && aKey === bKey;
  return !!a.cfi && a.cfi === b.cfi;
}
