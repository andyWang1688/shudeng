/**
 * 书内对话摘要：读取 messages/citations，清洗旧 Agent 的 JSON 包裹回答；
 * 旧迁移会话只有 UUID（无 bookId）时用 citations 的 quote/chapter/page/href 反查所属书。
 */
import { createLocalId, type AgentContextEstimate, type AgentContextUsage, type AgentSentMaterial, type LegacyNativeAgentStep, type LegacyNativeEvidence, type LegacyNativeSnapshot, type VerifiedCitation } from '@shudeng/core';
import type { SQLiteValue } from '@shudeng/core/db';
import type { ShudengDataLayer } from '../db';
import { getDataLayer } from '../db';
import { citationHref, cleanLegacyAssistantContent, isRecord } from './pure';
import { parseLegacyJSON } from './legacyMigration';
import type { ConversationSummary } from './types';
import { parseQuestionOrigin, type QuestionOriginSnapshot } from './questionOrigin';
import { parseWebSources, parseWebSearchPresentation, type WebSearchPresentation } from './assistantSources';
import type { WebSource } from '@shudeng/core';

export { cleanLegacyAssistantContent } from './pure';

const CONVERSATION_PREFIX = 'book:';
const activeRuns = new Map<string, () => void>();
const deletedConversations = new Set<string>();
export function isBookConversationDeleted(id: string): boolean {
  return deletedConversations.has(id);
}

export function cancelConversationRun(conversationId: string): void {
  activeRuns.get(conversationId)?.();
}

/** Stop active work before a caller's atomic book deletion. Roll back tombstones on failure. */
export function markConversationsDeleted(ids: readonly string[]): () => void {
  const added = ids.filter((id) => !deletedConversations.has(id));
  for (const id of ids) {
    deletedConversations.add(id);
    cancelConversationRun(id);
  }
  return () => {
    for (const id of added) deletedConversations.delete(id);
  };
}

export function registerConversationRun(conversationId: string, cancel: () => void): () => void {
  activeRuns.set(conversationId, cancel);
  return () => {
    if (activeRuns.get(conversationId) === cancel) activeRuns.delete(conversationId);
  };
}

export interface ConversationTurnDetails {
  readonly status: 'streaming' | 'done' | 'error' | 'cancelled' | 'interrupted';
  readonly agentQuestion?: string;
  readonly selectionQuote?: string;
  readonly selectionContextQuote?: string;
  readonly selectionAttached?: boolean;
  readonly questionOrigin?: QuestionOriginSnapshot | null;
  readonly error?: string;
  readonly reasoning?: string;
  readonly reasoningDurationMs?: number;
  readonly modelSteps?: number;
  readonly toolSummary?: string;
  readonly tools?: ReadonlyArray<{
    callId: string;
    name: string;
    status: 'running' | 'done' | 'error';
    detail?: string;
    readonly title?: string;
    readonly preview?: string;
    readonly durationMs?: number;
    readonly finished?: boolean;
  }>;
  readonly contextUsage?: AgentContextUsage;
  readonly contextSummary?: string;
  readonly warnings?: readonly string[];
  readonly bookTitle?: string;
  readonly contextEstimate?: AgentContextEstimate;
  readonly sentMaterials?: readonly AgentSentMaterial[];
  readonly webSources?: readonly WebSource[];
  readonly webSearchStatus?: WebSearchPresentation;
  readonly legacyNative?: LegacyNativeSnapshot;
}

export interface StoredConversationTurn {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly reasoning: string;
  readonly citations: VerifiedCitation[];
  readonly details: ConversationTurnDetails;
  /** Original Native turn order survives a rename changing that turn's timestamp. */
  readonly isFirstLegacyTurn?: boolean;
}

export function createBookConversationId(): string {
  return createLocalId('conversation');
}

