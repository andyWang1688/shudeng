import { afterEach, describe, expect, it, vi } from 'vitest';
import { discardConversationRun, finishConversationRun, getConversationRuntimeSnapshots,
  publishConversationRun, subscribeConversationRuntime } from '../conversationRuntime';
import type { ChatTurn } from '../types';

const turn = (id: string): ChatTurn => ({ id, role: 'assistant', text: '', reasoning: '', tools: [], citations: [],
  warnings: [], status: 'streaming', sourceQuestion: '真实原问题' });
afterEach(() => { for (const record of getConversationRuntimeSnapshots()) discardConversationRun(record.conversationId); vi.useRealTimers(); });

describe('readonly history runtime port', () => {
  it('freezes website sources and search status independently from a mutable running turn', () => {
    const source = { id: 'web-1', url: 'https://example.com/source', title: '真实外部来源', provider: 'openai' as const };
    const status = { status: 'searching' as const, message: '正在搜索' };
    publishConversationRun('runtime-web', { ...turn('answer'), webSources: [source], webSearchStatus: status }, { bookId: 'book', bookTitle: '书' });
    source.title = '后来修改'; status.message = '后来状态';
    const saved = getConversationRuntimeSnapshots()[0]!.turn;
    expect(saved.webSources?.[0]?.title).toBe('真实外部来源');
    expect(saved.webSearchStatus?.message).toBe('正在搜索');
    expect(Object.isFrozen(saved.webSources?.[0])).toBe(true);
    expect(Object.isFrozen(saved.webSearchStatus)).toBe(true);
  });

  it('keeps stable snapshots and first book identity across updates before storage', () => {
    vi.useFakeTimers(); vi.setSystemTime(100);
    const changed = vi.fn(); const stop = subscribeConversationRuntime(changed);
    const empty = getConversationRuntimeSnapshots();
    expect(getConversationRuntimeSnapshots()).toBe(empty);
    const mutable = turn('assistant-id');
    publishConversationRun('runtime-contract', mutable, { bookId: 'book-a', bookTitle: '最初书名' });
    const first = getConversationRuntimeSnapshots();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ conversationId: 'runtime-contract', bookId: 'book-a', bookTitle: '最初书名', updatedAt: 100,
      running: true, turn: { id: 'assistant-id', sourceQuestion: '真实原问题' } });
    mutable.text = '外部修改';
    mutable.tools.push({ callId: 'late', name: 'read', status: 'done' });
    expect(first[0]!.turn.text).toBe('');
    expect(first[0]!.turn.tools).toEqual([]);
    expect(Object.isFrozen(first[0]!.turn.tools)).toBe(true);
    vi.setSystemTime(200);
    publishConversationRun('runtime-contract', { ...turn('assistant-id'), text: '正在生成' }, { bookId: 'different-id', bookTitle: '后来书名' });
    const second = getConversationRuntimeSnapshots();
    expect(second).not.toBe(first);
    expect(first[0]!.turn.text).toBe('');
    expect(second[0]).toMatchObject({ bookId: 'book-a', bookTitle: '最初书名', updatedAt: 200 });
    expect(Object.isFrozen(second)).toBe(true);
    expect(Object.isFrozen(second[0])).toBe(true);
    expect(changed).toHaveBeenCalledTimes(2);
    stop();
  });

  it('retains only failed saves and notifies discard and successful persistence', () => {
    const changed = vi.fn(); const stop = subscribeConversationRuntime(changed);
    publishConversationRun('runtime-failed-save', turn('unsaved'), { bookId: 'book', bookTitle: '书' });
    finishConversationRun('runtime-failed-save', { ...turn('unsaved'), status: 'done', saveError: '磁盘失败' });
    expect(getConversationRuntimeSnapshots()[0]).toMatchObject({ running: false, turn: { id: 'unsaved', saveError: '磁盘失败' } });
    finishConversationRun('runtime-failed-save', { ...turn('unsaved'), status: 'done' });
    expect(getConversationRuntimeSnapshots()).toEqual([]);
    publishConversationRun('runtime-delete', turn('delete'), { bookId: 'book', bookTitle: '书' });
    discardConversationRun('runtime-delete');
    expect(getConversationRuntimeSnapshots()).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(5);
    stop();
  });
});
