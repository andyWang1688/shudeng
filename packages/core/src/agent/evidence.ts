/**
 * 引用核对：只接受本轮工具原文中实际派发给模型的片段。
 * 模型给的 quote 必须在某条已登记 evidence 的原文里连续出现（空白差异归一化后），
 * 且 id 必须是本轮登记过的证据 id；否则剔除并记录 warning。绝不“放宽到任意文本”。
 */
import type { BookExcerpt } from './book-source.js';
import { splitCitationTail } from './citation-tail.js';
import type { VerifiedCitation } from './events.js';

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

  recordRendered(content: string, materials: readonly RenderedEvidenceMaterial[]): string {
    this.rendered.set(content, materials.map(material => Object.freeze({ ...material })));
    return content;
  }

  renderedMaterials(content: string): readonly RenderedEvidenceMaterial[] | undefined {
    return this.rendered.get(content);
  }

  recordTransmitted(id: string, content: string): void {
    if (!this.byId.has(id)) return;
    const normalized = normalizeWhitespace(content);
    if (!normalized) return;
    const versions = this.transmitted.get(id) ?? new Set<string>();
    versions.add(normalized);
    this.transmitted.set(id, versions);
  }

  includesTransmittedQuote(id: string, normalizedQuote: string): boolean {
    return [...(this.transmitted.get(id) ?? [])].some(content => content.includes(normalizedQuote));
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

interface AnswerPayload {
  answer: string;
  citations: ReadonlyArray<{ id?: unknown; quote?: unknown }>;
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
      citations: parsed.citations as ReadonlyArray<{ id?: unknown; quote?: unknown }>,
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

function safeCitations(text: string): ReadonlyArray<{ id?: unknown; quote?: unknown }> {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value as ReadonlyArray<{ id?: unknown; quote?: unknown }> : [];
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
    const id = typeof reference.id === 'string' ? reference.id : '';
    const quote = typeof reference.quote === 'string' ? reference.quote : '';
    const evidence = id ? registry.get(id) : undefined;
    if (!evidence || seen.has(id)) {
      droppedIds.push(id || '(missing-id)');
      continue;
    }
    const normalizedQuote = normalizeWhitespace(quote);
    if (!normalizedQuote || !normalizeWhitespace(evidence.quote).includes(normalizedQuote) ||
        !registry.includesTransmittedQuote(id, normalizedQuote)) {
      droppedIds.push(id);
      continue;
    }
    seen.add(id);
    const citation: VerifiedCitation = {
      id,
      quote,
      locator: evidence.locator,
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
