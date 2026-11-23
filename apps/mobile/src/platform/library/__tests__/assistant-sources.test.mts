import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShudengDataLayer, type ShudengDataLayer } from '../../db/engine';
import { createNodeSQLiteDriver, type NodeSQLiteDriver } from '@shudeng/core/db/testing';

const state = vi.hoisted(() => ({ layer: null as ShudengDataLayer | null }));
vi.mock('../../db', () => ({ getDataLayer: async () => state.layer }));
vi.mock('../legacyMigration', () => ({ parseLegacyJSON: () => [] }));
import { appendBookChatTurn, loadBookConversation } from '../conversations';

let driver: NodeSQLiteDriver;
const source = { id: 'web-1', url: 'https://example.com/review', title: '外部资料', provider: 'openai' as const };
const citation = { id: 'E1', quote: '书中原文', chapter: '第一章', locator: JSON.stringify({ href: 'chapter.xhtml', text: { highlight: '书中原文' } }) };
beforeEach(async () => {
  driver = createNodeSQLiteDriver();
  state.layer = await createShudengDataLayer(driver);
  await state.layer.store.saveBook({ id: 'book', title: '原书', format: 'epub', sourceHash: 'book-hash' });
});
afterEach(async () => { await driver.close(); });
const write = (details: Parameters<typeof appendBookChatTurn>[0]['details']) => appendBookChatTurn({
  bookId: 'book', conversationId: 'book:roundtrip', assistantId: 'answer', question: '书内观点与外部观点有何区别？',
  answer: '书内观点 [E1]；外部资料见来源。', citations: [citation], details,
});

describe('assistant sources through actual SQLite conversation persistence', () => {
  it.each(['openai', 'deepseek'] as const)('keeps %s website sources separate from book citations after reopen', async provider => {
    const website = { ...source, provider, answerAnchor: '外部资料见来源。' };
    await write({ status: 'streaming', webSearchStatus: { status: 'searching' }, webSources: [website] });
    await write({ status: 'done', webSearchStatus: { status: 'complete' }, webSources: [website] });
    const reopenedLayer = await createShudengDataLayer(driver);
    state.layer = reopenedLayer;
    const turns = await loadBookConversation('book:roundtrip');
    expect(turns).toHaveLength(2);
    expect(turns[1]).toMatchObject({ details: { status: 'done', webSources: [website], webSearchStatus: { status: 'complete' } }, citations: [citation] });
    expect(await driver.all('SELECT * FROM citations')).toHaveLength(1);
    expect(await driver.all('SELECT * FROM messages')).toHaveLength(2);
  });

  it('persists book citation placement and clears it when the answer is retried', async () => {
    const anchored = { ...citation, answerAnchor: '书内观点。' };
    const input = { bookId: 'book', conversationId: 'book:roundtrip', assistantId: 'answer',
      question: '作者有什么看法？', answer: '书内观点。补充说明。', citations: [anchored] };
    await appendBookChatTurn(input);
    expect((await loadBookConversation(input.conversationId))[1]?.citations).toEqual([anchored]);
    await appendBookChatTurn({ ...input, citations: [citation] });
    expect((await loadBookConversation(input.conversationId))[1]?.citations).toEqual([citation]);
  });

  it.each(['streaming', 'cancelled', 'error'] as const)('recovers %s searches without a permanent activity indicator', async status => {
    await write({ status, webSearchStatus: { status: 'searching' }, webSources: [source] });
    const [, answer] = await loadBookConversation('book:roundtrip');
    expect(answer!.details.status).toBe(status === 'streaming' ? 'interrupted' : status);
    expect(answer!.details.webSearchStatus).toMatchObject({ status: 'failed' });
    expect(answer!.details.webSources).toEqual([source]);
  });

  it('validates persisted source metadata without interpreting model Markdown as provider sources', async () => {
    await write({ status: 'done' });
    await driver.run('UPDATE conversation_turn_details SET details_json=? WHERE message_id=?', [JSON.stringify({
      status: 'done', webSources: [source, source, { ...source, id: 'bad', url: 'javascript:alert(1)' },
        { ...source, id: 'credentials', url: 'https://user:password@example.com/' },
        { ...source, id: 'invented-provider', provider: 'model-markdown' }],
      webSearchStatus: { status: 'searching' },
    }), 'answer']);
    const [, answer] = await loadBookConversation('book:roundtrip');
    expect(answer!.details.webSources).toEqual([source]);
    expect(answer!.details.webSearchStatus).toEqual({ status: 'complete' });
    expect(answer!.citations).toEqual([citation]);
  });
});
