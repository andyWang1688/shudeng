/**
 * 引用核对：只接受工具真实返回过的原文片段。
 * 模型给的 quote 必须在某条已登记 evidence 的原文里连续出现（空白差异归一化后），
 * 且 id 必须是本轮登记过的证据 id；否则剔除并记录 warning。绝不“放宽到任意文本”。
 */
import type { BookExcerpt } from './book-source.js';
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

  recordRendered(content: string, materials: readonly RenderedEvidenceMaterial[]): string {
    this.rendered.set(content, materials.map(material => Object.freeze({ ...material })));
    return content;
  }

  renderedMaterials(content: string): readonly RenderedEvidenceMaterial[] | undefined {
    return this.rendered.get(content);
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
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const candidate = text.slice(start, end + 1);
  const parsed = safeParse(candidate);
  if (!parsed || typeof parsed.answer !== 'string' || !Array.isArray(parsed.citations)) {
    return null;
  }
  return {
    answer: parsed.answer,
    citations: parsed.citations as ReadonlyArray<{ id?: unknown; quote?: unknown }>,
  };
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

export interface CitationCheckOutcome {
  citations: VerifiedCitation[];
  droppedIds: string[];
  /** 被剔除的引用对应的 evidence id（用于评测统计伪造引用）。 */
  forged: boolean;
}

/**
 * 核对模型给出的引用：id 必须在本轮证据里，quote 必须是该证据原文的连续子串。
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
    const id = typeof reference.id === 'string' ? reference.id : '';
    const quote = typeof reference.quote === 'string' ? reference.quote : '';
    const evidence = id ? registry.get(id) : undefined;
    if (!evidence || seen.has(id)) {
      droppedIds.push(id || '(missing-id)');
      continue;
    }
    const normalizedQuote = normalizeWhitespace(quote);
    if (!normalizedQuote || !normalizeWhitespace(evidence.quote).includes(normalizedQuote)) {
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
