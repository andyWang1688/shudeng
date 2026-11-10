/** Product chat: SecureStore config and the current book's local source, with read-only Swift compatibility. */
import {
  createChatModel,
  inspectModelContext,
  resolveModelContextBudget,
  runBookAgent,
  type AgentRunSession,
  type BookSource,
} from '@shudeng/core/agent';
import type { BookIdentity } from '@shudeng/core/domain';
import type { BookRow } from '@shudeng/core/db';
import { loadAIConfig, type AIConfig } from '../aiConfig';
import { fetch as expoFetch } from 'expo/fetch';
import { getDataLayer } from '../db';
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

export interface BookChatAvailability {
  readonly config: AIConfig | null;
  readonly book: BookRow | null;
  readonly index: BookIndexStatus;
}

async function indexStatus(book: BookRow): Promise<BookIndexStatus> {
  if (book.removedAt !== null)
    return { available: false, semantic: false, detail: '原书已移除，重新导入后可继续问答' };
  const local = await getLocalBookIndexStatus(book.id);
  if (local.available || local.state === 'empty') return local;
  const legacy = await getLegacyIndexStatus(book.id);
  if (legacy.available) return legacy;
  try {
    return await rebuildBookIndex(book.id);
  } catch (error) {
    return {
      available: false,
      semantic: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getBookChatAvailability(bookId: string): Promise<BookChatAvailability> {
  const layer = await getDataLayer();
  const [book, config] = await Promise.all([layer.store.getBook(bookId), loadAIConfig()]);
  const index = book
    ? await indexStatus(book)
    : { available: false, semantic: false, detail: '找不到这本书' };
  return { config, book, index };
}

export interface StartBookChatTurnOptions {
  readonly bookId: string;
  readonly question: string;
  readonly selectionQuote?: string;
  readonly history?: ReadonlyArray<{ question: string; answer: string }>;
  readonly historySummary?: string;
  readonly readingPosition?: string;
  readonly contextWindowTokens?: number;
}

export interface BookChatTurn {
  readonly session: AgentRunSession;
  readonly book: BookRow;
  readonly config: AIConfig;
}

export async function startBookChatTurn(options: StartBookChatTurnOptions): Promise<BookChatTurn> {
  const config = await loadAIConfig();
  if (!config) throw new BookChatConfigError('请先在「我的 → AI 与助手」配置模型 API Key');
  // Snapshot once: editing preferences must not alter an in-flight run.
  const preferences = await loadAssistantPreferences();
  const layer = await getDataLayer();
  const book = await layer.store.getBook(options.bookId);
  if (!book) throw new BookChatIndexError('找不到这本书');
  const status = await indexStatus(book);
  if (!status.available) throw new BookChatIndexError(status.detail);
  const identity: BookIdentity = {
    id: book.id,
    title: book.title,
    format: book.format,
    sourceHash: book.sourceHash,
  };
  const local = await getLocalBookIndexStatus(book.id);
  const source: BookSource = local.available
    ? await createLocalBookSource(identity)
    : await createLegacyBookSource(identity);
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
