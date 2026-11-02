import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from './migrations.js';
import { SqliteCheckpointSaver } from './checkpoint-saver.js';
import { createNodeSQLiteDriver, type NodeSQLiteDriver } from './testing/node-sqlite-driver.js';

const CounterState = Annotation.Root({
  count: Annotation<number>({
    reducer: (_previous, next) => next,
    default: () => 0,
  }),
});

function buildGraph(saver: SqliteCheckpointSaver, interruptBeforeSecond = false) {
  const graph = new StateGraph(CounterState)
    .addNode('increment', (state) => ({ count: state.count + 1 }))
    .addNode('finish', (state) => ({ count: state.count }))
    .addEdge(START, 'increment')
    .addEdge('increment', 'finish')
    .addEdge('finish', END);
  return interruptBeforeSecond
    ? graph.compile({ checkpointer: saver, interruptBefore: ['finish'] })
    : graph.compile({ checkpointer: saver });
}

let driver: NodeSQLiteDriver;

beforeEach(async () => {
  driver = createNodeSQLiteDriver();
  await migrate(driver);
});

afterEach(async () => {
  await driver.close();
});

describe('LangGraph checkpoint 异步 SQLite saver（node:sqlite 驱动）', () => {
  it('官方 StateGraph 写入/读取 checkpoint，且跨 saver 实例持久化', async () => {
    const saver = new SqliteCheckpointSaver(driver);
    const graph = buildGraph(saver);
    const config = { configurable: { thread_id: 'thread-1' } };

    const result = await graph.invoke({ count: 0 }, config);
    expect(result).toMatchObject({ count: 1 });

    const tuple = await saver.getTuple({ configurable: { thread_id: 'thread-1' } });
    expect(tuple).toBeDefined();
    expect(tuple?.checkpoint.channel_values).toMatchObject({ count: 1 });
    expect(tuple?.metadata).toBeDefined();
    expect(tuple?.config.configurable?.checkpoint_id).toBe(tuple?.checkpoint.id);

    const listed: string[] = [];
    for await (const item of saver.list({ configurable: { thread_id: 'thread-1' } })) {
      listed.push(item.checkpoint.id);
    }
    expect(listed.length).toBeGreaterThanOrEqual(1);

    // 新实例（模拟 App 重启）仍能读到同一个线程的 checkpoint。
    const reopened = new SqliteCheckpointSaver(driver);
    const reopenedTuple = await reopened.getTuple({ configurable: { thread_id: 'thread-1' } });
    expect(reopenedTuple?.checkpoint.id).toBe(tuple?.checkpoint.id);

    // 真续跑：图在 finish 前 interrupt；换一个 saver/图实例（模拟重启）后从 DB 恢复并跑完。
    const resumeThread = 'thread-resume';
    const interruptedSaver = new SqliteCheckpointSaver(driver);
    const interruptedGraph = buildGraph(interruptedSaver, true);
    const interrupted = await interruptedGraph.invoke({ count: 0 }, { configurable: { thread_id: resumeThread } });
    expect(interrupted).toMatchObject({ count: 1 });

    const reopenedSaver = new SqliteCheckpointSaver(driver);
    const resumedGraph = buildGraph(reopenedSaver, false);
    const resumed = await resumedGraph.invoke(null, { configurable: { thread_id: resumeThread } });
    expect(resumed).toMatchObject({ count: 1 });
    const finalTuple = await reopenedSaver.getTuple({ configurable: { thread_id: resumeThread } });
    expect(finalTuple?.checkpoint.channel_values).toMatchObject({ count: 1 });
    expect((finalTuple?.metadata as { source?: string } | undefined)?.source).toBe('loop');
  });

  it('deleteThread 清理 checkpoint 与 writes', async () => {
    const saver = new SqliteCheckpointSaver(driver);
    const graph = buildGraph(saver);
    await graph.invoke({ count: 0 }, { configurable: { thread_id: 'thread-delete' } });
    await saver.deleteThread('thread-delete');
    expect(await saver.getTuple({ configurable: { thread_id: 'thread-delete' } })).toBeUndefined();
    const writes = await driver.all("SELECT task_id FROM lg_writes WHERE thread_id = 'thread-delete'");
    expect(writes).toHaveLength(0);
  });

  it('不同 thread 的 checkpoint 相互隔离', async () => {
    const saver = new SqliteCheckpointSaver(driver);
    const graph = buildGraph(saver);
    await graph.invoke({ count: 0 }, { configurable: { thread_id: 'a' } });
    await graph.invoke({ count: 10 }, { configurable: { thread_id: 'b' } });
    const a = await saver.getTuple({ configurable: { thread_id: 'a' } });
    const b = await saver.getTuple({ configurable: { thread_id: 'b' } });
    expect(a?.checkpoint.channel_values).toMatchObject({ count: 1 });
    expect(b?.checkpoint.channel_values).toMatchObject({ count: 11 });
  });
});
