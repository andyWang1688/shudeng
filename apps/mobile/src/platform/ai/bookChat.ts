/** 书内 AI 问答：SecureStore aiConfig → 真实模型 → 旧索引 BookSource → LangChain Agent。 */
import {
  createChatModel,
  runBookAgent,
  type AgentRunSession,
  type BookIdentity,
} from '@shudeng/core';
import type { BookRow } from '@shudeng/core/db';
import { loadAIConfig, type AIConfig } from '../aiConfig';
import { getDataLayer } from '../db';
import { createLegacyBookSource, getLegacyIndexStatus } from './legacyIndex';

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
  readonly index: { available: boolean; semantic: boolean; detail: string };
}

export async function getBookChatAvailability(bookId: string): Promise<BookChatAvailability> {
  const layer = await getDataLayer();
  const [book, config, index] = await Promise.all([
    layer.store.getBook(bookId),
    loadAIConfig(),
    getLegacyIndexStatus(bookId),
  ]);
  return { config, book, index };
}

export interface StartBookChatTurnOptions {
  readonly bookId: string;
  readonly question: string;
  readonly history?: ReadonlyArray<{ question: string; answer: string }>;
}

export interface BookChatTurn {
  readonly session: AgentRunSession;
  readonly book: BookRow;
  readonly config: AIConfig;
}

export async function startBookChatTurn(options: StartBookChatTurnOptions): Promise<BookChatTurn> {
  const config = await loadAIConfig();
  if (!config) throw new BookChatConfigError('请先在「我的 → AI 服务」配置模型 API Key');
  const layer = await getDataLayer();
  const book = await layer.store.getBook(options.bookId);
  if (!book) throw new BookChatIndexError('找不到这本书');
  const identity: BookIdentity = {
    id: book.id,
    title: book.title,
    format: book.format,
    sourceHash: book.sourceHash,
  };
  const source = await createLegacyBookSource(identity);
  const model = createChatModel({
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    thinking: config.provider === 'deepseek',
    reasoningEffort: 'high',
    maxTokens: 4096,
  });
  const session = runBookAgent({
    model,
    source,
    book: identity,
    question: options.question,
    ...(options.history && options.history.length > 0 ? { history: options.history } : {}),
  });
  return { session, book, config };
}
