import type { VerifiedCitation } from '@shudeng/core';

export interface ToolLine {
  readonly callId: string;
  readonly name: string;
  status: 'running' | 'done' | 'error';
  detail?: string;
}

export interface ChatTurn {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  text: string;
  reasoning: string;
  tools: ToolLine[];
  citations: VerifiedCitation[];
  warnings: string[];
  status: 'streaming' | 'done' | 'error' | 'cancelled';
  error?: string;
  /** 用户原始问题（不含选文前缀），用于多轮 history。 */
  readonly sourceQuestion?: string;
  /** 实际发送给 Agent 的问题（含选文前缀），重试时复用。 */
  readonly agentQuestion?: string;
  /** 该轮附带的选中原文（用户气泡内展开）。 */
  readonly selectionQuote?: string;
  readonly bookTitle?: string;
}
