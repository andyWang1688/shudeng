/**
 * 共享 Drizzle schema（SQLite）：书、锚点、标注、消息、引用、checkpoint。
 * 纯 TypeScript：不 import RN / Node 驱动；驱动通过 SQLiteDriver 注入（见 driver.ts）。
 *
 * 约定：
 * - 时间戳统一用 Unix epoch 毫秒（integer），避免各端 Date 序列化差异。
 * - 引擎定位（Readium locator / PDF page+rect / CFI）以 JSON 字符串存 anchors.locator_json。
 * - 引用只存“已核对”的原文 quote 与定位，便于回跳原文。
 */
import { blob, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const books = sqliteTable('books', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  author: text('author'),
  format: text('format', { enum: ['epub', 'pdf'] }).notNull(),
  sourceHash: text('source_hash').notNull(),
  importedAt: integer('imported_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const anchors = sqliteTable(
  'anchors',
  {
    id: text('id').primaryKey(),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    /** 引擎名：readium / pdfkit / foliate / pdfjs… */
    engine: text('engine').notNull(),
    /** 引擎定位串（locator JSON / CFI / page + rect 序列化）。 */
    locatorJson: text('locator_json').notNull(),
    /** 版本化 anchor 协议版本，用于后续迁移。 */
    anchorVersion: integer('anchor_version').notNull().default(1),
    quote: text('quote').notNull(),
    chapter: text('chapter'),
    page: integer('page'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('anchors_book').on(table.bookId)],
);

export const annotations = sqliteTable(
  'annotations',
  {
    id: text('id').primaryKey(),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    anchorId: text('anchor_id')
      .notNull()
      .references(() => anchors.id, { onDelete: 'cascade' }),
    /** highlight / note / bookmark */
    kind: text('kind', { enum: ['highlight', 'note', 'bookmark'] }).notNull(),
    /** HighlightColor（yellow/green/blue/rose），书签可为空。 */
    color: text('color'),
    body: text('body'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('annotations_book').on(table.bookId), index('annotations_anchor').on(table.anchorId)],
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').notNull(),
    /** system / user / assistant / tool */
    role: text('role', { enum: ['system', 'user', 'assistant', 'tool'] }).notNull(),
    content: text('content').notNull().default(''),
    /** provider 原生 reasoning（DeepSeek reasoning_content 等），用于工具轮回传。 */
    reasoningContent: text('reasoning_content'),
    /** tool_calls / tool 结果的 JSON 载荷。 */
    toolCallsJson: text('tool_calls_json'),
    toolCallId: text('tool_call_id'),
    isError: integer('is_error', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('messages_conversation').on(table.conversationId, table.createdAt)],
);

export const citations = sqliteTable(
  'citations',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').notNull(),
    messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    /** 本轮证据 id（E1…）。 */
    evidenceId: text('evidence_id').notNull(),
    /** 已核对的书内连续原文。 */
    quote: text('quote').notNull(),
    locatorJson: text('locator_json').notNull(),
    chapter: text('chapter'),
    page: integer('page'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('citations_conversation').on(table.conversationId)],
);

export const checkpoints = sqliteTable(
  'checkpoints',
  {
    conversationId: text('conversation_id').primaryKey(),
    /** 应用级 Agent 运行状态（消息快照/步骤/摘要引用等）的 JSON。 */
    stateJson: text('state_json').notNull(),
    step: integer('step').notNull().default(0),
    summaryJson: text('summary_json'),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('checkpoints_updated').on(table.updatedAt)],
);

/** 迁移记录表（migrate() 维护；不对外暴露业务接口）。 */
export const schemaMigrations = sqliteTable('_migrations', {
  id: text('id').primaryKey(),
  appliedAt: integer('applied_at').notNull(),
});

/**
 * LangGraph checkpoint 表：故意使用 `lg_` 前缀，避免与应用级 `checkpoints` 表冲突。
 * 官方 @langchain/langgraph-checkpoint-sqlite 用 `checkpoints` / `writes` 两张表，
 * 由于它依赖 better-sqlite3 同步驱动，移动端不能直接用（见 checkpoint-saver.ts 注释）。
 */
export const lgCheckpoints = sqliteTable(
  'lg_checkpoints',
  {
    threadId: text('thread_id').notNull(),
    checkpointNs: text('checkpoint_ns').notNull().default(''),
    checkpointId: text('checkpoint_id').notNull(),
    parentCheckpointId: text('parent_checkpoint_id'),
    type: text('type'),
    checkpoint: blob('checkpoint'),
    metadata: blob('metadata'),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.checkpointNs, table.checkpointId] })],
);

export const lgWrites = sqliteTable(
  'lg_writes',
  {
    threadId: text('thread_id').notNull(),
    checkpointNs: text('checkpoint_ns').notNull().default(''),
    checkpointId: text('checkpoint_id').notNull(),
    taskId: text('task_id').notNull(),
    taskPath: text('task_path').notNull().default(''),
    idx: integer('idx').notNull(),
    channel: text('channel').notNull(),
    type: text('type'),
    value: blob('value'),
  },
  (table) => [
    primaryKey({
      columns: [table.threadId, table.checkpointNs, table.checkpointId, table.taskId, table.idx],
    }),
    index('lg_writes_lookup').on(table.threadId, table.checkpointNs, table.checkpointId),
  ],
);

export type BookRow = typeof books.$inferSelect;
export type NewBookRow = typeof books.$inferInsert;
export type AnchorRow = typeof anchors.$inferSelect;
export type NewAnchorRow = typeof anchors.$inferInsert;
export type AnnotationRow = typeof annotations.$inferSelect;
export type NewAnnotationRow = typeof annotations.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
export type CitationRow = typeof citations.$inferSelect;
export type NewCitationRow = typeof citations.$inferInsert;
export type CheckpointRow = typeof checkpoints.$inferSelect;
export type NewCheckpointRow = typeof checkpoints.$inferInsert;

export const schema = {
  books,
  anchors,
  annotations,
  messages,
  citations,
  checkpoints,
  schemaMigrations,
  lgCheckpoints,
  lgWrites,
} as const;
