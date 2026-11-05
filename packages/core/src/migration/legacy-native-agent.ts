import type { AgentContextEstimate } from '../agent/events.js';
import { appleDateToUnixMs } from './legacy-locator.js';

export interface LegacyNativeEvidence {
  readonly id?: string; readonly locatorJSON: string; readonly quote?: string;
  readonly context?: string; readonly chapter?: string;
}

export interface LegacyNativeAgentStep {
  readonly id: string; readonly tool: string; readonly title: string; readonly detail: string;
  readonly preview: string; readonly isError: boolean; readonly duration: number; readonly finished: boolean;
}

/** A historical display snapshot. It is never an Agent checkpoint or a dispatched request. */
export interface LegacyNativeSnapshot {
  readonly version: 1;
  readonly questionId: string; readonly conversationId: string; readonly bookId: string;
  readonly sourceState: string; readonly turnIndex?: number; readonly notice?: string;
  readonly failure?: string; readonly retrievalNotice?: string; readonly reasoningExpanded?: boolean;
  readonly conversationTitle?: string; readonly bookIdentity?: string; readonly originJSON?: string; readonly freeQuestion?: boolean;
  readonly retrievalQueries?: readonly string[]; readonly searchedChapters?: readonly string[]; readonly omittedChapters?: readonly string[];
  readonly retrievalTrace?: Readonly<Partial<Record<'keyword' | 'semantic' | 'anchors' | 'expanded', readonly number[]>>>;
  readonly serviceName?: string; readonly model?: string; readonly format?: string; readonly updated?: number;
  readonly history?: readonly { readonly id: string; readonly question: string; readonly answer: string; readonly state?: string }[];
  readonly agent?: {
    readonly steps?: readonly LegacyNativeAgentStep[]; readonly summary?: string; readonly reasoning?: string;
    readonly reasoningDuration?: number; readonly reasoningExpanded?: boolean;
    readonly context?: Readonly<Record<string, number | string>>; readonly warnings?: readonly string[]; readonly stepsUsed?: number;
  };
  readonly selection?: LegacyNativeEvidence; readonly selectionParts?: readonly LegacyNativeEvidence[];
  readonly evidence?: readonly LegacyNativeEvidence[]; readonly neighbors?: readonly LegacyNativeEvidence[];
  readonly citations?: readonly LegacyNativeEvidence[];
}

export interface LegacyNativeTurnDetails {
  readonly status: 'done' | 'error' | 'interrupted' | 'cancelled';
  readonly reasoning?: string; readonly reasoningDurationMs?: number; readonly modelSteps?: number;
  readonly error?: string; readonly warnings?: readonly string[]; readonly bookTitle?: string;
  readonly contextEstimate?: AgentContextEstimate; readonly legacyNative: LegacyNativeSnapshot;
}

export interface LegacyNativeMetadataCandidate {
  readonly questionId: string; readonly conversationId: string; readonly bookId: string;
  readonly userId: string; readonly assistantId: string; readonly question: string; readonly answer: string;
  /** Absent source timestamps cannot prove an installed message's identity. */
  readonly createdAt?: number; readonly details: LegacyNativeTurnDetails;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function count(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function seconds(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 1000)); }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function strings(value: unknown): string[] | undefined { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined; }
function textFields(value: Record<string, unknown>, keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.flatMap(key => typeof value[key] === 'string' ? [[key, value[key]]] : []));
}
function evidence(value: unknown): LegacyNativeEvidence | undefined {
  const item = record(value);
  if (!item || typeof item.locatorJSON !== 'string') return;
  return { locatorJSON: item.locatorJSON, ...textFields(item, ['id', 'quote', 'context', 'chapter']) };
}
function evidenceList(value: unknown): LegacyNativeEvidence[] | undefined {
  return Array.isArray(value) ? value.flatMap(item => { const projected = evidence(item); return projected ? [projected] : []; }) : undefined;
}

