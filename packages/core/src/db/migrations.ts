/**
 * SQLite 迁移：手写、可审计的 SQL（与 schema.ts 一一对应）。
 *
 * 为什么不用 drizzle-kit 生成：drizzle-kit 是 Node CLI/构建期依赖，本 spike 不引入额外工具链；
 * 迁移在运行时执行同一份 SQL，iOS/Node 走相同路径。后续可在 CI 里用 drizzle-kit 校验/生成。
 *
 * 迁移记录存 `_migrations` 表；migrate() 幂等，按 id 顺序执行，每个迁移一个事务。
 */
import type { SQLiteDriver } from './driver.js';

export interface Migration {
  id: string;
  /** 同一事务内顺序执行。 */
  statements: ReadonlyArray<string>;
}

const MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS _migrations (
  id TEXT PRIMARY KEY NOT NULL,
  applied_at INTEGER NOT NULL
)`;

export const MIGRATIONS: ReadonlyArray<Migration> = [
  {
    id: '0001_initial',
    statements: [
      `CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        author TEXT,
        format TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        imported_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS anchors (
        id TEXT PRIMARY KEY NOT NULL,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        engine TEXT NOT NULL,
        locator_json TEXT NOT NULL,
        anchor_version INTEGER NOT NULL DEFAULT 1,
        quote TEXT NOT NULL,
        chapter TEXT,
        page INTEGER,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS anchors_book ON anchors (book_id)`,
      `CREATE TABLE IF NOT EXISTS annotations (
        id TEXT PRIMARY KEY NOT NULL,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        anchor_id TEXT NOT NULL REFERENCES anchors(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        color TEXT,
        body TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS annotations_book ON annotations (book_id)`,
      `CREATE INDEX IF NOT EXISTS annotations_anchor ON annotations (anchor_id)`,
      `CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY NOT NULL,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        reasoning_content TEXT,
        tool_calls_json TEXT,
        tool_call_id TEXT,
        is_error INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS messages_conversation ON messages (conversation_id, created_at)`,
      `CREATE TABLE IF NOT EXISTS citations (
        id TEXT PRIMARY KEY NOT NULL,
        conversation_id TEXT NOT NULL,
        message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
        evidence_id TEXT NOT NULL,
        quote TEXT NOT NULL,
        locator_json TEXT NOT NULL,
        chapter TEXT,
        page INTEGER,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS citations_conversation ON citations (conversation_id)`,
      `CREATE TABLE IF NOT EXISTS checkpoints (
        conversation_id TEXT PRIMARY KEY NOT NULL,
        state_json TEXT NOT NULL,
        step INTEGER NOT NULL DEFAULT 0,
        summary_json TEXT,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS checkpoints_updated ON checkpoints (updated_at)`,
      // LangGraph checkpoint（异步 saver 使用；刻意用 lg_ 前缀避免与应用级 checkpoints 冲突）。
      `CREATE TABLE IF NOT EXISTS lg_checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        type TEXT,
        checkpoint BLOB,
        metadata BLOB,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
      )`,
      `CREATE TABLE IF NOT EXISTS lg_writes (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        task_path TEXT NOT NULL DEFAULT '',
        idx INTEGER NOT NULL,
        channel TEXT NOT NULL,
        type TEXT,
        value BLOB,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
      )`,
      `CREATE INDEX IF NOT EXISTS lg_writes_lookup ON lg_writes (thread_id, checkpoint_ns, checkpoint_id)`,
    ],
  },
  {
    id: '0002_rag',
    statements: [
      // 切块：保留书内原文位置与 locator（章节/页码/字符 offset）。
      `CREATE TABLE IF NOT EXISTS rag_chunks (
        id TEXT PRIMARY KEY NOT NULL,
        book_id TEXT NOT NULL,
        chapter_ordinal INTEGER NOT NULL,
        chapter_title TEXT NOT NULL,
        page INTEGER,
        start_offset INTEGER NOT NULL,
        end_offset INTEGER NOT NULL,
        text TEXT NOT NULL,
        locator_json TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS rag_chunks_book ON rag_chunks (book_id, chapter_ordinal)`,
      // FTS5 全文索引。中文不靠分词器：写入/查询前由 rag/text.ts 转成字符/词 token 序列
      // （unicode61 会把连续中文当单 token，无法用子串检索）。
      `CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_fts USING fts5(
        chunk_id UNINDEXED,
        book_id UNINDEXED,
        fts_text,
        tokenize='unicode61'
      )`,
      // 向量：BLOB 存 Float32 小端数组；余弦相似度在 JS 里算（expo/Node 都可用，不依赖 SQLite 扩展）。
      `CREATE TABLE IF NOT EXISTS rag_chunk_vectors (
        chunk_id TEXT PRIMARY KEY NOT NULL,
        model TEXT NOT NULL,
        dim INTEGER NOT NULL,
        vector BLOB NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS rag_chunk_vectors_model ON rag_chunk_vectors (model, dim)`,
    ],
  },
];

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

/** 应用所有未执行迁移（幂等）。 */
export async function migrate(driver: SQLiteDriver): Promise<MigrateResult> {
  await driver.exec(MIGRATIONS_TABLE);
  const rows = await driver.all<{ id: string }>('SELECT id FROM _migrations');
  const applied = new Set(rows.map((row) => row.id));
  const result: MigrateResult = { applied: [], skipped: [] };
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) {
      result.skipped.push(migration.id);
      continue;
    }
    await driver.transaction(async (tx) => {
      for (const statement of migration.statements) await tx.exec(statement);
      await tx.run('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)', [
        migration.id,
        Date.now(),
      ]);
    });
    result.applied.push(migration.id);
  }
  return result;
}
