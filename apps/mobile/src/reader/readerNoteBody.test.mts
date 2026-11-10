import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

// Execute the actual persistence callbacks, with platform I/O injected. These
// tests cover the save boundary, without claiming to mount a reader or its UI.
function saveCallback(format: 'EPUB' | 'PDF') {
  const path = new URL(format === 'EPUB' ? './useReaderState.ts' : './pdf/usePdfReader.ts', import.meta.url);
  const source = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  let callback: any;
  let refresh: any;
  let chapterHelper: any;
  const visit = (node: any) => {
    if (format === 'EPUB' && ts.isFunctionDeclaration(node) && node.name?.text === 'annotationChapter') chapterHelper = node;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'saveNote') {
      assert.ok(ts.isCallExpression(node.initializer));
      callback = node.initializer.arguments[0];
    }
    if (format === 'EPUB' && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'refreshSavedAnnotations') refresh = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(callback, 'reader must expose its real saveNote callback');
  return ts.transpileModule((chapterHelper ? chapterHelper.getText(source) : '') + (refresh ? 'const refreshSavedAnnotations = ' + refresh.getText(source) + ';' : '') + 'module.exports = ' + callback.getText(source) + ';', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function harness(format: 'EPUB' | 'PDF', editing: boolean, body: string, failFirst = false) {
  const locator = format === 'EPUB' ? { type: 'epub', cfi: 'epubcfi(/6/4!/4/2)' } : { type: 'pdf', page: 7 };
  const selection = { quote: '原文', locator };
  const annotation = { id: 'existing-note', kind: 'note', body: '旧正文', ...selection };
  const created: any[] = [];
  const updated: any[] = [];
  const failures: any[][] = [];
  let attempts = 0;
  let refreshed = 0;
  let cleared = 0;
  const maybeFail = () => { if (++attempts === 1 && failFirst) throw new Error('disk full'); };
  const context: any = {
    module: { exports: null },
    bookId: 'book-id', fileUri: 'file:///owned.pdf', chapter: '章节', noteBody: body,
    currentChapter: { current: '章节' },
    annotationOwner: { current: { active: true, bookId: 'book-id', fileUri: 'file:///owned.pdf' } },
    readerOwner: { current: { active: true, bookId: 'book-id' } },
    noteSaveOperation: { current: null },
    ownsReaderUI: (owner: any) => owner.active && context.readerOwner.current === owner,
    ownsAnnotationUI: (owner: any) => owner.active && context.annotationOwner.current === owner,
    setError() {},
    selectionActionsEnabled: { current: true },
    selection: editing ? null : selection, noteSelection: editing ? null : selection,
    editingAnnotation: editing ? annotation : null,
    noteDraft: { ...selection, annotation: editing ? annotation : null },
    savingNoteRef: { current: false }, saveInFlight: { current: false }, saveOperation: { current: null },
    committedNoteDrafts: { current: new WeakSet() },
    preferredColor: { current: 'yellow' }, saving: false,
    setSavingNote(value: boolean) { context.saving = value; },
    setNoteBody(value: string) { context.noteBody = value; },
    setSelection(value: any) { context.selection = value; },
    setNoteSelection(value: any) { context.noteSelection = value; },
    setEditingAnnotation(value: any) { context.editingAnnotation = value; },
    setNoteDraft(value: any) { context.noteDraft = value; },
    saveReaderAnnotation: async (bookId: string, input: any) => { maybeFail(); created.push({ bookId, ...input }); },
    updateReaderAnnotation: async (id: string, patch: any) => { maybeFail(); updated.push({ id, ...patch }); },
    refreshAnnotations: async () => { refreshed++; },
    readerRef: { current: { clearSelection() { cleared++; } } },
    clearSelection() { cleared++; }, showNotice() {},
    message: (cause: Error) => cause.message,
    Alert: { alert: (...args: string[]) => failures.push(args) },
    persistError: (title: string, cause: Error) => failures.push([title, cause.message]),
  };
  runInNewContext(saveCallback(format), context);
  return { context, created, updated, failures, locator,
    get refreshed() { return refreshed; }, get cleared() { return cleared; },
    save: () => context.module.exports() };
}

for (const editing of [false, true]) {
  test(`EPUB ${editing ? 'edited' : 'new'} note remains saved when its display reload fails, and retries only the read`, async () => {
    const h = harness('EPUB', editing, rawBody);
    let reads = 0;
    h.context.refreshAnnotations = async () => {
      if (++reads === 1) throw new Error('display read unavailable');
    };
    assert.equal(await h.save(), true, 'durable success closes the editor');
    assert.equal(h.created.length + h.updated.length, 1);
    assert.equal(h.context.noteBody, '');
    assert.equal(h.cleared, 1);
    assert.equal(h.context.saving, false);
    assert.equal(h.failures.length, 1);
    assert.match(h.failures[0][0], /笔记已保存/);
    assert.match(h.failures[0][1], /显示.*失败|显示.*未能/);
    const retry = h.failures[0][2].find((button: any) => button.text === '重试显示');
    assert.ok(retry);
    await retry.onPress();
    assert.equal(reads, 2);
    assert.equal(h.created.length + h.updated.length, 1, 'retry never saves again');
    assert.equal(h.failures.length, 1);
  });
}

test('EPUB display retry stays available after another read failure and is revoked when its reader retires', async () => {
  const h = harness('EPUB', true, rawBody);
  let reads = 0;
  h.context.refreshAnnotations = async () => {
    reads++;
    throw new Error('display read unavailable');
  };
  assert.equal(await h.save(), true);
  const retry = () => h.failures.at(-1)[2].find((button: any) => button.text === '重试显示').onPress;
  await retry()();
  assert.equal(reads, 2);
  assert.equal(h.failures.length, 2, 'another read failure is visible');
  const oldRetry = retry();
  h.context.readerOwner.current.active = false;
  h.context.readerOwner.current = { active: true, bookId: 'another-book' };
  await oldRetry();
  assert.equal(reads, 2, 'retired alert cannot start another read');
  assert.equal(h.failures.length, 2);
  assert.equal(h.updated.length, 1);
});

test('EPUB note display completion cannot close the replacement reader editor', async () => {
  const h = harness('EPUB', true, rawBody);
  let release!: () => void;
  let refreshing = false;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  h.context.refreshAnnotations = () => { refreshing = true; return waiting; };
  const save = h.save();
  while (!refreshing) await Promise.resolve();
  h.context.readerOwner.current.active = false;
  h.context.readerOwner.current = { active: true, bookId: 'replacement-book' };
  h.context.noteBody = '下一本书的未保存正文';
  release();
  assert.equal(await save, false, 'retired caller must not close a replacement editor');
  assert.equal(h.context.noteBody, '下一本书的未保存正文');
  assert.equal(h.updated.length, 1);
  assert.deepEqual(h.failures, []);
});

const rawBody = ' \t\n第一行\r\n第二行\u3000 \n';
for (const format of ['EPUB', 'PDF'] as const) {
  for (const editing of [false, true]) {
    test(format + (editing ? ' edits' : ' creates') + ' notes with the entered whitespace intact', async () => {
      const h = harness(format, editing, rawBody);
      await h.save();
      assert.deepEqual(h.failures, []);
      if (editing) {
        assert.deepEqual(h.updated, [{ id: 'existing-note', body: rawBody }]);
        assert.equal(h.created.length, 0, 'editing keeps the original annotation identity');
      } else {
        assert.equal(h.updated.length, 0);
        assert.equal(h.created.length, 1);
        assert.equal(h.created[0].body, rawBody);
        assert.equal(h.created[0].quote, '原文');
        assert.deepEqual(h.created[0].locator, h.locator);
      }
      assert.equal(h.refreshed, 1);
      assert.equal(h.cleared, 1);
      assert.equal(h.context.noteBody, '');
      assert.equal(h.context.saving, false);
    });
  }

  test(format + ' rejects whitespace-only new and edited notes without writes or closing the draft', async () => {
    for (const editing of [false, true]) {
      const h = harness(format, editing, ' \t\r\n\u3000 ');
      await h.save();
      assert.deepEqual(h.created, []);
      assert.deepEqual(h.updated, []);
      assert.equal(h.refreshed, 0);
      assert.equal(h.cleared, 0);
      assert.equal(h.context.noteBody, ' \t\r\n\u3000 ');
      assert.equal(h.context.saving, false);
    }
  });

  test(format + ' retains the complete draft on save failure and retries the same raw body', async () => {
    const h = harness(format, true, rawBody, true);
    await h.save();
    assert.equal(h.failures.length, 1);
    assert.equal(h.failures[0][1], 'disk full');
    assert.deepEqual(h.updated, []);
    assert.equal(h.refreshed, 0);
    assert.equal(h.cleared, 0);
    assert.equal(h.context.noteBody, rawBody);
    assert.equal(h.context.saving, false);
    assert.equal(h.context.savingNoteRef.current, false);
    assert.equal(h.context.saveInFlight.current, false);
    await h.save();
    assert.deepEqual(h.updated, [{ id: 'existing-note', body: rawBody }]);
    assert.equal(h.refreshed, 1);
    assert.equal(h.cleared, 1);
  });
}
