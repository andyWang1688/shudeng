/**
 * 引用核对：只接受本轮工具原文中实际派发给模型的片段。
 * 模型给的 quote 必须在某条已登记 evidence 的原文里连续出现（空白差异归一化后），
 * 且 id 必须是本轮登记过的证据 id；否则剔除并记录 warning。绝不“放宽到任意文本”。
 */
import type { BookExcerpt } from './book-source.js';
import type { BookFormat } from '../domain/types.js';
import { normalizedReaderText } from '../rag/reader-location.js';
import { splitCitationTail } from './citation-tail.js';
import type { VerifiedCitation, WebSource } from './events.js';

export interface RegisteredEvidence extends BookExcerpt {
  /** 本轮运行内的稳定证据 id（E1、E2…）。 */
  id: string;
}

/** Structured portions of one exact rendered tool payload, not the full source registry. */
export interface RenderedEvidenceMaterial {
  readonly id: string;
  readonly name: string;
  readonly content: string;
}

/** 本轮运行内登记的可核查依据；工具回调写入，完成时核对。 */
export class EvidenceRegistry {
  private readonly byId = new Map<string, RegisteredEvidence>();
  private readonly order: string[] = [];
  private readonly rendered = new Map<string, readonly RenderedEvidenceMaterial[]>();
  private readonly transmitted = new Map<string, Set<string>>();

  constructor(readonly format?: BookFormat) {}

  recordRendered(content: string, materials: readonly RenderedEvidenceMaterial[]): string {
    this.rendered.set(content, materials.map(material => Object.freeze({ ...material })));
    return content;
  }

  renderedMaterials(content: string): readonly RenderedEvidenceMaterial[] | undefined {
    return this.rendered.get(content);
  }

  recordTransmitted(id: string, content: string): void {
    if (!this.byId.has(id)) return;
    if (!content.trim()) return;
    const versions = this.transmitted.get(id) ?? new Set<string>();
    versions.add(content);
    this.transmitted.set(id, versions);
  }

  includesTransmittedQuote(id: string, normalizedQuote: string, pdfLineWrap = false): boolean {
    const normalize = pdfLineWrap ? (content: string) => normalizePdfCitationText(content).text : normalizeWhitespace;
    return [...(this.transmitted.get(id) ?? [])].some(content => normalize(content).includes(normalizedQuote));
  }

  /** A budget trim may cut inside a quote; preserve only its transmitted prefix. */
  recordTruncated(original: string, prefix: string, rendered: string): void {
    const materials = this.rendered.get(original);
    if (!materials) return;
    let offset = 0;
    const kept: RenderedEvidenceMaterial[] = [];
    for (const material of materials) {
      const start = original.indexOf(material.content, offset);
      if (start < 0) continue;
      offset = start + material.content.length;
      const content = prefix.slice(start, Math.min(offset, prefix.length));
      if (content) kept.push({ ...material, content });
    }
    this.recordRendered(rendered, kept);
  }

  register(excerpt: BookExcerpt): RegisteredEvidence {
    for (const id of this.order) {
      const existing = this.byId.get(id)!;
      if (existing.quote === excerpt.quote && existing.locator === excerpt.locator &&
          existing.chunkId === excerpt.chunkId && existing.readRef === excerpt.readRef &&
          existing.sourceVersion === excerpt.sourceVersion) {
        return existing;
      }
    }
    const id = `E${this.order.length + 1}`;
    const registered: RegisteredEvidence = { ...excerpt, id };
    this.byId.set(id, registered);
    this.order.push(id);
    return registered;
  }

  all(): RegisteredEvidence[] {
    return this.order.map((id) => this.byId.get(id)!);
  }

  get(id: string): RegisteredEvidence | undefined {
    return this.byId.get(id);
  }

  get size(): number {
    return this.order.length;
  }
}

/** 归一化空白：折叠连续空白为单个空格（与 Swift 版引用核对口径一致）。 */
export function normalizeWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** PDFKit may insert a visual line break inside a Chinese word. Preserve the
 * offsets so persisted citations still contain the original PDF text. */
