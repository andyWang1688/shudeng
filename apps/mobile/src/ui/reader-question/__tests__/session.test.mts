import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReaderQuestionRegistry, type CitationTarget, type ReaderOwner, type ReferenceCommand, type NavigationReceipt, type QuestionPresentation } from '../session.ts';

const origin = { type: 'epub' as const, cfi: 'epubcfi(/6/2!/4)' };
const citation = { locator: { type: 'epub' as const, cfi: 'epubcfi(/6/8!/4)' }, quote: '引用原文', ordinal: 2, id: 'E2' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function fixture(format: 'epub' | 'pdf' = 'epub') {
  let sequence = 0;
  const shown: QuestionPresentation[] = [];
  const fallback: Array<{ value: QuestionPresentation; target: CitationTarget; visitId: string }> = [];
  const navigated: ReferenceCommand[] = [];
  const dismissed: Array<[string, string]> = [];
  const control = { saved: true, documentFailed: false, flushes: 0,
    dismiss: async (_signal: AbortSignal) => true,
    navigate: async (command: ReferenceCommand): Promise<NavigationReceipt> => ({ operationId: command.operationId, status: 'arrived' }),
  };
  const registry = new ReaderQuestionRegistry(() => 'id-' + ++sequence, {
    dismissQuestion: (questionKey, readerKey, signal) => { dismissed.push([questionKey, readerKey]); return control.dismiss(signal); },
    presentQuestion: value => { shown.push(value); },
    presentReference: (value, target, visitId) => { fallback.push({ value, target, visitId }); },
  });
  const owner: ReaderOwner = { id: 'reader-A', routeKey: 'reader-route-A', bookId: 'same-book', format };
  registry.register(owner, {
    navigate: command => { navigated.push(command); return control.navigate(command); },
    flushProgress: async () => { control.flushes += 1; return control.saved; },
    documentFailed: () => control.documentFailed,
  });
  const initial = format === 'pdf' ? { type: 'pdf' as const, page: 4 } : origin;
  const presentation = registry.openQuestion(owner.id, { bookId: owner.bookId, theme: 'light', origin: initial });
  registry.bind(presentation)();
  return { registry, owner, presentation, shown, fallback, navigated, dismissed, control };
}

test('waits for sheet dismissal and the matching citation receipt, without presenting another reader', async () => {
  const f = fixture();
  const close = deferred<boolean>();
  const arrival = deferred<NavigationReceipt>();
  f.control.dismiss = () => close.promise;
  f.control.navigate = () => arrival.promise;
  const opened = f.registry.openReference(f.presentation, 'question-route', citation);
  assert.equal(f.navigated.length, 0);
  assert.equal(f.registry.readerSnapshot(f.owner.id).busy, true);
  close.resolve(true);
  await Promise.resolve();
  assert.equal(f.navigated.length, 1);
  assert.deepEqual(f.dismissed, [['question-route', 'reader-route-A']]);
  assert.equal(f.fallback.length, 0);
  arrival.resolve({ operationId: f.navigated[0]!.operationId, status: 'arrived' });
  assert.equal((await opened).status, 'opened');
  assert.equal(f.registry.readerSnapshot(f.owner.id).reference, f.presentation);
});

test('EPUB restores the fixed origin and waits for arrival before reopening the same presentation', async () => {
  const f = fixture();
  await f.registry.openReference(f.presentation, 'question-route', citation);
  const arrival = deferred<NavigationReceipt>();
  f.control.navigate = () => arrival.promise;
  const returned = f.registry.returnToQuestion(f.owner.id);
  await Promise.resolve();
  const command = f.navigated.at(-1)!;
  assert.deepEqual(command.locator, origin);
  assert.equal(command.citation, false);
  assert.equal(f.shown.length, 1);
  arrival.resolve({ operationId: command.operationId, status: 'arrived' });
  assert.equal((await returned).status, 'returned');
  assert.equal(f.shown.at(-1), f.presentation);
  assert.equal(f.control.flushes, 2);
});

test('EPUB ask reopens at citation B, retains reference through sheet dismissal, allows citation C, and only back restores A', async () => {
  const f = fixture();
  await f.registry.openReference(f.presentation, 'question-route', citation);
  assert.equal(f.registry.reopenActiveQuestion(f.owner.id), f.presentation);
  assert.equal(f.registry.reopenActiveQuestion(f.owner.id), f.presentation);
  assert.equal(f.shown.length, 2, 'repeated ask before mount presents once');
  assert.equal(f.navigated.length, 1, 'ask does not navigate from B to A');
  assert.equal(f.control.flushes, 0, 'ask does not flush or restore origin');
  assert.equal(f.registry.readerSnapshot(f.owner.id).reference, f.presentation);
  assert.equal((await f.registry.openReference(f.presentation, 'reopened-question', citation)).status, 'busy', 'a pending ask is not a mounted question');
  const unbind = f.registry.bind(f.presentation, 'reopened-question');
  f.registry.reopenActiveQuestion(f.owner.id);
  assert.equal(f.shown.length, 2, 'an existing question route is not presented twice');
  // Gesture-dismiss keeps the reader's questionOrigin/reference, just like native.
  unbind(); f.registry.prune(new Set(['reader-route-A']));
  assert.equal(f.registry.readerSnapshot(f.owner.id).reference, f.presentation);
  f.registry.reopenActiveQuestion(f.owner.id);
  const unbindAgain = f.registry.bind(f.presentation, 'question-again');
  const nextCitation = { ...citation, id: 'E3', locator: { type: 'epub' as const, cfi: 'epubcfi(/6/12!/4)' } };
  assert.equal((await f.registry.openReference(f.presentation, 'question-again', nextCitation)).status, 'opened');
  assert.deepEqual(f.navigated[1]!.locator, nextCitation.locator);
  assert.notEqual(f.navigated[1]!.operationId, f.navigated[0]!.operationId);
  assert.deepEqual(f.presentation.origin, origin);
  unbindAgain(); f.registry.prune(new Set(['reader-route-A']));
  assert.equal((await f.registry.returnToQuestion(f.owner.id)).status, 'returned');
  assert.deepEqual(f.navigated[2]!.locator, origin);
  assert.equal(f.navigated[2]!.citation, false);
  assert.equal(f.control.flushes, 2);
  assert.equal(f.registry.readerSnapshot(f.owner.id).reference, null);
  assert.equal(f.shown.at(-1), f.presentation);
});

test('cancelled dismissal of a second EPUB citation preserves the preceding reference state', async () => {
  const f = fixture();
  await f.registry.openReference(f.presentation, 'question-route', citation);
  f.registry.reopenActiveQuestion(f.owner.id);
  f.registry.bind(f.presentation, 'reopened-question');
  f.control.dismiss = async () => false;
  assert.equal((await f.registry.openReference(f.presentation, 'reopened-question', { ...citation, id: 'E3' })).status, 'failed');
  assert.equal(f.registry.readerSnapshot(f.owner.id).reference, f.presentation);
  assert.equal(f.navigated.length, 1);
  assert.equal(f.registry.readerSnapshot(f.owner.id).busy, false);
});

test('PDF reopens activeQuestion at the citation page, without EPUB origin restoration', async () => {
  const f = fixture('pdf');
  await f.registry.openReference(f.presentation, 'question-route', { ...citation, locator: { type: 'pdf', page: 40 } });
  assert.equal((await f.registry.returnToQuestion(f.owner.id)).status, 'returned');
  assert.equal(f.navigated.length, 1);
  assert.equal(f.navigated[0]!.locator.type, 'pdf');
  assert.equal(f.control.flushes, 0);
  assert.equal(f.shown.at(-1), f.presentation);
});

test('PDF explicit selection at a citation replaces activeQuestion instead of reopening the old question', async () => {
  const f = fixture('pdf');
  await f.registry.openReference(f.presentation, 'question-route', { ...citation, locator: { type: 'pdf', page: 40 } });
  const next = f.registry.openQuestion(f.owner.id, { bookId: 'same-book', theme: 'light', origin: { type: 'pdf', page: 40 },
    selection: { quote: '新的PDF选文', locator: { type: 'pdf', page: 40 } } });
  assert.notEqual(next.id, f.presentation.id);
  assert.notEqual(next.conversationId, f.presentation.conversationId);
  assert.equal(next.selectionQuote, '新的PDF选文');
  assert.equal(f.registry.readerSnapshot(f.owner.id).reference, null);
  f.registry.bind(next)();
  assert.equal((await f.registry.openReference(next, 'next-question', { ...citation, locator: { type: 'pdf', page: 50 } })).status, 'opened');
});

test('keeps draft, consumption markers, expansion, selection and visible scroll through unmount/reopen', async () => {
  const f = fixture();
  f.presentation.update({ draft: '未发的中文草稿', selection: { start: 2, end: 5 }, selectionConsumed: true, initialQuestionConsumed: true,
    expandedReasoning: ['answer-1'], expandedTools: ['answer-1'], expandedSelection: ['user-1'], scroll: { offset: 438, anchorId: 'answer-1', anchorOffset: -22 }, sheetDetent: 1, referenceFocus: 'answer-1:E2' });
  const snapshot = f.presentation.getSnapshot();
  await f.registry.openReference(f.presentation, 'question-route', citation);
  await f.registry.returnToQuestion(f.owner.id);
  const reopened = f.registry.get(f.shown.at(-1)!.id)!;
  assert.equal(reopened, f.presentation);
  assert.deepEqual(reopened.getSnapshot(), { ...snapshot, restoreReferenceFocus: true });
  assert.equal(reopened.conversationId, f.presentation.conversationId);
});

test('normal reopen keeps origin and conversation; an explicit selection replaces both presentation and origin', () => {
  const f = fixture();
  const same = f.registry.openQuestion(f.owner.id, { bookId: 'same-book', theme: 'dark', origin: citation.locator });
  assert.equal(same, f.presentation);
  assert.deepEqual(same.origin, origin);
  f.registry.bind(same)();
  const next = f.registry.openQuestion(f.owner.id, { bookId: 'same-book', theme: 'light', origin,
    selection: { quote: '新的选文', locator: citation.locator } });
  assert.notEqual(next.id, same.id);
  assert.notEqual(next.conversationId, same.conversationId);
  assert.deepEqual(next.origin, citation.locator);
  assert.equal(next.getSnapshot().draft, '');
  assert.equal(next.getSnapshot().selectionConsumed, false);
});

test('history references keep the question route and present a separate full-screen reader', async () => {
  const f = fixture();
  const history = f.registry.createHistory({ bookId: 'same-book', theme: 'light', origin: null, conversationId: 'saved-conversation' });
  await f.registry.openReference(history, 'history-question', citation);
  assert.equal(f.dismissed.length, 0);
  assert.equal(f.navigated.length, 0);
  assert.equal(f.fallback.length, 1);
});

test('history reference visits deduplicate same and different citations until the exact reader route closes', async () => {
  const f = fixture();
  const history = f.registry.createHistory({ bookId: 'same-book', theme: 'light', origin: null, conversationId: 'history' });
  const unbind = f.registry.bind(history, 'history-question');
  assert.equal((await f.registry.openReference(history, 'history-question', citation)).status, 'opened');
  const firstVisit = f.fallback[0]!.visitId;
  assert.equal((await f.registry.openReference(history, 'history-question', citation)).status, 'busy');
  assert.equal((await f.registry.openReference(history, 'history-question', { ...citation, id: 'E3' })).status, 'busy');
  f.registry.prune(new Set(['history-question', 'reference-reader', 'another-reader']), new Map([['history-question', history.id]]),
    new Map([['reference-reader', { presentationId: history.id, visitId: firstVisit }], ['another-reader', { presentationId: history.id, visitId: 'stale-visit' }]]));
  unbind(); // Activity cleanup must not release the visit.
  assert.equal((await f.registry.openReference(history, 'history-question', citation)).status, 'busy');
  f.registry.prune(new Set(['history-question', 'another-reader']));
  assert.equal((await f.registry.openReference(history, 'history-question', citation)).status, 'opened');
  assert.notEqual(f.fallback[1]!.visitId, firstVisit);
  assert.equal(f.fallback.length, 2);
  // A late old route/token must not bind the second visit or release its hold.
  f.registry.prune(new Set(['history-question', 'old-reference']), undefined, new Map([['old-reference', { presentationId: history.id, visitId: firstVisit }]]));
  f.registry.prune(new Set(['history-question']));
  assert.equal((await f.registry.openReference(history, 'history-question', citation)).status, 'busy');
  f.registry.prune(new Set(['tabs']));
  assert.equal(f.registry.get(history.id), undefined);
});

test('stale-source fallback visits deduplicate and release after the actual reference route is removed', async () => {
  const f = fixture();
  f.registry.bind(f.presentation, 'question-route');
  f.registry.disposeReader(f.owner.id);
  assert.equal((await f.registry.openReference(f.presentation, 'question-route', citation)).status, 'opened');
  assert.equal((await f.registry.openReference(f.presentation, 'question-route', citation)).status, 'busy');
  const visitId = f.fallback[0]!.visitId;
  f.registry.prune(new Set(['question-route', 'reference']), undefined, new Map([['reference', { presentationId: f.presentation.id, visitId }]]));
  f.registry.prune(new Set(['question-route']));
  assert.equal((await f.registry.openReference(f.presentation, 'question-route', citation)).status, 'opened');
});

test('a synchronous fallback presentation failure releases the visit for an explicit retry', async () => {
  let attempts = 0;
  const registry = new ReaderQuestionRegistry(() => String(++attempts), {
    dismissQuestion: async () => false, presentQuestion: () => {},
    presentReference: () => { throw new Error('question is no longer current'); },
  });
  const history = registry.createHistory({ bookId: 'book', theme: 'light', origin: null });
  registry.bind(history, 'question');
  assert.equal((await registry.openReference(history, 'question', citation)).status, 'failed');
  assert.equal((await registry.openReference(history, 'question', citation)).status, 'failed');
});

test('history presentation survives Activity effect cleanup while its question route still exists', () => {
  const f = fixture();
  const history = f.registry.createHistory({ bookId: 'same-book', theme: 'light', origin: null, conversationId: 'history' });
  history.update({ draft: '历史草稿', scroll: { offset: 312, anchorId: 'answer', anchorOffset: -18 } });
  const unbind = f.registry.bind(history, 'history-question');
  unbind();
  f.registry.prune(new Set(['tabs', 'history-question', 'reference-reader']));
  assert.equal(f.registry.get(history.id), history);
  const rebind = f.registry.bind(history, 'history-question');
  assert.deepEqual(history.getSnapshot().scroll, { offset: 312, anchorId: 'answer', anchorOffset: -18 });
  assert.equal(history.getSnapshot().draft, '历史草稿');
  rebind();
  f.registry.prune(new Set(['tabs']));
  assert.equal(f.registry.get(history.id), undefined);
});

test('closing and reopening a saved conversation keeps its unsent draft without retaining the old route', () => {
  const f = fixture();
  const input = { bookId: 'same-book', theme: 'light' as const, origin: null, conversationId: 'history-draft' };
  const first = f.registry.createHistory(input);
  const unbind = f.registry.bind(first, 'history-route');
  first.update({ draft: '未发送的追问', selection: { start: 2, end: 4 } });
  unbind();
  f.registry.prune(new Set(['tabs', 'reader-route-A']));
  assert.equal(f.registry.get(first.id), undefined, 'the removed presentation must still be collected');
  const reopened = f.registry.createHistory(input);
  assert.notEqual(reopened.id, first.id);
  assert.equal(reopened.getSnapshot().draft, '未发送的追问');
  assert.deepEqual(reopened.getSnapshot().selection, { start: 2, end: 4 });
  assert.equal(reopened.origin, null);
  assert.equal(reopened.source, null);
  assert.equal(f.registry.createHistory({ ...input, bookId: 'another-book' }).getSnapshot().draft, '');
  assert.equal(f.registry.createHistory({ ...input, conversationId: 'another-conversation' }).getSnapshot().draft, '');
});

test('a retained exit binding cannot overwrite the reopened conversation draft', () => {
  const f = fixture();
  const input = { bookId: 'same-book', theme: 'light' as const, origin: null, conversationId: 'history' };
  const old = f.registry.createHistory(input);
  const oldUnbind = f.registry.bind(old, 'old-route');
  old.update({ draft: '旧窗口的输入' });
  f.registry.prune(new Set(['tabs', 'reader-route-A']));
  const next = f.registry.createHistory(input);
  assert.equal(next.getSnapshot().draft, '旧窗口的输入');
  const nextUnbind = f.registry.bind(next, 'next-route');
  next.update({ draft: '新窗口继续输入' });
  old.update({ draft: '迟到的旧事件' });
  oldUnbind();
  assert.equal(f.registry.get(old.id), undefined);
  nextUnbind();
  f.registry.prune(new Set(['tabs', 'reader-route-A']));
  assert.equal(f.registry.createHistory(input).getSnapshot().draft, '新窗口继续输入');
});

test('clearing or explicitly replacing a draft and disposing the registry never resurrects old text', () => {
  const f = fixture();
  const input = { bookId: 'same-book', theme: 'light' as const, origin: null, conversationId: 'history' };
  const first = f.registry.createHistory(input);
  first.update({ draft: '不能复活' });
  const explicit = f.registry.createHistory({ ...input, initialQuestion: '' });
  assert.equal(explicit.getSnapshot().draft, '');
  explicit.update({ draft: '新的内容' });
  explicit.update({ draft: '' });
  assert.equal(f.registry.createHistory(input).getSnapshot().draft, '');
  const final = f.registry.createHistory(input);
  final.update({ draft: '本次运行的草稿' });
  f.registry.dispose();
  final.update({ draft: '销毁后的迟到事件' });
  assert.equal(f.registry.createHistory(input).getSnapshot().draft, '');
});

test('ordinary ask taps cannot enqueue a second sheet before mounting or while Activity hides it', () => {
  const f = fixture();
  f.registry.openQuestion(f.owner.id, { bookId: 'same-book', theme: 'light', origin });
  f.registry.openQuestion(f.owner.id, { bookId: 'same-book', theme: 'light', origin });
  assert.equal(f.shown.length, 2);
  const unbind = f.registry.bind(f.presentation, 'question-route');
  unbind();
  f.registry.openQuestion(f.owner.id, { bookId: 'same-book', theme: 'light', origin });
  assert.equal(f.shown.length, 2);
  f.registry.prune(new Set(['reader-route-A']));
  f.registry.openQuestion(f.owner.id, { bookId: 'same-book', theme: 'light', origin });
  assert.equal(f.shown.length, 3);
});

test('a question route removed before layout binding does not leave a permanent pending presentation', () => {
  const f = fixture();
  f.registry.openQuestion(f.owner.id, { bookId: 'same-book', theme: 'light', origin });
  f.registry.prune(new Set(['reader-route-A', 'question-route']), new Map([['question-route', f.presentation.id]]));
  f.registry.prune(new Set(['reader-route-A']));
  f.registry.openQuestion(f.owner.id, { bookId: 'same-book', theme: 'light', origin });
  assert.equal(f.shown.length, 3);
});

test('disposing a source before its pending question mounts releases the provisional hold', () => {
  const f = fixture();
  f.registry.openQuestion(f.owner.id, { bookId: 'same-book', theme: 'light', origin });
  f.registry.disposeReader(f.owner.id);
  assert.equal(f.registry.get(f.presentation.id), undefined);
});

test('two readers of one book never substitute for each other', async () => {
  const f = fixture();
  let otherNavigations = 0;
  f.registry.register({ ...f.owner, id: 'reader-B', routeKey: 'reader-route-B' }, {
    navigate: async command => { otherNavigations += 1; return { operationId: command.operationId, status: 'arrived' }; },
    flushProgress: async () => true, documentFailed: () => false,
  });
  await f.registry.openReference(f.presentation, 'question-route', citation);
  assert.equal(otherNavigations, 0);
  assert.equal(f.navigated.length, 1);
  f.registry.disposeReader(f.owner.id);
  await f.registry.openReference(f.presentation, 'question-route', citation);
  assert.equal(otherNavigations, 0);
  assert.equal(f.fallback.length, 1);
});

test('duplicate taps cannot dismiss twice or start concurrent navigation', async () => {
  const f = fixture();
  const close = deferred<boolean>(); f.control.dismiss = () => close.promise;
  const first = f.registry.openReference(f.presentation, 'question-route', citation);
  assert.equal((await f.registry.openReference(f.presentation, 'question-route', citation)).status, 'busy');
  assert.equal(f.dismissed.length, 1);
  close.resolve(true); await first;
  assert.equal(f.navigated.length, 1);
});

test('a cancelled dismissal does not navigate and keeps the current question usable', async () => {
  const f = fixture(); f.control.dismiss = async () => false;
  assert.equal((await f.registry.openReference(f.presentation, 'question-route', citation)).status, 'failed');
  assert.equal(f.navigated.length, 0);
  assert.equal(f.registry.readerSnapshot(f.owner.id).reference, null);
});

test('wrong operation receipts cannot count as arrival or reopen a question', async () => {
  const f = fixture(); f.control.navigate = async () => ({ operationId: 'old-operation', status: 'arrived' });
  assert.equal((await f.registry.openReference(f.presentation, 'question-route', citation)).status, 'failed');
  assert.equal((await f.registry.returnToQuestion(f.owner.id)).status, 'failed');
  assert.equal(f.shown.length, 1);
});

test('disposing an in-flight source invalidates late receipts without resurrecting a sheet', async () => {
  const f = fixture(); const arrival = deferred<NavigationReceipt>(); f.control.navigate = () => arrival.promise;
  const result = f.registry.openReference(f.presentation, 'question-route', citation);
  await Promise.resolve();
  const oldOperation = f.navigated[0]!.operationId;
  f.registry.disposeReader(f.owner.id);
  assert.equal((await result).status, 'failed');
  arrival.resolve({ operationId: oldOperation, status: 'arrived' }); await Promise.resolve();
  assert.equal(f.shown.length, 1);
  assert.equal(f.registry.readerSnapshot(f.owner.id).reference, null);
});

test('save failure retains the reference; only an explicit allowUnsaved return proceeds', async () => {
  const f = fixture(); await f.registry.openReference(f.presentation, 'question-route', citation);
  f.control.saved = false;
  assert.equal((await f.registry.returnToQuestion(f.owner.id)).status, 'save-failed');
  assert.equal(f.registry.readerSnapshot(f.owner.id).reference, f.presentation);
  assert.equal(f.navigated.length, 1);
  assert.equal((await f.registry.returnToQuestion(f.owner.id, true)).status, 'returned');
  assert.equal(f.navigated.length, 2);
});

test('broken EPUB resource can return to the question without requiring a successful origin navigation', async () => {
  const f = fixture(); await f.registry.openReference(f.presentation, 'question-route', citation);
  f.control.documentFailed = true;
  assert.equal((await f.registry.returnToQuestion(f.owner.id)).status, 'returned');
  assert.equal(f.navigated.length, 1);
  assert.equal(f.shown.at(-1), f.presentation);
});

test('source lifetime follows actual route keys; normal chat unmount does not discard its state', () => {
  const f = fixture(); f.presentation.update({ draft: '保留' });
  f.registry.prune(new Set(['reader-route-A', 'question-route']));
  assert.equal(f.registry.get(f.presentation.id)?.getSnapshot().draft, '保留');
  f.registry.prune(new Set(['tabs']));
  assert.equal(f.registry.get(f.presentation.id), undefined);
});