function validModelSteps(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

async function firstBookTitle(layer: ShudengDataLayer, conversationId: string): Promise<string | undefined> {
  const [row] = await layer.driver.all<{ book_title: SQLiteValue }>(
    "SELECT json_extract(d.details_json,'$.bookTitle') AS book_title FROM conversation_turn_details d JOIN messages m ON m.id=d.message_id WHERE m.conversation_id=? AND m.role='assistant' AND CASE WHEN json_valid(d.details_json) THEN json_type(d.details_json,'$.bookTitle') END='text' ORDER BY m.created_at,m.id LIMIT 1",
    [conversationId],
  );
  return typeof row?.book_title === 'string' ? row.book_title : undefined;
}

async function hasLegacyMessages(layer: ShudengDataLayer, conversationId: string): Promise<boolean> {
  const rows = await layer.driver.all<{ id: string }>(
    "SELECT id FROM messages WHERE conversation_id=? AND id GLOB 'legacy-q:*' LIMIT 1",
    [conversationId],
  );
  return rows.length > 0;
}

/** A question and its answer/citations are committed together, including interrupted runs. */
export async function appendBookChatTurn(input: {
  readonly bookId: string;
  readonly conversationId?: string;
  readonly assistantId?: string;
  readonly question: string;
  readonly answer: string;
  readonly details?: ConversationTurnDetails;
  readonly citations?: ReadonlyArray<{
    readonly id: string;
    readonly quote: string;
    readonly locator: string;
    readonly chapter?: string;
    readonly page?: number;
  }>;
}): Promise<void> {
  const layer = await getDataLayer();
  const conversationId = input.conversationId ?? createBookConversationId();
  if (deletedConversations.has(conversationId)) throw new Error('这段对话已删除');
  const assistantId = input.assistantId ?? createLocalId('message');
  const now = Date.now();
  // Freeze the first real book-name snapshot in existing turn details. Source
  // removal and later partial/final writes must not replace that name.
  const priorTitle = await firstBookTitle(layer, conversationId);
  const legacyTitle = priorTitle === undefined && await hasLegacyMessages(layer, conversationId)
    ? legacyConversationMetadata().get(conversationId)?.bookTitle : undefined;
  const bookTitle = priorTitle ?? legacyTitle ?? input.details?.bookTitle ?? (await layer.store.getBook(input.bookId))?.title;
  const details = { ...(input.details ?? { status: 'done' as const }) };
  if (!validModelSteps(details.modelSteps)) delete details.modelSteps;
  await layer.driver.transaction(async (tx) => {
    if (deletedConversations.has(conversationId)) throw new Error('这段对话已删除');
    await tx.run(
      'INSERT INTO conversations (id,book_id,title,created_at,updated_at) VALUES (?,?,NULL,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at',
      [conversationId, input.bookId, now, now],
    );
    await tx.run(
      'INSERT INTO messages (id,conversation_id,role,content,created_at) VALUES (?,?,?, ?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content',
      [assistantId + ':user', conversationId, 'user', input.question, now],
    );
    await tx.run(
      'INSERT INTO messages (id,conversation_id,role,content,reasoning_content,is_error,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content,reasoning_content=excluded.reasoning_content,is_error=excluded.is_error',
      [
        assistantId,
        conversationId,
        'assistant',
        input.answer,
        input.details?.reasoning ?? null,
        input.details?.status === 'error' ? 1 : 0,
        now + 1,
      ],
    );
    await tx.run(
      'INSERT INTO conversation_turn_details (message_id,details_json) VALUES (?,?) ON CONFLICT(message_id) DO UPDATE SET details_json=excluded.details_json',
      [assistantId, JSON.stringify({ ...details, ...(bookTitle !== undefined ? { bookTitle } : {}) })],
    );
    await tx.run('DELETE FROM citations WHERE message_id = ?', [assistantId]);
    for (const citation of input.citations ?? []) {
      await tx.run(
        'INSERT INTO citations (id,conversation_id,message_id,evidence_id,quote,locator_json,chapter,page,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [
          createLocalId('citation'),
          conversationId,
          assistantId,
          citation.id,
          citation.quote,
          citation.locator,
          citation.chapter ?? null,
          citation.page ?? null,
          now,
        ],
      );
    }
  });
}

function parseContextEstimate(value: unknown): AgentContextEstimate | undefined {
  if (!isRecord(value)) return;
  const count = (item: unknown): item is number => typeof item === 'number' && Number.isSafeInteger(item) && item >= 0;
  const keys = ['estimatedTokens', 'characterCount', 'systemTokens', 'historyTokens', 'toolTokens', 'summaryTokens', 'summarizedMessages'] as const;
  if (!keys.every(key => count(value[key])) || !['none', 'compacted', 'pruned', 'trimmed'].includes(value.action as string)) return;
  for (const key of ['contextWindowTokens', 'thresholdTokens']) {
    if (value[key] !== undefined && (!count(value[key]) || value[key] === 0)) return;
  }
  for (const key of ['trimmedMessages', 'truncatedToolResults']) {
    if (value[key] !== undefined && !count(value[key])) return;
  }
  return {
    estimatedTokens: value.estimatedTokens as number, characterCount: value.characterCount as number,
    systemTokens: value.systemTokens as number, historyTokens: value.historyTokens as number,
    toolTokens: value.toolTokens as number, summaryTokens: value.summaryTokens as number,
    summarizedMessages: value.summarizedMessages as number, action: value.action as AgentContextEstimate['action'],
    ...(typeof value.contextWindowTokens === 'number' ? { contextWindowTokens: value.contextWindowTokens } : {}),
    ...(typeof value.thresholdTokens === 'number' ? { thresholdTokens: value.thresholdTokens } : {}),
    ...(typeof value.trimmedMessages === 'number' ? { trimmedMessages: value.trimmedMessages } : {}),
    ...(typeof value.truncatedToolResults === 'number' ? { truncatedToolResults: value.truncatedToolResults } : {}),
  };
}

