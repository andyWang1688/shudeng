import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { test } from 'node:test';
import { conversationSections, conversationTitle, initialCollapsed, mergeRuntimeConversations } from './model.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const model = { conversationSections, conversationTitle, initialCollapsed, mergeRuntimeConversations };
const item = (id: string, bookId: string, updatedAt: number, extra: any = {}) => ({
  conversationId: id, bookId, updatedAt, question: '问题-' + id, answer: '回答-' + id, turns: 2, submittedCount: 1, assistantIds: [id + ':assistant'], ...extra,
});
const book = (id: string) => ({ id, title: '书名-' + id, format: 'EPUB', removed: false });
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function load(path: string, mocks: Record<string, any>) {
  const file = new URL(path, import.meta.url);
  const compiled: any = new Module(file.pathname);
  compiled.require = (id: string) => { if (!(id in mocks)) throw Error('Unmocked ' + id); return mocks[id]; };
  compiled._compile(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, file.pathname);
  return compiled.exports;
}
function hooks() {
  const slots: any[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const differs = (a: any[], b: any[]) => !a || !b || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
  const api: any = {
    useState(initial: any) { const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, (next: any) => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
    useRef(initial: any) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo(factory: any, deps: any[]) { const i = cursor++; if (!slots[i] || differs(slots[i].deps, deps)) slots[i] = { deps, value: factory() }; return slots[i].value; },
    useCallback(callback: any, deps: any[]) { return api.useMemo(() => callback, deps); },
    useEffect(effect: any, deps: any[]) { const i = cursor++; if (!slots[i] || differs(slots[i].deps, deps)) {
      const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = effect(); });
    } },
    useSyncExternalStore(_subscribe: any, get: any) { return get(); },
  };
  return { api, render(operation: any) { cursor = 0; const result = operation(); const next = effects; effects = []; next.forEach(effect => effect()); return result; },
    unmount() { slots.forEach(slot => slot.cleanup?.()); } };
}

test('first expansion chooses the latest real timestamp while an existing empty preference keeps all groups closed', () => {
  const items = [item('old', 'a', 1), item('latest', 'b', 10), item('middle', 'a', 3)];
  assert.deepEqual(initialCollapsed(items, null), { a: true, b: false });
  assert.deepEqual(initialCollapsed(items, {}), { a: true, b: true });
  assert.deepEqual(initialCollapsed(items, { a: false, bogus: 'not a boolean' }), { a: false, b: true });
});

test('search expands matches transiently, restores saved folds, and does not search unrelated intermediate turns', () => {
  const items = [item('old', 'a', 1, { searchText: 'intermediate-only' }), item('latest', 'b', 10, { bookTitle: '原书快照', answer: 'LATEST answer' }), item('middle', 'a', 3)];
  const books = [book('a'), book('b')];
  assert.deepEqual(conversationSections(items, books, '', { a: true, b: false }).map(section => [section.bookId, section.count, section.data.length]), [['b', 1, 1], ['a', 2, 0]]);
  assert.equal(conversationSections(items, books, 'intermediate-only', {}).length, 0);
  const matching = conversationSections(items, books, ' 原书快照 ', { b: true });
  assert.equal(matching[0].data[0].conversationId, 'latest');
  assert.equal(matching[0].collapsed, false);
  assert.equal(conversationSections(items, books, '', { b: true })[0].collapsed, true);
});

test('removed books keep their original snapshot and conversations without exposing a current cover', () => {
  const sections = conversationSections([item('one', 'a', 1, { bookTitle: '历史书名' })], [{ ...book('a'), title: '当前书名', removed: true }], '', { a: false });
  assert.equal(sections[0].title, '历史书名');
  assert.equal(sections[0].book, null);
  assert.equal(sections[0].count, 1);
  assert.equal(conversationTitle(item('empty', 'a', 1, { question: '' })), '未填写的问题');
  assert.equal(conversationTitle(item('long', 'a', 1, { question: '字'.repeat(60) })), '字'.repeat(48));
});

