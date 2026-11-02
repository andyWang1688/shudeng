/**
 * LangGraph checkpoint 的异步 SQLite saver（移动端可用方案）。
 *
 * 背景（任务结论的一部分）：
 * - 官方 `@langchain/langgraph-checkpoint-sqlite@1.1.0` 直接 `import Database from "better-sqlite3"`，
 *   同步原生驱动；Hermes/Expo 里没有 better-sqlite3，expo-sqlite 只有异步 API，因此不能直接用。
 * - 最小可验证方案：复用官方 `BaseCheckpointSaver` 契约与对应表结构语义，但把 IO 换成
 *   注入的异步 SQLiteDriver（Node: node:sqlite / 移动端: expo-sqlite），表名加 `lg_` 前缀避免
 *   与应用级 `checkpoints` 表冲突。序列化仍走官方 serde（JsonPlusSerializer），所以
 *   checkpoint 内容与官方 saver 语义一致（可迁移），只是存储实现不同。
 *
 * 没有实现（V1 spike 范围外）：
 * - `pending_sends` 的 v<4 checkpoint 迁移逻辑（官方 SqliteSaver 内部兼容代码）。
 * - 官方表的 task_path 列兼容读取（本 saver 总是写新列）。
 */
import type { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
  compareWritesSortKeys,
  copyCheckpoint,
  writesSortKey,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointPendingWrite,
  type CheckpointTuple,
  type PendingWrite,
  type SerializerProtocol,
} from '@langchain/langgraph-checkpoint';
import type { SQLiteDriver, SQLiteValue } from './driver.js';

const SETUP_STATEMENTS = [
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
];

type Row = Record<string, SQLiteValue>;

function bytes(value: SQLiteValue | undefined): Uint8Array | string {
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string') return value;
  throw new Error('LangGraph checkpoint 数据不是 BLOB/字符串');
}

function text(value: SQLiteValue | undefined): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

