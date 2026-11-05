import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExpoSQLiteDriver, createDatabase, migrate, ShudengStore, type ExpoSQLiteDatabaseLike, type SQLiteDriver, type SQLiteValue } from '@shudeng/core/db';
import { saveEpubAnnotation } from '../epubAnnotations';

const active = vi.hoisted(() => ({ layer: null as any }));
vi.mock('../../db', () => ({ getDataLayer: async () => active.layer }));
vi.mock('../import', () => ({ loadShelfBooks: async () => [] }));
import { loadBookAnnotations, saveReaderAnnotation, updateReaderAnnotation } from '../annotations';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const rawBody = ' \t\n第一行\r\n第二行\u3000 \n';

class SQLiteExpoDatabase implements ExpoSQLiteDatabaseLike {
  readonly db = new DatabaseSync(':memory:');
  async execAsync(sql: string) { this.db.exec(sql); }
  async runAsync(sql: string, ...params: SQLiteValue[]) { return { changes: Number(this.db.prepare(sql).run(...params).changes) }; }
  async getAllAsync<T>(sql: string, ...params: SQLiteValue[]) { return this.db.prepare(sql).all(...params) as T[]; }
  async getFirstAsync<T>(sql: string, ...params: SQLiteValue[]) { return (await this.getAllAsync<T>(sql, ...params))[0] ?? null; }
  async withExclusiveTransactionAsync<T>(fn: (transaction: ExpoSQLiteDatabaseLike) => Promise<T>) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = await fn(this); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
const databases: SQLiteExpoDatabase[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.db.close(); active.layer = null; });
async function setup(format: 'epub' | 'pdf') {
  const database = new SQLiteExpoDatabase(); databases.push(database);
  const delegate = createExpoSQLiteDriver(database);
  let failReload = false;
  const driver = new Proxy(delegate, { get(target, property) {
    if (property === 'all' || property === 'allValues') return async (sql: string, params: readonly SQLiteValue[] = []) => {
      if (failReload && /^select .* from ["`]annotations["`]/i.test(sql)) { failReload = false; throw new Error('injected reload-only failure'); }
      return (target[property] as any).call(target, sql, params);
    };
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  } }) as SQLiteDriver;
  await driver.exec('PRAGMA foreign_keys = ON;'); await migrate(driver);
  const store = new ShudengStore(createDatabase(driver));
  await store.saveBook({ id: 'owned-book', title: 'Isolated note persistence', format, sourceHash: 'owned-fixture' });
  active.layer = { driver, store };
  return { database, driver, store, failNextReload: () => { failReload = true; } };
}
const epubInput = { format: 'EPUB' as const, kind: 'note' as const, quote: '独立原文', body: rawBody, locator: { type: 'epub' as const, cfi: 'epubcfi(/6/4!/4/2)' } };

describe('real EPUB persistence through Expo driver contract and SQLite', () => {
  it('preserves entered UTF-8 bytes on first insert', async () => {
    const { database } = await setup('epub');
    await saveReaderAnnotation('owned-book', epubInput);
    const row = database.db.prepare('SELECT body FROM annotations').get()!;
    expect(Buffer.from(String(row.body)).toString('hex')).toBe(Buffer.from(rawBody).toString('hex'));
  });
  it('preserves raw replacement bytes while keeping selection identity', async () => {
    const { database, driver } = await setup('epub');
    const first = await saveEpubAnnotation(driver, 'owned-book', { ...epubInput, body: 'old' });
    const second = await saveEpubAnnotation(driver, 'owned-book', epubInput);
    expect(second).toEqual(first);
    expect(database.db.prepare('SELECT body FROM annotations').all()).toEqual([{ body: rawBody }]);
    expect(database.db.prepare('SELECT COUNT(*) AS total FROM anchors').get()).toEqual({ total: 1 });
  });
  it('rejects whitespace-only content before writes and leaves an existing note intact', async () => {
    const { database, driver } = await setup('epub');
    await expect(saveEpubAnnotation(driver, 'owned-book', { ...epubInput, body: ' \t\r\n\u3000 ' })).rejects.toThrow('不能为空');
    expect(database.db.prepare('SELECT COUNT(*) AS total FROM annotations').get()).toEqual({ total: 0 });
    expect(database.db.prepare('SELECT COUNT(*) AS total FROM anchors').get()).toEqual({ total: 0 });
    await saveEpubAnnotation(driver, 'owned-book', { ...epubInput, body: 'keep' });
    await expect(saveEpubAnnotation(driver, 'owned-book', { ...epubInput, body: ' ' })).rejects.toThrow('不能为空');
    expect(database.db.prepare('SELECT body FROM annotations').all()).toEqual([{ body: 'keep' }]);
  });
});

function actualPdfSaveCallback() {
  const sourcePath = new URL('../../../reader/pdf/usePdfReader.ts', import.meta.url);
  const source = ts.createSourceFile(sourcePath.pathname, readFileSync(sourcePath, 'utf8'), ts.ScriptTarget.Latest, true);
  let callback: any;
  const visit = (node: any) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'saveNote') callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(source); if (!callback) throw Error('actual saveNote callback missing');
  return ts.transpileModule('module.exports = ' + callback.getText(source) + ';', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}
function pdfCallbackHarness() {
  const owner = { active: true, bookId: 'owned-book', fileUri: 'file:///owned.pdf' };
  const alerts: string[][] = []; const displayErrors: string[] = [];
  const context: any = {
    module: { exports: null }, bookId: owner.bookId, fileUri: owner.fileUri,
    noteBody: rawBody, noteDraft: { quote: '独立原文', locator: { type: 'pdf', page: 7 }, annotation: null },
    saveInFlight: { current: false }, saveOperation: { current: null }, committedNoteDrafts: { current: new WeakSet() }, annotationOwner: { current: owner }, preferredColor: { current: 'yellow' },
    ownsAnnotationUI: (captured: any) => captured === owner && owner.active,
    setSavingNote(value: boolean) { context.saving = value; },
    setNoteDraft(value: any) { context.noteDraft = value; }, setNoteBody(value: string) { context.noteBody = value; },
    setError(value: string) { displayErrors.push(value); }, clearSelection() { context.clears++; }, clears: 0,
    saveReaderAnnotation, updateReaderAnnotation,
    refreshAnnotations: async (captured?: any) => { const rows = await loadBookAnnotations(owner.bookId); if (!captured || context.ownsAnnotationUI(captured)) context.rows = rows; },
    persistError(title: string, cause: Error) { alerts.push([title, cause.message]); },
  };
  runInNewContext(actualPdfSaveCallback(), context);
  return { context, alerts, displayErrors, owner, save: () => context.module.exports() };
}

async function realPdfHookHarness(overrides: { saveReaderAnnotation?: typeof saveReaderAnnotation } = {}) {
  const { installDOM } = createRequire(import.meta.url)('./annotation-react-dom-host.cjs');
  const document = installDOM();
  const React = require('react');
  const ReactDOM = require('react-dom/client');
  const alerts: string[][] = [];
  const stubs: Record<string, any> = {
    react: React,
    'react-native': { Alert: { alert: (...args: string[]) => alerts.push(args) } },
    'expo-secure-store': { getItemAsync: async () => null, setItemAsync: async () => {} },
    '../../ui/appearance': { useAppearance: () => ({ resolvedMode: 'light' }) },
    '../../ui/reader-question/ReaderQuestionProvider': { useReaderQuestions: () => ({ ask() {} }) },
    '../../platform/library': { loadBookAnnotations, saveReaderAnnotation, updateReaderAnnotation, saveBookProgress: async () => {}, deleteReaderAnnotation: async () => {}, ...overrides },
    '../../platform/library/readerPreferences': { loadReaderPreferences: async () => null, saveReaderPreferences: async () => {} },
    '../../platform/library/legacyMigration': { parseLegacyJSON: () => null },
    '../../platform/pdfNative': { cancelPdfSearch() {}, getLegacyHighlightColor: () => null, startPdfInspection: () => ({ promise: Promise.resolve({}), cancel() {} }), releasePdf: async () => {}, readPdfPageText: async () => 'Owned bookmark text', trimPdfSearchQuery: (value: string) => value.trim() },
    './pdfReaderMetadata': { resolvePdfReaderPageInfo: () => ({ textPageCount: 1, scannedPageCount: 0 }) },
    './pdfBookmarkSummary': { pdfBookmarkSummary: (text: string) => text },
  };
  const sourcePath = new URL('../../../reader/pdf/usePdfReader.ts', import.meta.url);
  const code = ts.transpileModule(readFileSync(sourcePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as any };
  runInNewContext(code, { module, exports: module.exports, require: (id: string) => { if (!(id in stubs)) throw Error('Unplanned hook dependency: ' + id); return stubs[id]; }, Error, Map, JSON, Promise, setTimeout, clearTimeout });
  const usePdfReader = module.exports.usePdfReader;
  let state: any;
  let options = { bookId: 'owned-book', fileUri: 'file:///owned.pdf', title: 'Owned fixture' };
  function Host() { state = usePdfReader(options); return null; }
  const container = document.createElement('div'); document.body.appendChild(container); const root = ReactDOM.createRoot(container);
  const act = async (action: () => unknown) => React.act(async () => { await action(); });
  await act(() => root.render(React.createElement(Host)));
  return { alerts, act, get state() { return state; },
    async render(patch: Partial<typeof options>, key?: string) { options = { ...options, ...patch }; await act(() => root.render(React.createElement(Host, key ? { key } : null))); },
    async draft(body = rawBody) { await act(() => { state.onSelectionAction({ type: 'selectionAction', action: 'note', text: '独立原文', page: 7 }); state.setNoteBody(body); }); },
    async unmount() { await act(() => root.unmount()); document.body.removeChild(container); },
  };
}

describe('real PDF persistence plus the actual reader save callback', () => {
  it('does not insert twice when commit succeeds but the following read fails', async () => {
    const { database, failNextReload } = await setup('pdf'); const h = pdfCallbackHarness();
    failNextReload(); await h.save();
    expect(database.db.prepare('SELECT body FROM annotations').all()).toEqual([{ body: rawBody }]);
    expect(database.db.prepare('SELECT COUNT(*) AS total FROM anchors').get()).toEqual({ total: 1 });
    await h.save();
    expect(database.db.prepare('SELECT body FROM annotations').all()).toEqual([{ body: rawBody }]);
    expect(database.db.prepare('SELECT COUNT(*) AS total FROM anchors').get()).toEqual({ total: 1 });
    expect(h.context.noteDraft).toBeNull(); expect(h.context.noteBody).toBe('');
    expect(h.alerts).toEqual([]);
    expect(h.displayErrors).toEqual(['笔记已保存，显示更新失败；请重新打开阅读器查看。']);
    expect((await loadBookAnnotations('owned-book'))[0]?.body).toBe(rawBody);
  });
  it('keeps the draft after a real rejected INSERT and retries one durable note', async () => {
    const { database } = await setup('pdf'); const h = pdfCallbackHarness();
    database.db.exec("CREATE TRIGGER reject_note BEFORE INSERT ON annotations BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;");
    await h.save();
    expect(database.db.prepare('SELECT COUNT(*) AS total FROM annotations').get()).toEqual({ total: 0 });
    expect(database.db.prepare('SELECT COUNT(*) AS total FROM anchors').get()).toEqual({ total: 0 });
    expect(h.context.noteBody).toBe(rawBody); expect(h.context.noteDraft.annotation).toBeNull(); expect(h.context.saving).toBe(false);
    expect(h.alerts[0]?.[0]).toBe('笔记保存失败');
    database.db.exec('DROP TRIGGER reject_note;'); await h.save();
    expect(database.db.prepare('SELECT body FROM annotations').all()).toEqual([{ body: rawBody }]);
    expect(database.db.prepare('SELECT COUNT(*) AS total FROM anchors').get()).toEqual({ total: 1 });
    expect(h.context.noteDraft).toBeNull();
  });
  it('edits the existing ID without losing raw whitespace', async () => {
    const { database } = await setup('pdf'); const saved = await saveReaderAnnotation('owned-book', { ...epubInput, format: 'PDF', locator: { type: 'pdf', page: 7 }, body: 'before' });
    const h = pdfCallbackHarness(); h.context.noteDraft.annotation = { id: saved.annotationId }; await h.save();
    expect(database.db.prepare('SELECT id, body FROM annotations').all()).toEqual([{ id: saved.annotationId, body: rawBody }]);
  });
  it('does not publish a late failure after the reader owner closes', async () => {
    await setup('pdf'); const h = pdfCallbackHarness(); let reject!: (reason: Error) => void;
    h.context.saveReaderAnnotation = () => new Promise((_resolve, no) => { reject = no; });
    const pending = h.save(); h.owner.active = false; reject(new Error('late write failure')); await pending;
    expect(h.alerts).toEqual([]); expect(h.displayErrors).toEqual([]);
  });
});

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

describe('real React owner replacement and save operation ownership', () => {
  it.each([['commit', 'fileUri'], ['reject', 'fileUri'], ['commit', 'bookId'], ['reject', 'bookId']] as const)('recovers the reused hook after old save %s and a changed %s', async (outcome, changed) => {
    const { database, store } = await setup('pdf');
    await store.saveBook({ id: 'other-book', title: 'Reused next owner', format: 'pdf', sourceHash: 'reused-owner' });
    if (outcome === 'reject') database.db.exec("CREATE TRIGGER reject_old_owner BEFORE INSERT ON annotations WHEN NEW.body = 'old-owner' BEGIN SELECT RAISE(ABORT, 'old owner failure'); END;");
    const old = gate(); const started = gate(); let calls = 0;
    const h = await realPdfHookHarness({ saveReaderAnnotation: async (...args) => {
      if (++calls === 1) { started.release(); await old.promise; }
      return saveReaderAnnotation(...args);
    } });
    let pending: Promise<void> | undefined;
    try {
      await h.draft('old-owner'); await h.act(() => { pending = h.state.saveNote(); }); await started.promise;
      await h.render(changed === 'fileUri' ? { fileUri: 'file:///restored.pdf' } : { bookId: 'other-book' });
      expect(h.state.savingNote).toBe(false); expect(h.state.noteDraft).toBeNull(); expect(h.state.noteBody).toBe('');
      await h.act(async () => { old.release(); await pending; });
      expect(h.state.savingNote).toBe(false); expect(h.alerts).toEqual([]);
      await h.draft('new-owner'); await h.act(() => h.state.saveNote());
      expect(h.state.savingNote).toBe(false); expect(h.state.noteDraft).toBeNull();
      expect(database.db.prepare("SELECT body FROM annotations WHERE body = 'new-owner'").all()).toEqual([{ body: 'new-owner' }]);
      expect(database.db.prepare('SELECT COUNT(*) AS total FROM anchors').get()).toEqual({ total: outcome === 'commit' ? 2 : 1 });
      expect(calls).toBe(2);
    } finally { old.release(); await pending; await h.unmount(); }
  });

  it.each(['note', 'highlight', 'bookmark'] as const)('a retired %s finally cannot unlock the next owner saving a note', async kind => {
    const { database } = await setup('pdf');
    const old = gate(); const next = gate(); const started = gate(); let calls = 0;
    const h = await realPdfHookHarness({ saveReaderAnnotation: async (...args) => {
      if (++calls === 1) { started.release(); await old.promise; } else await next.promise;
      return saveReaderAnnotation(...args);
    } });
    const pending: Promise<void>[] = [];
    try {
      if (kind === 'note') await h.draft('old-owner');
      else if (kind === 'highlight') await h.act(() => h.state.setPaletteTarget({ quote: 'Old highlight', locator: { type: 'pdf', page: 2 }, annotation: null }));
      else await h.act(() => h.state.onEvent({ type: 'ready', pageCount: 12, outline: [] }));
      await h.act(() => { pending.push(kind === 'note' ? h.state.saveNote() : kind === 'highlight' ? h.state.pickColor('green') : h.state.toggleBookmark()); });
      await started.promise;
      await h.render({ fileUri: 'file:///restored.pdf' }); await h.draft('new-owner');
      await h.act(() => { pending.push(h.state.saveNote()); });
      expect(calls).toBe(2); expect(h.state.savingNote).toBe(true);
      await h.act(async () => { old.release(); await pending[0]; });
      expect(h.state.savingNote).toBe(true); expect(h.state.noteBody).toBe('new-owner');
      await h.act(() => { pending.push(h.state.saveNote()); });
      expect(calls).toBe(2);
      await h.act(async () => { next.release(); await Promise.all(pending); });
      expect(h.state.savingNote).toBe(false); expect(h.state.noteDraft).toBeNull(); expect(h.alerts).toEqual([]);
      expect(database.db.prepare('SELECT COUNT(*) AS total FROM annotations').get()).toEqual({ total: 2 });
      expect(database.db.prepare("SELECT body FROM annotations WHERE body = 'new-owner'").all()).toEqual([{ body: 'new-owner' }]);
    } finally { old.release(); next.release(); await Promise.all(pending); await h.unmount(); }
  });

  it('keeps the current route keyed remount independent of an old save', async () => {
    const { database, store } = await setup('pdf');
    await store.saveBook({ id: 'other-book', title: 'Next route', format: 'pdf', sourceHash: 'other-route' });
    const old = gate(); let calls = 0;
    const h = await realPdfHookHarness({ saveReaderAnnotation: async (...args) => { if (++calls === 1) await old.promise; return saveReaderAnnotation(...args); } });
    let pending: Promise<void> | undefined;
    try {
      await h.draft('old-owner'); await h.act(() => { pending = h.state.saveNote(); });
      await h.render({ bookId: 'other-book', fileUri: 'file:///other.pdf' }, 'other-book'); await h.draft('new-owner');
      await h.act(async () => { old.release(); await pending; });
      expect(h.state.savingNote).toBe(false); expect(h.state.noteBody).toBe('new-owner');
      await h.act(() => h.state.saveNote());
      expect(h.state.savingNote).toBe(false); expect(h.state.noteDraft).toBeNull(); expect(h.alerts).toEqual([]);
      expect(database.db.prepare('SELECT book_id, body FROM annotations ORDER BY book_id').all()).toEqual([{ book_id: 'other-book', body: 'new-owner' }, { book_id: 'owned-book', body: 'old-owner' }]);
    } finally { old.release(); await pending; await h.unmount(); }
  });
});

describe('PDF anchor and annotation write atomicity', () => {
  it.each(['note', 'highlight', 'bookmark'] as const)('rolls back failed %s and leaves prior records and another book byte-for-byte unchanged', async kind => {
    const { database, store } = await setup('pdf');
    await store.saveBook({ id: 'other-book', title: 'Preserved book', format: 'pdf', sourceHash: 'other-owned-fixture' });
    const input = { format: 'PDF' as const, kind, quote: 'owned new selection', locator: { type: 'pdf' as const, page: 7 }, page: 7, ...(kind === 'note' ? { body: rawBody } : {}) };
    await saveReaderAnnotation('owned-book', { ...input, kind: 'note', body: 'prior owned note' });
    await saveReaderAnnotation('other-book', { ...input, kind: 'note', body: 'other book note' });
    const snapshot = () => ['books', 'anchors', 'annotations'].map(table => database.db.prepare('SELECT * FROM ' + table + ' ORDER BY id').all());
    const before = snapshot();
    database.db.exec("CREATE TRIGGER reject_owned BEFORE INSERT ON annotations WHEN NEW.book_id = 'owned-book' BEGIN SELECT RAISE(ABORT, 'injected annotation insert failure'); END;");
    await expect(saveReaderAnnotation('owned-book', input)).rejects.toMatchObject({ cause: { message: 'injected annotation insert failure' } });
    expect(snapshot()).toEqual(before);
    database.db.exec('DROP TRIGGER reject_owned;');
    const saved = await saveReaderAnnotation('owned-book', input);
    expect(database.db.prepare('SELECT id, book_id, kind, body, anchor_id FROM annotations WHERE id = ?').get(saved.annotationId)).toEqual({ id: saved.annotationId, book_id: 'owned-book', kind, body: kind === 'note' ? rawBody : null, anchor_id: saved.anchorId });
    const after = snapshot();
    expect(after[0]).toEqual(before[0]);
    expect(after[1]!.filter((row: any) => row.id !== saved.anchorId)).toEqual(before[1]);
    expect(after[2]!.filter((row: any) => row.id !== saved.annotationId)).toEqual(before[2]);
  });
});

describe('real React and ReactDOM mounted PDF reader hook with SQLite', () => {
  it('cannot insert twice through the same save closure before React commits cleared state', async () => {
    const { database, failNextReload } = await setup('pdf'); const h = await realPdfHookHarness();
    try {
      await h.draft(); const sameRenderedSave = h.state.saveNote; failNextReload();
      await h.act(async () => { await sameRenderedSave(); await sameRenderedSave(); });
      expect(database.db.prepare('SELECT body FROM annotations').all()).toEqual([{ body: rawBody }]);
      expect(database.db.prepare('SELECT COUNT(*) AS total FROM anchors').get()).toEqual({ total: 1 });
    } finally { await h.unmount(); }
  });
  it('commits the cleared draft after reload failure and cannot insert through the next rendered save handler', async () => {
    const { database, failNextReload } = await setup('pdf'); const h = await realPdfHookHarness();
    try {
      await h.draft(); failNextReload(); await h.act(() => h.state.saveNote());
      expect(h.state.noteDraft).toBeNull(); expect(h.state.noteBody).toBe(''); expect(h.state.savingNote).toBe(false);
      expect(h.state.error).toBe('笔记已保存，显示更新失败；请重新打开阅读器查看。');
      await h.act(() => h.state.saveNote());
      expect(database.db.prepare('SELECT body FROM annotations').all()).toEqual([{ body: rawBody }]);
      expect(database.db.prepare('SELECT COUNT(*) AS total FROM anchors').get()).toEqual({ total: 1 });
      expect(h.alerts).toEqual([]);
    } finally { await h.unmount(); }
  });
  it('allows reopening and editing the same note, while both retired save callbacks stay inert', async () => {
    const { database } = await setup('pdf'); const h = await realPdfHookHarness();
    try {
      await h.draft(); const firstSave = h.state.saveNote; await h.act(() => firstSave());
      const id = database.db.prepare('SELECT id FROM annotations').get()!.id;
      const editedBody = ' \t第二次编辑\n ';
      await h.act(() => { h.state.onEvent({ type: 'annotation', id }); h.state.setNoteBody(editedBody); });
      const editSave = h.state.saveNote; await h.act(() => editSave());
      await h.act(async () => { await firstSave(); await editSave(); });
      expect(database.db.prepare('SELECT id, body FROM annotations').all()).toEqual([{ id, body: editedBody }]);
      expect(database.db.prepare('SELECT COUNT(*) AS total FROM anchors').get()).toEqual({ total: 1 });
      expect(h.state.noteDraft).toBeNull();
    } finally { await h.unmount(); }
  });
  it('keeps the real mounted draft after failed INSERT, then clears it on a single successful retry', async () => {
    const { database } = await setup('pdf'); const h = await realPdfHookHarness();
    try {
      await h.draft(); database.db.exec("CREATE TRIGGER reject_note BEFORE INSERT ON annotations BEGIN SELECT RAISE(ABORT, 'injected hook write failure'); END;");
      await h.act(() => h.state.saveNote());
      expect(h.state.noteDraft).not.toBeNull(); expect(h.state.noteBody).toBe(rawBody); expect(h.state.savingNote).toBe(false);
      expect(database.db.prepare('SELECT COUNT(*) AS total FROM anchors').get()).toEqual({ total: 0 });
      expect(h.alerts).toHaveLength(1);
      database.db.exec('DROP TRIGGER reject_note;'); await h.act(() => h.state.saveNote());
      expect(h.state.noteDraft).toBeNull(); expect(h.state.noteBody).toBe('');
      expect(database.db.prepare('SELECT body FROM annotations').all()).toEqual([{ body: rawBody }]);
      expect(database.db.prepare('SELECT COUNT(*) AS total FROM anchors').get()).toEqual({ total: 1 });
    } finally { await h.unmount(); }
  });
  it('ignores a failure delivered after real React unmount', async () => {
    const { database } = await setup('pdf'); let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const h = await realPdfHookHarness({ saveReaderAnnotation: async (...args) => { await gate; return saveReaderAnnotation(...args); } });
    await h.draft(); database.db.exec("CREATE TRIGGER reject_note BEFORE INSERT ON annotations BEGIN SELECT RAISE(ABORT, 'injected late hook failure'); END;");
    let pending!: Promise<void>;
    await h.act(() => { pending = h.state.saveNote(); });
    await h.unmount(); release(); await pending;
    expect(h.alerts).toEqual([]);
    expect(database.db.prepare('SELECT COUNT(*) AS total FROM annotations').get()).toEqual({ total: 0 });
    expect(database.db.prepare('SELECT COUNT(*) AS total FROM anchors').get()).toEqual({ total: 0 });
  });
});
