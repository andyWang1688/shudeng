import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShudengDataLayer, type ShudengDataLayer } from '../../db/engine';
import { createNodeSQLiteDriver, type NodeSQLiteDriver } from '@shudeng/core/db/testing';
import { migrateSwiftLibrary } from '@shudeng/core';

const state = vi.hoisted(() => ({ layer: null as ShudengDataLayer | null, files: new Map<string, string>() }));
vi.mock('../../db', () => ({ getDataLayer: async () => state.layer }));
vi.mock('expo-file-system', () => {
  const join = (values: readonly (string | { uri: string })[]) => values.map(value => typeof value === 'string' ? value : value.uri).join('/');
  class File {
    uri: string; constructor(...values: (string | { uri: string })[]) { this.uri = join(values); }
    get exists() { return state.files.has(this.uri); }
    textSync() { return state.files.get(this.uri); }
    write(value: string) { state.files.set(this.uri, value); }
  }
  class Directory {
    uri: string; constructor(...values: (string | { uri: string })[]) { this.uri = join(values); }
    get exists() { return false; }
    create() {} list() { return []; }
  }
  return { File, Directory, Paths: { document: { uri: 'file:///documents' } } };
});
vi.mock('../../ai/bookIndex', () => ({ cancelBookIndexing: async () => {}, readBookContent: async () => ({}), startBookPreparation: () => {}, resumeAvailableBookIndexes: async () => {} }));
vi.mock('../bookCovers', () => ({ loadBookCover: async () => undefined, saveBookCover: async () => undefined }));
vi.mock('../conversations', () => ({ loadConversationSummaries: async () => [], markConversationsDeleted: () => () => {}, cancelConversationRun: () => {} }));
import { migrateLegacyLibraryIfNeeded } from '../legacyMigration';
import { backfillLegacyAgentMetadata, LEGACY_AGENT_METADATA_KEY } from '../legacyAgentMetadata';

const sourcePath = 'file:///documents/legacy/reading-questions.json';
const markerPath = 'file:///documents/legacy/.imported';
const now = Math.round((815024254 + 978307200) * 1000);
function turn(id = 'NATIVE-UPPER', overrides: Record<string, unknown> = {}) {
  return { id, conversationID: 'CONVERSATION-' + id, bookID: 'book', bookTitle: '原书', question: '旧问题-' + id, answer: '旧回答-' + id, state: 'complete', updated: 815024254,
    notice: '原提示', agent: { reasoning: '原思考', reasoningDuration: 1.5, reasoningExpanded: true, summary: '查书 2 步', stepsUsed: 2, warnings: ['原警告'],
      steps: [{ id: 'call', tool: 'search_book', title: '查书内资料', detail: '旧参数', preview: '旧预览，不代表完整发送内容', isError: false, duration: .5, finished: true }],
      context: { estimatedTokens: 100, characterCount: 300, limitTokens: 500 } }, ...overrides };
}
let driver: NodeSQLiteDriver;
beforeEach(async () => {
  driver = createNodeSQLiteDriver(); state.layer = await createShudengDataLayer(driver); state.files.clear();
  await driver.exec('PRAGMA foreign_keys = ON');
  await state.layer.store.saveBook({ id: 'book', title: '原书', format: 'epub', sourceHash: 'book' });
});
afterEach(async () => { vi.restoreAllMocks(); await driver.close(); });
async function seed(records: ReturnType<typeof turn>[], options: { omitAssistant?: boolean } = {}) {
  const result = migrateSwiftLibrary({ library: [{ id: 'book', title: '原书' }], questions: records }, { now });
  for (const row of result.tables.messages) {
    if (options.omitAssistant && row.role === 'assistant') continue;
    await driver.run('INSERT INTO messages(id,conversation_id,role,content,reasoning_content,is_error,created_at) VALUES (?,?,?,?,NULL,0,?)', [row.id, row.conversationId, row.role, row.content ?? '', row.createdAt]);
  }
  state.files.set(sourcePath, JSON.stringify(records));
}
async function detail(id = 'NATIVE-UPPER') {
  const rows = await driver.all<{ details_json: string }>('SELECT details_json FROM conversation_turn_details WHERE message_id = ?', ['legacy-q:' + id + ':assistant']);
  return rows[0] ? JSON.parse(rows[0].details_json) : undefined;
}