function normalizePdfCitationText(source: string): { text: string; offsets: number[] } {
  const { text, offsets } = normalizedReaderText(source);
  const han = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
  const kept: number[] = [];
  let output = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    const offset = offsets[index]!;
    if (char === ' ' && index > 0 && index + 1 < text.length &&
        han.test(text[index - 1]!) && han.test(text[index + 1]!) &&
        /^[ \t\u3000]*(?:\r\n|\n|\r)[ \t\u3000]*$/.test(source.slice(offset, offsets[index + 1]))) continue;
    output += char;
    kept.push(offset);
  }
  return { text: output, offsets: kept };
}

function verifiedQuote(quote: string, evidence: RegisteredEvidence, registry: EvidenceRegistry): string | undefined {
  const normalized = normalizeWhitespace(quote);
  if (!normalized) return undefined;
  if (normalizeWhitespace(evidence.quote).includes(normalized) && registry.includesTransmittedQuote(evidence.id, normalized)) return quote;
  if (registry.format !== 'pdf') return undefined;
  const pdfQuote = normalizePdfCitationText(quote).text;
  const source = normalizePdfCitationText(evidence.quote);
  const start = source.text.indexOf(pdfQuote);
  if (start < 0 || !registry.includesTransmittedQuote(evidence.id, pdfQuote, true)) return undefined;
  return evidence.quote.slice(source.offsets[start], source.offsets[start + pdfQuote.length - 1]! + 1);
}

type AnswerCitation = { id?: unknown; quote?: unknown; url?: unknown; after?: unknown };

interface AnswerPayload {
  answer: string;
  citations: ReadonlyArray<AnswerCitation>;
}

function answerAnchor(answer: string, value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const anchor = value.trim();
  if (!anchor || anchor.length > 160 || /[\r\n]/.test(anchor)) return;
  const start = answer.indexOf(anchor);
  if (start >= 0 && answer.indexOf(anchor, start + 1) < 0) return anchor;
}

export function placeWebSources(payload: AnswerPayload, sources: readonly WebSource[]): readonly WebSource[] {
  if (!sources.length) return sources;
  const anchors = new Map<string, string>();
  for (const citation of payload.citations) {
    if (typeof citation?.url !== 'string' || citation.id !== undefined) continue;
    const anchor = answerAnchor(payload.answer, citation.after);
    if (!anchor) continue;
    try {
      const url = new URL(citation.url).href;
      if (!anchors.has(url)) anchors.set(url, anchor);
    } catch { /* Only real provider URLs can receive a placement. */ }
  }
  return sources.map(source => {
    const anchor = anchors.get(source.url);
    return anchor ? { ...source, answerAnchor: anchor } : source;
  });
}

/** 从模型最终输出里解析 `{answer, citations}`；允许 markdown 代码块与前后说明。 */
export function parseAnswerPayload(text: string): AnswerPayload | null {
  const unwrapped = unwrapJsonString(text.trim());
  const tail = splitCitationTail(unwrapped);
  if (tail) {
    const array = readJsonArray(tail.references, 0);
    return { answer: tail.answer, citations: array ? safeCitations(array) : [] };
  }
  const start = unwrapped.indexOf('{');
  if (start < 0) return null;
  const end = unwrapped.lastIndexOf('}');
  const candidate = end > start ? unwrapped.slice(start, end + 1) : unwrapped.slice(start);
  const parsed = safeParse(candidate);
  if (parsed && typeof parsed.answer === 'string' && Array.isArray(parsed.citations)) {
    return {
      answer: parsed.answer,
      citations: parsed.citations as ReadonlyArray<AnswerCitation>,
    };
  }
  return salvageAnswerPayload(candidate);
}

function unwrapJsonString(text: string): string {
  let value = text;
  for (let depth = 0; depth < 3 && value.startsWith('"'); depth += 1) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed !== 'string') break;
      value = parsed.trim();
    } catch {
      break;
    }
  }
  return value;
}

function safeParse(text: string): { answer?: unknown; citations?: unknown } | null {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return null;
    return value as { answer?: unknown; citations?: unknown };
  } catch {
    return null;
  }
}