function parseSentMaterials(value: unknown): readonly AgentSentMaterial[] | undefined {
  if (!Array.isArray(value)) return;
  return value.flatMap(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id.trim() || typeof item.name !== 'string' || !item.name.trim() || typeof item.content !== 'string') return [];
    if (item.kind !== 'selection' && item.kind !== 'book-tool' && item.kind !== 'external-tool') return [];
    return [{ id: item.id, name: item.name, content: item.content, kind: item.kind }];
  });
}

function validDurationMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function nativeTextFields<K extends string>(value: Record<string, unknown>, keys: readonly K[]): Partial<Record<K, string>> {
  return Object.fromEntries(keys.flatMap(key => typeof value[key] === 'string' ? [[key, value[key]]] : [])) as Partial<Record<K, string>>;
}

function parseNativeEvidence(value: unknown): LegacyNativeEvidence | undefined {
  if (!isRecord(value) || typeof value.locatorJSON !== 'string') return;
  return { locatorJSON: value.locatorJSON, ...nativeTextFields(value, ['id', 'quote', 'context', 'chapter']) };
}

/** Validate the versioned display snapshot without converting it into provider usage or sent materials. */
function parseLegacyNative(value: unknown): LegacyNativeSnapshot | undefined {
  if (!isRecord(value) || value.version !== 1 ||
      typeof value.questionId !== 'string' || !value.questionId.trim() ||
      typeof value.conversationId !== 'string' || !value.conversationId.trim() ||
      typeof value.bookId !== 'string' || !value.bookId.trim() || typeof value.sourceState !== 'string') return;
  const agent = isRecord(value.agent) ? value.agent : undefined;
  const seconds = (item: unknown): item is number => typeof item === 'number' &&
    Number.isFinite(item) && item >= 0 && Number.isSafeInteger(Math.round(item * 1000));
  const steps: LegacyNativeAgentStep[] | undefined = Array.isArray(agent?.steps) ? agent.steps.flatMap(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.tool !== 'string' ||
        typeof item.title !== 'string' || typeof item.detail !== 'string' || typeof item.preview !== 'string' ||
        typeof item.isError !== 'boolean' || typeof item.finished !== 'boolean' || !seconds(item.duration)) return [];
    return [{ id: item.id, tool: item.tool, title: item.title, detail: item.detail, preview: item.preview,
      isError: item.isError, finished: item.finished, duration: item.duration }];
  }) : undefined;
  const context = isRecord(agent?.context) ? Object.fromEntries(Object.entries(agent.context).filter(([key, item]) =>
    ['estimatedTokens', 'characterCount', 'limitTokens', 'contextWindow', 'thresholdTokens', 'percent', 'thresholdPercent',
      'systemTokens', 'historyTokens', 'toolTokens', 'summaryTokens', 'summarizedMessages', 'trimmedMessages', 'truncatedToolResults'].includes(key)
      ? typeof item === 'number' && Number.isFinite(item) : key === 'action' && typeof item === 'string')) as Record<string, number | string> : undefined;
  const selection = parseNativeEvidence(value.selection);
  const evidenceLists = Object.fromEntries((['selectionParts', 'evidence', 'neighbors', 'citations'] as const).flatMap(key =>
    Array.isArray(value[key]) ? [[key, value[key].flatMap(item => { const parsed = parseNativeEvidence(item); return parsed ? [parsed] : []; })]] : []));
  const sourceLists = Object.fromEntries((['retrievalQueries', 'searchedChapters', 'omittedChapters'] as const).flatMap(key =>
    Array.isArray(value[key]) ? [[key, value[key].filter((item): item is string => typeof item === 'string')]] : []));
  const trace = isRecord(value.retrievalTrace) ? value.retrievalTrace : undefined;
  const retrievalTrace = trace ? Object.fromEntries((['keyword', 'semantic', 'anchors', 'expanded'] as const).flatMap(key => {
    const items = trace[key];
    return Array.isArray(items) && items.every(validModelSteps) ? [[key, [...items]]] : [];
  })) : undefined;
  const history = Array.isArray(value.history) ? value.history.flatMap(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.question !== 'string' || typeof item.answer !== 'string') return [];
    return [{ id: item.id, question: item.question, answer: item.answer, ...nativeTextFields(item, ['state']) }];
  }) : undefined;
  return {
    version: 1, questionId: value.questionId, conversationId: value.conversationId, bookId: value.bookId, sourceState: value.sourceState,
    ...nativeTextFields(value, ['notice', 'failure', 'retrievalNotice']),
    ...nativeTextFields(value, ['conversationTitle', 'bookIdentity', 'originJSON', 'serviceName', 'model', 'format']),
    ...(typeof value.freeQuestion === 'boolean' ? { freeQuestion: value.freeQuestion } : {}),
    ...(typeof value.updated === 'number' && Number.isFinite(value.updated) ? { updated: value.updated } : {}),
    ...sourceLists, ...(retrievalTrace ? { retrievalTrace } : {}), ...(history ? { history } : {}),
    ...(validModelSteps(value.turnIndex) ? { turnIndex: value.turnIndex } : {}),
    ...(typeof value.reasoningExpanded === 'boolean' ? { reasoningExpanded: value.reasoningExpanded } : {}),
    ...(selection ? { selection } : {}), ...evidenceLists,
    ...(agent ? { agent: {
      ...nativeTextFields(agent, ['summary', 'reasoning']), ...(steps ? { steps } : {}),
      ...(typeof agent.reasoningDuration === 'number' && Number.isFinite(agent.reasoningDuration) ? { reasoningDuration: agent.reasoningDuration } : {}),
      ...(typeof agent.reasoningExpanded === 'boolean' ? { reasoningExpanded: agent.reasoningExpanded } : {}),
      ...(context ? { context } : {}), ...(validModelSteps(agent.stepsUsed) ? { stepsUsed: agent.stepsUsed } : {}),
      ...(Array.isArray(agent.warnings) ? { warnings: agent.warnings.filter((item): item is string => typeof item === 'string') } : {}),
    } } : {}),
  };
}