test('runtime overlays preserve first question/title and never count a persisted partial assistant twice', () => {
  const persisted = item('one', 'a', 1, { title: '首个对话名', bookTitle: '首轮书名' });
  const record: any = { conversationId: 'one', bookId: 'a', bookTitle: '后续元数据', updatedAt: 8, running: false,
    turn: { id: 'one:assistant', sourceQuestion: '后续问题', text: '实时答案', saveError: '磁盘满' } };
  let merged = mergeRuntimeConversations([persisted], [record]);
  assert.equal(merged[0].submittedCount, 1);
  assert.equal(merged[0].question, persisted.question);
  assert.equal(merged[0].bookTitle, '首轮书名');
  assert.equal(merged[0].unsaved, true);
  merged = mergeRuntimeConversations([persisted], [{ ...record, turn: { ...record.turn, id: 'new-turn' } }]);
  assert.equal(merged[0].submittedCount, 2);
  const unsavedNew = mergeRuntimeConversations([], [record])[0];
  assert.equal(unsavedNew.question, '后续问题');
  assert.equal(unsavedNew.submittedCount, 1);
  assert.equal(mergeRuntimeConversations([], [{ ...record, turn: { ...record.turn, saveError: undefined } }])[0].unsaved, true, 'a new runtime conversation is unsaved before its first disk write');
  assert.equal(mergeRuntimeConversations([persisted], [{ ...record, turn: { ...record.turn, saveError: undefined } }])[0].unsaved, false, 'a persisted turn with no save error is not fabricated as unsaved');
});

function listHarness(options: any = {}) {
  const react = hooks();
  let records = options.items ?? [item('one', 'a', 1)];
  let failLoad = options.failLoad ?? false;
  let runtime: any[] = [];
  const writes: any[] = [];
  let loads = 0;
  const api = load('./useConversationList.ts', {
    react: react.api, 'expo-router': { useFocusEffect: (callback: any) => react.api.useEffect(callback, [callback]) }, './model': model,
    '../chat/conversationRuntime': { getConversationRuntimeSnapshots: () => runtime, subscribeConversationRuntime: () => () => {},
      discardConversationRun: (id: string) => { runtime = runtime.filter(record => record.conversationId !== id); } },
    '../../platform/library': {
      loadConversationSummaries: async () => { loads++; if (failLoad) throw Error('read failed'); return options.load ? options.load(loads) : records; },
      loadShelfBooks: async () => [book('a')], loadAppPreference: async () => options.preferences ?? {}, saveAppPreference: async () => {},
      renameBookConversation: async (id: string, title: string) => { writes.push(['rename', id, title]); if (options.rename) await options.rename(); records = records.map((record: any) => record.conversationId === id ? { ...record, title, updatedAt: 100 } : record); },
      deleteBookConversation: async (id: string) => { writes.push(['delete', id]); if (options.remove) await options.remove(); records = records.filter((record: any) => record.conversationId !== id); },
    },
  });
  let value: any;
  const render = () => { value = react.render(() => api.useConversationList()); return value; };
  render();
  return { get value() { return value; }, writes, get loads() { return loads; }, render, unmount: react.unmount,
    setRuntime(value: any[]) { runtime = value; }, setFailLoad(value: boolean) { failLoad = value; },
    async flush() { await settle(); render(); await settle(); render(); } };
}

test('a read failure offers a clean retry without overwriting records or persisting fabricated emptiness', async () => {
  const h = listHarness({ failLoad: true }); await h.flush();
  assert.equal(h.value.loadError, true); assert.equal(h.value.loading, false);
  assert.deepEqual(h.writes, []);
  h.setFailLoad(false); await h.value.reload(); h.render();
  assert.equal(h.value.loadError, false);
  assert.equal(h.value.items[0].conversationId, 'one');
});

test('cancelled or unmounted dialog callbacks cannot mutate another conversation', async () => {
  const h = listHarness(); await h.flush();
  const first = h.value.items[0]; h.value.openDialog('delete', first); h.render();
  const old = h.value.dialog; h.value.dismiss(old.id); h.render();
  h.value.openDialog('rename', first); h.render();
  await h.value.confirm(old.id, first);
  assert.deepEqual(h.writes, []);
  const current = h.value.dialog; h.unmount(); await h.value.confirm(current.id, first, '新名');
  assert.deepEqual(h.writes, []);
});

test('confirmed mutations consume their token once and failure preserves the original list', async () => {
  const h = listHarness({ remove: async () => { throw Error('disk full'); } }); await h.flush();
  const first = h.value.items[0]; h.value.openDialog('delete', first); h.render(); const dialog = h.value.dialog;
  await Promise.all([h.value.confirm(dialog.id, first), h.value.confirm(dialog.id, first)]); h.render();
  assert.deepEqual(h.writes, [['delete', 'one']]);
  assert.equal(h.value.items.length, 1);
  assert.equal(h.value.dialog.kind, 'notice');
  assert.equal(h.value.dialog.message, '删除失败，对话仍保留；生成已取消，请重试删除。');
});

