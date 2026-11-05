/**
 * 最小 store：用共享 Drizzle schema 做增删改查，不直接拼 SQL（迁移/建表除外）。
 * 数据库对象由注入驱动创建（createDatabase）；本文件不 import 任何平台驱动。
 */
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { ShudengDatabase } from './drizzle.js';
import {
  anchors,
  annotations,
  books,
  checkpoints,
  conversations,
  conversationTurnDetails,
  lgCheckpoints,
  lgWrites,
  citations,
  messages,
  type AnchorRow,
  type AnnotationRow,
  type BookRow,
  type CitationRow,
  type MessageRow,
} from './schema.js';

let idSequence = 0;

/** 平台无关的本地 id（不依赖 crypto.randomUUID；调用方可传自己的 id）。 */
export function createLocalId(prefix: string): string {
  idSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSequence.toString(36)}`;
}

export interface SaveBookInput {
  id: string;
  title: string;
  author?: string | null;
  format: 'epub' | 'pdf';
  sourceHash: string;
}

export interface SaveAnchorInput {
  id?: string;
  bookId: string;
  engine: string;
  locatorJson: string;
  quote: string;
  chapter?: string | null;
  page?: number | null;
  anchorVersion?: number;
}

export interface SaveAnnotationInput {
  id?: string;
  bookId: string;
  anchorId: string;
  kind: 'highlight' | 'note' | 'bookmark';
  color?: string | null;
  body?: string | null;
}

export interface AppendMessageInput {
  id?: string;
  conversationId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  reasoningContent?: string | null;
  toolCallsJson?: string | null;
  toolCallId?: string | null;
  isError?: boolean;
}

export interface AddCitationInput {
  id?: string;
  conversationId: string;
  messageId?: string | null;
  evidenceId: string;
  quote: string;
  locatorJson: string;
  chapter?: string | null;
  page?: number | null;
}

export interface StoredCheckpoint {
  conversationId: string;
  state: unknown;
  step: number;
  summary: unknown;
  updatedAt: number;
}

// New and restored books append to the catalog, including imports in the same millisecond.
// Keep epoch milliseconds monotonic without changing migrated books that share a timestamp.
function nextBookImportTime(now: number) {
  return sql<number>`max(${now}, coalesce((select max(${books.importedAt}) from ${books}), ${now} - 1) + 1)`;
}

export class ShudengStore {
  constructor(private readonly db: ShudengDatabase) {}

  // ---------- books ----------

  async saveBook(input: SaveBookInput): Promise<void> {
    const now = Date.now();
    await this.db
      .insert(books)
      .values({
        id: input.id,
        title: input.title,
        author: input.author ?? null,
        format: input.format,
        sourceHash: input.sourceHash,
        importedAt: nextBookImportTime(now),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: books.id,
        set: {
          title: input.title,
          author: input.author ?? null,
          format: input.format,
          sourceHash: input.sourceHash,
          updatedAt: now,
        },
      });
  }

  /** Only a removed book changes catalog position; replaying recovery is a no-op. */
  async restoreRemovedBook(id: string): Promise<void> {
    const now = Date.now();
    await this.db
      .update(books)
      .set({ importedAt: nextBookImportTime(now), removedAt: null, updatedAt: now })
      .where(and(eq(books.id, id), isNotNull(books.removedAt)));
  }

  async getBook(id: string): Promise<BookRow | null> {
    const rows = await this.db.select().from(books).where(eq(books.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async listBooks(): Promise<BookRow[]> {
    // Native migration preserves catalog insertion order when import timestamps tie.
    return this.db.select().from(books).orderBy(books.importedAt, sql`${books}.rowid`);
  }

  // ---------- anchors ----------

  async saveAnchor(input: SaveAnchorInput): Promise<AnchorRow> {
    const row = {
      id: input.id ?? createLocalId('anchor'),
      bookId: input.bookId,
      engine: input.engine,
      locatorJson: input.locatorJson,
      anchorVersion: input.anchorVersion ?? 1,
      quote: input.quote,
      chapter: input.chapter ?? null,
      page: input.page ?? null,
      createdAt: Date.now(),
    };
    await this.db
      .insert(anchors)
      .values(row)
      .onConflictDoUpdate({
        target: anchors.id,
        set: {
          engine: row.engine,
          locatorJson: row.locatorJson,
          anchorVersion: row.anchorVersion,
          quote: row.quote,
          chapter: row.chapter,
          page: row.page,
        },
      });
    return row;
  }

  async listAnchors(bookId: string): Promise<AnchorRow[]> {
    return this.db.select().from(anchors).where(eq(anchors.bookId, bookId)).orderBy(anchors.createdAt);
  }

  // ---------- annotations ----------

  async saveAnnotation(input: SaveAnnotationInput): Promise<AnnotationRow> {
    const now = Date.now();
    const row = {
      id: input.id ?? createLocalId('annotation'),
      bookId: input.bookId,
      anchorId: input.anchorId,
      kind: input.kind,
      color: input.color ?? null,
      body: input.body ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await this.db
      .insert(annotations)
      .values(row)
      .onConflictDoUpdate({
        target: annotations.id,
        set: {
          color: row.color,
          body: row.body,
          kind: row.kind,
          updatedAt: now,
        },
      });
    return row;
  }

  async listAnnotations(bookId: string): Promise<AnnotationRow[]> {
    return this.db
      .select()
      .from(annotations)
      .where(eq(annotations.bookId, bookId))
      .orderBy(annotations.createdAt);
  }

  async deleteAnnotation(id: string): Promise<void> {
    await this.db.delete(annotations).where(eq(annotations.id, id));
  }

  // ---------- messages ----------

  async appendMessage(input: AppendMessageInput): Promise<MessageRow> {
    const row = {
      id: input.id ?? createLocalId('message'),
      conversationId: input.conversationId,
      role: input.role,
      content: input.content ?? '',
      reasoningContent: input.reasoningContent ?? null,
      toolCallsJson: input.toolCallsJson ?? null,
      toolCallId: input.toolCallId ?? null,
      isError: input.isError ?? false,
      createdAt: Date.now(),
    };
    await this.db.insert(messages).values(row);
    return row;
  }

  async listMessages(conversationId: string): Promise<MessageRow[]> {
    return this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);
  }

  // ---------- citations ----------

  async addCitation(input: AddCitationInput): Promise<CitationRow> {
    const row = {
      id: input.id ?? createLocalId('citation'),
      conversationId: input.conversationId,
      messageId: input.messageId ?? null,
      evidenceId: input.evidenceId,
      quote: input.quote,
      locatorJson: input.locatorJson,
      chapter: input.chapter ?? null,
      page: input.page ?? null,
      createdAt: Date.now(),
    };
    await this.db.insert(citations).values(row);
    return row;
  }

  async listCitations(conversationId: string): Promise<CitationRow[]> {
    return this.db
      .select()
      .from(citations)
      .where(eq(citations.conversationId, conversationId))
      .orderBy(citations.createdAt);
  }

  // ---------- checkpoints ----------

  async saveCheckpoint(conversationId: string, state: unknown, step = 0, summary?: unknown): Promise<void> {
    const now = Date.now();
    const summaryJson = summary === undefined ? null : JSON.stringify(summary);
    await this.db
      .insert(checkpoints)
      .values({
        conversationId,
        stateJson: JSON.stringify(state),
        step,
        summaryJson,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: checkpoints.conversationId,
        set: { stateJson: JSON.stringify(state), step, summaryJson, updatedAt: now },
      });
  }

  async loadCheckpoint(conversationId: string): Promise<StoredCheckpoint | null> {
    const rows = await this.db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.conversationId, conversationId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      conversationId: row.conversationId,
      state: JSON.parse(row.stateJson) as unknown,
      step: row.step,
      summary: row.summaryJson ? (JSON.parse(row.summaryJson) as unknown) : null,
      updatedAt: row.updatedAt,
    };
  }

  /** 删除对话（messages / citations / checkpoints；不删书与标注）。 */
  async deleteConversation(conversationId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.conversationId, conversationId));
      if (rows.length > 0)
        await tx.delete(conversationTurnDetails).where(
          inArray(
            conversationTurnDetails.messageId,
            rows.map((row) => row.id),
          ),
        );
      await tx.delete(citations).where(eq(citations.conversationId, conversationId));
      await tx.delete(messages).where(eq(messages.conversationId, conversationId));
      await tx.delete(checkpoints).where(eq(checkpoints.conversationId, conversationId));
      await tx.delete(lgWrites).where(eq(lgWrites.threadId, conversationId));
      await tx.delete(lgCheckpoints).where(eq(lgCheckpoints.threadId, conversationId));
      await tx.delete(conversations).where(eq(conversations.id, conversationId));
    });
  }

  /** 删除书（FK 级联 anchors/annotations；消息/引用按书隔离由调用方保证）。 */
  async deleteBook(bookId: string): Promise<void> {
    await this.db.delete(books).where(and(eq(books.id, bookId)));
  }
}