function parseTurnDetails(raw: string | undefined): ConversationTurnDetails {
  if (!raw) return { status: 'done' };
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return { status: 'done' };
    const status =
      value.status === 'error' || value.status === 'cancelled' || value.status === 'interrupted'
        ? value.status
        : value.status === 'streaming'
          ? 'interrupted'
          : 'done';
    // Streaming persisted before a crash is an interrupted run, never a spinning completed answer.
    const legacyNative = parseLegacyNative(value.legacyNative);
    const tools: NonNullable<ConversationTurnDetails['tools']> = Array.isArray(value.tools)
      ? value.tools.flatMap((tool) => {
          if (!isRecord(tool) || typeof tool.callId !== 'string' || typeof tool.name !== 'string') return [];
          const state = tool.status === 'error' ? 'error' : tool.status === 'running' ? 'running' : 'done';
          return [
            {
              callId: tool.callId,
              name: tool.name,
              status: state,
              ...(typeof tool.detail === 'string' ? { detail: tool.detail } : {}),
              ...(typeof tool.title === 'string' ? { title: tool.title } : {}),
              ...(typeof tool.preview === 'string' ? { preview: tool.preview } : {}),
              ...(validDurationMs(tool.durationMs) ? { durationMs: tool.durationMs } : {}),
              ...(typeof tool.finished === 'boolean' ? { finished: tool.finished } : {}),
            },
          ];
        })
      : (legacyNative?.agent?.steps ?? []).map(step => ({
          callId: step.id, name: step.tool, title: step.title, detail: step.detail, preview: step.preview,
          status: step.isError ? 'error' as const : step.finished ? 'done' as const : 'running' as const,
          durationMs: Math.round(step.duration * 1000), finished: step.finished,
        }));
    const usage =
      isRecord(value.contextUsage) &&
      typeof value.contextUsage.inputTokens === 'number' &&
      typeof value.contextUsage.outputTokens === 'number'
        ? {
            inputTokens: value.contextUsage.inputTokens,
            outputTokens: value.contextUsage.outputTokens,
            ...(typeof value.contextUsage.contextWindowTokens === 'number'
              ? { contextWindowTokens: value.contextUsage.contextWindowTokens }
              : {}),
          }
        : undefined;
    const estimate = parseContextEstimate(value.contextEstimate);
    const materials = parseSentMaterials(value.sentMaterials);
    const webSources = parseWebSources(value.webSources);
    const webSearchStatus = parseWebSearchPresentation(value.webSearchStatus);
    return {
      status,
      tools,
      ...(typeof value.toolSummary === 'string' ? { toolSummary: value.toolSummary }
        : !Array.isArray(value.tools) && legacyNative?.agent?.summary !== undefined ? { toolSummary: legacyNative.agent.summary } : {}),
      ...(legacyNative ? { legacyNative } : {}),
      ...(typeof value.reasoning === 'string' ? { reasoning: value.reasoning } : {}),
      ...(typeof value.bookTitle === 'string' ? { bookTitle: value.bookTitle } : {}),
      ...(estimate ? { contextEstimate: estimate } : {}),
      ...(materials ? { sentMaterials: materials } : {}),
      ...(webSources.length ? { webSources } : {}),
      ...(webSearchStatus ? { webSearchStatus: webSearchStatus.status === 'searching'
        ? status === 'done' && webSources.length > 0
          ? { status: 'complete' as const }
          : { status: 'failed' as const, message: '上次联网搜索未完成，可重试。' }
        : webSearchStatus } : {}),
      ...(Array.isArray(value.warnings)
        ? { warnings: value.warnings.filter((warning): warning is string => typeof warning === 'string') }
        : {}),
      ...(typeof value.contextSummary === 'string' ? { contextSummary: value.contextSummary } : {}),
      ...(typeof value.agentQuestion === 'string' ? { agentQuestion: value.agentQuestion } : {}),
      ...(typeof value.selectionQuote === 'string' ? { selectionQuote: value.selectionQuote } : {}),
      ...(typeof value.selectionContextQuote === 'string' ? { selectionContextQuote: value.selectionContextQuote } : {}),
      ...(typeof value.selectionAttached === 'boolean' ? { selectionAttached: value.selectionAttached } : {}),
      ...(value.questionOrigin !== undefined ? { questionOrigin: parseQuestionOrigin(value.questionOrigin) ?? null } : {}),
      ...(typeof value.error === 'string' ? { error: value.error } : {}),
      ...(validDurationMs(value.reasoningDurationMs)
        ? { reasoningDurationMs: value.reasoningDurationMs }
        : {}),
      ...(validModelSteps(value.modelSteps) ? { modelSteps: value.modelSteps } : {}),
      ...(usage ? { contextUsage: usage } : {}),
    };
  } catch {
    return { status: 'done' };
  }
}