describe('additive Native Agent metadata migration on actual SQLite', () => {
  it('backfills an already imported and removal-recovered install exactly once without replaying old removal intent', async () => {
    const original = turn(); await seed([original]);
    state.files.set(markerPath, 'UNCHANGED-IMPORT-MARKER');
    state.files.set('file:///documents/legacy/library.json', JSON.stringify([{ id: 'book', removal: 'deleting' }]));
    await driver.run('INSERT INTO app_preferences(key,value_json) VALUES (?,?)', ['legacy-library-removals-recovered:v1', 'true']);
    const sourceBytes = state.files.get(sourcePath);
    const before = await driver.all('SELECT * FROM messages');
    await migrateLegacyLibraryIfNeeded();
    expect(await detail()).toMatchObject({ status: 'done', reasoningDurationMs: 1500, modelSteps: 2, legacyNative: { version: 1, sourceState: 'complete', agent: { summary: '查书 2 步', steps: original.agent.steps } } });
    expect(await state.layer!.store.getBook('book')).not.toBeNull();
    const after = await driver.all('SELECT * FROM messages');
    expect(after).toEqual(before.map(row => row.role === 'assistant' ? { ...row, reasoning_content: '原思考' } : row));
    const complete = await driver.all('SELECT * FROM conversation_turn_details');
    await migrateLegacyLibraryIfNeeded();
    expect(await driver.all('SELECT * FROM conversation_turn_details')).toEqual(complete);
    expect(await driver.all('SELECT * FROM messages')).toEqual(after);
    expect(state.files.get(sourcePath)).toBe(sourceBytes); expect(state.files.get(markerPath)).toBe('UNCHANGED-IMPORT-MARKER');
  });

  it('new import retains full metadata and submitted empty interrupted/failure assistants with no duplicate history', async () => {
    await driver.run('DELETE FROM books');
    const first = turn();
    const interrupted = turn('BLANK', { state: 'generating', answer: '', history: [{ id: first.id, question: 'stale question', answer: 'stale answer', state: 'complete' }] });
    const failed = turn('FAILED', { state: 'incomplete', answer: '', failure: '连接断开' });
    const restarted = turn('RESTARTED', { state: 'incomplete', answer: '', failure: '上次生成已中断，请主动重试。' });
    const cancelled = turn('CANCELLED', { state: 'incomplete', answer: '', failure: '已主动取消；保留已保存内容。' });
    const draft = turn('DRAFT', { state: 'draft', answer: '', question: '' });
    state.files.set('file:///documents/legacy/library.json', JSON.stringify([{ id: 'book', title: '原书' }]));
    const sourceBytes = JSON.stringify([first, interrupted, failed, restarted, cancelled, draft]); state.files.set(sourcePath, sourceBytes);
    await migrateLegacyLibraryIfNeeded();
    expect(await driver.all('SELECT id FROM messages')).toHaveLength(10);
    expect(await driver.all('SELECT message_id FROM conversation_turn_details')).toHaveLength(5);
    expect(await detail('BLANK')).toMatchObject({ status: 'interrupted', legacyNative: { sourceState: 'generating' } });
    expect(await detail('FAILED')).toMatchObject({ status: 'error', error: '连接断开' });
    expect(await detail('RESTARTED')).toMatchObject({ status: 'interrupted', legacyNative: { failure: '上次生成已中断，请主动重试。' } });
    expect(await detail('CANCELLED')).toMatchObject({ status: 'cancelled' });
    expect(await detail()).not.toHaveProperty('sentMaterials'); expect(await detail()).not.toHaveProperty('contextUsage');
    expect(await detail()).not.toHaveProperty('contextSummary'); expect(state.files.get(sourcePath)).toBe(sourceBytes);
    const snapshot = await driver.all('SELECT * FROM messages');
    await migrateLegacyLibraryIfNeeded(); expect(await driver.all('SELECT * FROM messages')).toEqual(snapshot);
  });

  it('preserves RN retry bodies/details, citations, timestamps, new followups, and deleted conversation history', async () => {
    const originals = ['SAFE', 'BODY', 'DETAILS', 'REASONING', 'RETRY', 'DELETED', 'WRONGBOOK'].map(id => turn(id));
    await seed(originals);
    await driver.run('UPDATE messages SET content=? WHERE id=?', ['RN 新回答', 'legacy-q:BODY:assistant']);
    await driver.run('UPDATE messages SET reasoning_content=? WHERE id=?', ['RN 新思考', 'legacy-q:REASONING:assistant']);
    const nativeDetails = '{"status":"done","reasoning":"RN persisted","sentMaterials":[{"id":"m","name":"真实材料","kind":"book-tool","content":"真实发送"}]}';
    await driver.run('INSERT INTO conversation_turn_details(message_id,details_json) VALUES (?,?)', ['legacy-q:DETAILS:assistant', nativeDetails]);
    await driver.run('INSERT INTO messages(id,conversation_id,role,content,created_at) VALUES (?,?,?,?,?)', ['legacy-q:RETRY:assistant:user', 'CONVERSATION-RETRY', 'user', '重试', now + 100]);
    await driver.run('INSERT INTO messages(id,conversation_id,role,content,created_at) VALUES (?,?,?,?,?)', ['rn-followup', 'CONVERSATION-SAFE', 'assistant', 'RN 追问答案', now + 200]);
    await driver.run('INSERT INTO conversation_turn_details(message_id,details_json) VALUES (?,?)', ['rn-followup', '{"status":"done","contextSummary":"RN summary"}']);
    await driver.run('DELETE FROM messages WHERE conversation_id=?', ['CONVERSATION-DELETED']);
    await driver.run('INSERT INTO conversations(id,book_id,created_at,updated_at) VALUES (?,?,?,?)', ['CONVERSATION-WRONGBOOK', 'different-book', now, now]);
    await driver.run('INSERT INTO citations(id,conversation_id,message_id,evidence_id,quote,locator_json,created_at) VALUES (?,?,?,?,?,?,?)', ['rn-citation', 'CONVERSATION-BODY', 'legacy-q:BODY:assistant', 'E-RN', 'RN引文', '{}', now + 500]);
    const before = await driver.all('SELECT * FROM messages ORDER BY id'); const citations = await driver.all('SELECT * FROM citations');
    expect(await backfillLegacyAgentMetadata(driver, originals)).toBe(1);
    expect(await driver.all('SELECT * FROM messages ORDER BY id')).toEqual(before.map(row => row.id === 'legacy-q:SAFE:assistant' ? { ...row, reasoning_content: '原思考' } : row));
    expect(await driver.all('SELECT * FROM citations')).toEqual(citations);
    expect((await driver.all<{ details_json: string }>('SELECT details_json FROM conversation_turn_details WHERE message_id=?', ['legacy-q:DETAILS:assistant']))[0]!.details_json).toBe(nativeDetails);
    for (const id of ['BODY', 'REASONING', 'RETRY', 'DELETED', 'WRONGBOOK']) expect(await detail(id)).toBeUndefined();
    const after = await driver.all('SELECT * FROM conversation_turn_details ORDER BY message_id');
    expect(await backfillLegacyAgentMetadata(driver, originals)).toBe(0);
    expect(await driver.all('SELECT * FROM conversation_turn_details ORDER BY message_id')).toEqual(after);
  });

  it('never resurrects missing empty assistants or deleted/reimported generations, and records safe skips', async () => {
    const blank = turn('EMPTY', { state: 'incomplete', answer: '' }); await seed([blank], { omitAssistant: true });
    const missingDate = turn('NO-DATE', { updated: undefined }); await seed([missingDate]);
    const reimport = turn('REIMPORTED', { bookID: 'new-generation' }); await seed([reimport]);
    await state.layer!.store.saveBook({ id: 'new-generation', title: '重新导入', format: 'epub', sourceHash: 'new-generation' });
    await driver.run('INSERT INTO app_preferences(key,value_json) VALUES (?,?)', ['legacy-book-data-deleted:new-generation', 'true']);
    const before = await driver.all('SELECT * FROM messages');
    expect(await backfillLegacyAgentMetadata(driver, [blank, missingDate, reimport])).toBe(0);
    expect(await driver.all('SELECT * FROM messages')).toEqual(before); expect(await driver.all('SELECT * FROM conversation_turn_details')).toEqual([]);
    const [marker] = await driver.all<{ value_json: string }>('SELECT value_json FROM app_preferences WHERE key=?', [LEGACY_AGENT_METADATA_KEY]);
    expect(JSON.parse(marker!.value_json)).toMatchObject({ skipped: { missingAssistant: 1, missingSourceTimestamp: 1, identityMismatchOrExistingDetails: 1 } });
  });

  it('rolls back metadata, reasoning, and marker together and succeeds on retry after a transaction failure', async () => {
    const source = [turn('ONE'), turn('TWO')]; await seed(source);
    const originalRun = driver.run.bind(driver);
    const injected = vi.spyOn(driver, 'run').mockImplementation(async (sql, parameters) => {
      if (sql.includes('INSERT INTO app_preferences') && parameters?.[0] === LEGACY_AGENT_METADATA_KEY) throw new Error('synthetic metadata commit failure');
      return originalRun(sql, parameters);
    });
    await expect(backfillLegacyAgentMetadata(driver, source)).rejects.toThrow('synthetic metadata commit failure');
    expect(await driver.all('SELECT * FROM conversation_turn_details')).toEqual([]);
    expect(await driver.all('SELECT * FROM app_preferences WHERE key=?', [LEGACY_AGENT_METADATA_KEY])).toEqual([]);
    expect(await driver.all('SELECT reasoning_content FROM messages WHERE role=?', ['assistant'])).toEqual([{ reasoning_content: null }, { reasoning_content: null }]);
    injected.mockRestore();
    expect(await backfillLegacyAgentMetadata(driver, source)).toBe(2); expect(await backfillLegacyAgentMetadata(driver, source)).toBe(0);
  });

  it('keeps a new import and both recovery markers atomic even when the source has no updated timestamp', async () => {
    await driver.run('DELETE FROM books');
    state.files.set('file:///documents/legacy/library.json', JSON.stringify([{ id: 'book', title: '原书' }]));
    const sourceBytes = JSON.stringify([turn('NO-DATE-IMPORT', { updated: undefined, state: 'incomplete', answer: '', failure: '上次生成已中断，请主动重试。' })]);
    state.files.set(sourcePath, sourceBytes);
    const originalRun = driver.run.bind(driver);
    const injected = vi.spyOn(driver, 'run').mockImplementation(async (sql, parameters) => {
      if (sql.includes('INSERT INTO app_preferences') && parameters?.[0] === LEGACY_AGENT_METADATA_KEY) throw new Error('synthetic new-import metadata failure');
      return originalRun(sql, parameters);
    });
    await expect(migrateLegacyLibraryIfNeeded()).rejects.toThrow('synthetic new-import metadata failure');
    expect(await driver.all('SELECT * FROM messages')).toEqual([]); expect(await driver.all('SELECT * FROM books')).toEqual([]);
    expect(await driver.all('SELECT * FROM app_preferences')).toEqual([]); expect(state.files.has(markerPath)).toBe(false);
    injected.mockRestore();
    await migrateLegacyLibraryIfNeeded();
    expect(await detail('NO-DATE-IMPORT')).toMatchObject({ status: 'interrupted' });
    expect(await driver.all('SELECT key FROM app_preferences WHERE key IN (?,?)', [LEGACY_AGENT_METADATA_KEY, 'legacy-library-removals-recovered:v1'])).toHaveLength(2);
    expect(state.files.get(sourcePath)).toBe(sourceBytes);
  });
});
