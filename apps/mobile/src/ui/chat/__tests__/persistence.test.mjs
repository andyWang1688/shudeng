import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNodeSQLiteDriver } from '@shudeng/core/db/testing';
import { createShudengDataLayer } from '../../../platform/db/engine.ts';
import {
  appendBookChatTurn,
  loadBookConversation,
  loadConversationSummaries,
  renameBookConversation,
  deleteBookConversation,
  registerConversationRun,
} from '../../../platform/library/conversations.ts';
import { locatorForCitation, streamingAnswer } from '../format.ts';
import { createTurnPersistence } from '../turnPersistence.ts';
import {
  activeConversationRun,
  discardConversationRun,
  mergeConversationRun,
  finishConversationRun,
  publishConversationRun,
  subscribeConversationRun,
} from '../conversationRuntime.ts';

const state = vi.hoisted(() => ({ layer: null }));
vi.mock('../../../platform/db', () => ({ getDataLayer: async () => state.layer }));
vi.mock('../../../platform/library/legacyMigration', () => ({ parseLegacyJSON: () => [] }));
let driver;
beforeEach(async () => {
  driver = createNodeSQLiteDriver();
  state.layer = await createShudengDataLayer(driver);
});
afterEach(async () => {
  vi.useRealTimers();
  await driver.close();
});