export async function loadBookConversation(conversationId: string): Promise<StoredConversationTurn[]> {
  const layer = await getDataLayer();
  const [messages, citations, details] = await Promise.all([
    layer.store.listMessages(conversationId),
    layer.store.listCitations(conversationId),
    layer.driver.all<{ message_id: string; details_json: string }>(
      'SELECT d.message_id,d.details_json FROM conversation_turn_details d JOIN messages m ON m.id=d.message_id WHERE m.conversation_id=?',
      [conversationId],
    ),
  ]);
  const detailById = new Map(details.map((row) => [row.message_id, row.details_json]));
  const firstLegacyUser = messages.some(message => message.id.startsWith('legacy-q:'))
    ? legacyConversationMetadata().get(conversationId)?.firstQuestionId : undefined;
  const firstLegacyAssistant = firstLegacyUser ? firstLegacyUser.slice(0, -4) + 'assistant' : undefined;
  return messages.flatMap((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') return [];
    const turnDetails = parseTurnDetails(detailById.get(message.id));
    return [
      {
        id: message.id,
        role: message.role,
        text: message.role === 'assistant' ? cleanLegacyAssistantContent(message.content) : message.content,
        reasoning: message.reasoningContent ?? turnDetails.reasoning ?? '',
        details: turnDetails,
        ...(message.id === firstLegacyAssistant ? { isFirstLegacyTurn: true } : {}),
        citations: citations
          .filter((citation) => citation.messageId === message.id)
          .map((citation) => ({
            id: citation.evidenceId,
            quote: citation.quote,
            locator: citation.locatorJson,
            ...(citation.chapter ? { chapter: citation.chapter } : {}),
            ...(citation.page !== null ? { page: citation.page } : {}),
          })),
      },
    ];
  });
}

