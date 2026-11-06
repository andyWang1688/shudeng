import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { test } from 'node:test';
import { loader } from '../settings/__tests__/platformHarness.mts';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const ts = require('typescript');
const palette = {
  paper: 'paper', paperDeep: 'paperDeep', ink: 'ink', ink2: 'ink2',
  ink3: 'ink3', error: 'error', errorWash: 'errorWash', line: 'line', lamp: 'lamp',
};

// Execute the actual components with isolated hooks and native ports. No database
// or simulator is loaded; animations and the iOS dismissal event stay controllable.
function component(file: URL, overrides: Record<string, any> = {}) {
  const slots: any[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const changes = (before: any[], after: any[]) => !before || !after ||
    before.length !== after.length || before.some((value, i) => !Object.is(value, after[i]));
  const hooks = {
    useState(initial: any) {
      const index = cursor++;
      slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, (next: any) => {
        slots[index].value = typeof next === 'function' ? next(slots[index].value) : next;
      }];
    },
    useRef(initial: any) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useMemo(factory: () => any, deps: any[]) {
      const index = cursor++;
      if (!slots[index] || changes(slots[index].deps, deps)) slots[index] = { deps, value: factory() };
      return slots[index].value;
    },
    useCallback(callback: any, deps: any[]) { return hooks.useMemo(() => callback, deps); },
    useEffect(effect: () => any, deps: any[]) {
      const index = cursor++;
      if (!slots[index] || changes(slots[index].deps, deps)) {
        const previous = slots[index];
        slots[index] = { deps };
        effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); });
      }
    },
  };
  const animations: any[] = [];
  let motionChanged = (_value: boolean) => {};
  const native = {
    AccessibilityInfo: {
      isReduceMotionEnabled: async () => false,
      addEventListener: (_event: string, callback: any) => {
        motionChanged = callback;
        return { remove() {} };
      },
    },
    Animated: {
      Value: class { value: number; constructor(value: number) { this.value = value; } stopAnimation() {} },
      View: 'AnimatedView',
      timing(value: any, config: any) {
        const animation: any = { config, finish: (_finished = true) => {} };
        animations.push(animation);
        return { start(callback: any) {
          animation.finish = (finished = true) => { value.value = config.toValue; callback?.({ finished }); };
        } };
      },
    },
    Easing: { ease: 'ease', inOut: (value: any) => value },
    Platform: { OS: 'ios' },
    Modal: 'Modal', Pressable: 'Pressable', Text: 'Text', View: 'View',
    FlatList: 'FlatList', ActivityIndicator: 'ActivityIndicator',
    Alert: { alert() { throw new Error('Unexpected system alert'); } },
    StyleSheet: { create: (value: any) => value },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
  };
  const theme = { usePalette: () => palette, spacing: { screen: 20 }, type: { caption: 11 } };
  const jsx = (type: any, props: any) => ({ type, props });
  const modules = {
    react: hooks,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': native,
    '../theme': theme, './theme': theme,
    ...overrides,
  };
  const path = file.pathname;
  const compiled: any = new Module(path);
  compiled.filename = path;
  compiled.require = (id: string) => {
    if (id in modules) return modules[id as keyof typeof modules];
    throw new Error('Unmocked component dependency: ' + id);
  };
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  compiled._compile(code, path);
  return {
    native, animations,
    motionChanged: (value: boolean) => motionChanged(value),
    render(name: string, props: any = {}) {
      cursor = 0;
      const tree = compiled.exports[name](props);
      const pending = effects; effects = [];
      pending.forEach((effect) => effect());
      return tree;
    },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
    hooks,
  };
}

