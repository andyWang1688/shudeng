import test from 'node:test';
import assert from 'node:assert/strict';
import { hooks, jsx, loader, nativePorts, nodes, flush } from './settings/__tests__/platformHarness.mts';

const fixture = [
  { id: 'sea', title: '海洋', author: 'Alice', format: 'EPUB', progressPercent: 32, removed: false },
  { id: 'forest', title: '森林', author: 'Bob', format: 'PDF', progressPercent: null, removed: false },
  { id: 'sky', title: '天空', author: 'ALICE', format: 'EPUB', progressPercent: 5, removed: false },
];
const Stack = { Screen: 'StackScreen', Toolbar: Object.assign('StackToolbar', { Button: 'ToolbarButton' }) };
function shelf(options: { importBook?: (args: any) => Promise<any> } = {}) {
  const h = hooks(), pushes: any[] = [], locks: boolean[] = [];
  const native = nativePorts([]);
  native.useWindowDimensions = () => ({ width: 390, height: 844 });
  const Screen = loader({
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-router': { Stack, useRouter: () => ({ push: (value: any) => pushes.push(value) }), useFocusEffect: (fn: any) => h.react.useEffect(fn, [fn]) },
    'expo-symbols': { SymbolView: 'SymbolView' }, '@expo/ui/community/menu': { MenuView: 'MenuView' },
    '../platform/db': { initializeDatabase: async () => ({ ok: true }) },
    '../platform/library': {
      migrateLegacyLibraryIfNeeded: async () => ({ failures: 0 }),
      loadShelfBooks: async () => fixture,
      importBookFromPicker: options.importBook ?? (async () => ({ status: 'cancelled' })),
    },
    '../platform/library/pdfImport': { importFailureNotice: (cause: unknown) => ({ title: '导入未完成', message: String(cause) }) },
    './components/BookCover': { BookCover: 'BookCover' }, './components/BookNotice': { BookNotice: 'BookNotice' },
    './components/EmptyState': { EmptyState: 'EmptyState' }, './components/SectionHeader': { SectionHeader: 'SectionHeader' },
    './components/useHaptics': { useHaptics: () => () => {} }, './tabInteraction': { useTabInteractionLock: (value: boolean) => locks.push(value) },
    './theme': { spacing: { screen: 20 }, type: {}, usePalette: () => ({ paper: 'paper', lamp: 'lamp', ink: 'ink', ink2: 'ink2' }) },
  })('apps/mobile/src/ui/ShelfScreen.tsx').ShelfScreen;
  return { render: () => h.render(Screen), pushes, locks, unmount: h.unmount };
}
const find = (tree: any, type: string) => nodes(tree, n => n.type === type)[0];
const search = (tree: any) => find(tree, 'StackScreen').props.options.headerSearchBarOptions;
const ids = (tree: any) => find(tree, 'FlatList').props.data.map((book: any) => book.id);
async function ready(options: Parameters<typeof shelf>[0] = {}) { const h = shelf(options); h.render(); await flush(); return h; }

test('shelf uses persistent native search above a two-column grid with an import toolbar action', async () => {
  const h = await ready(), tree = h.render(), options = search(tree);
  assert.equal(options.placement, 'stacked'); assert.equal(options.hideWhenScrolling, false);
  assert.equal(options.obscureBackground, false); assert.equal(options.placeholder, '书名或作者');
  assert.equal('text' in options || 'value' in options, false);
  const list = find(tree, 'FlatList');
  assert.equal(list.props.numColumns, 2); assert.equal(list.props.contentInsetAdjustmentBehavior, 'automatic');
  assert.equal(nodes(list.props.ListHeaderComponent, n => n.type === 'PageHeader' || n.type === 'SearchField').length, 0);
  assert.deepEqual(tree.props.edges, ['left', 'right']);
  assert.equal(find(tree, 'ToolbarButton').props.accessibilityLabel, '导入书籍');
  h.unmount();
});