test('rename rechecks the current runtime at confirmation and refuses newly unsaved or active work', async () => {
  const h = listHarness(); await h.flush();
  const first = h.value.items[0]; h.value.openDialog('rename', first); h.render(); const dialog = h.value.dialog;
  h.setRuntime([{ conversationId: 'one', bookId: 'a', bookTitle: '原书', updatedAt: 2, running: false,
    turn: { id: 'one:assistant', text: '回答', sourceQuestion: first.question, saveError: 'failed' } }]);
  await h.value.confirm(dialog.id, first, '新的名称'); h.render();
  assert.deepEqual(h.writes, []);
  assert.equal(h.value.dialog.message, '改名尚未保存，原名称未变；请检查名称、生成及保存状态后重试。');
});

test('a successful rename refreshes title/order while a confirmed delete removes only its original id', async () => {
  const h = listHarness({ items: [item('one', 'a', 1), item('two', 'a', 2)] }); await h.flush();
  const first = h.value.items[0]; h.value.openDialog('rename', first); h.render();
  await h.value.confirm(h.value.dialog.id, first, '保存后的标题'); h.render();
  assert.equal(h.value.items.find((entry: any) => entry.conversationId === 'one').title, '保存后的标题');
  h.value.openDialog('delete', first); h.render(); await h.value.confirm(h.value.dialog.id, first); h.render();
  assert.deepEqual(h.value.items.map((entry: any) => entry.conversationId), ['two']);
});

test('an older in-flight reload cannot resurrect a successfully deleted conversation', async () => {
  let finish!: (value: any[]) => void;
  const pending = new Promise<any[]>(resolve => { finish = resolve; });
  const h = listHarness({ load: (count: number) => count === 1 ? [item('one', 'a', 1)] : pending });
  await h.flush(); const first = h.value.items[0];
  const oldLoad = h.value.reload(); h.render();
  h.value.openDialog('delete', first); h.render();
  await h.value.confirm(h.value.dialog.id, first); h.render();
  assert.equal(h.value.items.length, 0);
  finish([first]); await oldLoad; h.render();
  assert.equal(h.value.items.length, 0); assert.equal(h.value.loading, false);
});

function find(tree: any, type: any, matches: (props: any) => boolean = () => true): any {
  if (!tree || typeof tree !== 'object') return;
  if (Array.isArray(tree)) return tree.map(entry => find(entry, type, matches)).find(Boolean);
  if (tree.type === type && matches(tree.props)) return tree;
  return find(tree.props?.children, type, matches);
}
const jsx = (type: any, props: any) => ({ type, props });
const palette = new Proxy({}, { get: (_target, key) => key });

