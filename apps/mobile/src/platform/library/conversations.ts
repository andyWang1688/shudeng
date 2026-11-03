/**
 * 书内对话摘要：读取 messages/citations，清洗旧 Agent 的 JSON 包裹回答；
 * 旧迁移会话只有 UUID（无 bookId）时用 citations 的 quote/chapter/page/href 反查所属书。
 */
import type { SQLiteValue } from '@shudeng/core/db';
import type { ShudengDataLayer } from '../db';
import { getDataLayer } from '../db';
import { citationHref, cleanLegacyAssistantContent, isRecord } from './pure';
import { parseLegacyJSON } from './legacyMigration';
import type { ConversationSummary } from './types';

export { cleanLegacyAssistantContent } from './pure';

const CONVERSATION_PREFIX = 'book:';

export async function appendBookChatTurn(input: {
  readonly bookId: string;
  readonly question: string;
  readonly answer: string;
  readonly citations?: ReadonlyArray<{ readonly id: string; readonly quote: string; readonly locator: string; readonly chapter?: string; readonly page?: number }>;
}): Promise<void> {
  const layer = await getDataLayer();
  const conversationId = `${CONVERSATION_PREFIX}${input.bookId}`;
  await layer.store.appendMessage({ conversationId, role: 'user', content: input.question });
  const assistant = await layer.store.appendMessage({ conversationId, role: 'assistant', content: input.answer });
  for (const citation of input.citations ?? []) {
    await layer.store.addCitation({
      conversationId,
      messageId: assistant.id,
      evidenceId: citation.id,
      quote: citation.quote,
      locatorJson: citation.locator,
      chapter: citation.chapter ?? null,
      page: citation.page ?? null,
    });
  }
}

/**
 * 旧迁移会话只有 UUID，没有 bookId；用 citations 的 quote/chapter/page/href
 * 匹配 anchors → books，给会话补上所属书。匹配不到时返回 null（UI 归入「书内问答」）。
 */
let legacyQuestionBookCache: Map<string, string> | null = null;

/** 旧 reading-questions.json 自带 bookID；用于 citations 缺失的旧对话归书。 */
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
      const followUps = Array.isArray(item.followUps) ? item.followUps : [];
      for (const follow of followUps) {
        if (isRecord(follow) && typeof follow.id === 'string' && bookID) map.set(follow.id, bookID);
      }
    }
  }
  legacyQuestionBookCache = map;
  return map;
}

async function inferLegacyConversationBookId(layer: ShudengDataLayer, conversationId: string): Promise<string | null> {
  const citations = await layer.driver.all<Record<string, SQLiteValue>>(
    'SELECT quote, locator_json, chapter, page FROM citations WHERE conversation_id = ? LIMIT 12',
    [conversationId],
  );
  if (citations.length === 0) return legacyQuestionBookIds().get(conversationId) ?? null;
  const scores = new Map<string, number>();
  const addScore = (bookId: string, score: number): void => {
    scores.set(bookId, (scores.get(bookId) ?? 0) + score);
  };
  for (const citation of citations) {
    const quote = typeof citation.quote === 'string' && citation.quote.trim().length > 0 ? citation.quote.trim() : null;
    const chapter = typeof citation.chapter === 'string' && citation.chapter.trim().length > 0 ? citation.chapter.trim() : null;
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
    const candidates = await layer.driver.all<{ book_id: string; format: string }>(
      `SELECT DISTINCT a.book_id AS book_id, b.format AS format
       FROM anchors a JOIN books b ON b.id = a.book_id
       WHERE (? IS NOT NULL AND a.quote = ?)
          OR (? IS NOT NULL AND a.chapter = ?)
          OR (? IS NOT NULL AND a.page = ?)`,
      [quote, quote, chapter, chapter, page, page],
    );
    for (const candidate of candidates) {
      if (kind === 'pdf' && candidate.format !== 'pdf') continue;
      if (kind !== null && kind !== 'pdf' && candidate.format !== 'epub') continue;
      addScore(candidate.book_id, 3);
    }
    const href = citationHref(typeof citation.locator_json === 'string' ? citation.locator_json : null);
    if (href) {
      const byHref = await layer.driver.all<{ book_id: string; format: string }>(
        `SELECT DISTINCT a.book_id AS book_id, b.format AS format
         FROM anchors a JOIN books b ON b.id = a.book_id
         WHERE a.locator_json LIKE ?`,
        [`%${href}%`],
      );
      for (const candidate of byHref) {
        if (kind === 'pdf' && candidate.format !== 'pdf') continue;
        if (kind !== null && kind !== 'pdf' && candidate.format !== 'epub') continue;
        addScore(candidate.book_id, 2);
      }
    }
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? null;
}

export async function loadConversationSummaries(): Promise<readonly ConversationSummary[]> {
  const layer = await getDataLayer();
  const rows = await layer.driver.all<Record<string, SQLiteValue>>(
    `SELECT conversation_id, COUNT(*) AS turns, MAX(created_at) AS updated_at
     FROM messages WHERE role IN ('user','assistant')
     GROUP BY conversation_id ORDER BY updated_at DESC`,
  );
  const summaries: ConversationSummary[] = [];
  for (const row of rows) {
    if (typeof row.conversation_id !== 'string') continue;
    const conversationId = row.conversation_id;
    const messages = await layer.store.listMessages(conversationId);
    const question = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
    const rawAnswer = [...messages].reverse().find((message) => message.role === 'assistant')?.content ?? '';
    const answer = cleanLegacyAssistantContent(rawAnswer);
    let bookId = conversationId.startsWith(CONVERSATION_PREFIX) ? conversationId.slice(CONVERSATION_PREFIX.length) : '';
    if (!bookId) {
      bookId = (await inferLegacyConversationBookId(layer, conversationId)) ?? '';
    }
    summaries.push({
      conversationId,
      bookId,
      question,
      answer,
      turns: typeof row.turns === 'number' ? row.turns : messages.length,
      updatedAt: typeof row.updated_at === 'number' ? row.updated_at : 0,
    });
  }
  return summaries;
}