/** Match Native's documented old-field defaults without inventing provider token usage. */
export function projectLegacyNativeContext(value: unknown): AgentContextEstimate | undefined {
  const source = record(value);
  if (!source || (source.estimatedTokens !== undefined && !count(source.estimatedTokens)) || (source.characterCount !== undefined && !count(source.characterCount))) return;
  const required = ['systemTokens', 'historyTokens', 'toolTokens', 'summaryTokens', 'summarizedMessages'] as const;
  if (required.some(key => source[key] !== undefined && !count(source[key]))) return;
  const action = source.action ?? 'none';
  if (action !== 'none' && action !== 'compacted' && action !== 'pruned' && action !== 'trimmed') return;
  const threshold = count(source.thresholdTokens) && source.thresholdTokens > 0 ? source.thresholdTokens
    : source.thresholdTokens === undefined && count(source.limitTokens) && source.limitTokens > 0 ? source.limitTokens : undefined;
  const window = count(source.contextWindow) && source.contextWindow > 0 ? source.contextWindow : undefined;
  return {
    estimatedTokens: (source.estimatedTokens as number | undefined) ?? 0, characterCount: (source.characterCount as number | undefined) ?? 0,
    systemTokens: (source.systemTokens as number | undefined) ?? 0, historyTokens: (source.historyTokens as number | undefined) ?? 0,
    toolTokens: (source.toolTokens as number | undefined) ?? 0, summaryTokens: (source.summaryTokens as number | undefined) ?? 0,
    summarizedMessages: (source.summarizedMessages as number | undefined) ?? 0, action,
    ...(window !== undefined ? { contextWindowTokens: window } : {}), ...(threshold !== undefined ? { thresholdTokens: threshold } : {}),
    ...(count(source.trimmedMessages) ? { trimmedMessages: source.trimmedMessages } : {}),
    ...(count(source.truncatedToolResults) ? { truncatedToolResults: source.truncatedToolResults } : {}),
  };
}