function salvageAnswerPayload(candidate: string): AnswerPayload | null {
  const marker = /"answer"\s*:\s*"/.exec(candidate);
  if (!marker) return null;
  const answerStart = marker.index + marker[0].length;
  const citationPattern = /"\s*,\s*"citations"\s*:\s*\[/g;
  citationPattern.lastIndex = answerStart;
  let boundary: RegExpExecArray | null = null;
  for (let match = citationPattern.exec(candidate); match; match = citationPattern.exec(candidate)) {
    boundary = match;
  }
  if (!boundary) return salvageTruncatedAnswer(candidate.slice(answerStart));
  const arrayStart = candidate.indexOf('[', boundary.index);
  const arrayText = arrayStart >= 0 ? readJsonArray(candidate, arrayStart) : null;
  const citations = arrayText ? safeCitations(arrayText) : [];
  return {
    answer: decodeJsonStringFragment(candidate.slice(answerStart, boundary.index)),
    citations,
  };
}

/**
 * Recover only when the answer string has an unambiguous end: the response stops
 * inside the answer string, or its closing quote is followed by the object end or
 * the citations key. Other malformed objects remain format errors.
 */
function salvageTruncatedAnswer(answerText: string): AnswerPayload | null {
  let escaped = false;
  for (let index = 0; index < answerText.length; index += 1) {
    const char = answerText[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char !== '"') continue;
    const after = answerText.slice(index + 1);
    if (!/^\s*(?:}\s*)?$/.test(after) && !/^\s*,\s*"citations"\s*:/.test(after)) return null;
    return { answer: decodeJsonStringFragment(answerText.slice(0, index)), citations: [] };
  }
  return { answer: decodeJsonStringFragment(answerText), citations: [] };
}

function safeCitations(text: string): ReadonlyArray<AnswerCitation> {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value as ReadonlyArray<AnswerCitation> : [];
  } catch {
    return [];
  }
}

function readJsonArray(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function decodeJsonStringFragment(text: string): string {
  let answer = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char !== '\\') {
      answer += char;
      continue;
    }
    const escaped = text[++index];
    if (escaped === undefined) break;
    if (escaped === 'u') {
      const code = text.slice(index + 1, index + 5);
      if (code.length < 4 || !/^[0-9a-f]{4}$/i.test(code)) continue;
      answer += String.fromCharCode(parseInt(code, 16));
      index += 4;
    } else {
      answer +=
        ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[escaped] ?? escaped;
    }
  }
  return answer;
}

export interface CitationCheckOutcome {
  citations: VerifiedCitation[];
  droppedIds: string[];
  /** 被剔除的引用对应的 evidence id（用于评测统计伪造引用）。 */
  forged: boolean;
}

/**
 * 核对引用：id 属于本轮证据，quote 连续存在于该证据原文和本轮实际派发的片段中。
 * 同一 id 只接受第一次出现；伪造/未知/空引用全部剔除。
 */
export function verifyCitations(
  payload: AnswerPayload,
  registry: EvidenceRegistry,
): CitationCheckOutcome {
  const citations: VerifiedCitation[] = [];
  const droppedIds: string[] = [];
  const seen = new Set<string>();
  for (const reference of payload.citations) {
    if (typeof reference !== 'object' || reference === null || Array.isArray(reference)) {
      droppedIds.push('(invalid-citation)');
      continue;
    }
    if (typeof reference.url === 'string' && reference.id === undefined) continue;
    const id = typeof reference.id === 'string' ? reference.id : '';
    const quote = typeof reference.quote === 'string' ? reference.quote : '';
    const evidence = id ? registry.get(id) : undefined;
    if (!evidence || seen.has(id)) {
      droppedIds.push(id || '(missing-id)');
      continue;
    }
    const sourceQuote = verifiedQuote(quote, evidence, registry);
    if (!sourceQuote) {
      droppedIds.push(id);
      continue;
    }
    seen.add(id);
    const anchor = answerAnchor(payload.answer, reference.after);
    const citation: VerifiedCitation = {
      id,
      quote: sourceQuote,
      locator: evidence.locator,
      ...(anchor ? { answerAnchor: anchor } : {}),
      ...(evidence.chunkId ? { chunkId: evidence.chunkId } : {}),
      ...(evidence.readRef ? { readRef: evidence.readRef } : {}),
      ...(evidence.sourceVersion ? { sourceVersion: evidence.sourceVersion } : {}),
      ...(evidence.chapter ? { chapter: evidence.chapter } : {}),
      ...(evidence.page !== undefined ? { page: evidence.page } : {}),
    };
    citations.push(citation);
  }
  return { citations, droppedIds, forged: droppedIds.length > 0 };
}
