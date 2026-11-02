import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, type ShudengDatabase } from './drizzle.js';
import { MIGRATIONS, migrate } from './migrations.js';
import { ShudengStore } from './store.js';
import { createNodeSQLiteDriver, type NodeSQLiteDriver } from './testing/node-sqlite-driver.js';

let driver: NodeSQLiteDriver;
let db: ShudengDatabase;
let store: ShudengStore;
const tempDirs: string[] = [];

beforeEach(async () => {
  driver = createNodeSQLiteDriver();
  await migrate(driver);
  db = createDatabase(driver);
  store = new ShudengStore(db);
});

afterEach(async () => {
  await driver.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('SQLite + Drizzle schema/store（node:sqlite 驱动）', () => {
  it('迁移幂等且建出全部表', async () => {
    const second = await migrate(driver);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(MIGRATIONS.map((migration) => migration.id));

    const rows = await driver.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const tables = rows.map((row) => row.name);
    for (const table of [
      'books',
      'anchors',
      'annotations',
      'messages',
      'citations',
      'checkpoints',
      'lg_checkpoints',
      'lg_writes',
      '_migrations',
    ]) {
      expect(tables).toContain(table);
    }
  });

  it('books: 写入/更新/读取', async () => {
    await store.saveBook({
      id: 'book-1',
      title: '测试书',
      format: 'epub',
      sourceHash: 'hash-1',
    });
    expect((await store.getBook('book-1'))?.title).toBe('测试书');

    await store.saveBook({
      id: 'book-1',
      title: '测试书（改名）',
      author: '作者',
      format: 'epub',
      sourceHash: 'hash-1',
    });
    const updated = await store.getBook('book-1');
    expect(updated?.title).toBe('测试书（改名）');
    expect(updated?.author).toBe('作者');
    expect(await store.listBooks()).toHaveLength(1);
  });

  it('anchors / annotations: 关联写入与查询', async () => {
    await store.saveBook({ id: 'book-1', title: '书', format: 'pdf', sourceHash: 'h' });
    const anchor = await store.saveAnchor({
      bookId: 'book-1',
      engine: 'pdfkit',
      locatorJson: '{"page":1,"rects":[]}',
      quote: '灯把书页照亮',
      page: 1,
    });
    expect(anchor.id).toMatch(/^anchor-/);
    expect(await store.listAnchors('book-1')).toHaveLength(1);

    const annotation = await store.saveAnnotation({
      bookId: 'book-1',
      anchorId: anchor.id,
      kind: 'highlight',
      color: 'yellow',
    });
    const annotations = await store.listAnnotations('book-1');
    expect(annotations.map((row) => row.id)).toEqual([annotation.id]);
    expect(annotations[0]?.color).toBe('yellow');

    await store.deleteAnnotation(annotation.id);
    expect(await store.listAnnotations('book-1')).toHaveLength(0);
  });

  it('messages / citations / checkpoints: 读写与删除对话', async () => {
    const conversationId = 'conv-1';
    const assistant = await store.appendMessage({
      conversationId,
      role: 'assistant',
      content: '{"answer":"…"}',
      reasoningContent: '先查书',
    });
    await store.appendMessage({ conversationId, role: 'tool', content: '[E1] 原文', toolCallId: 'call_1' });
    const citation = await store.addCitation({
      conversationId,
      messageId: assistant.id,
      evidenceId: 'E1',
      quote: '灯把书页照亮',
      locatorJson: '{"page":1}',
      page: 1,
    });
    await store.saveCheckpoint(conversationId, { messages: ['m1'] }, 2, { text: '摘要' });

    const messageRows = await store.listMessages(conversationId);
    expect(messageRows).toHaveLength(2);
    expect(messageRows[0]?.reasoningContent).toBe('先查书');
    expect((await store.listCitations(conversationId)).map((row) => row.id)).toEqual([citation.id]);

    const checkpoint = await store.loadCheckpoint(conversationId);
    expect(checkpoint?.step).toBe(2);
    expect(checkpoint?.state).toEqual({ messages: ['m1'] });
    expect(checkpoint?.summary).toEqual({ text: '摘要' });

    await store.deleteConversation(conversationId);
    expect(await store.listMessages(conversationId)).toHaveLength(0);
    expect(await store.listCitations(conversationId)).toHaveLength(0);
    expect(await store.loadCheckpoint(conversationId)).toBeNull();
  });

  it('事务失败回滚（不留下半条记录）', async () => {
    await expect(
      driver.transaction(async (tx) => {
        await tx.run('INSERT INTO books (id,title,format,source_hash,imported_at,updated_at) VALUES (?,?,?,?,?,?)', [
          'book-tx',
          '事务书',
          'epub',
          'h',
          Date.now(),
          Date.now(),
        ]);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    const rows = await driver.all("SELECT id FROM books WHERE id = 'book-tx'");
    expect(rows).toHaveLength(0);
  });

  it('文件数据库重开后数据仍在', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shudeng-db-'));
    tempDirs.push(dir);
    const location = join(dir, 'shudeng.sqlite');
    const fileDriver = createNodeSQLiteDriver({ location });
    try {
      await migrate(fileDriver);
      const fileStore = new ShudengStore(createDatabase(fileDriver));
      await fileStore.saveBook({ id: 'persisted', title: '持久书', format: 'epub', sourceHash: 'h' });
    } finally {
      await fileDriver.close();
    }
    const reopened = createNodeSQLiteDriver({ location });
    try {
      const reopenedStore = new ShudengStore(createDatabase(reopened));
      expect((await reopenedStore.getBook('persisted'))?.title).toBe('持久书');
    } finally {
      await reopened.close();
    }
  });
});