/** Explicit allowlists prevent a future/foreign provider configuration being copied into details. */
export function projectLegacyNativeTurn(value: unknown): LegacyNativeMetadataCandidate | undefined {
  const source = record(value);
  if (!source || typeof source.id !== 'string' || !source.id.trim() || typeof source.bookID !== 'string' || !source.bookID.trim()) return;
  const questionId = source.id;
  const conversationId = typeof source.conversationID === 'string' && source.conversationID.trim() ? source.conversationID : questionId;
  const question = typeof source.question === 'string' ? source.question : '';
  const answer = typeof source.answer === 'string' ? source.answer : '';
  const state = typeof source.state === 'string' ? source.state : 'unknown';
  // Draft and unknown empty records cannot establish a submitted assistant turn.
  const interrupted = state === 'preparing' || state === 'generating' || state === 'incomplete';
  if (!answer.length && (!interrupted || !question.trim().length)) return;
  const agent = record(source.agent);
  const context = record(agent?.context);
  const safeContext = context ? Object.fromEntries(Object.entries(context).filter(([key, item]) =>
    ['estimatedTokens', 'characterCount', 'limitTokens', 'contextWindow', 'thresholdTokens', 'percent', 'thresholdPercent',
      'systemTokens', 'historyTokens', 'toolTokens', 'summaryTokens', 'summarizedMessages', 'trimmedMessages', 'truncatedToolResults'].includes(key)
      ? typeof item === 'number' && Number.isFinite(item) : key === 'action' && typeof item === 'string')) as Record<string, number | string> : undefined;
  const steps = Array.isArray(agent?.steps) ? agent.steps.flatMap(value => {
    const step = record(value);
    if (!step || !['id', 'tool', 'title', 'detail', 'preview'].every(key => typeof step[key] === 'string') ||
        typeof step.isError !== 'boolean' || typeof step.finished !== 'boolean' || !finite(step.duration)) return [];
    return [{ ...textFields(step, ['id', 'tool', 'title', 'detail', 'preview']), isError: step.isError, duration: step.duration, finished: step.finished } as unknown as LegacyNativeAgentStep];
  }) : undefined;
  const warnings = strings(agent?.warnings);
  const estimate = projectLegacyNativeContext(context);
  const selection = evidence(source.selection);
  const lists = Object.fromEntries(['selectionParts', 'evidence', 'neighbors', 'citations'].flatMap(key => {
    const list = evidenceList(source[key]); return list ? [[key, list]] : [];
  }));
  const failure = typeof source.failure === 'string' && source.failure.trim() ? source.failure : undefined;
  // These are exact persisted reasons emitted by Native QuestionStore; arbitrary
  // incomplete failures do not establish reader cancellation.
  const interruptionReasons = new Set([
    '上次生成已中断，请主动重试。', '系统未提供后台时间，请主动重试。',
    '系统后台时间已结束，回答未完成，请主动重试。', '原书已移除，回答未完成；重新导入相同文件后可主动重试。',
  ]);
  const status: LegacyNativeTurnDetails['status'] = state === 'preparing' || state === 'generating' ? 'interrupted'
    : state === 'incomplete' && failure === '已主动取消；保留已保存内容。' ? 'cancelled'
      : state === 'incomplete' && (!failure || interruptionReasons.has(failure)) ? 'interrupted' : failure ? 'error' : 'done';
  const retrievalTrace = record(source.retrievalTrace);
  const safeTrace = retrievalTrace ? Object.fromEntries(['keyword', 'semantic', 'anchors', 'expanded'].flatMap(key => {
    const values = retrievalTrace[key]; return Array.isArray(values) && values.every(count) ? [[key, [...values]]] : [];
  })) : undefined;
  const sourceLists = Object.fromEntries(['retrievalQueries', 'searchedChapters', 'omittedChapters'].flatMap(key => {
    const values = strings(source[key]); return values ? [[key, values]] : [];
  }));
  const history = Array.isArray(source.history) ? source.history.flatMap(value => {
    const turn = record(value);
    if (!turn || typeof turn.id !== 'string' || typeof turn.question !== 'string' || typeof turn.answer !== 'string') return [];
    return [{ id: turn.id, question: turn.question, answer: turn.answer, ...(typeof turn.state === 'string' ? { state: turn.state } : {}) }];
  }) : undefined;
  const createdAt = typeof source.updated === 'number' ? appleDateToUnixMs(source.updated) : undefined;
  return {
    questionId, conversationId, bookId: source.bookID, userId: `legacy-q:${questionId}:user`, assistantId: `legacy-q:${questionId}:assistant`, question, answer,
    ...(createdAt !== undefined ? { createdAt } : {}),
    details: {
      status,
      ...(failure ? { error: failure } : {}), ...(typeof source.bookTitle === 'string' ? { bookTitle: source.bookTitle } : {}),
      ...(typeof agent?.reasoning === 'string' ? { reasoning: agent.reasoning } : {}),
      ...(seconds(agent?.reasoningDuration) ? { reasoningDurationMs: Math.round(agent.reasoningDuration * 1000) } : {}),
      ...(count(agent?.stepsUsed) ? { modelSteps: agent.stepsUsed } : {}), ...(warnings ? { warnings } : {}), ...(estimate ? { contextEstimate: estimate } : {}),
      legacyNative: {
        version: 1, questionId, conversationId, bookId: source.bookID, sourceState: state,
        ...textFields(source, ['notice', 'failure', 'retrievalNotice']), ...(count(source.turnIndex) ? { turnIndex: source.turnIndex } : {}),
        ...textFields(source, ['conversationTitle', 'bookIdentity', 'originJSON', 'serviceName', 'model', 'format']),
        ...(typeof source.freeQuestion === 'boolean' ? { freeQuestion: source.freeQuestion } : {}),
        ...(finite(source.updated) ? { updated: source.updated } : {}), ...sourceLists,
        ...(safeTrace ? { retrievalTrace: safeTrace } : {}), ...(history ? { history } : {}),
        ...(typeof agent?.reasoningExpanded === 'boolean' ? { reasoningExpanded: agent.reasoningExpanded } : {}),
        ...(selection ? { selection } : {}), ...lists,
        ...(agent ? { agent: {
          ...textFields(agent, ['summary', 'reasoning']), ...(steps ? { steps } : {}),
          ...(finite(agent.reasoningDuration) ? { reasoningDuration: agent.reasoningDuration } : {}),
          ...(typeof agent.reasoningExpanded === 'boolean' ? { reasoningExpanded: agent.reasoningExpanded } : {}),
          ...(safeContext ? { context: safeContext } : {}), ...(warnings ? { warnings } : {}), ...(count(agent.stepsUsed) ? { stepsUsed: agent.stepsUsed } : {}),
        } } : {}),
      },
    },
  };
}

/** Independent per-turn records are authoritative; embedded history has no full Native transcript. */
export function legacyNativeMetadataCandidates(value: unknown): LegacyNativeMetadataCandidate[] {
  if (!Array.isArray(value)) return [];
  const projected = value.flatMap(item => { const candidate = projectLegacyNativeTurn(item); return candidate ? [candidate] : []; });
  const ids = new Map<string, number>();
  const booksByConversation = new Map<string, Set<string>>();
  for (const item of value) {
    const source = record(item);
    if (typeof source?.id === 'string') ids.set(source.id.toLowerCase(), (ids.get(source.id.toLowerCase()) ?? 0) + 1);
    if (typeof source?.id !== 'string' || typeof source.bookID !== 'string') continue;
    const id = typeof source.conversationID === 'string' && source.conversationID.trim() ? source.conversationID : source.id;
    const books = booksByConversation.get(id.toLowerCase()) ?? new Set<string>(); books.add(source.bookID); booksByConversation.set(id.toLowerCase(), books);
  }
  return projected.filter(item => ids.get(item.questionId.toLowerCase()) === 1 && booksByConversation.get(item.conversationId.toLowerCase())?.size === 1);
}