export async function renameBookConversation(conversationId: string, title: string): Promise<void> {
  if (activeRuns.has(conversationId)) throw new Error('正在生成，请先取消生成后再改名');
  const trimmed = title.trim();
  if (!trimmed) throw new Error('对话名称不能为空');
  const layer = await getDataLayer();
  const [existing] = await layer.driver.all<{ book_id: string | null; updated_at: number; has_legacy: number }>(
    `SELECT c.book_id, MAX(MAX(COALESCE(c.updated_at,0),m.created_at)) AS updated_at,
       MAX(CASE WHEN m.id GLOB 'legacy-q:*' THEN 1 ELSE 0 END) AS has_legacy
     FROM messages m LEFT JOIN conversations c ON c.id=m.conversation_id
     WHERE m.conversation_id=? AND m.role IN ('user','assistant') GROUP BY m.conversation_id`,
    [conversationId],
  );
  if (!existing) throw new Error('对话不存在或已删除');
  const bookId = existing.book_id || (conversationId.startsWith(CONVERSATION_PREFIX) ? conversationId.slice(CONVERSATION_PREFIX.length) : '')
    || await inferLegacyConversationBookId(layer, conversationId, existing.has_legacy ? legacyQuestionBookIds().get(conversationId) : undefined) || '';
  await layer.driver.run(
    'INSERT INTO conversations (id,book_id,title,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,updated_at=excluded.updated_at',
    [conversationId, bookId, trimmed, existing.updated_at, Date.now()],
  );
}

export async function deleteBookConversation(conversationId: string): Promise<void> {
  const layer = await getDataLayer();
  deletedConversations.add(conversationId);
  activeRuns.get(conversationId)?.();
  try {
    await layer.store.deleteConversation(conversationId);
  } catch (error) {
    deletedConversations.delete(conversationId);
    throw error;
  }
}

/**
 * 旧迁移会话只有 UUID，没有 bookId；用 citations 的 quote/chapter/page/href
 * 匹配 anchors → books，给会话补上所属书。匹配不到时返回 null（UI 归入「书内问答」）。
 */
let legacyQuestionBookCache: Map<string, string> | null = null;

type LegacyConversationMetadata = {
  bookTitle?: string; title?: string; firstIndex: number; latestIndex: number;
  firstQuestionId: string; latestTurnId: string; draftMessageIds: Set<string>;
};
function legacyConversationMetadata(): Map<string, LegacyConversationMetadata> {
  const result = new Map<string, LegacyConversationMetadata>();
  const records = parseLegacyJSON('reading-questions.json');
  if (!Array.isArray(records)) return result;
  for (const record of records) {
    if (!isRecord(record) || typeof record.id !== 'string') continue;
    const id = typeof record.conversationID === 'string' ? record.conversationID : record.id;
    const index = typeof record.turnIndex === 'number' ? record.turnIndex : 0;
    const previous = result.get(id);
    const metadata = previous ?? { firstIndex: index, latestIndex: index, firstQuestionId: 'legacy-q:' + record.id + ':user', latestTurnId: record.id, draftMessageIds: new Set<string>() };
    if (!previous || index < metadata.firstIndex) {
      metadata.firstIndex = index;
      metadata.firstQuestionId = 'legacy-q:' + record.id + ':user';
      if (typeof record.bookTitle === 'string') metadata.bookTitle = record.bookTitle;
      if (typeof record.conversationTitle === 'string') metadata.title = record.conversationTitle;
    }
    if (index > metadata.latestIndex) { metadata.latestIndex = index; metadata.latestTurnId = record.id; }
    if (record.state === 'draft') metadata.draftMessageIds.add('legacy-q:' + record.id + ':user');
    result.set(id, metadata);
  }
  return result;
}

/** 旧 reading-questions.json 的直接 bookID 优先于引用位置的推断。 */
function legacyQuestionBookIds(): Map<string, string> {
  if (legacyQuestionBookCache) return legacyQuestionBookCache;
  const map = new Map<string, string>();
  const questions = parseLegacyJSON('reading-questions.json');
  if (Array.isArray(questions)) {
    for (const item of questions) {
      if (!isRecord(item)) continue;
      const id = typeof item.id === 'string' ? item.id : null;
      const bookID = typeof item.bookID === 'string' ? item.bookID : null;
      if (id && bookID) map.set(id, bookID);
      if (typeof item.conversationID === 'string' && bookID) map.set(item.conversationID, bookID);
      const followUps = Array.isArray(item.followUps) ? item.followUps : [];
      for (const follow of followUps) {
        if (isRecord(follow) && typeof follow.id === 'string' && bookID) map.set(follow.id, bookID);
      }
    }
  }
  legacyQuestionBookCache = map;
  return map;
}

