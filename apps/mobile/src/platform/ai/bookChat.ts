/** Product chat: SecureStore config and the current book's local source, with read-only Swift compatibility. */
import {
  createChatModel,
  inspectModelContext,
  resolveModelContextBudget,
  runBookAgent,
  type AgentRunSession,
  type BookChatHistoryTurn,
  type BookSource,
} from '@shudeng/core/agent';
import type { BookIdentity } from '@shudeng/core/domain';
import type { BookRow } from '@shudeng/core/db';
import { assertNotAborted } from '@shudeng/core';
import { loadAIConfig, type AIConfig } from '../aiConfig';
import { fetch as expoFetch } from 'expo/fetch';
import { getDataLayer } from '../db';
import { findBookFile } from '../bookFiles';
import { loadAssistantPreferences } from '../assistantPreferences';
import { loadMCPAgentTools } from '../mcp';
import { createLegacyBookSource, getLegacyIndexStatus } from './legacyIndex';
import {
  createLocalBookSource,
  getLocalBookIndexStatus,
  rebuildBookIndex,
  type BookIndexStatus,
} from './bookIndex';

export class BookChatConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookChatConfigError';
  }
}

export class BookChatIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookChatIndexError';
  }
}

export interface BookChatSourceState {
  readonly book: BookRow | null;
  readonly sourceAvailable: boolean;
  readonly sourceError: string | null;
}

export interface BookChatAvailability extends BookChatSourceState {
  readonly config: AIConfig | null;
  readonly configError?: string;
  readonly index: BookIndexStatus;
}

function bookSourceError(book: BookRow | null): string | null {
  if (!book) return '找不到这本书';
  if (book.removedAt !== null) return '原书已移除，重新导入后可继续问答';
  if (!findBookFile(book)) return '书籍文件缺失，重新导入后可继续问答';
  return null;
}

