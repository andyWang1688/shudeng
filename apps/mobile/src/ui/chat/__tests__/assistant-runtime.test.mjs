import { describe, expect, it } from 'vitest';
import { assistantMessageStatus, bookTurnToAssistantMessage, submittedQuestion } from '../assistantRuntimeAdapter.ts';

const turn = (patch = {}) => ({
  id: 'answer-1', role: 'assistant', text: '回答正文', reasoning: '', tools: [], citations: [], warnings: [], status: 'done', ...patch,
});

describe('assistant-ui persisted book message boundary', () => {
  it('shows the original user question instead of the Agent prompt and keeps the persisted id', () => {
    const message = bookTurnToAssistantMessage(turn({ role: 'user', text: '这段话为什么这样说？',
      agentQuestion: '附带了很长的检索指令', selectionQuote: '原文', selectionAttached: true }));
    expect(message).toEqual({ id: 'answer-1', role: 'user', content: [{ type: 'text', text: '这段话为什么这样说？' }] });
  });

  it('preserves interrupted and cancelled partial answers instead of presenting them as completed', () => {
    const cancelled = bookTurnToAssistantMessage(turn({ text: '已收到的半段回答', status: 'cancelled' }));
    expect(cancelled.status).toEqual({ type: 'incomplete', reason: 'cancelled' });
    expect(cancelled.content).toContainEqual({ type: 'text', text: '已收到的半段回答' });
    expect(assistantMessageStatus(turn({ status: 'interrupted', error: '应用退出' })))
      .toEqual({ type: 'incomplete', reason: 'other', error: '应用退出' });
    expect(assistantMessageStatus(turn({ status: 'error', error: '服务不可用' })))
      .toEqual({ type: 'incomplete', reason: 'error', error: '服务不可用' });
    expect(assistantMessageStatus(turn({ status: 'streaming' }))).toEqual({ type: 'running' });
    expect(assistantMessageStatus(turn())).toEqual({ type: 'complete', reason: 'stop' });
  });

  it('keeps running, successful and failed tool calls distinct and does not invent a running result', () => {
    const message = bookTurnToAssistantMessage(turn({ reasoning: '核查原文', tools: [
      { callId: 'running', name: 'search_book', status: 'running' },
      { callId: 'done', name: 'read_book_passage', status: 'done', preview: '确切原文' },
      { callId: 'failed', name: 'get_book_outline', status: 'error', detail: '目录无法读取' },
    ] }));
    expect(message.content[0]).toEqual({ type: 'reasoning', text: '核查原文' });
    const tools = message.content.filter(part => part.type === 'tool-call');
    expect(tools[0]).not.toHaveProperty('result');
    expect(tools[1]).toMatchObject({ toolCallId: 'done', result: '确切原文' });
    expect(tools[2]).toMatchObject({ toolCallId: 'failed', result: '目录无法读取', isError: true });
  });

  it('exposes only saved provider sources and leaves book locators outside external URLs', () => {
    const message = bookTurnToAssistantMessage(turn({ citations: [{ id: 'B1', quote: '书中原文', locator: 'book-position' }],
      webSources: [{ id: 'W1', url: 'https://example.com/article', title: '来源标题', provider: 'openai' }] }));
    expect(message.content.filter(part => part.type === 'source')).toEqual([
      { type: 'source', sourceType: 'url', id: 'W1', url: 'https://example.com/article', title: '来源标题' },
    ]);
    expect(message.content.some(part => part.url === 'book-position')).toBe(false);
  });

  it('submits text from the runtime message, preserving multiline text and ignoring non-text parts', () => {
    const message = { content: [{ type: 'text', text: '  作者为什么这样说？' },
      { type: 'image', image: 'not-question-text' }, { type: 'text', text: '请引用原文。  ' }] };
    expect(submittedQuestion(message)).toBe('作者为什么这样说？\n请引用原文。');
    expect(submittedQuestion({ content: [{ type: 'text', text: '  \n' }] })).toBe('');
  });
});
