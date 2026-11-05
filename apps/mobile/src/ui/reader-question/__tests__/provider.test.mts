import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { QuestionPresentation, ReaderQuestionRegistry } from '../session.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { StackRouter } = require('expo-router/build/react-navigation/routers/StackRouter.js');
const providerFile = fileURLToPath(new URL('../ReaderQuestionProvider.tsx', import.meta.url));
const providerCode = ts.transpileModule(readFileSync(providerFile, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const target = { locator: { type: 'epub' as const, cfi: 'epubcfi(/6/8!/4)' }, quote: 'citation', ordinal: 1, id: 'E1' };

/** Public Provider contract harness. Hook storage and route actions are modeled;
 * native transitions and actual React Activity scheduling require device acceptance. */
function harness(wrapRoot = false) {
  let context: any;
  let sequence = 0;
  let slots: any[] = [];
  let cursor = 0;
  let queued: Array<() => void> = [];
  const scopes = new Map<string, any[]>();
  const stack = StackRouter({ initialRouteName: 'book-chat' });
  let rootState: any = { type: 'stack', key: 'root', routeKeySeq: 0, index: 0, routeNames: ['book-chat', 'reader/[id]', 'settings/ai-service'], routes: [{ key: 'question', name: 'book-chat', params: {} }] };
  const action = (value: any) => { rootState = stack.getStateForAction(rootState, value, { routeParamList: {}, routeGetIdList: {} }).state; };
  const effect = (callback: () => void | (() => void), deps: unknown[]) => {
    const index = cursor++;
    const old = slots[index];
    if (old && deps.length === old.deps.length && deps.every((value, i) => Object.is(value, old.deps[i]))) return;
    const cell = { deps, cleanup: old?.cleanup };
    slots[index] = cell;
    queued.push(() => { cell.cleanup?.(); cell.cleanup = callback(); });
  };
  const react = {
    createContext: () => ({ Provider: 'provider' }), useContext: () => context,
    useCallback: (callback: any) => callback,
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
    useEffect: effect, useLayoutEffect: effect,
    useRef: (value: any) => { const index = cursor++; return slots[index] ?? (slots[index] = { current: value }); },
    useState: (value: any) => { const index = cursor++; if (!slots[index]) slots[index] = { value: typeof value === 'function' ? value() : value }; return [slots[index].value, () => {}]; },
  };
  const compiled: any = new Module(providerFile);
  compiled.filename = providerFile;
  compiled.require = (id: string) => {
    if (id === 'react') return react;
    if (id === 'react/jsx-runtime') return { jsx: (type: any, props: any) => ({ type, props }) };
    if (id === 'react-native') return { Alert: { alert() {} }, Keyboard: { dismiss() {} } };
    if (id === 'expo-router') return { useRootNavigationState: () => wrapRoot ? {
      type: 'stack', key: 'expo-container', index: 0, routeNames: ['__root'],
      routes: [{ key: '__root:-0', name: '__root', state: rootState }],
    } : rootState, useRouter: () => ({
      push: ({ pathname, params }: any) => action({ type: 'PUSH', payload: { name: pathname.slice(1), params } }),
      back: () => action({ type: 'POP', payload: { count: 1 } }),
    }) };
    if (id.endsWith('library/conversations')) return { createBookConversationId: () => 'provider-' + ++sequence };
    if (id === './session') return { ReaderQuestionRegistry, QuestionPresentation };
    throw new Error('Unexpected dependency: ' + id);
  };
  compiled._compile(providerCode, providerFile);
  const api = compiled.exports;
  function scope<T>(id: string, callback: () => T): T {
    slots = scopes.get(id) ?? []; scopes.set(id, slots); cursor = 0; queued = [];
    const result = callback();
    const effects = queued; queued = [];
    for (const run of effects) run();
    return result;
  }
  function render() { scope('provider', () => { context = api.ReaderQuestionProvider({ children: null }).props.value; }); }
  render();
  return {
    get registry(): ReaderQuestionRegistry { return context.registry; },
    get state() { return rootState; },
    render, action,
    unmount(id: string) {
      for (const cell of scopes.get(id) ?? []) if (typeof cell?.cleanup === 'function') cell.cleanup();
      scopes.delete(id);
    },
    setReaderRoot() { rootState = { ...rootState, index: 0, routes: [{ key: 'source-reader', name: 'reader/[id]', params: { id: 'book' } }] }; render(); },
    setQuestionToken(id: string) {
      rootState = { ...rootState, routes: rootState.routes.map((route: any, i: number) => i === rootState.index ? { ...route, params: { ...route.params, questionPresentationId: id } } : route) };
      render();
    },
    transition(target: string, closing = false) { context.transitionEnd({ target, data: { closing } }); },
    subscribe(id: string, presentation: QuestionPresentation, callback: () => void) { scope(id, () => api.useQuestionAppearance(presentation, callback)); },
    presentation(id: string, input: any): QuestionPresentation { return scope(id, () => api.useQuestionPresentation(input)); },
    citation(id: string, presentation: QuestionPresentation): (value: typeof target) => void { return scope(id, () => api.useOpenQuestionCitation(presentation)); },
    readerQuestions(id: string, input: any): any { return scope(id, () => api.useReaderQuestions(input)); },
  };
}

for (const wrapRoot of [false, true]) describe(wrapRoot ? 'Expo root wrapper' : 'flat app stack', () => {
test('Provider replays a completed question appearance to a list mounted after loading', () => {
  const h = harness(wrapRoot);
  const presentation = h.registry.createHistory({ bookId: 'book', theme: 'light', origin: null });
  h.registry.bind(presentation, 'question'); h.setQuestionToken(presentation.id);
  h.transition('question');
  let received = 0;
  h.subscribe('late-list', presentation, () => { received++; });
  assert.equal(received, 1);
});

test('an unrelated removed route cannot confirm a newly opening question appearance', () => {
  const h = harness(wrapRoot);
  const presentation = h.registry.createHistory({ bookId: 'book', theme: 'light', origin: null });
  h.registry.bind(presentation, 'question'); h.setQuestionToken(presentation.id);
  let received = 0;
  h.subscribe('not-yet-appeared', presentation, () => { received++; });
  h.transition('removed-old-route', true);
  assert.equal(received, 0);
  h.subscribe('late-not-yet-appeared', presentation, () => { received++; });
  assert.equal(received, 0);
  h.transition('question');
  assert.equal(received, 2);
});

test('history visit pushes once with an explicit token, releases on actual route removal, and restores current appearance', async () => {
  const h = harness(wrapRoot);
  const presentation = h.registry.createHistory({ bookId: 'book', theme: 'light', origin: null });
  h.registry.bind(presentation, 'question'); h.setQuestionToken(presentation.id);
  h.transition('question');
  const [first, second] = await Promise.all([h.registry.openReference(presentation, 'question', target), h.registry.openReference(presentation, 'question', { ...target, id: 'E2' })]);
  assert.equal(first.status, 'opened'); assert.equal(second.status, 'busy');
  const reader = h.state.routes[h.state.index];
  assert.equal(h.state.routes.filter((route: any) => route.name === 'reader/[id]').length, 1);
  assert.equal(typeof reader.params.questionReferenceVisitId, 'string');
  h.render();
  let hidden = 0;
  h.subscribe('hidden-list', presentation, () => { hidden++; });
  h.transition(reader.key); h.transition('question');
  assert.equal(hidden, 0, 'a reader with the same presentation token is not a question appearance');
  h.action({ type: 'POP', payload: { count: 1 } }); h.render();
  let early = 0;
  h.subscribe('before-close-completes', presentation, () => { early++; });
  assert.equal(early, 0, 'route state alone is not a completed transition');
  h.transition('removed-old-route', true);
  assert.equal(hidden, 0); assert.equal(early, 0, 'only this visit reader can confirm the return');
  h.transition(reader.key, true);
  assert.equal(hidden, 1); assert.equal(early, 1);
  let late = 0;
  h.subscribe('after-close-completes', presentation, () => { late++; });
  assert.equal(late, 1);
  assert.equal((await h.registry.openReference(presentation, 'question', target)).status, 'opened');
  assert.notEqual(h.state.routes[h.state.index].params.questionReferenceVisitId, reader.params.questionReferenceVisitId);
});

test('covering or removing the question invalidates replay, including late old transition events', () => {
  const h = harness(wrapRoot);
  const presentation = h.registry.createHistory({ bookId: 'book', theme: 'light', origin: null });
  h.registry.bind(presentation, 'question'); h.setQuestionToken(presentation.id); h.transition('question');
  h.action({ type: 'PUSH', payload: { name: 'settings/ai-service', params: { questionPresentationId: presentation.id } } }); h.render();
  h.transition('question');
  let received = 0;
  h.subscribe('covered-list', presentation, () => { received++; });
  assert.equal(received, 0);
  h.action({ type: 'POP', payload: { count: 1 } }); h.render();
  h.subscribe('not-yet-returned-list', presentation, () => { received++; });
  assert.equal(received, 0);
});

test('unknown or mismatched presentation tokens create an independent history presentation', () => {
  const h = harness(wrapRoot);
  const known = h.registry.createHistory({ bookId: 'book-A', conversationId: 'conversation-A', theme: 'light', origin: null });
  const unknown = h.presentation('unknown', { presentationId: 'missing', bookId: 'book-A', theme: 'light', origin: null });
  const wrongBook = h.presentation('wrong-book', { presentationId: known.id, bookId: 'book-B', theme: 'light', origin: null });
  const wrongConversation = h.presentation('wrong-conversation', { presentationId: known.id, bookId: 'book-A', conversationId: 'conversation-B', theme: 'light', origin: null });
  assert.notEqual(unknown.id, 'missing');
  assert.notEqual(wrongBook.id, known.id); assert.equal(wrongBook.bookId, 'book-B');
  assert.notEqual(wrongConversation.id, known.id); assert.equal(wrongConversation.conversationId, 'conversation-B');
});

test('EPUB hook keeps bottom ask separate from the origin-restoring back action', async () => {
  const h = harness(wrapRoot); h.setReaderRoot();
  const origin = { type: 'epub' as const, cfi: 'epubcfi(/6/2!/4)' };
  const navigated: any[] = []; let flushes = 0;
  const questions = h.readerQuestions('source-hook', { bookId: 'book', format: 'epub', theme: 'light',
    getLocator: () => origin, documentFailed: false, flushProgress: async () => { flushes++; return true; },
    navigate: async (command: any) => { navigated.push(command); return { operationId: command.operationId, status: 'arrived' }; },
  });
  questions.ask(); h.render();
  const questionRoute = h.state.routes[h.state.index];
  const presentation = h.registry.get(questionRoute.params.questionPresentationId)!;
  const unbind = h.registry.bind(presentation, questionRoute.key);
  const opened = h.registry.openReference(presentation, questionRoute.key, target);
  h.render(); h.transition(questionRoute.key, true); await opened;
  unbind(); h.registry.prune(new Set(['source-reader']));
  questions.ask(); questions.ask(); h.render();
  assert.equal(h.state.routes.filter((route: any) => route.name === 'book-chat').length, 1);
  assert.equal(navigated.length, 1); assert.equal(flushes, 0);
  assert.equal(h.registry.readerSnapshot(questions.readerSessionId).reference, presentation);
  // Dismiss the directly re-presented question, then use the distinct top back action.
  h.action({ type: 'POP', payload: { count: 1 } }); h.render();
  assert.equal(await questions.returnToQuestion(), true);
  assert.equal(navigated.length, 2); assert.deepEqual(navigated[1].locator, origin);
  assert.equal(flushes, 2);
  assert.equal(h.registry.readerSnapshot(questions.readerSessionId).reference, null);
});

test('ordinary question reopens after route removal with retained effects', () => {
  const h = harness(wrapRoot); h.setReaderRoot();
  const origin = { type: 'epub' as const, cfi: 'epubcfi(/6/2!/4)' };
  const questions = h.readerQuestions('source-reader-hook', { bookId: 'book', format: 'epub', theme: 'light',
    getLocator: () => origin, documentFailed: false, flushProgress: async () => true,
    navigate: async (command: any) => ({ operationId: command.operationId, status: 'arrived' }),
  });
  questions.ask(); h.render();
  const firstRoute = h.state.routes[h.state.index];
  const presentation = h.presentation('exiting-question-hook', {
    presentationId: firstRoute.params.questionPresentationId, bookId: 'book', theme: 'light', origin,
  });
  presentation.update({ draft: 'keep this draft' });
  h.transition(firstRoute.key);
  h.action({ type: 'POP', payload: { count: 1 } }); h.render(); h.transition(firstRoute.key, true);
  assert.equal(presentation.routeKeys.size, 0, 'the real router removed the dismissed question');
  assert.equal(presentation.bindings, 1, 'the native exiting scene may retain hook effects after route removal');
  questions.ask(); questions.ask(); h.render();
  const nextRoute = h.state.routes[h.state.index];
  assert.equal(nextRoute.name, 'book-chat', 'the visible bottom ask must reopen the dismissed question');
  assert.notEqual(nextRoute.key, firstRoute.key);
  assert.equal(nextRoute.params.questionPresentationId, presentation.id);
  assert.equal(presentation.getSnapshot().draft, 'keep this draft');
  assert.equal(h.state.routes.filter((route: any) => route.name === 'book-chat').length, 1, 'two taps still present once');
  const reopened = h.presentation('new-question-hook', {
    presentationId: nextRoute.params.questionPresentationId, bookId: 'book', theme: 'light', origin,
  });
  assert.equal(reopened, presentation);
  assert.equal(presentation.bindings, 2);
  h.unmount('exiting-question-hook');
  assert.equal(presentation.bindings, 1, 'late cleanup releases only the old effect');
  assert.equal(h.registry.get(presentation.id), presentation);
  assert.deepEqual([...presentation.routeKeys], [nextRoute.key]);
  let appeared = 0;
  h.subscribe('reopened-list', presentation, () => { appeared++; });
  h.transition(firstRoute.key, true);
  assert.equal(appeared, 0, 'late old closing events cannot confirm the newly opening question');
  h.transition(nextRoute.key);
  assert.equal(appeared, 1);
  questions.ask(); h.render();
  assert.equal(h.state.routes.filter((route: any) => route.name === 'book-chat').length, 1);
});

test('the citation hook dismisses the app question route and reaches the owning reader', async () => {
  const h = harness(wrapRoot); h.setReaderRoot();
  const origin = { type: 'epub' as const, cfi: 'epubcfi(/6/2!/4)' };
  const navigated: any[] = [];
  const questions = h.readerQuestions('source-citation-hook', { bookId: 'book', format: 'epub', theme: 'light',
    getLocator: () => origin, documentFailed: false, flushProgress: async () => true,
    navigate: async (command: any) => { navigated.push(command); return { operationId: command.operationId, status: 'arrived' }; },
  });
  questions.ask(); h.render();
  const route = h.state.routes[h.state.index];
  const presentation = h.presentation('question-citation-hook', {
    presentationId: route.params.questionPresentationId, bookId: 'book', theme: 'light', origin,
  });
  h.citation('citation-hook', presentation)(target);
  assert.equal(h.state.routes[h.state.index].key, 'source-reader', 'citation must dismiss the app Stack question');
  assert.equal(navigated.length, 0, 'reader navigation must wait for this question to finish closing');
  h.render(); h.transition(route.key, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(navigated.length, 1);
  assert.deepEqual(navigated[0].locator, target.locator);
  assert.equal(h.registry.readerSnapshot(questions.readerSessionId).reference, presentation);
});
});

