import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { parseQuestionOrigin } from '../../platform/library/questionOrigin.ts';
import { parseWebSources, parseWebSearchPresentation } from '../../platform/library/assistantSources.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const file = new URL('../../platform/library/conversations.ts', import.meta.url);
function library(legacy: any[] | (() => unknown) = []) {
  const db = new DatabaseSync(':memory:');
  db.exec([
    "CREATE TABLE books(id TEXT PRIMARY KEY,title TEXT,format TEXT DEFAULT 'epub')",
    'CREATE TABLE anchors(book_id TEXT,quote TEXT,chapter TEXT,page INTEGER,locator_json TEXT)',
    'CREATE TABLE conversations(id TEXT PRIMARY KEY,book_id TEXT,title TEXT,created_at INTEGER,updated_at INTEGER)',
    'CREATE TABLE messages(id TEXT PRIMARY KEY,conversation_id TEXT,role TEXT,content TEXT,reasoning_content TEXT,is_error INTEGER,created_at INTEGER)',
    'CREATE TABLE conversation_turn_details(message_id TEXT PRIMARY KEY,details_json TEXT)',
    'CREATE TABLE citations(id TEXT,conversation_id TEXT,message_id TEXT,evidence_id TEXT,quote TEXT,locator_json TEXT,chapter TEXT,page INTEGER,created_at INTEGER)',
  ].join(';'));
  const reads = { legacy: 0, bodies: 0, queries: [] as string[] };
  const driver: any = {
    all: async (sql: string, args: any[] = []) => { reads.queries.push(sql); return db.prepare(sql).all(...args); },
    run: async (sql: string, args: any[] = []) => db.prepare(sql).run(...args),
    transaction: async (operation: any) => {
      db.exec('BEGIN');
      try { const value = await operation(driver); db.exec('COMMIT'); return value; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  const store = {
    getBook: async (id: string) => db.prepare('SELECT * FROM books WHERE id=?').get(id),
    listMessages: async (id: string) => {
      reads.bodies++;
      return db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at,id').all(id)
        .map((row: any) => ({ ...row, createdAt: row.created_at, reasoningContent: row.reasoning_content }));
    },
    listCitations: async () => [],
  };
  const compiled: any = new Module(file.pathname);
  let counter = 0;
  const mocks: Record<string, any> = {
    '@shudeng/core': { createLocalId: () => 'generated-' + ++counter },
    '../db': { getDataLayer: async () => ({ driver, store }) },
    './pure': { isRecord: (value: any) => value !== null && typeof value === 'object' && !Array.isArray(value), cleanLegacyAssistantContent: (value: string) => value,
      citationHref: (raw: string | null) => raw ? /"href"\s*:\s*"([^"]+)"/.exec(raw)?.[1] ?? null : null },
    './legacyMigration': { parseLegacyJSON: () => { reads.legacy++; return typeof legacy === 'function' ? legacy() : legacy; } },
    './questionOrigin': { parseQuestionOrigin },
    './assistantSources': { parseWebSources, parseWebSearchPresentation },
  };
  compiled.require = (id: string) => { if (!(id in mocks)) throw Error('Unmocked ' + id); return mocks[id]; };
  compiled._compile(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, file.pathname);
  return { db, reads, api: compiled.exports, insert(id: string, updated: number, details: any = {}) {
    db.prepare('INSERT INTO conversations VALUES(?,?,NULL,?,?)').run(id, 'book', updated, updated);
    db.prepare('INSERT INTO messages VALUES(?,?,?,?,NULL,0,?)').run(id + ':user', id, 'user', '问题-' + id, updated);
    db.prepare('INSERT INTO messages VALUES(?,?,?,?,NULL,0,?)').run(id + ':assistant', id, 'assistant', '答案-' + id, updated + 1);
    db.prepare('INSERT INTO conversation_turn_details VALUES(?,?)').run(id + ':assistant', JSON.stringify({ status: 'done', ...details }));
  } };
}

test('renaming updates real SQLite ordering, preserves identity, trims the name and rejects blank input', async () => {
  const h = library();
  try {
    h.insert('older', 10); h.insert('newer', 20);
    assert.equal((await h.api.loadConversationSummaries())[0].conversationId, 'newer');
    await h.api.renameBookConversation('older', '  新名称\n');
    const summaries = await h.api.loadConversationSummaries();
    assert.equal(summaries[0].conversationId, 'older');
    assert.equal(summaries[0].title, '新名称');
    assert.ok(summaries[0].updatedAt > 20);
    assert.equal(summaries.length, 2);
    await assert.rejects(h.api.renameBookConversation('older', ' \n'), /名称不能为空/);
    assert.equal((await h.api.loadConversationSummaries())[0].title, '新名称');
  } finally { h.db.close(); }
});

test('summaries retain original legacy titles and count actual submitted users without draft or assistant inflation', async () => {
  const h = library([{ id: 'draft', conversationID: 'thread', turnIndex: 0, bookID: 'book', bookTitle: '原书快照', conversationTitle: '旧对话名称', state: 'draft' }]);
  try {
    h.insert('thread', 20);
    h.db.prepare('INSERT INTO messages VALUES(?,?,?,?,NULL,0,?)').run('legacy-q:draft:user', 'thread', 'user', '未发送草稿', 1);
    const [item] = await h.api.loadConversationSummaries();
    assert.equal(item.bookTitle, '原书快照');
    assert.equal(item.title, '旧对话名称');
    assert.equal(item.submittedCount, 1);
    assert.deepEqual(item.assistantIds, ['thread:assistant']);
    assert.equal(item.question, '未发送草稿');
  } finally { h.db.close(); }
});

test('the first real book title survives partial rewrites, later turns and removal of the source row', async () => {
  const h = library();
  try {
    h.db.prepare('INSERT INTO books(id,title) VALUES(?,?)').run('book', '最初书名');
    const save = (id: string, answer: string) => h.api.appendBookChatTurn({ bookId: 'book', conversationId: 'thread', assistantId: id, question: '原问题', answer });
    await save('first', '部分回答');
    h.db.prepare('UPDATE books SET title=?').run('后来书名');
    await save('first', '完整回答');
    h.db.exec('DELETE FROM books');
    await save('follow', '追问回答');
    const [item] = await h.api.loadConversationSummaries();
    assert.equal(item.bookTitle, '最初书名');
    assert.equal(item.submittedCount, 2);
    assert.equal(item.answer, '追问回答');
    assert.equal((await h.api.loadBookConversation('thread')).find((turn: any) => turn.id === 'follow').details.bookTitle, '最初书名');
  } finally { h.db.close(); }
});

function legacyThread(h: ReturnType<typeof library>, quote: string, chapter: string | null, page: number | null, kind = 'pdf') {
  h.db.prepare('INSERT INTO messages VALUES(?,?,?,?,NULL,0,?)').run('legacy-q:turn:user', 'thread', 'user', '问题', 1);
  h.db.prepare('INSERT INTO messages VALUES(?,?,?,?,NULL,0,?)').run('legacy-q:turn:assistant', 'thread', 'assistant', '回答', 2);
  h.db.prepare('INSERT INTO citations VALUES(?,?,?,?,?,?,?,?,?)').run('citation', 'thread', 'legacy-q:turn:assistant', 'E1', quote, JSON.stringify({ kind }), chapter, page, 2);
}

test('a reliable native bookID wins over citations shared by two books on the same PDF page', async () => {
  const h = library([{ id: 'turn', conversationID: 'thread', turnIndex: 0, bookID: 'B', bookTitle: 'Book B' }]);
  try {
    h.db.exec("INSERT INTO books VALUES('A','Book A','pdf'),('B','Book B','pdf')");
    h.db.exec("INSERT INTO anchors VALUES('A','uniqueA',NULL,1,'{}'),('B','uniqueB',NULL,1,'{}')");
    legacyThread(h, 'uniqueB', null, 1);
    const [summary] = await h.api.loadConversationSummaries();
    assert.equal(summary.bookId, 'B'); assert.equal(summary.bookTitle, 'Book B');
    assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM conversations').get().count, 0, 'reading never changes migration/schema or writes an inferred relation');
  } finally { h.db.close(); }
});

test('an exact quote narrows shared page candidates without a native book mapping', async () => {
  const h = library();
  try {
    h.db.exec("INSERT INTO books VALUES('A','Book A','pdf'),('B','Book B','pdf')");
    h.db.exec("INSERT INTO anchors VALUES('A','uniqueA',NULL,1,'{}'),('B','uniqueB',NULL,1,'{}')");
    legacyThread(h, 'uniqueB', null, 1);
    assert.equal((await h.api.loadConversationSummaries())[0].bookId, 'B');
  } finally { h.db.close(); }
});

test('a removed native source book keeps its known identity instead of adopting a surviving citation match', async () => {
  const h = library([{ id: 'turn', conversationID: 'thread', bookID: 'B', bookTitle: 'Removed Book B' }]);
  try {
    h.db.exec("INSERT INTO books VALUES('A','Book A','pdf')");
    h.db.exec("INSERT INTO anchors VALUES('A','same',NULL,1,'{}')");
    legacyThread(h, 'same', null, 1);
    const [summary] = await h.api.loadConversationSummaries();
    assert.equal(summary.bookId, 'B'); assert.equal(summary.bookTitle, 'Removed Book B');
  } finally { h.db.close(); }
});

test('a page or chapter alone cannot identify a book even when there is only one matching anchor', async () => {
  for (const format of ['pdf', 'epub']) {
    const h = library();
    try {
      const chapter = format === 'epub' ? '第一章' : null; const page = format === 'pdf' ? 1 : null;
      h.db.prepare('INSERT INTO books VALUES(?,?,?)').run('A', 'Book A', format);
      h.db.prepare('INSERT INTO anchors VALUES(?,?,?,?,?)').run('A', '不同的原文', chapter, page, '{}');
      legacyThread(h, '未找到的原文', chapter, page, format);
      assert.equal((await h.api.loadConversationSummaries())[0].bookId, '');
    } finally { h.db.close(); }
  }
});

test('shared PDF pages or EPUB chapters do not assign an ambiguous legacy conversation to the first book', async () => {
  for (const format of ['pdf', 'epub']) {
    const h = library();
    try {
      const chapter = format === 'epub' ? '第一章' : null; const page = format === 'pdf' ? 1 : null;
      const insertBook = h.db.prepare('INSERT INTO books VALUES(?,?,?)');
      const insertAnchor = h.db.prepare('INSERT INTO anchors VALUES(?,?,?,?,?)');
      for (const id of ['A', 'B']) { insertBook.run(id, 'Book ' + id, format); insertAnchor.run(id, '相同原文', chapter, page, '{}'); }
      legacyThread(h, '相同原文', chapter, page, format);
      assert.equal((await h.api.loadConversationSummaries())[0].bookId, '', format + ' ambiguity is left unresolved');
    } finally { h.db.close(); }
  }
});

test('conflicting citation evidence cannot silently select a book by score', async () => {
  const h = library();
  try {
    h.db.exec("INSERT INTO books VALUES('A','Book A','pdf'),('B','Book B','pdf')");
    h.db.exec("INSERT INTO anchors VALUES('A','uniqueA',NULL,1,'{}'),('B','uniqueB',NULL,2,'{}')");
    legacyThread(h, 'uniqueB', null, 1);
    assert.equal((await h.api.loadConversationSummaries())[0].bookId, '');
  } finally { h.db.close(); }
});

test('legacy turnIndex preserves first question and latest answer after an earlier turn was renamed later', async () => {
  const h = library([
    { id: 'first', conversationID: 'legacy', turnIndex: 0, bookTitle: '原书', conversationTitle: '改后的名字' },
    { id: 'follow', conversationID: 'legacy', turnIndex: 1, bookTitle: '原书' },
  ]);
  try {
    h.db.prepare('INSERT INTO conversations VALUES(?,?,NULL,?,?)').run('legacy', 'book', 1, 100);
    const insert = h.db.prepare('INSERT INTO messages VALUES(?,?,?,?,NULL,0,?)');
    insert.run('legacy-q:first:user', 'legacy', 'user', '最初问题', 100);
    insert.run('legacy-q:first:assistant', 'legacy', 'assistant', '旧回答', 101);
    insert.run('legacy-q:follow:user', 'legacy', 'user', '后续问题', 20);
    insert.run('legacy-q:follow:assistant', 'legacy', 'assistant', '后续回答', 21);
    const [summary] = await h.api.loadConversationSummaries();
    assert.equal(summary.question, '最初问题'); assert.equal(summary.answer, '后续回答');
    assert.equal(summary.title, '改后的名字'); assert.equal(summary.submittedCount, 2);
    assert.equal(summary.updatedAt, 101);
  } finally { h.db.close(); }
});

test('optional request estimates and sent materials are strictly projected without inventing missing metadata', async () => {
  const estimate = { estimatedTokens: 10, characterCount: 38, systemTokens: 3, historyTokens: 2, toolTokens: 5, summaryTokens: 0, summarizedMessages: 0,
    contextWindowTokens: 4096, thresholdTokens: 3000, action: 'none' };
  const material = { id: 'E1', kind: 'book-tool', name: '检索资料', content: '实际发送的原文' };
  const h = library();
  try {
    h.insert('valid', 1, { contextEstimate: { ...estimate, unknown: 'drop' }, sentMaterials: [material, { ...material, id: '' }, { ...material, kind: 'unknown' }, { ...material, content: 3 }] });
    let turn = (await h.api.loadBookConversation('valid'))[1];
    assert.deepEqual(turn.details.contextEstimate, estimate);
    assert.deepEqual(turn.details.sentMaterials, [material]);
    for (const action of ['pruned', 'trimmed']) {
      const extended = { ...estimate, action, trimmedMessages: 2, truncatedToolResults: 0 };
      h.db.prepare('UPDATE conversation_turn_details SET details_json=? WHERE message_id=?').run(JSON.stringify({ contextEstimate: extended }), 'valid:assistant');
      assert.deepEqual((await h.api.loadBookConversation('valid'))[1].details.contextEstimate, extended);
    }
    for (const invalid of [{ ...estimate, toolTokens: -1 }, { ...estimate, estimatedTokens: 1.5 }, { ...estimate, thresholdTokens: 0 }, { ...estimate, action: 'invented' },
      { ...estimate, trimmedMessages: -1 }, { ...estimate, truncatedToolResults: 0.5 }, { ...estimate, trimmedMessages: Number.MAX_SAFE_INTEGER + 1 }]) {
      h.db.prepare('UPDATE conversation_turn_details SET details_json=? WHERE message_id=?').run(JSON.stringify({ contextEstimate: invalid }), 'valid:assistant');
      turn = (await h.api.loadBookConversation('valid'))[1];
      assert.equal(turn.details.contextEstimate, undefined);
      assert.equal(turn.details.sentMaterials, undefined);
      assert.equal(turn.details.bookTitle, undefined);
    }
  } finally { h.db.close(); }
});

test('new conversation save, read, list, rename and book identity lookup do not read a corrupt legacy file', async () => {
  const h = library(() => { throw SyntaxError('broken legacy JSON'); });
  try {
    h.db.prepare('INSERT INTO books(id,title) VALUES(?,?)').run('book', '现在的书');
    await h.api.appendBookChatTurn({ bookId: 'book', conversationId: 'new-thread', assistantId: 'answer', question: '新问题', answer: '新回答' });
    assert.equal((await h.api.loadBookConversation('new-thread'))[1].text, '新回答');
    assert.equal((await h.api.loadConversationSummaries())[0].bookTitle, '现在的书');
    await h.api.renameBookConversation('new-thread', '新会话名');
    assert.deepEqual(await h.api.listConversationIdsForBook('book'), ['book:book', 'new-thread']);
    assert.equal(h.reads.legacy, 0);
  } finally { h.db.close(); }
});

test('loading a migrated legacy conversation still reports corrupt legacy metadata', async () => {
  const h = library(() => { throw SyntaxError('broken legacy JSON'); });
  try {
    legacyThread(h, '引文', null, 1);
    await assert.rejects(h.api.loadBookConversation('thread'), /broken legacy JSON/);
    await assert.rejects(h.api.loadConversationSummaries(), /broken legacy JSON/);
    await assert.rejects(h.api.appendBookChatTurn({ bookId: 'book', conversationId: 'thread', question: '追问', answer: '回答' }), /broken legacy JSON/);
  } finally { h.db.close(); }
});

test('narrow book conversation lookup includes direct, old book-prefixed, UUID and follow-up identities without reading bodies', async () => {
  const h = library([{ id: 'native', conversationID: 'native-uuid', bookID: 'B', followUps: [{ id: 'followup-uuid' }] }]);
  try {
    h.db.exec("INSERT INTO books VALUES('A','Book A','pdf'),('B','Book B','pdf')");
    h.db.exec("INSERT INTO anchors VALUES('A','shared',NULL,1,'{}'),('B','shared',NULL,1,'{}'),('B','uniqueB',NULL,2,'{}')");
    h.db.prepare('INSERT INTO conversations VALUES(?,?,NULL,1,1)').run('modern-B', 'B');
    const insert = h.db.prepare('INSERT INTO messages VALUES(?,?,?,?,NULL,0,?)');
    for (const [id, thread] of [['book-B-user', 'book:B'], ['legacy-q:native:user', 'native-uuid'], ['legacy-q:follow:user', 'followup-uuid'], ['legacy-q:unique:user', 'unique-uuid'], ['legacy-q:ambiguous:user', 'ambiguous-uuid'], ['legacy-q:explicit-other:user', 'book:A']]) {
      insert.run(id, thread, 'user', '完整问题正文', 1);
    }
    const cite = h.db.prepare('INSERT INTO citations VALUES(?,?,?,?,?,?,?,?,?)');
    cite.run('unique', 'unique-uuid', 'legacy-q:unique:user', 'E1', 'uniqueB', '{"kind":"pdf"}', null, 2, 1);
    cite.run('ambiguous', 'ambiguous-uuid', 'legacy-q:ambiguous:user', 'E2', 'shared', '{"kind":"pdf"}', null, 1, 1);
    cite.run('other', 'book:A', 'legacy-q:explicit-other:user', 'E3', 'uniqueB', '{"kind":"pdf"}', null, 2, 1);
    assert.deepEqual(new Set(await h.api.listConversationIdsForBook('B')), new Set(['book:B', 'modern-B', 'native-uuid', 'followup-uuid', 'unique-uuid']));
    assert.equal(h.reads.bodies, 0);
    assert.ok(h.reads.queries.every(sql => !sql.includes('details_json') && !/SELECT\s+(?:m\.)?content\b/i.test(sql)));
    assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM conversations').get().count, 1);
  } finally { h.db.close(); }
});

test('renaming a modern thread reads only its identity even when another legacy thread is damaged', async () => {
  const h = library(() => { throw SyntaxError('broken legacy JSON'); });
  try {
    h.insert('modern', 1); legacyThread(h, '引文', null, 1);
    await h.api.renameBookConversation('modern', '新名称');
    assert.equal(h.db.prepare('SELECT title FROM conversations WHERE id=?').get('modern').title, '新名称');
    assert.equal(h.reads.bodies, 0); assert.equal(h.reads.legacy, 0);
  } finally { h.db.close(); }
});
