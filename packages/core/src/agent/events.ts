/**
 * 对外 AgentEvent 协议：UI / 宿主只消费这里的事件。
 * 不依赖 LangChain / LangGraph / Node 专属运行时类型。
 */
import type { BookIdentity, EvidenceRef } from '../domain/types.js';

export type AgentFailureCode =
  | 'configuration'
  | 'authentication'
  | 'network'
  | 'limited'
  | 'capacity'
  | 'incompatible'
  | 'invalid-response'
  | 'timeout'
  | 'unknown';

export interface AgentRunStarted {
  runId: string;
  book: BookIdentity;
  question: string;
  provider: string;
  model: string;
  toolNames: string[];
}

/** 已通过原文核对的书内引用。 */
export interface VerifiedCitation extends EvidenceRef {
  locator: string;
  chapter?: string;
  page?: number;
}

export interface AgentRunResult {
  answer: string;
  citations: VerifiedCitation[];
  /** 展示给读者的提示（例如引用未通过核对被剔除）。 */
  warnings: string[];
  /** 模型步数（含工具结果回填后的下一轮）。 */
  steps: number;
  /** 被剔除的引用 id 列表，便于评测统计“伪造引用”。 */
  droppedCitationIds: string[];
  model: string;
  contextUsage?: AgentContextUsage;
  contextSummary?: string;
  contextEstimate?: AgentContextEstimate;
  sentMaterials?: readonly AgentSentMaterial[];
}

/** Provider-reported tokens for the most recent model request; never an estimated percentage. */
export interface AgentContextUsage {
  inputTokens: number;
  outputTokens: number;
  contextWindowTokens?: number;
}

/** Local estimate of the actual prepared messages; separate from provider usage. */
export interface AgentContextEstimate {
  estimatedTokens: number;
  characterCount: number;
  systemTokens: number;
  historyTokens: number;
  toolTokens: number;
  summaryTokens: number;
  contextWindowTokens?: number;
  thresholdTokens?: number;
  action: 'none' | 'compacted' | 'pruned' | 'trimmed';
  summarizedMessages: number;
  trimmedMessages?: number;
  truncatedToolResults?: number;
}

/** Text present in a dispatched model request, never the unabridged source registry. */
export interface AgentSentMaterial {
  id: string;
  kind: 'selection' | 'book-tool' | 'external-tool';
  name: string;
  content: string;
}

export type AgentEvent =
  | { type: 'started'; started: AgentRunStarted }
  | { type: 'reasoningDelta'; delta: string }
  | { type: 'textDelta'; delta: string }
  | { type: 'toolStarted'; callId: string; name: string; args: unknown }
  | {
      type: 'toolFinished';
      callId: string;
      name: string;
      content: string;
      isError: boolean;
      durationMs: number;
    }
  | { type: 'citation'; citation: VerifiedCitation }
  | { type: 'contextUsage'; usage: AgentContextUsage }
  | { type: 'requestContext'; estimate: AgentContextEstimate; materials: readonly AgentSentMaterial[] }
  | { type: 'contextCompacted'; summary: string }
  | { type: 'completed'; result: AgentRunResult }
  | { type: 'failed'; code: AgentFailureCode; message: string }
  | { type: 'cancelled' };

/** 一次运行的可迭代事件流 + 取消入口 + 最终结果。 */
export interface AgentRunSession {
  events: AsyncIterable<AgentEvent>;
  /** 取消运行；事件流以 cancelled 结束，result resolve 为 null。 */
  cancel(): void;
  result: Promise<AgentRunResult | null>;
}