describe('durable conversation lifecycle', () => {
  it('keeps a completed subscriber snapshot over a stale restoration read after the active run is removed', async () => {
    const turn = {
      id: 'restore-race',
      role: 'assistant',
      text: '',
      reasoning: '',
      tools: [],
      citations: [],
      warnings: [],
      status: 'streaming',
      sourceQuestion: '原问题',
    };
    let latest;
    const stop = subscribeConversationRun('restore-race', (snapshot) => {
      latest = snapshot;
    });
    publishConversationRun('restore-race', turn);
    let completeRead;
    const pendingRead = new Promise((resolve) => {
      completeRead = resolve;
    });
    finishConversationRun('restore-race', { ...turn, text: '已完成回答', status: 'done' });
    expect(activeConversationRun('restore-race')).toBeUndefined();
    completeRead([
      { ...turn, id: turn.id + ':user', role: 'user', text: '原问题', status: 'done' },
      { ...turn, status: 'cancelled' },
    ]);
    const saved = await pendingRead;
    const restored = mergeConversationRun(saved, activeConversationRun('restore-race') ?? latest);
    expect(restored).toHaveLength(2);
    expect(restored[1]).toMatchObject({ text: '已完成回答', status: 'done' });
    stop();
  });

  it('saves received partial text and reasoning before a process restart', async () => {
    vi.useFakeTimers();
    const write = createTurnPersistence(
      (snapshot) =>
        appendBookChatTurn({
          bookId: 'book-1',
          conversationId: 'partial',
          assistantId: 'partial-a',
          question: '问题',
          answer: snapshot.answer,
          details: { status: 'streaming', reasoning: snapshot.reasoning },
        }),
      (error) => {
        throw error;
      },
    );
    await write.flush({ answer: '', reasoning: '' });
    write.schedule({ answer: '已经收到的半段回答', reasoning: '已经收到的思考' });
    await vi.advanceTimersByTimeAsync(750);
    await write.flush();
    const restored = await loadBookConversation('partial');
    expect(restored[1].text).toBe('已经收到的半段回答');
    expect(restored[1].reasoning).toBe('已经收到的思考');
    expect(restored[1].details.status).toBe('interrupted');
  });

  it('finishes after a slow partial write without overwriting the final answer', async () => {
    vi.useFakeTimers();
    let release;
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    const snapshots = [];
    const write = createTurnPersistence(async (snapshot) => {
      if (snapshot === 'partial') await blocked;
      snapshots.push(snapshot);
    }, vi.fn());
    write.schedule('partial');
    await vi.advanceTimersByTimeAsync(750);
    const finished = write.flush('final');
    expect(snapshots).toEqual([]);
    release();
    await finished;
    expect(snapshots).toEqual(['partial', 'final']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(snapshots).toEqual(['partial', 'final']);
  });

  it('flushes the newest unsaved partial immediately when the app backgrounds', async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    const write = createTurnPersistence(save, vi.fn());
    write.schedule('first delta');
    write.schedule('newest delta');
    await write.flush();
    expect(save).toHaveBeenCalledExactlyOnceWith('newest delta');
    await vi.advanceTimersByTimeAsync(750);
    expect(save).toHaveBeenCalledOnce();
  });

  it('recovers from a failed partial save and still commits the final answer', async () => {
    vi.useFakeTimers();
    const fail = vi.fn();
    const save = vi.fn().mockRejectedValueOnce(new Error('disk busy')).mockResolvedValue(undefined);
    const write = createTurnPersistence(save, fail);
    write.schedule('partial');
    await vi.advanceTimersByTimeAsync(750);
    expect(fail).toHaveBeenCalledOnce();
    await write.flush('final');
    expect(save).toHaveBeenLastCalledWith('final');
  });

  it('keeps an in-flight run alive when its observer closes and restores live progress', () => {
    const turn = {
      id: 'background',
      role: 'assistant',
      text: '',
      reasoning: '',
      tools: [],
      citations: [],
      warnings: [],
      status: 'streaming',
    };
    const first = vi.fn();
    const close = subscribeConversationRun('background', first);
    publishConversationRun('background', turn);
    close();
    publishConversationRun('background', { ...turn, text: '正在生成' });
    expect(activeConversationRun('background').turn.text).toBe('正在生成');
    const restored = vi.fn();
    const stop = subscribeConversationRun('background', restored);
    finishConversationRun('background', { ...turn, text: '完成', status: 'done' });
    expect(restored).toHaveBeenCalledWith({
      turn: { ...turn, text: '完成', status: 'done' },
      running: false,
    });
    expect(activeConversationRun('background')).toBeUndefined();
    stop();
  });
  it('keeps independent conversations, restores retry input and atomically replaces a turn', async () => {
    await appendBookChatTurn({
      bookId: 'book-1',
      conversationId: 'first',
      assistantId: 'a1',
      question: '问题',
      answer: '',
      details: { status: 'streaming', agentQuestion: '选文+问题', selectionQuote: '原文' },
    });
    expect((await loadBookConversation('first'))[1].details.status).toBe('interrupted');
    await appendBookChatTurn({
      bookId: 'book-1',
      conversationId: 'first',
      assistantId: 'a1',
      question: '问题',
      answer: '回答',
      details: {
        status: 'done',
        agentQuestion: '选文+问题',
        selectionQuote: '原文',
        reasoning: '真实思考',
        reasoningDurationMs: 1234,
        warnings: ['回答包含书外补充'],
      },
      citations: [{ id: 'E1', quote: '原文', locator: 'chapter.xhtml' }],
    });
    await appendBookChatTurn({
      bookId: 'book-1',
      conversationId: 'second',
      assistantId: 'a2',
      question: '另一个问题',
      answer: '另一个回答',
    });
    const turns = await loadBookConversation('first');
    expect(turns).toHaveLength(2);
    expect(turns[1].text).toBe('回答');
    expect(turns[1].details.agentQuestion).toBe('选文+问题');
    expect(turns[1].details.selectionQuote).toBe('原文');
    expect(turns[1].reasoning).toBe('真实思考');
    expect(turns[1].details.warnings).toEqual(['回答包含书外补充']);
    expect(turns[1].citations[0].quote).toBe('原文');
    expect(await loadConversationSummaries()).toHaveLength(2);
    await renameBookConversation('first', '重命名');
    expect((await loadConversationSummaries()).find((item) => item.conversationId === 'first').title).toBe(
      '重命名',
    );
    expect(await loadBookConversation('first')).toHaveLength(2);
    await appendBookChatTurn({
      bookId: 'book-1',
      conversationId: 'first',
      assistantId: 'a3',
      question: '追问',
      answer: '后续回答',
    });
    const summary = (await loadConversationSummaries()).find((item) => item.conversationId === 'first');
    expect(summary.question).toBe('问题');
    expect(summary.answer).toBe('后续回答');
    expect(summary.searchText).toContain('问题');
    expect(summary.searchText).toContain('后续回答');
  });

  it('deletes dependent state, cancels generation and prevents late writes resurrecting it', async () => {
    await appendBookChatTurn({
      bookId: 'book-1',
      conversationId: 'deleted',
      assistantId: 'd1',
      question: '问题',
      answer: '回答',
    });
    const cancel = vi.fn();
    registerConversationRun('deleted', cancel);
    await deleteBookConversation('deleted');
    expect(cancel).toHaveBeenCalledOnce();
    expect(await loadBookConversation('deleted')).toEqual([]);
    expect(await driver.all('SELECT * FROM conversation_turn_details')).toEqual([]);
    expect(await driver.all('SELECT * FROM conversations')).toEqual([]);
    await expect(
      appendBookChatTurn({
        bookId: 'book-1',
        conversationId: 'deleted',
        assistantId: 'd1',
        question: '问题',
        answer: '迟到的回答',
      }),
    ).rejects.toThrow('已删除');
  });

  it('rolls back a whole turn if citations cannot be saved', async () => {
    await driver.exec(
      "CREATE TRIGGER fail_citation BEFORE INSERT ON citations BEGIN SELECT RAISE(ABORT,'disk full'); END",
    );
    await expect(
      appendBookChatTurn({
        bookId: 'book-1',
        conversationId: 'failed',
        assistantId: 'f1',
        question: '问题',
        answer: '回答',
        citations: [{ id: 'E1', quote: '原文', locator: 'chapter.xhtml' }],
      }),
    ).rejects.toThrow('disk full');
    expect(await loadBookConversation('failed')).toEqual([]);
    expect(await driver.all('SELECT * FROM conversations')).toEqual([]);
  });
});

describe('streaming answer and citation contracts', () => {
  it('shows the JSON answer body and hides the response envelope', () => {
    expect(streamingAnswer('{"ans')).toBe('');
    expect(streamingAnswer('{"answer":"回答","citations":[]}')).toBe('回答');
  });
  it('preserves href/progression anchors and direct CFI', () => {
    const raw = JSON.stringify({
      href: 'chapter.xhtml',
      locations: { progression: 0.4 },
      text: { highlight: '原文' },
    });
    const citation = { id: 'E1', quote: '原文', locator: raw };
    expect(JSON.parse(locatorForCitation(citation))).toEqual({ ...JSON.parse(raw), quote: '原文' });
    expect(locatorForCitation({ ...citation, locator: 'epubcfi(/6/4)' })).toBe('epubcfi(/6/4)');
    expect(JSON.parse(locatorForCitation({ ...citation, page: 3 }))).toEqual({
      type: 'pdf',
      page: 3,
      text: '原文',
    });
  });
});
