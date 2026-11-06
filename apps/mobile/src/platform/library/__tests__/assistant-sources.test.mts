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
  it('keeps website sources separate from navigable book citations across partial/final writes and reopen', async () => {
    await write({ status: 'streaming', webSearchStatus: { status: 'searching' }, webSources: [source] });
    await write({ status: 'done', webSearchStatus: { status: 'complete' }, webSources: [source] });
    const reopenedLayer = await createShudengDataLayer(driver);
    state.layer = reopenedLayer;
    const turns = await loadBookConversation('book:roundtrip');
    expect(turns).toHaveLength(2);
    expect(turns[1]).toMatchObject({ details: { status: 'done', webSources: [source], webSearchStatus: { status: 'complete' } }, citations: [citation] });
    expect(await driver.all('SELECT * FROM citations')).toHaveLength(1);
    expect(await driver.all('SELECT * FROM messages')).toHaveLength(2);
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