function optionalText(value: SQLiteValue | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export class SqliteCheckpointSaver extends BaseCheckpointSaver<number> {
  private readonly driver: SQLiteDriver;
  private setupPromise: Promise<void> | null = null;

  constructor(driver: SQLiteDriver, serde?: SerializerProtocol) {
    super(serde);
    this.driver = driver;
  }

  private async ensureSetup(): Promise<void> {
    if (!this.setupPromise) {
      this.setupPromise = (async () => {
        for (const statement of SETUP_STATEMENTS) await this.driver.exec(statement);
      })();
    }
    return this.setupPromise;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    await this.ensureSetup();
    const threadId = readThreadId(config);
    const checkpointNs = readCheckpointNs(config);
    const checkpointId = readCheckpointId(config);
    const rows = checkpointId
      ? await this.driver.all<Row>(
          `SELECT * FROM lg_checkpoints WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`,
          [threadId, checkpointNs, checkpointId],
        )
      : await this.driver.all<Row>(
          `SELECT * FROM lg_checkpoints WHERE thread_id = ? AND checkpoint_ns = ? ORDER BY checkpoint_id DESC LIMIT 1`,
          [threadId, checkpointNs],
        );
    const row = rows[0];
    if (!row) return undefined;
    const type = text(row.type) || 'json';
    const checkpoint = (await this.serde.loadsTyped(type, bytes(row.checkpoint))) as Checkpoint;
    const metadata = (await this.serde.loadsTyped(type, bytes(row.metadata))) as CheckpointMetadata;
    const storedId = text(row.checkpoint_id);
    const parentId = optionalText(row.parent_checkpoint_id);
    const resolvedConfig: RunnableConfig = checkpointId
      ? config
      : {
          ...config,
          configurable: {
            ...(config.configurable ?? {}),
            thread_id: threadId,
            checkpoint_ns: checkpointNs,
            checkpoint_id: storedId,
          },
        };
    const pendingWrites = await this.loadPendingWrites(threadId, checkpointNs, storedId);
    return {
      checkpoint,
      config: resolvedConfig,
      metadata,
      ...(parentId
        ? {
            parentConfig: {
              configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: parentId },
            },
          }
        : {}),
      pendingWrites,
    };
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    await this.ensureSetup();
    const threadId = readThreadId(config);
    const checkpointNs = readCheckpointNs(config);
    const beforeId = options?.before ? readCheckpointId(options.before) : undefined;
    const rows = await this.driver.all<Row>(
      `SELECT * FROM lg_checkpoints WHERE thread_id = ? AND checkpoint_ns = ?` +
        (beforeId ? ` AND checkpoint_id < ?` : '') +
        ` ORDER BY checkpoint_id DESC`,
      beforeId ? [threadId, checkpointNs, beforeId] : [threadId, checkpointNs],
    );
    let emitted = 0;
    for (const row of rows) {
      const type = text(row.type) || 'json';
      const metadata = (await this.serde.loadsTyped(type, bytes(row.metadata))) as CheckpointMetadata;
      if (options?.filter && !matchesFilter(metadata as Record<string, unknown>, options.filter)) {
        continue;
      }
      const checkpoint = (await this.serde.loadsTyped(type, bytes(row.checkpoint))) as Checkpoint;
      const storedId = text(row.checkpoint_id);
      const parentId = optionalText(row.parent_checkpoint_id);
      yield {
        checkpoint,
        config: {
          ...config,
          configurable: {
            ...(config.configurable ?? {}),
            thread_id: threadId,
            checkpoint_ns: checkpointNs,
            checkpoint_id: storedId,
          },
        },
        metadata,
        ...(parentId
          ? {
              parentConfig: {
                configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: parentId },
              },
            }
          : {}),
        pendingWrites: await this.loadPendingWrites(threadId, checkpointNs, storedId),
      };
      emitted += 1;
      if (options?.limit !== undefined && emitted >= options.limit) return;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    await this.ensureSetup();
    const threadId = readThreadId(config);
    const checkpointNs = readCheckpointNs(config);
    const parentCheckpointId = readCheckpointId(config);
    const prepared = copyCheckpoint(checkpoint);
    const [[checkpointType, checkpointBytes], [metadataType, metadataBytes]] = await Promise.all([
      this.serde.dumpsTyped(prepared),
      this.serde.dumpsTyped(metadata),
    ]);
    if (checkpointType !== metadataType) {
      throw new Error('checkpoint 与 metadata 序列化类型不一致');
    }
    await this.driver.run(
      `INSERT OR REPLACE INTO lg_checkpoints
       (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        threadId,
        checkpointNs,
        checkpoint.id,
        parentCheckpointId ?? null,
        checkpointType,
        checkpointBytes,
        metadataBytes,
      ],
    );
    return {
      configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: checkpoint.id },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
    taskPath?: string,
  ): Promise<void> {
    await this.ensureSetup();
    const threadId = readThreadId(config);
    const checkpointNs = readCheckpointNs(config);
    const checkpointId = readCheckpointId(config);
    if (!checkpointId) throw new Error('putWrites 需要 checkpoint_id');
    const allSpecial = writes.every(([channel]) => channel in WRITES_IDX_MAP);
    const statement = `INSERT ${allSpecial ? 'OR REPLACE' : 'OR IGNORE'} INTO lg_writes
      (thread_id, checkpoint_ns, checkpoint_id, task_id, task_path, idx, channel, type, value)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const rows = await Promise.all(
      writes.map(async ([channel, value], index) => {
        const [type, serialized] = await this.serde.dumpsTyped(value);
        return [
          threadId,
          checkpointNs,
          checkpointId,
          taskId,
          taskPath ?? '',
          WRITES_IDX_MAP[channel] ?? index,
          channel,
          type,
          serialized,
        ] satisfies SQLiteValue[];
      }),
    );
    await this.driver.transaction(async (tx) => {
      for (const row of rows) await tx.run(statement, row);
    });
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.ensureSetup();
    await this.driver.transaction(async (tx) => {
      await tx.run('DELETE FROM lg_checkpoints WHERE thread_id = ?', [threadId]);
      await tx.run('DELETE FROM lg_writes WHERE thread_id = ?', [threadId]);
    });
  }

  private async loadPendingWrites(
    threadId: string,
    checkpointNs: string,
    checkpointId: string,
  ): Promise<CheckpointPendingWrite[]> {
    const rows = await this.driver.all<Row>(
      `SELECT * FROM lg_writes WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`,
      [threadId, checkpointNs, checkpointId],
    );
    const decoded = await Promise.all(
      rows.map(async (row) => ({
        sortKey: writesSortKey(text(row.task_path), text(row.task_id), Number(row.idx ?? 0)),
        write: [
          text(row.task_id),
          text(row.channel),
          await this.serde.loadsTyped(text(row.type) || 'json', bytes(row.value)),
        ] as CheckpointPendingWrite,
      })),
    );
    decoded.sort((a, b) => compareWritesSortKeys(a.sortKey, b.sortKey));
    return decoded.map((entry) => entry.write);
  }
}

function readThreadId(config: RunnableConfig): string {
  const value = config.configurable?.thread_id;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('LangGraph checkpoint 配置缺少 thread_id');
  }
  return value;
}

function readCheckpointNs(config: RunnableConfig): string {
  const value = config.configurable?.checkpoint_ns;
  return typeof value === 'string' && value.length > 0 ? value : '';
}

function readCheckpointId(config: RunnableConfig): string | undefined {
  const value = config.configurable?.checkpoint_id;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function matchesFilter(metadata: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, expected]) => metadata[key] === expected);
}