async function indexStatus(book: BookRow, signal?: AbortSignal): Promise<BookIndexStatus> {
  try {
    const local = await getLocalBookIndexStatus(book.id);
    assertNotAborted(signal);
    if (local.available || local.state === 'empty') return local;
    const legacy = await getLegacyIndexStatus(book.id);
    assertNotAborted(signal);
    if (legacy.available) return legacy;
    return await rebuildBookIndex(book.id);
  } catch (error) {
    assertNotAborted(signal);
    return {
      available: false,
      semantic: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Enough information to show history and locate its citations without preparing the search index. */
export async function getBookChatSource(bookId: string): Promise<BookChatSourceState> {
  const layer = await getDataLayer();
  const book = await layer.store.getBook(bookId);
  const sourceError = bookSourceError(book);
  return { book, sourceAvailable: sourceError === null, sourceError };
}

export async function getBookChatAvailability(bookId: string): Promise<BookChatAvailability> {
  // Configuration gates new requests, never access to locally saved conversations.
  const [source, configuration] = await Promise.all([getBookChatSource(bookId), loadAIConfig().then(
    config => ({ config }),
    (error: unknown) => ({ config: null, configError: error instanceof Error ? error.message : String(error) }),
  )]);
  const index = source.book && source.sourceAvailable
    ? await indexStatus(source.book)
    : { available: false, semantic: false, detail: source.sourceError ?? '' };
  return { ...source, ...configuration, index };
}

export interface StartBookChatTurnOptions {
  readonly bookId: string;
  readonly question: string;
  readonly selectionQuote?: string;
  readonly history?: readonly BookChatHistoryTurn[];
  readonly historySummary?: string;
  readonly readingPosition?: string;
  readonly contextWindowTokens?: number;
  readonly signal?: AbortSignal;
}

export interface BookChatTurn {
  readonly session: AgentRunSession;
  readonly book: BookRow;
  readonly config: AIConfig;
}

export async function startBookChatTurn(options: StartBookChatTurnOptions): Promise<BookChatTurn> {
  const { signal } = options;
  assertNotAborted(signal);
  if (!signal) return prepareBookChatTurn(options);
  // Local reads and shared index preparation may outlive the request. Let
  // the caller stop waiting, and have the pipeline check before starting an agent.
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(Object.assign(new Error('回答已停止'), { name: 'AbortError' }));
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([prepareBookChatTurn(options), cancelled]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

async function prepareBookChatTurn(options: StartBookChatTurnOptions): Promise<BookChatTurn> {
  const { signal } = options;
  const config = await loadAIConfig();
  assertNotAborted(signal);
  if (!config) throw new BookChatConfigError('请先在「我的 → AI 与助手」配置模型 API Key');
  // Snapshot once: editing preferences must not alter an in-flight run.
  const preferences = await loadAssistantPreferences();
  assertNotAborted(signal);
  const layer = await getDataLayer();
  const book = await layer.store.getBook(options.bookId);
  assertNotAborted(signal);
  if (!book) throw new BookChatIndexError('找不到这本书');
  const sourceError = bookSourceError(book);
  if (sourceError) throw new BookChatIndexError(sourceError);
  const status = await indexStatus(book, signal);
  assertNotAborted(signal);
  if (!status.available) throw new BookChatIndexError(status.detail);
  const identity: BookIdentity = {
    id: book.id,
    title: book.title,
    format: book.format,
    sourceHash: book.sourceHash,
  };
  const local = await getLocalBookIndexStatus(book.id);
  assertNotAborted(signal);
  const source: BookSource = local.available
    ? await createLocalBookSource(identity)
    : await createLegacyBookSource(identity);
  assertNotAborted(signal);
  let host = '';
  try { host = new URL(config.baseUrl.trim()).hostname.toLowerCase(); } catch { /* Provider validation reports invalid addresses. */ }
  const deepSeekThinking = config.provider !== 'anthropic' && (config.provider === 'deepseek' ||
    config.model.toLowerCase().startsWith('deepseek') || host === 'api.deepseek.com');
  const modelConfig = {
    provider: deepSeekThinking ? 'deepseek' as const : config.provider,
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    fetch: expoFetch,
    thinking: deepSeekThinking,
    reasoningEffort: 'high' as const,
  };
  const configuredWindow = options.contextWindowTokens ?? config.contextWindowTokens;
  const contextInfo = inspectModelContext({
    provider: modelConfig.provider, model: config.model, baseUrl: config.baseUrl,
    ...(configuredWindow !== undefined ? { contextWindowTokens: configuredWindow } : {}),
  });
  const { contextWindowTokens, outputReserveTokens } = resolveModelContextBudget(
    contextInfo, deepSeekThinking ? 16384 : 4096,
  );
  const summaryOutput = resolveModelContextBudget(contextInfo, deepSeekThinking ? 16384 : 2000).outputReserveTokens;
  const model = createChatModel({ ...modelConfig, maxTokens: outputReserveTokens,
    webSearch: { enabled: config.webSearchEnabled ?? false, maxUses: 3 } });
  const summaryModel = createChatModel({ ...modelConfig, maxTokens: summaryOutput });
  const extraTools = await loadMCPAgentTools();
  assertNotAborted(signal);
  const session = runBookAgent({
    assistantInstructions: preferences.instructions,
    model,
    summaryModel,
    summaryIdleTimeoutMs: deepSeekThinking ? 180000 : 45000,
    modelIdleTimeoutMs: deepSeekThinking ? 180000 : 90000,
    runTimeoutMs: deepSeekThinking ? 300000 : 240000,
    outputReserveTokens,
    source,
    book: identity,
    question: options.question,
    ...(options.selectionQuote ? { selectionQuote: options.selectionQuote } : {}),
    ...(options.history && options.history.length > 0 ? { history: options.history } : {}),
    ...(options.historySummary ? { historySummary: options.historySummary } : {}),
    ...(options.readingPosition ? { readingPosition: options.readingPosition } : {}),
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    ...(extraTools.length > 0 ? { extraTools } : {}),
  });
  return { session, book, config };
}
