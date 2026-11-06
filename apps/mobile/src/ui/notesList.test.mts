import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { test } from 'node:test';
import { groupByKey } from './components/groupBy.ts';

const require = createRequire(new URL('../../package.json', import.meta.url));
const ts = require('typescript');
function load(file: URL, mocks: Record<string, any>) {
  const compiled: any = new Module(file.pathname);
  compiled.filename = file.pathname;
  compiled.require = (id: string) => {
    if (!(id in mocks)) throw new Error('Unmocked dependency: ' + id);
    return mocks[id];
  };
  compiled._compile(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, file.pathname);
  return compiled.exports;
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('notes list hides removed books while retaining their annotations for reimport', async () => {
  const books = [{ id: 'active', format: 'EPUB', removed: false }, { id: 'removed', format: 'EPUB', removed: true }];
  const saved = books.map((book, i) => ({ id: 'note-' + book.id, anchorId: 'anchor-' + book.id,
    body: 'retained body ' + book.id, kind: 'note', color: null, createdAt: i + 1 }));
  const original = JSON.stringify(saved);
  const reads: string[] = [];
  let writes = 0;
  const store = {
    getBook: async (id: string) => books.find((book) => book.id === id),
    listAnnotations: async (id: string) => { reads.push(id); return saved.filter((row) => row.id === 'note-' + id); },
    listAnchors: async (id: string) => [{ id: 'anchor-' + id, quote: 'original ' + id, chapter: 'Chapter', page: null, locatorJson: '{}' }],
  };
  const api = load(new URL('../platform/library/annotations.ts', import.meta.url), {
    '@shudeng/core/db': {},
    '@shudeng/core/domain': { decodeEpubAnchor: () => null },
    './epubAnnotations': {},
    '../db': { getDataLayer: async () => ({ store, driver: { run: async () => { writes++; } } }) },
    './import': { loadShelfBooks: async (options: any = {}) => books.filter((book) => options.includeRemoved || !book.removed) },
    './pure': { formatOf: () => 'EPUB', annotationReadingOrder: () => ({}) },
  });
  assert.deepEqual((await api.loadAllAnnotations()).map((item: any) => item.annotation.id), ['note-active']);
  assert.deepEqual(reads, ['active'], 'hidden books are excluded at the list query boundary');
  assert.equal((await api.loadBookAnnotations('removed'))[0].body, 'retained body removed');
  books[1]!.removed = false; // Simulate restored source visibility, without deleting/recreating records.
  assert.deepEqual((await api.loadAllAnnotations()).map((item: any) => item.annotation.id), ['note-active', 'note-removed']);
  assert.equal(JSON.stringify(saved), original);
  assert.equal(writes, 0);
});

test('saved notes validate nonblank content but preserve the original leading/trailing text', async () => {
  const writes: any[] = [];
  const api = load(new URL('../platform/library/annotations.ts', import.meta.url), {
    '@shudeng/core/db': {},
    '@shudeng/core/domain': {}, './epubAnnotations': {}, './import': {}, './pure': {},
    '../db': { getDataLayer: async () => ({ driver: {
      all: async () => [{ kind: 'note' }], run: async (...args: any[]) => writes.push(args),
    } }) },
  });
  await api.updateReaderAnnotation('id', { body: '  保留空白\n' });
  assert.equal(writes[0][1][0], '  保留空白\n');
  assert.equal(writes[0][1][2], 'id');
  await assert.rejects(api.updateReaderAnnotation('id', { body: '\n  ' }), /笔记内容不能为空/);
  assert.equal(writes.length, 1);
});

function notesRoute(items: any[], preferences: Record<string, boolean> | null = null, ports: Record<string, any> = {}) {
  const state: any[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const hooks = {
    useState(initial: any) {
      const i = cursor++; state[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [state[i].value, (next: any) => { state[i].value = typeof next === 'function' ? next(state[i].value) : next; }];
    },
    useRef(initial: any) { const i = cursor++; return state[i] ??= { current: initial }; },
    useMemo(factory: any, deps: any[]) {
      const i = cursor++;
      if (!state[i] || deps.some((value, j) => !Object.is(value, state[i].deps[j]))) state[i] = { deps, value: factory() };
      return state[i].value;
    },
    useCallback(callback: any, deps: any[]) { return hooks.useMemo(() => callback, deps); },
    useEffect(effect: any, deps: any[]) {
      const i = cursor++;
      if (!state[i] || deps.some((value, j) => !Object.is(value, state[i].deps[j]))) {
        const previous = state[i]; state[i] = { deps };
        effects.push(() => { previous?.cleanup?.(); state[i].cleanup = effect(); });
      }
    },
  };
  const navigation: string[] = [];
  const writes: string[] = [];
  const alerts: string[] = [];
  const files: any[] = [];
  const shares: any[] = [];
  const jsx = (type: any, props: any) => ({ type, props });
  const palette = new Proxy({}, { get: (_target, key) => key });
  const api = load(new URL('./notes/NotesScreen.tsx', import.meta.url), {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', SectionList: 'SectionList', PlatformColor: (value: string) => value,
      Text: 'Text', View: 'View', StyleSheet: { create: (value: any) => value, hairlineWidth: 0.5 },
      Alert: { alert: (title: string) => alerts.push(title) }, Share: {
        share: async (value: any) => { shares.push(value); if (ports.share) return ports.share(value); return { action: 'dismissedAction' }; },
        sharedAction: 'sharedAction',
      } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-router': { Stack: { Screen: 'StackScreen', Toolbar: Object.assign('StackToolbar', { Button: 'ToolbarButton' }) },
      useRouter: () => ({ navigate: (route: string) => navigation.push(route), push() {} }),
      useFocusEffect: (callback: any) => hooks.useEffect(callback, [callback]) },
    'react-native-gesture-handler/ReanimatedSwipeable': { __esModule: true, default: 'Swipeable' },
    'expo-file-system': { File: class {
      exists = true; uri = 'cache://notes.txt'; name: string; text = ''; deleted = false;
      constructor(_root: any, name: string) { if (ports.fileConstructor) ports.fileConstructor(); this.name = name; files.push(this); }
      write(text: string) { if (ports.fileWrite) ports.fileWrite(); this.text = text; }
      delete() { this.deleted = true; }
    }, Paths: { cache: 'cache' } },
    '../../platform/library': { loadAllAnnotations: async () => items,
      loadAppPreference: async () => preferences, saveAppPreference: async () => {},
      deleteReaderAnnotation: async (id: string) => { writes.push('delete:' + id); if (ports.delete) return ports.delete(id); },
      updateReaderAnnotation: async (id: string, patch: any) => { writes.push('update:' + id); if (ports.update) return ports.update(id, patch); } },
    '../reader/NoteSheet': { NoteSheet: 'NoteSheet' },
    '../components/EmptyState': { EmptyState: 'EmptyState' },
    '../components/BookNotice': { BookNotice: 'BookNotice' },
    '../components/SectionHeader': { SectionHeader: 'SectionHeader' },
    '../components/groupBy': { groupByKey },
    '../components/useHaptics': { useHaptics: () => () => {} },
    '../format': { recordTime: () => '今天 09:41' },
    '../chat/format': { SERIF: 'Songti SC' },
    '../theme': { usePalette: () => palette, type: {} },
    '../navigation/useNativeListSearch': load(new URL('./navigation/useNativeListSearch.ts', import.meta.url), { react: hooks }),
  });
  return { navigation, writes, alerts, files, shares, unmount() { state.forEach((entry) => entry.cleanup?.()); }, render() {
    cursor = 0;
    const tree = api.default();
    const next = effects; effects = []; next.forEach((effect) => effect());
    return tree;
  } };
}
function find(tree: any, type: string): any {
  if (!tree || typeof tree !== 'object') return undefined;
  if (Array.isArray(tree)) return tree.map((value) => find(value, type)).find(Boolean);
  if (tree.type === type) return tree;
  return find(tree.props?.children, type);
}
function search(tree: any) { return find(tree, 'StackScreen').props.options.headerSearchBarOptions; }
const fixture = { book: { id: 'book', title: '测试书', format: 'EPUB' }, annotation: {
  id: 'note', kind: 'note', quote: '原文', body: '独有marker', chapter: '第一章', createdAt: 1,
} };

test('unmatched search uses native empty copy and its action clears the query without editing notes', async () => {
  const ui = notesRoute([fixture]);
  ui.render(); await settle(); ui.render();
  let tree = ui.render();
  search(tree).onChangeText({ nativeEvent: { text: 'a-query-with-no-matches' } });
  tree = ui.render();
  const list = find(tree, 'SectionList');
  assert.deepEqual(list.props.sections, []);
  const empty = list.props.ListEmptyComponent.props;
  assert.equal(empty.title, '没有找到相关笔记');
  assert.equal(empty.description, '换一个关键词，或清除搜索后再看。');
  assert.equal(empty.actionLabel, '清除搜索');
  assert.equal(empty.symbol, 'square.and.pencil');
  empty.onAction(); tree = ui.render();
  assert.equal(find(tree, 'SectionList').props.sections[0].book.id, 'book');
  assert.deepEqual(ui.writes, []);
  assert.deepEqual(ui.navigation, []);
});

test('the genuine empty list uses the native guidance and navigates to the shelf', async () => {
  const ui = notesRoute([]);
  ui.render(); await settle();
  const tree = ui.render();
  const empty = find(tree, 'SectionList').props.ListEmptyComponent.props;
  assert.equal(empty.title, '还没有笔记');
  assert.equal(empty.description, '阅读时选中原文，画下高亮或写下想法，之后会出现在这里。');
  assert.equal(empty.actionLabel, '去书架读书');
  empty.onAction();
  assert.deepEqual(ui.navigation, ['/(tabs)']);
  assert.deepEqual(ui.writes, []);
});

test('bookmarks do not enter notes search or counts and whitespace keeps the normal empty state', async () => {
  const bookmark = { ...fixture, annotation: { ...fixture.annotation, id: 'bookmark', kind: 'bookmark' } };
  const ui = notesRoute([bookmark]);
  ui.render(); await settle();
  let tree = ui.render();
  search(tree).onChangeText({ nativeEvent: { text: '   ' } });
  tree = ui.render();
  assert.deepEqual(find(tree, 'SectionList').props.sections, []);
  assert.equal(find(tree, 'SectionList').props.ListEmptyComponent.props.title, '还没有笔记');
  assert.deepEqual(ui.writes, []);
});

test('search expands matching notes and clearing restores the previous collapsed state', async () => {
  const ui = notesRoute([fixture], { book: true });
  ui.render(); await settle(); ui.render();
  let tree = ui.render();
  assert.equal(find(tree, 'SectionList').props.sections[0].collapsed, true);
  search(tree).onChangeText({ nativeEvent: { text: '独有marker' } });
  tree = ui.render();
  let list = find(tree, 'SectionList');
  assert.equal(list.props.sections[0].collapsed, false);
  assert.equal(list.props.sections[0].count, 1);
  list.props.renderSectionHeader({ section: list.props.sections[0] }).props.onPress();
  assert.equal(find(ui.render(), 'SectionList').props.sections[0].collapsed, false);
  search(tree).onChangeText({ nativeEvent: { text: '' } });
  tree = ui.render();
  assert.equal(find(tree, 'SectionList').props.sections[0].collapsed, true);
  assert.deepEqual(ui.writes, []);
});

async function ready(items: any[] = [fixture], preferences: Record<string, boolean> | null = null, ports = {}) {
  const ui = notesRoute(items, preferences, ports);
  ui.render(); await settle(); ui.render();
  return ui;
}
function swipe(tree: any, sectionIndex = 0, itemIndex = 0) {
  const list = find(tree, 'SectionList');
  const section = list.props.sections[sectionIndex];
  return list.props.renderItem({ item: section.data[itemIndex], index: itemIndex, section });
}
function edit(ui: ReturnType<typeof notesRoute>) {
  const row = swipe(ui.render());
  row.props.renderLeftActions(null, null, { close() {} }).props.onPress();
  return find(ui.render(), 'NoteSheet');
}

test('book groups preserve catalog order while the newest note alone controls initial expansion', async () => {
  const other = { book: { ...fixture.book, id: 'other', title: '另一本书' }, annotation: { ...fixture.annotation, id: 'other-note', createdAt: 99 } };
  const ui = await ready([fixture, other]);
  const sections = find(ui.render(), 'SectionList').props.sections;
  assert.deepEqual(sections.map((section: any) => section.book.id), ['book', 'other']);
  assert.equal(sections[0].collapsed, true);
  assert.equal(sections[1].collapsed, false);
});

test('an existing empty group preference keeps all groups collapsed instead of reinitializing the newest', async () => {
  const ui = await ready([fixture], {});
  assert.equal(find(ui.render(), 'SectionList').props.sections[0].collapsed, true);
});

test('legacy rows without a usable locator sort after known reading positions, as the native document order does', async () => {
  const invalid = { ...fixture, annotation: { ...fixture.annotation, id: 'invalid', locator: null } };
  const valid = { ...fixture, annotation: { ...fixture.annotation, id: 'valid', progression: 0.8, locator: { type: 'epub', cfi: 'known' } } };
  const ui = await ready([invalid, valid]);
  assert.deepEqual(find(ui.render(), 'SectionList').props.sections[0].data.map((item: any) => item.annotation.id), ['valid', 'invalid']);
});

test('native search is event driven, clear is explicit, and cancellation restores the pre-search scroll offset', async () => {
  const ui = await ready();
  const tree = ui.render();
  const options = search(tree);
  const cleared: string[] = [];
  const scrolled: any[] = [];
  const frames: (() => void)[] = [];
  const oldFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = ((callback: () => void) => { frames.push(callback); return frames.length; }) as any;
  try {
    options.ref.current = { clearText: () => cleared.push('clear'), setText: () => { throw Error('stale text echo'); } };
    find(tree, 'SectionList').props.ref.current = { getScrollResponder: () => ({ scrollTo: (value: any) => scrolled.push(value) }) };
    find(tree, 'SectionList').props.onScroll({ nativeEvent: { contentOffset: { y: 180 } } });
    options.onFocus();
    options.onChangeText({ nativeEvent: { text: '价' } }); ui.render();
    options.onChangeText({ nativeEvent: { text: '价值投资' } });
    assert.deepEqual(cleared, []);
    assert.equal(options.placement, 'stacked');
    assert.equal(options.hideWhenScrolling, false);
    assert.equal(options.obscureBackground, false);
    assert.equal('text' in options || 'value' in options, false);
    options.onCancelButtonPress(); ui.render();
    frames.splice(0).forEach((callback) => callback());
    assert.deepEqual(scrolled, [{ y: 180, animated: false }]);
    search(ui.render()).onChangeText({ nativeEvent: { text: 'no-match' } });
    const filtered = ui.render();
    find(filtered, 'SectionList').props.ListEmptyComponent.props.onAction();
    assert.deepEqual(cleared, ['clear']);
  } finally { globalThis.requestAnimationFrame = oldFrame; }
});

test('swipes reveal actions only, all records use native delete copy, and cancel never writes', async () => {
  const highlight = { ...fixture, annotation: { ...fixture.annotation, kind: 'highlight', body: null } };
  const ui = await ready([highlight]);
  let tree = ui.render();
  const row = swipe(tree);
  assert.equal(row.props.renderLeftActions, undefined);
  assert.equal(find(row, 'Pressable').props.onLongPress, undefined);
  const action = row.props.renderRightActions(null, null, { close() {} });
  assert.deepEqual(ui.writes, []);
  action.props.onPress();
  tree = ui.render();
  const card = find(tree, 'BookNotice').props;
  assert.equal(card.title, '删除笔记？');
  assert.equal(card.message, '删除后无法恢复；原文中的高亮与笔记也会移除。');
  card.actions.find((value: any) => value.style === 'cancel').onPress();
  await settle();
  assert.deepEqual(ui.writes, []);
  assert.equal(find(ui.render(), 'BookNotice'), undefined);
});

test('failed list deletion retains the row and shows the original 操作未保存 card', async () => {
  const ui = await ready([fixture], null, { delete: async () => { throw Error('disk'); } });
  const row = swipe(ui.render());
  row.props.renderRightActions(null, null, { close() {} }).props.onPress();
  const card = find(ui.render(), 'BookNotice').props;
  card.actions.find((value: any) => value.style === 'destructive').onPress();
  await settle();
  const tree = ui.render();
  assert.equal(find(tree, 'BookNotice').props.title, '操作未保存');
  assert.equal(find(tree, 'BookNotice').props.message, '删除失败，笔记仍保留；请重试。');
  assert.equal(find(tree, 'SectionList').props.sections[0].data[0].annotation.body, fixture.annotation.body);
  assert.deepEqual(ui.writes, ['delete:note']);
});

test('editor save failure keeps the changed body and editor visible until explicit dismissal', async () => {
  const ui = await ready([fixture], null, { update: async () => { throw Error('disk'); } });
  edit(ui).props.onChangeBody('未保存的新正文');
  let sheet = find(ui.render(), 'NoteSheet');
  sheet.props.onSave(); sheet.props.onSave();
  await settle();
  sheet = find(ui.render(), 'NoteSheet');
  assert.equal(sheet.props.visible, true);
  assert.equal(sheet.props.body, '未保存的新正文');
  assert.deepEqual(sheet.props.notice, { title: '笔记保存失败', message: '内容仍在此页；请检查储存空间后重试保存。' });
  assert.equal(sheet.props.saving, false);
  assert.deepEqual(ui.writes, ['update:note']);
  sheet.props.onDismissNotice();
  assert.equal(find(ui.render(), 'NoteSheet').props.body, '未保存的新正文');
});

test('successful editor save retains raw body whitespace for subsequent export', async () => {
  const updates: any[] = [];
  const ui = await ready([fixture], null, { update: async (id: string, patch: any) => updates.push({ id, patch }) });
  edit(ui).props.onChangeBody('  前后空白\n');
  find(ui.render(), 'NoteSheet').props.onSave(); await settle();
  const tree = ui.render();
  assert.deepEqual(updates, [{ id: 'note', patch: { body: '  前后空白\n' } }]);
  assert.equal(find(tree, 'NoteSheet').props.visible, false);
  await find(tree, 'ToolbarButton').props.onPress(); await settle();
  assert.ok(ui.files[0].text.includes('想法：  前后空白\n'));
});

test('editor deletion failure uses one already-confirmed callback, preserves content and stays open', async () => {
  const ui = await ready([fixture], null, { delete: async () => { throw Error('disk'); } });
  let sheet = edit(ui);
  sheet.props.onDelete(); sheet.props.onDelete();
  await settle();
  sheet = find(ui.render(), 'NoteSheet');
  assert.equal(sheet.props.visible, true);
  assert.equal(sheet.props.body, fixture.annotation.body);
  assert.deepEqual(sheet.props.notice, { title: '删除失败', message: '笔记仍保留；请检查储存空间后重试。' });
  assert.deepEqual(ui.writes, ['delete:note']);
  assert.equal(find(ui.render(), 'BookNotice'), undefined, 'failure lives inside the existing editor modal');
});

test('export includes collapsed groups in catalog/document order and removes its cache after sharing', async () => {
  const second = { ...fixture, annotation: { ...fixture.annotation, id: 'second', body: '第二条', position: 2, createdAt: 99 } };
  const first = { ...fixture, annotation: { ...fixture.annotation, id: 'first', body: '', position: 1, createdAt: 1 } };
  const other = { book: { ...fixture.book, id: 'other', title: '另一本书', format: 'PDF' }, annotation: { ...fixture.annotation, id: 'other', page: 3, body: null } };
  const ui = await ready([second, first, other], { book: true, other: true });
  const tree = ui.render();
  assert.ok(find(tree, 'SectionList').props.sections.every((section: any) => section.data.length === 0));
  await find(tree, 'ToolbarButton').props.onPress(); await settle();
  assert.equal(ui.files.length, 1);
  assert.match(ui.files[0].name, /^书灯笔记-[0-9]{8}\.txt$/);
  assert.equal(ui.files[0].text, '《测试书》\n第一章\n原文：原文\n\n《测试书》\n第一章\n原文：原文\n想法：第二条\n\n《另一本书》\n第 3 页\n原文：原文\n');
  assert.equal(ui.shares.length, 1);
  assert.equal(ui.files[0].deleted, true);
  assert.deepEqual(ui.writes, []);
});

test('notes export uses native total then local progression before position, even for collapsed groups', async () => {
  const entry = (id: string, body: string, order: any) => ({ ...fixture, annotation: {
    ...fixture.annotation, id, body, locator: { type: 'epub', cfi: 'chapter.xhtml' }, ...order,
  } });
  const ui = await ready([
    entry('local-late', '局部进度后', { localProgression: .8, position: 1 }),
    entry('local-early', '局部进度前', { localProgression: .2, position: 99 }),
    entry('total-first', '总进度优先', { progression: .1, localProgression: .9, position: 100 }),
    entry('no-location', '位置损坏保留到末尾', { progression: 0, localProgression: 0, position: 0, locator: null }),
  ], { book: true });
  const tree = ui.render();
  assert.equal(find(tree, 'SectionList').props.sections[0].data.length, 0);
  await find(tree, 'ToolbarButton').props.onPress(); await settle();
  assert.equal(ui.files[0].text,
    '《测试书》\n第一章\n原文：原文\n想法：总进度优先\n\n' +
    '《测试书》\n第一章\n原文：原文\n想法：局部进度前\n\n' +
    '《测试书》\n第一章\n原文：原文\n想法：局部进度后\n\n' +
    '《测试书》\n第一章\n原文：原文\n想法：位置损坏保留到末尾\n');
  assert.deepEqual(ui.writes, []);
});

test('PDF geometry page is display text, never a replacement for missing native sort position', async () => {
  const entry = (id: string, page: number) => ({ book: { ...fixture.book, format: 'PDF' }, annotation: {
    ...fixture.annotation, id, page, body: null, locator: { type: 'pdf', page },
  } });
  const ui = await ready([entry('z', 1), entry('a', 9)], { book: true });
  await find(ui.render(), 'ToolbarButton').props.onPress(); await settle();
  assert.equal(ui.files[0].text, '《测试书》\n第 9 页\n原文：原文\n\n《测试书》\n第 1 页\n原文：原文\n');
});

test('export preserves native chapter whitespace and only substitutes a genuinely empty chapter', async () => {
  const entry = (id: string, chapter: string | null, position: number) => ({ ...fixture, annotation: {
    ...fixture.annotation, id, chapter, position, body: null, locator: { type: 'epub', cfi: 'chapter.xhtml' },
  } });
  const ui = await ready([entry('padded', '  第一章 \t', 1), entry('spaces', '  ', 2), entry('empty', '', 3), entry('missing', null, 4)], { book: true });
  await find(ui.render(), 'ToolbarButton').props.onPress(); await settle();
  assert.equal(ui.files[0].text,
    '《测试书》\n  第一章 \t\n原文：原文\n\n' +
    '《测试书》\n  \n原文：原文\n\n' +
    '《测试书》\n阅读位置\n原文：原文\n\n' +
    '《测试书》\n阅读位置\n原文：原文\n');
});

test('PDF export displays geometry page first and falls back to locator position, including zero', async () => {
  const entry = (id: string, page: number | null, position: number) => ({ book: { ...fixture.book, format: 'PDF' }, annotation: {
    ...fixture.annotation, id, page, position, body: null, locator: { type: 'pdf', page: page ?? position },
  } });
  const ui = await ready([entry('fallback', null, 7), entry('geometry', 3, 8), entry('zero', 0, 9)], { book: true });
  await find(ui.render(), 'ToolbarButton').props.onPress(); await settle();
  assert.equal(ui.files[0].text,
    '《测试书》\n第 7 页\n原文：原文\n\n' +
    '《测试书》\n第 3 页\n原文：原文\n\n' +
    '《测试书》\n第 0 页\n原文：原文\n');
});

test('empty and failed exports use the native cards, with no extra writes or stale busy state', async () => {
  const empty = await ready([]);
  await find(empty.render(), 'ToolbarButton').props.onPress();
  let card = find(empty.render(), 'BookNotice').props;
  assert.equal(card.title, '还没有可导出的笔记');
  assert.equal(card.message, '阅读时选中原文，写下高亮或笔记后再导出。');
  assert.equal(empty.files.length, 0);
  const failed = await ready([fixture], null, { fileConstructor: () => { throw Error('cache unavailable'); } });
  await find(failed.render(), 'ToolbarButton').props.onPress(); await settle();
  card = find(failed.render(), 'BookNotice').props;
  assert.equal(card.title, '无法导出');
  assert.equal(card.message, '笔记仍保存在本机，请检查储存空间后重试。');
  assert.equal(find(failed.render(), 'ToolbarButton').props.disabled, false);
  assert.deepEqual(failed.writes, []);
});