async function inferLegacyConversationBookId(
  layer: ShudengDataLayer,
  conversationId: string,
  knownBookId?: string,
): Promise<string | null> {
  if (knownBookId) return knownBookId;
  const citations = await layer.driver.all<Record<string, SQLiteValue>>(
    'SELECT quote, locator_json, chapter, page FROM citations WHERE conversation_id = ? LIMIT 12',
    [conversationId],
  );
  let matchingBooks: Set<string> | undefined;
  let hasIdentityEvidence = false;
  // Page numbers, chapter names and even quoted text can occur in several
  // books. Each matching clue narrows the same candidate set; conflicting or
  // still-ambiguous clues must never silently choose the first SQLite row.
  const narrow = (bookIds: readonly string[]): void => {
    const matches = new Set(bookIds);
    if (matches.size === 0) return;
    matchingBooks = matchingBooks === undefined ? matches
      : new Set([...matchingBooks].filter(id => matches.has(id)));
  };
  for (const citation of citations) {
    const quote =
      typeof citation.quote === 'string' && citation.quote.trim().length > 0 ? citation.quote.trim() : null;
    const chapter =
      typeof citation.chapter === 'string' && citation.chapter.trim().length > 0
        ? citation.chapter.trim()
        : null;
    const page = typeof citation.page === 'number' ? citation.page : null;
    let kind: string | null = null;
    if (typeof citation.locator_json === 'string') {
      try {
        const parsed: unknown = JSON.parse(citation.locator_json);
        if (isRecord(parsed) && typeof parsed.kind === 'string') kind = parsed.kind;
      } catch {
        // 旧 locator 不是 JSON 时忽略。
      }
    }
    const href = citationHref(typeof citation.locator_json === 'string' ? citation.locator_json : null);
    const candidates = (await layer.driver.all<{ book_id: string; format: string; quote: string; chapter: string | null; page: number | null; locator_json: string }>(
      `SELECT DISTINCT a.book_id AS book_id, b.format AS format, a.quote, a.chapter, a.page, a.locator_json
       FROM anchors a JOIN books b ON b.id = a.book_id
       WHERE (? IS NOT NULL AND a.quote = ?)
          OR (? IS NOT NULL AND a.chapter = ?)
          OR (? IS NOT NULL AND a.page = ?)
          OR (? IS NOT NULL AND a.locator_json LIKE ?)`,
      [quote, quote, chapter, chapter, page, page, href, href ? `%${href}%` : null],
    )).filter(candidate => kind === null || candidate.format === (kind === 'pdf' ? 'pdf' : 'epub'));
    if (quote) {
      const matches = candidates.filter(candidate => candidate.quote === quote).map(candidate => candidate.book_id);
      if (matches.length > 0) hasIdentityEvidence = true;
      narrow(matches);
    }
    if (chapter) narrow(candidates.filter(candidate => candidate.chapter === chapter).map(candidate => candidate.book_id));
    if (page !== null) narrow(candidates.filter(candidate => candidate.page === page).map(candidate => candidate.book_id));
    if (href) {
      const matches = candidates.filter(candidate => citationHref(candidate.locator_json) === href).map(candidate => candidate.book_id);
      if (matches.length > 0) hasIdentityEvidence = true;
      narrow(matches);
    }
  }
  return hasIdentityEvidence && matchingBooks?.size === 1 ? [...matchingBooks][0]! : null;
}

/** Book removal only needs identities; never load full message bodies or build summaries. */
export async function listConversationIdsForBook(bookId: string): Promise<readonly string[]> {
  const layer = await getDataLayer();
  const direct = await layer.driver.all<{ id: string }>('SELECT id FROM conversations WHERE book_id=?', [bookId]);
  const ids = new Set([CONVERSATION_PREFIX + bookId, ...direct.map(row => row.id)]);
  const unresolved = await layer.driver.all<{ conversation_id: string; has_legacy: number }>(
    `SELECT m.conversation_id, MAX(CASE WHEN m.id GLOB 'legacy-q:*' THEN 1 ELSE 0 END) AS has_legacy
     FROM messages m LEFT JOIN conversations c ON c.id=m.conversation_id
     WHERE (c.book_id IS NULL OR c.book_id='') AND m.role IN ('user','assistant') GROUP BY m.conversation_id`,
  );
  let legacyBooks: Map<string, string> | undefined;
  for (const row of unresolved) {
    if (ids.has(row.conversation_id)) continue;
    if (row.conversation_id.startsWith(CONVERSATION_PREFIX)) {
      // The explicit old book:<id> relation takes precedence over citation matches.
      continue;
    }
    if (row.has_legacy) legacyBooks ??= legacyQuestionBookIds();
    const inferred = await inferLegacyConversationBookId(layer, row.conversation_id, row.has_legacy ? legacyBooks?.get(row.conversation_id) : undefined);
    if (inferred === bookId) ids.add(row.conversation_id);
  }
  return [...ids];
}