test('native search filters title and author immediately and opening a result preserves its book id', async () => {
  const h = await ready(); let tree = h.render();
  search(tree).onChangeText({ nativeEvent: { text: '  aLiCe  ' } }); tree = h.render();
  assert.deepEqual(ids(tree), ['sea', 'sky']);
  search(tree).onChangeText({ nativeEvent: { text: '森林' } }); tree = h.render();
  assert.deepEqual(ids(tree), ['forest']);
  const result = find(tree, 'FlatList').props.renderItem({ item: find(tree, 'FlatList').props.data[0] });
  result.props.onPress();
  assert.deepEqual(h.pushes, [{ pathname: '/reader/[id]', params: { id: 'forest' } }]);
  h.unmount();
});

test('cancel clears the query and restores the first focus offset after native search movement', async () => {
  const h = await ready(), tree = h.render(), options = search(tree);
  const scrolled: any[] = [], frames: (() => void)[] = [];
  const oldFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = ((callback: () => void) => { frames.push(callback); return frames.length; }) as any;
  try {
    find(tree, 'FlatList').props.ref.current = { getScrollResponder: () => ({ scrollTo: (value: any) => scrolled.push(value) }) };
    find(tree, 'FlatList').props.onScroll({ nativeEvent: { contentOffset: { y: 240 } } });
    options.onFocus();
    find(tree, 'FlatList').props.onScroll({ nativeEvent: { contentOffset: { y: -160 } } });
    options.onFocus();
    options.onChangeText({ nativeEvent: { text: 'no-match' } }); assert.deepEqual(ids(h.render()), []);
    options.onCancelButtonPress(); assert.deepEqual(ids(h.render()), ['sea', 'forest', 'sky']);
    frames.splice(0).forEach(callback => callback());
    assert.deepEqual(scrolled, [{ y: 240, animated: false }]);
    options.onCancelButtonPress(); assert.equal(frames.length, 0);
  } finally { globalThis.requestAnimationFrame = oldFrame; h.unmount(); }
});

test('empty-search recovery clears the native field and keeps the selected sorting', async () => {
  const h = await ready(); let tree = h.render();
  find(find(tree, 'FlatList').props.ListHeaderComponent, 'MenuView').props.onPressAction({ nativeEvent: { event: 'title' } });
  tree = h.render(); const ordered = ids(tree); let cleared = 0;
  search(tree).ref.current = { clearText() { cleared++; } };
  search(tree).onChangeText({ nativeEvent: { text: 'missing' } }); tree = h.render();
  const empty = find(tree, 'FlatList').props.ListEmptyComponent;
  find(empty, 'EmptyState').props.onAction(); tree = h.render();
  assert.equal(cleared, 1); assert.deepEqual(ids(tree), ordered);
  h.unmount();
});

test('native import action retains progress, cancellation, and the tab interaction lock', async () => {
  let args: any, finish!: (value: any) => void;
  const h = await ready({ importBook: value => { args = value; return new Promise(resolve => { finish = resolve; }); } });
  find(h.render(), 'ToolbarButton').props.onPress(); await flush(); let tree = h.render();
  assert.equal(find(tree, 'ToolbarButton').props.disabled, true); assert.equal(h.locks.at(-1), true);
  args.onProgress({ stage: 'indexing', completed: 2, total: 6 }); tree = h.render();
  const header = find(tree, 'FlatList').props.ListHeaderComponent;
  assert.ok(JSON.stringify(header).includes('正在准备问答资料 · 2/6'));
  nodes(header, n => n.props?.accessibilityLabel === '取消导入')[0].props.onPress();
  assert.equal(args.signal.aborted, true);
  finish({ status: 'cancelled' }); await flush(); tree = h.render();
  assert.equal(find(tree, 'ToolbarButton').props.disabled, false); assert.equal(h.locks.at(-1), false);
  h.unmount();
});