test('the real screen uses native stacked search, clears native text explicitly and exposes three separate recovery states', () => {
  const react = hooks();
  const state: any = { items: [item('one', 'a', 1)], books: [book('a')], collapsed: { a: false }, loading: false, loadError: false, dialog: null,
    reload() { retried++; }, toggleGroup() {}, openDialog() {}, dismiss() {}, confirm() {} };
  let retried = 0; let cleared = 0; const navigation: string[] = [];
  const screen = load('./ConversationsScreen.tsx', {
    react: react.api, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { ActivityIndicator: 'ActivityIndicator', PlatformColor: (name: string) => name, Pressable: 'Pressable', SectionList: 'SectionList',
      StyleSheet: { create: (value: any) => value }, Text: 'Text', View: 'View' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-router': { Stack: { Screen: 'StackScreen' }, useRouter: () => ({ navigate: (route: string) => navigation.push(route) }) },
    'react-native-gesture-handler/ReanimatedSwipeable': { __esModule: true, default: 'Swipeable' }, 'expo-symbols': { SymbolView: 'SymbolView' },
    '../components/EmptyState': { EmptyState: 'EmptyState' }, '../components/BookNotice': { BookNotice: 'BookNotice' },
    '../components/SectionHeader': { SectionHeader: 'SectionHeader' }, '../format': { conversationTime: () => '时间' },
    '../chat/format': { SERIF_BOLD: 'serif' }, '../theme': { usePalette: () => palette },
    './ConversationRenamePrompt': { ConversationRenamePrompt: 'RenamePrompt' }, './model': model,
    './useConversationList': { useConversationList: () => state },
    '../navigation/useNativeListSearch': load('../navigation/useNativeListSearch.ts', { react: react.api }),
  });
  const render = () => react.render(() => screen.default());
  let tree = render(); const search = find(tree, 'StackScreen').props.options.headerSearchBarOptions;
  assert.equal(search.placement, 'stacked'); assert.equal(search.hideWhenScrolling, false);
  assert.equal('text' in search, false, 'JS does not write a stale controlled query back to native search');
  search.ref.current = { clearText() { cleared++; } };
  search.onChangeText({ nativeEvent: { text: 'unmatched' } }); tree = render();
  let empty = find(tree, 'SectionList').props.ListEmptyComponent.props.children;
  assert.equal(empty.props.title, '没有找到相关对话'); assert.equal(empty.props.actionLabel, '清除搜索');
  empty.props.onAction(); tree = render(); assert.equal(cleared, 1); assert.equal(find(tree, 'SectionList').props.sections.length, 1);
  state.loadError = true; tree = render(); empty = find(tree, 'SectionList').props.ListEmptyComponent.props.children;
  assert.equal(empty.props.title, '对话读取失败'); empty.props.onAction(); assert.equal(retried, 1);
  state.loadError = false; state.items = []; tree = render(); empty = find(tree, 'SectionList').props.ListEmptyComponent.props.children;
  assert.equal(empty.props.title, '还没有对话'); empty.props.onAction(); assert.deepEqual(navigation, ['/(tabs)']);
});

function promptHarness() {
  const react = hooks();
  const completions: any[] = [];
  const writes: string[] = [];
  let cancelled = 0;
  class Value { constructor(_value: number) {} stopAnimation() {} }
  const prompt = load('./ConversationRenamePrompt.tsx', {
    react: react.api, 'react/jsx-runtime': { jsx, jsxs: jsx }, '../theme': { usePalette: () => palette },
    'react-native': { AccessibilityInfo: { addEventListener: () => ({ remove() {} }), isReduceMotionEnabled: async () => false },
      Animated: { Value, View: 'AnimatedView', timing: () => ({ start: (callback: any) => { if (callback) completions.push(callback); } }) },
      Easing: { ease: 'ease', inOut: (value: any) => value }, Platform: { OS: 'ios' },
      Modal: 'Modal', Pressable: 'Pressable', StyleSheet: { create: (value: any) => value }, Text: 'Text', TextInput: 'TextInput', View: 'View' },
  });
  const render = () => react.render(() => prompt.ConversationRenamePrompt({ initialName: '原名称', onCancel: () => { cancelled++; }, onSave: (name: string) => writes.push(name) }));
  return { render, writes, completions, unmount: react.unmount, get cancelled() { return cancelled; } };
}

test('rename prompt consumes save once, preserves raw text and waits for native dismissal before writing', () => {
  const h = promptHarness(); let tree = h.render();
  find(tree, 'TextInput').props.onChangeText('  新名称\n'); tree = h.render();
  const save = find(tree, 'Pressable', props => props.children.props.children === '保存');
  save.props.onPress(); save.props.onPress(); assert.equal(h.completions.length, 1);
  assert.deepEqual(h.writes, []);
  h.completions[0]({ finished: true }); tree = h.render(); assert.equal(find(tree, 'Modal').props.visible, false);
  assert.deepEqual(h.writes, []);
  find(tree, 'Modal').props.onDismiss(); find(tree, 'Modal').props.onDismiss();
  assert.deepEqual(h.writes, ['  新名称\n']); assert.equal(h.cancelled, 0);
});

test('rename cancellation never saves, and unmount drops a pending action before dismissal', () => {
  const h = promptHarness(); let tree = h.render();
  find(tree, 'Pressable', props => props.children.props.children === '取消').props.onPress();
  h.completions[0]({ finished: true }); tree = h.render(); find(tree, 'Modal').props.onDismiss();
  assert.equal(h.cancelled, 1); assert.deepEqual(h.writes, []);
  const other = promptHarness(); tree = other.render();
  find(tree, 'Pressable', props => props.children.props.children === '保存').props.onPress();
  other.unmount(); other.completions[0]({ finished: true }); find(tree, 'Modal').props.onDismiss();
  assert.deepEqual(other.writes, []);
});