function nodes(tree: any): any[] {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function ofType(tree: any, type: string) { return nodes(tree).filter((node) => node.type === type); }
function text(tree: any): string {
  if (typeof tree === 'string') return tree;
  if (Array.isArray(tree)) return tree.map(text).join('');
  return tree?.props ? text(tree.props.children) : '';
}
function button(tree: any, title: string) {
  const found = ofType(tree, 'Pressable').filter((node) => text(node) === title);
  assert.equal(found.length, 1, 'one button titled ' + title);
  return found[0];
}
function style(node: any, pressed = false): any {
  const value = typeof node.props.style === 'function' ? node.props.style({ pressed }) : node.props.style;
  return Object.assign({}, ...[value].flat(Infinity).filter(Boolean));
}
const noticeFile = new URL('./BookNotice.tsx', import.meta.url);
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test('single 知道了 notice preserves the native geometry and primary appearance', () => {
  const ui = component(noticeFile);
  const tree = ui.render('BookNotice', { title: '扫描页', message: '说明', onAcknowledge() {} });
  assert.equal(ofType(tree, 'Modal')[0].props.visible, true);
  const card = ofType(tree, 'View').find((node) => node.props.accessibilityViewIsModal);
  assert.equal(style(card).width, 320);
  assert.equal(style(card).borderRadius, 22);
  assert.equal(style(card).paddingHorizontal, 20);
  const action = button(tree, '知道了');
  assert.equal(style(action).minHeight, 44);
  assert.equal(style(action).backgroundColor, palette.ink);
  assert.equal(style(ofType(action, 'Text')[0]).color, palette.paper);
  assert.equal(ofType(action, 'Text')[0].props.dynamicTypeRamp, 'subheadline');
});

test('native action order, primary selection and destructive colours are retained', () => {
  const ui = component(noticeFile);
  const tree = ui.render('BookNotice', { title: '确认', message: '说明', actions: [
    { title: '取消', style: 'cancel', onPress() {} },
    { title: '彻底删除', style: 'destructive', onPress() {} },
    { title: '继续', onPress() {} },
    { title: '其他', onPress() {} },
    { title: '第二个取消', style: 'cancel', onPress() {} },
  ] });
  assert.deepEqual(ofType(tree, 'Pressable').map(text), ['彻底删除', '继续', '其他', '取消']);
  for (const [title, background, foreground] of [
    ['彻底删除', palette.errorWash, palette.error],
    ['继续', palette.ink, palette.paper],
    ['其他', palette.paperDeep, palette.ink],
    ['取消', palette.paperDeep, palette.ink],
  ]) {
    const action = button(tree, title);
    assert.equal(style(action).backgroundColor, background);
    assert.equal(style(ofType(action, 'Text')[0]).color, foreground);
  }
});

test('iOS dispatches once after fade completion and actual Modal dismissal', async () => {
  const ui = component(noticeFile);
  const calls: string[] = [];
  const props = { title: '确认', message: '说明', actions: [
    { title: '移除', onPress: () => calls.push('remove') },
    { title: '取消', style: 'cancel', onPress: () => calls.push('cancel') },
  ] };
  let tree = ui.render('BookNotice', props);
  ofType(tree, 'Modal')[0].props.onShow();
  await settle();
  assert.equal(ui.animations[0].config.duration, 350);
  button(tree, '移除').props.onPress();
  button(tree, '移除').props.onPress();
  button(tree, '取消').props.onPress();
  assert.equal(ui.animations.length, 2);
  assert.equal(ui.animations[1].config.duration, 160);
  assert.deepEqual(calls, []);
  tree = ui.render('BookNotice', props);
  assert.ok(ofType(tree, 'Pressable').every((node) => node.props.disabled && node.props.accessibilityState.disabled));
  ui.animations[1].finish();
  tree = ui.render('BookNotice', props);
  assert.equal(ofType(tree, 'Modal')[0].props.visible, false);
  assert.deepEqual(calls, []);
  ofType(tree, 'Modal')[0].props.onDismiss();
  ofType(tree, 'Modal')[0].props.onDismiss();
  assert.deepEqual(calls, ['remove']);
});

test('only the first default action is primary when the same action object is reused', () => {
  const ui = component(noticeFile);
  const action = { title: '继续', onPress() {} };
  const tree = ui.render('BookNotice', { title: '确认', message: '说明', actions: [action, action] });
  assert.deepEqual(ofType(tree, 'Pressable').map((node) => style(node).backgroundColor), [palette.ink, palette.paperDeep]);
});

test('cancel dismisses without running the destructive action or a background callback', () => {
  const ui = component(noticeFile);
  const calls: string[] = [];
  const props = { title: '确认', message: '说明', actions: [
    { title: '删除', style: 'destructive', onPress: () => calls.push('delete') },
    { title: '取消', style: 'cancel', onPress: () => calls.push('cancel') },
  ] };
  let tree = ui.render('BookNotice', props);
  assert.ok(ofType(tree, 'AnimatedView').every((node) => !node.props.onPress));
  ofType(tree, 'Modal')[0].props.onRequestClose();
  assert.deepEqual(calls, []);
  button(tree, '取消').props.onPress();
  ui.animations.at(-1).finish();
  tree = ui.render('BookNotice', props);
  ofType(tree, 'Modal')[0].props.onDismiss();
  assert.deepEqual(calls, ['cancel']);
});

test('reduce motion removes both fades, including an early press before settings resolve', async () => {
  const ui = component(noticeFile);
  ui.native.AccessibilityInfo.isReduceMotionEnabled = async () => true;
  const props = { title: '确认', message: '说明', onAcknowledge() {} };
  const tree = ui.render('BookNotice', props);
  ofType(tree, 'Modal')[0].props.onShow();
  await settle();
  button(tree, '知道了').props.onPress();
  assert.deepEqual(ui.animations.map((value) => value.config.duration), [0, 0]);
  const early = component(noticeFile);
  button(early.render('BookNotice', props), '知道了').props.onPress();
  assert.equal(early.animations[0].config.duration, 0);
});

test('an unmounted or interrupted notice never executes a pending handler', () => {
  let calls = 0;
  const props = { title: '确认', message: '说明', onAcknowledge() { calls++; } };
  const ui = component(noticeFile);
  const tree = ui.render('BookNotice', props);
  button(tree, '知道了').props.onPress();
  ui.unmount();
  ui.animations.at(-1).finish();
  ofType(tree, 'Modal')[0].props.onDismiss();
  assert.equal(calls, 0);
  const interrupted = component(noticeFile);
  const other = interrupted.render('BookNotice', props);
  button(other, '知道了').props.onPress();
  interrupted.animations.at(-1).finish(false);
  assert.equal(ofType(interrupted.render('BookNotice', props), 'Modal')[0].props.visible, true);
  assert.equal(calls, 0);
});

async function shelf(removed: boolean, operation?: () => Promise<void>) {
  const calls: string[] = [];
  const otherCalls: string[] = [];
  const fixture = { id: 'selected-book', title: '唯一测试书', format: 'EPUB', author: '作者',
    coverUri: null, progressPercent: null, removed };
  let ui: ReturnType<typeof component>;
  let nativeSearch: any;
  ui = component(new URL('../ShelfScreen.tsx', import.meta.url), {
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-router': { Stack: { Screen: 'StackScreen', Toolbar: Object.assign('StackToolbar', { Button: 'ToolbarButton' }) }, useRouter: () => ({ push() { otherCalls.push('navigate'); } }), useFocusEffect: (callback: any) => ui.hooks.useEffect(callback, [callback]) },
    'expo-symbols': { SymbolView: 'SymbolView' },
    '@expo/ui/community/menu': { MenuView: 'MenuView' },
    '../platform/db': { initializeDatabase: async () => ({ ok: true }) },
    '../platform/library': {
      migrateLegacyLibraryIfNeeded: async () => ({ failures: 0 }),
      loadShelfBooks: async () => [fixture],
      importBookFromPicker: async () => { otherCalls.push('import'); return { status: 'cancelled' }; },
      removeShelfBook: async (id: string) => { calls.push('remove:' + id); await operation?.(); },
      deleteShelfBook: async (id: string) => { calls.push('delete:' + id); await operation?.(); },
    },
    '../platform/library/pdfImport': {
      importFailureNotice: (cause: unknown) => ({ title: '导入未完成', message: String(cause) }),
      requestPdfImportConfirmation() { throw new Error('Unexpected PDF import confirmation'); },
    },
    './components/BookCover': { BookCover: 'BookCover' },
    './components/BookNotice': { BookNotice: 'BookNotice' },
    './components/EmptyState': { EmptyState: 'EmptyState' },
    './components/SectionHeader': { SectionHeader: 'SectionHeader' },
    './components/useHaptics': { useHaptics: () => () => {} },
    './tabInteraction': { useTabInteractionLock() {} },
    './navigation/useNativeListSearch': { useNativeListSearch: (options: any) => {
      nativeSearch ??= loader({ react: ui.hooks })('apps/mobile/src/ui/navigation/useNativeListSearch.ts');
      return nativeSearch.useNativeListSearch(options);
    } },
  });
  ui.render('ShelfScreen');
  await settle();
  const tree = ui.render('ShelfScreen');
  const card = ofType(tree, 'FlatList')[0].props.renderItem({ item: fixture });
  return { ui, calls, otherCalls, card, fixture };
}

for (const permanent of [false, true]) {
  test('Shelf ' + (permanent ? 'permanent delete' : 'soft remove') + ' uses the native contract and only the selected id', async () => {
    const { ui, calls, card } = await shelf(permanent);
    if (permanent) card.props.onPress(); else card.props.onLongPress();
    let tree = ui.render('ShelfScreen');
    const props = ofType(tree, 'BookNotice')[0].props;
    assert.equal(props.title, permanent ? '彻底删除这本书及记录？' : '移除原书？');
    assert.equal(props.message, permanent
      ? '将删除《唯一测试书》的原书、笔记、草稿、对话与引用记录，无法撤销。其他书籍不受影响。'
      : '保留笔记、草稿、对话与引用文字；正在进行的准备和回答将取消。重新导入相同文件后可返回原文并继续问答。');
    const notice = component(noticeFile);
    let dialog = notice.render('BookNotice', props);
    const title = permanent ? '确认彻底删除' : '移除原书，保留记录';
    assert.equal(props.actions[1].style, permanent ? 'destructive' : 'default');
    button(dialog, title).props.onPress();
    button(dialog, title).props.onPress();
    notice.animations.at(-1).finish();
    await settle();
    assert.deepEqual(calls, []);
    dialog = notice.render('BookNotice', props);
    ofType(dialog, 'Modal')[0].props.onDismiss();
    ofType(dialog, 'Modal')[0].props.onDismiss();
    await settle();
    assert.deepEqual(calls, [(permanent ? 'delete:' : 'remove:') + 'selected-book']);
    tree = ui.render('ShelfScreen');
    assert.equal(ofType(tree, 'BookNotice').length, 0);
  });

  test('Shelf ' + (permanent ? 'permanent delete' : 'soft remove') + ' cancel performs no library mutation', async () => {
    const { ui, calls, card } = await shelf(permanent);
    card.props.onLongPress();
    const props = ofType(ui.render('ShelfScreen'), 'BookNotice')[0].props;
    const notice = component(noticeFile);
    let dialog = notice.render('BookNotice', props);
    button(dialog, '取消').props.onPress();
    notice.animations.at(-1).finish();
    dialog = notice.render('BookNotice', props);
    ofType(dialog, 'Modal')[0].props.onDismiss();
    await settle();
    assert.deepEqual(calls, []);
    assert.equal(ofType(ui.render('ShelfScreen'), 'BookNotice').length, 0);
  });
}

test('Shelf ignores a second removal request while the confirmed operation is running', async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const { ui, calls, otherCalls, card } = await shelf(false, () => pending);
  card.props.onLongPress();
  let tree = ui.render('ShelfScreen');
  const props = ofType(tree, 'BookNotice')[0].props;
  props.actions[1].onPress();
  await settle();
  tree = ui.render('ShelfScreen');
  const list = ofType(tree, 'FlatList')[0];
  const another = list.props.renderItem({ item: { id: 'another-book', title: '另一书', removed: false } });
  another.props.onLongPress();
  card.props.onPress();
  ofType(tree, 'ToolbarButton')[0].props.onPress();
  await settle();
  assert.equal(ofType(ui.render('ShelfScreen'), 'BookNotice').length, 0);
  assert.deepEqual(calls, ['remove:selected-book']);
  assert.deepEqual(otherCalls, [], 'native busy state also prevents reopening and importing');
  finish();
  await settle();
});

