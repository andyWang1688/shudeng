import type { AgentContextEstimate, AgentContextUsage, AgentSentMaterial, LegacyNativeSnapshot, VerifiedCitation, WebSource } from '@shudeng/core';
import type { WebSearchPresentation } from '../../platform/library/assistantSources';
import type { QuestionOriginSnapshot } from '../../platform/library/questionOrigin';

export interface ToolLine {
  readonly callId: string;
  readonly name: string;
  status: 'running' | 'done' | 'error';
  detail?: string;
  readonly title?: string;
  readonly preview?: string;
  readonly durationMs?: number;
  readonly finished?: boolean;
}

export interface ChatTurn {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  text: string;
  reasoning: string;
  tools: ToolLine[];
  /** Reader-facing process title, separate from compressed conversation context. */
  toolSummary?: string;
  citations: VerifiedCitation[];
  webSources?: readonly WebSource[];
  webSearchStatus?: WebSearchPresentation;
  warnings: string[];
  status: 'streaming' | 'done' | 'error' | 'cancelled' | 'interrupted';
  error?: string;
  saveError?: string;
  reasoningDurationMs?: number;
  /** Actual model rounds reported by a completed run, independent of tool calls. */
  modelSteps?: number;
  contextUsage?: AgentContextUsage;
  contextSummary?: string;
  contextEstimate?: AgentContextEstimate;
  sentMaterials?: readonly AgentSentMaterial[];
  /** Native historical display data; never a dispatched request or checkpoint. */
  readonly legacyNative?: LegacyNativeSnapshot;
  /** 用户原始问题（不含选文前缀），用于多轮 history。 */
  readonly sourceQuestion?: string;
  /** 实际发送给 Agent 的问题（含选文前缀），重试时复用。 */
  readonly agentQuestion?: string;
  /** 该轮附带的选中原文（用户气泡内展开）。 */
  readonly selectionQuote?: string;
  /** Request selection keeps Native multi-part separators without changing the visible attachment. */
  readonly selectionContextQuote?: string;
  readonly selectionAttached?: boolean;
  /** Null preserves an explicitly invalid authoritative position instead of reviving an older fallback. */
  readonly questionOrigin?: QuestionOriginSnapshot | null;
  readonly bookTitle?: string;
}
