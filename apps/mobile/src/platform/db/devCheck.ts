/**
 * 最小 dev 验证：建表/insert/select + LangGraph checkpoint write/read。
 * 与平台无关（只依赖注入后的 ShudengDataLayer），iOS/Android/Node 共用。
 */
import type { SqliteCheckpointSaver } from '@shudeng/core/db';
import type { ShudengDataLayer } from './engine';

export interface DevCheckStep {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface DevCheckReport {
  readonly ok: boolean;
  readonly engine: string;
  readonly steps: readonly DevCheckStep[];
}

type SaverPutArgs = Parameters<SqliteCheckpointSaver['put']>;
type SaverConfig = SaverPutArgs[0];
type SaverCheckpoint = SaverPutArgs[1];
type SaverMetadata = SaverPutArgs[2];
type SaverVersions = SaverPutArgs[3];

const EXPECTED_TABLES = [
  'books',
  'anchors',
  'annotations',
  'messages',
  'citations',
  'checkpoints',
  'lg_checkpoints',
  'lg_writes',
  '_migrations',
] as const;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function expect(condition: boolean, detail: string): Promise<string> {
  if (!condition) throw new Error(detail);
  return detail;
}

export async function runDataLayerDevCheck(
  layer: ShudengDataLayer,
  engine: string,
): Promise<DevCheckReport> {
  const steps: DevCheckStep[] = [];
  const suffix = Date.now().toString(36);
  const bookId = `dev-book-${suffix}`;
  const conversationId = `dev-conv-${suffix}`;
  const threadId = `dev-thread-${suffix}`;

  const run = async (name: string, action: () => Promise<string>): Promise<void> => {
    try {
      steps.push({ name, ok: true, detail: await action() });
    } catch (error) {
      steps.push({ name, ok: false, detail: message(error) });
    }
  };

  await run('schema.migrate', async () => {
    const applied = layer.migration.applied;
    const skipped = layer.migration.skipped;
    if (applied.length === 0 && skipped.length === 0) throw new Error('迁移没有任何记录');
    return `applied=[${applied.join(',')}] skipped=[${skipped.join(',')}]`;
  });

  await run('schema.tables', async () => {
    const rows = await layer.driver.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    );
    const names = new Set(rows.map((row) => row.name));
    const missing = EXPECTED_TABLES.filter((table) => !names.has(table));
    if (missing.length > 0) throw new Error(`缺表：${missing.join(', ')}`);
    return `${names.size} 张表（含全部 ${EXPECTED_TABLES.length} 张业务/迁移表）`;
  });

  await run('store.books', async () => {
    await layer.store.saveBook({
      id: bookId,
      title: 'DB dev check 书',
      format: 'epub',
      sourceHash: `hash-${suffix}`,
    });
    const row = await layer.store.getBook(bookId);
    if (!row || row.title !== 'DB dev check 书') throw new Error('books 读回不匹配');
    return 'books insert/select ok';
  });

  await run('store.messages+citations+checkpoint', async () => {
    const assistant = await layer.store.appendMessage({
      conversationId,
      role: 'assistant',
      content: '{"answer":"dev"}',
      reasoningContent: 'dev reasoning',
    });
    await layer.store.appendMessage({ conversationId, role: 'user', content: '问题' });
    await layer.store.addCitation({
      conversationId,
      messageId: assistant.id,
      evidenceId: 'E1',
      quote: 'dev quote',
      locatorJson: '{"page":1}',
      page: 1,
    });
    await layer.store.saveCheckpoint(conversationId, { step: 1 }, 1, { text: 'dev summary' });

    const messages = await layer.store.listMessages(conversationId);
    if (messages.length !== 2) throw new Error(`messages 数量 ${messages.length}`);
    if (messages[0]?.reasoningContent !== 'dev reasoning') throw new Error('reasoningContent 读回不匹配');
    const citations = await layer.store.listCitations(conversationId);
    if (citations.length !== 1) throw new Error(`citations 数量 ${citations.length}`);
    const checkpoint = await layer.store.loadCheckpoint(conversationId);
    if (checkpoint?.step !== 1) throw new Error('app checkpoint 读回不匹配');

    await layer.store.deleteConversation(conversationId);
    const after = await layer.store.listMessages(conversationId);
    if (after.length !== 0) throw new Error('deleteConversation 后仍有消息');
    return 'messages/citations/checkpoint 读写 + 删除对话 ok';
  });

  await run('checkpoint.langgraph', async () => {
    const config = {
      configurable: { thread_id: threadId, checkpoint_ns: '' },
    } as SaverConfig;
    const checkpoint = {
      v: 4,
      id: `ckpt-${suffix}`,
      ts: new Date().toISOString(),
      channel_values: { count: 1 },
      channel_versions: { count: 1 },
      versions_seen: {},
    } as SaverCheckpoint;
    const metadata = { source: 'input', step: 0, writes: {}, parents: {} } as SaverMetadata;
    await layer.saver.put(config, checkpoint, metadata, {} as SaverVersions);

    const tuple = await layer.saver.getTuple(config);
    if (!tuple) throw new Error('getTuple 没读到 checkpoint');
    const count = (tuple.checkpoint.channel_values as { count?: number }).count;
    if (count !== 1) throw new Error(`channel_values.count=${String(count)}`);

    const listed: string[] = [];
    for await (const item of layer.saver.list({ configurable: { thread_id: threadId } } as SaverConfig)) {
      listed.push(item.checkpoint.id);
    }
    if (!listed.includes(checkpoint.id)) throw new Error('list 没列出 checkpoint');

    await layer.saver.deleteThread(threadId);
    const gone = await layer.saver.getTuple(config);
    if (gone) throw new Error('deleteThread 后仍能读到 checkpoint');
    return `put/getTuple/list/deleteThread ok（checkpoint ${checkpoint.id}）`;
  });

  return {
    ok: steps.every((step) => step.ok),
    engine,
    steps,
  };
}