test('Shelf removal failure uses the native retry card and retry targets the same id and operation', async () => {
  for (const permanent of [false, true]) {
    let attempts = 0;
    const { ui, calls, card } = await shelf(permanent, async () => { if (++attempts === 1) throw Error('磁盘不可写'); });
    card.props.onLongPress();
    const confirmation = ofType(ui.render('ShelfScreen'), 'BookNotice')[0].props;
    confirmation.actions[1].onPress();
    await settle();
    const failed = ofType(ui.render('ShelfScreen'), 'BookNotice')[0];
    assert.equal(failed.props.title, '移除尚未完成');
    assert.equal(failed.props.message, '磁盘不可写 已完成的清理不会撤销，请重试完成本次操作。');
    assert.deepEqual(failed.props.actions.map((action: any) => [action.title, action.style]), [['稍后重试', 'cancel'], ['重试', 'default']]);
    failed.props.actions[1].onPress(); failed.props.actions[1].onPress();
    await settle();
    const expected = (permanent ? 'delete:' : 'remove:') + 'selected-book';
    assert.deepEqual(calls, [expected, expected]);
    assert.equal(ofType(ui.render('ShelfScreen'), 'BookNotice').length, 0);
  }
});

test('Shelf repeated failure remounts the closed notice and later retry dismissal performs no operation', async () => {
  const { ui, calls, card } = await shelf(false, async () => { throw Error('磁盘不可写'); });
  card.props.onLongPress();
  ofType(ui.render('ShelfScreen'), 'BookNotice')[0].props.actions[1].onPress();
  await settle();
  const first = ofType(ui.render('ShelfScreen'), 'BookNotice')[0];
  first.props.actions[1].onPress();
  await settle();
  const second = ofType(ui.render('ShelfScreen'), 'BookNotice')[0];
  // The JSX runtime mock omits key, so verify the source's keyed lifetime as well.
  assert.match(readFileSync(new URL('../ShelfScreen.tsx', import.meta.url), 'utf8'), /key=\{removalFailure\.id\}/);
  assert.equal(second.props.title, '移除尚未完成');
  second.props.actions[0].onPress();
  await settle();
  assert.equal(ofType(ui.render('ShelfScreen'), 'BookNotice').length, 0);
  assert.deepEqual(calls, ['remove:selected-book', 'remove:selected-book']);
});

test('Shelf removal finishes its authorized operation but does not publish a late failure after unmount', async () => {
  let reject!: (reason: Error) => void;
  const pending = new Promise<void>((_resolve, fail) => { reject = fail; });
  const { ui, calls, card } = await shelf(false, () => pending);
  card.props.onLongPress();
  ofType(ui.render('ShelfScreen'), 'BookNotice')[0].props.actions[1].onPress();
  await settle();
  ui.unmount();
  reject(Error('late disk error'));
  await settle();
  assert.deepEqual(calls, ['remove:selected-book']);
  assert.equal(ofType(ui.render('ShelfScreen'), 'BookNotice').length, 0);
});