export async function loadConversationSummaries(): Promise<
  readonly (ConversationSummary & { title?: string; searchText?: string })[]
> {
  const layer = await getDataLayer();
  const rows = await layer.driver.all<Record<string, SQLiteValue>>(
    `SELECT m.conversation_id, COUNT(*) AS turns, MAX(MAX(COALESCE(c.updated_at,0),m.created_at)) AS updated_at,
       MAX(CASE WHEN m.id GLOB 'legacy-q:*' THEN 1 ELSE 0 END) AS has_legacy
     FROM messages m LEFT JOIN conversations c ON c.id=m.conversation_id
     WHERE m.role IN ('user','assistant') GROUP BY m.conversation_id ORDER BY updated_at DESC`,
  );
  const metadata = await layer.driver.all<{ id: string; book_id: string; title: string | null }>(
    'SELECT id,book_id,title FROM conversations',
  );
  const byId = new Map(metadata.map((row) => [row.id, row]));
  const legacy = rows.some(row => row.has_legacy === 1) ? legacyConversationMetadata() : new Map<string, LegacyConversationMetadata>();
  const summaries: Array<ConversationSummary & { title?: string; searchText?: string }> = [];
  for (const row of rows) {
    if (typeof row.conversation_id !== 'string') continue;
    const conversationId = row.conversation_id;
    const messages = await layer.store.listMessages(conversationId);
    const original = row.has_legacy === 1 ? legacy.get(conversationId) : undefined;
    const firstQuestion = original && messages.find(message => message.id === original.firstQuestionId);
    const question = firstQuestion?.content ?? messages.find((message) => message.role === 'user')?.content ?? '';
    const assistants = messages.filter(message => message.role === 'assistant');
    // Native turnIndex determines the latest answer. Renaming an earlier Swift
    // turn updates its timestamp; that must not turn its old answer into latest.
    const modernAnswer = [...assistants].reverse().find(message => !message.id.startsWith('legacy-q:'));
    const hasLatestLegacyTurn = original && messages.some(message => message.id === 'legacy-q:' + original.latestTurnId + ':user' || message.id === 'legacy-q:' + original.latestTurnId + ':assistant');
    const rawAnswer = modernAnswer?.content ?? (hasLatestLegacyTurn
      ? assistants.find(message => message.id === 'legacy-q:' + original!.latestTurnId + ':assistant')?.content ?? ''
      : assistants[assistants.length - 1]?.content ?? '');
    const answer = cleanLegacyAssistantContent(rawAnswer);
    const bookTitle = (await firstBookTitle(layer, conversationId)) ?? original?.bookTitle;
    const title = byId.get(conversationId)?.title ?? original?.title;
    let bookId =
      byId.get(conversationId)?.book_id ??
      (conversationId.startsWith(CONVERSATION_PREFIX)
        ? conversationId.slice(CONVERSATION_PREFIX.length)
        : '');
    if (!bookId) {
      bookId = (await inferLegacyConversationBookId(layer, conversationId, row.has_legacy === 1 ? legacyQuestionBookIds().get(conversationId) : undefined)) ?? '';
    }
    summaries.push({
      conversationId,
      bookId,
      question,
      ...(title !== undefined && title !== null ? { title } : {}),
      ...(bookTitle !== undefined ? { bookTitle } : {}),
      answer,
      searchText: messages.map((message) => cleanLegacyAssistantContent(message.content)).join(' '),
      turns: typeof row.turns === 'number' ? row.turns : messages.length,
      submittedCount: messages.filter(message => message.role === 'user' && !original?.draftMessageIds.has(message.id)).length,
      assistantIds: messages.filter(message => message.role === 'assistant').map(message => message.id),
      updatedAt: typeof row.updated_at === 'number' ? row.updated_at : 0,
    });
  }
  return summaries;
}
