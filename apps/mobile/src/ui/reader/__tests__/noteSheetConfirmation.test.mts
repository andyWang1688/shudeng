import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { test } from 'node:test';
import * as geometry from '../noteSheetGeometry.ts';

const require = createRequire(new URL('../../../../package.json', import.meta.url));
const ts = require('typescript');
const file = new URL('../NoteSheet.tsx', import.meta.url);
const code = ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

// Actual NoteSheet render/effects. The shared BookNotice separately owns and tests
// animation/dismissal timing; these tests exercise its consumer callbacks/lifetimes.
function sheet(initial: any) {
  const state: any[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  let props = initial;
  const different = (a: any[], b: any[]) => !a || !b || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
  const hooks = {
    useState(initial: any) { const i = cursor++; state[i] ??= { value: initial }; return [state[i].value, (next: any) => { state[i].value = next; }]; },
    useRef(initial: any) { const i = cursor++; return state[i] ??= { current: initial }; },
    useMemo(factory: any, deps: any[]) { const i = cursor++; if (!state[i] || different(state[i].deps, deps)) state[i] = { deps, value: factory() }; return state[i].value; },
    useCallback(callback: any, deps: any[]) { return hooks.useMemo(() => callback, deps); },
    useEffect(effect: any, deps: any[]) { const i = cursor++; if (!state[i] || different(state[i].deps, deps)) {
      const old = state[i]; state[i] = { deps }; effects.push(() => { old?.cleanup?.(); state[i].cleanup = effect(); });
    } },
  };
  const animation = { start() {}, stop() {} };
  class Value {
    value: number;
    constructor(value: number) { this.value = value; }
    addListener() { return 'listener'; } removeListener() {} stopAnimation(callback?: any) { callback?.(this.value); }
    setValue(value: number) { this.value = value; }
  }
  const palette = new Proxy({}, { get: (_target, key) => key });
  const jsx = (type: any, props: any) => ({ type, props });
  const mocks: Record<string, any> = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': {
      Animated: { Value, timing: () => animation, spring: () => animation, parallel: () => animation, View: 'AnimatedView' },
      Easing: { ease: 'ease', inOut: (value: any) => value, in: (value: any) => value, out: (value: any) => value },
      Keyboard: { dismiss() {}, addListener: () => ({ remove() {} }) },
      Platform: { OS: 'ios' }, PanResponder: { create: () => ({ panHandlers: {} }) },
      Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View',
      StyleSheet: { create: (value: any) => value, absoluteFill: {} },
      useWindowDimensions: () => ({ width: 390, height: 844 }),
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) },
    'expo-symbols': { SymbolView: 'SymbolView' },
    '../theme': { usePalette: () => palette, font: {} },
    '../chat/useReduceMotion': { useReduceMotion: () => false },
    '../components/BookNotice': { BookNotice: 'BookNotice' },
    './noteSheetGeometry': geometry,
  };
  const compiled: any = new Module(file.pathname);
  compiled.filename = file.pathname;
  compiled.require = (id: string) => { if (!(id in mocks)) throw Error('Unmocked ' + id); return mocks[id]; };
  compiled._compile(code, file.pathname);
  return { render(next?: any) {
    if (next) props = next;
    cursor = 0;
    const tree = compiled.exports.NoteSheet(props);
    const nextEffects = effects; effects = []; nextEffects.forEach((effect) => effect());
    return tree;
  }, unmount() { state.forEach((entry) => entry.cleanup?.()); } };
}
function find(tree: any, type: string, id?: string): any {
  if (!tree || typeof tree !== 'object') return;
  if (Array.isArray(tree)) return tree.map((entry) => find(entry, type, id)).find(Boolean);
  if (tree.type === type && (!id || tree.props.testID === id)) return tree;
  return find(tree.props?.children, type, id);
}
function base(onDelete: () => void) {
  return { visible: true, quote: '原文', body: '已有正文', saving: false, onDelete,
    onClose() {}, onSave() {}, onChangeBody() {} };
}

test('editor opens one native-copy confirmation and cancelling never deletes or closes the editor', () => {
  let deleted = 0;
  const ui = sheet(base(() => deleted++));
  let tree = ui.render();
  find(tree, 'Pressable', 'note-delete').props.onPress();
  tree = ui.render();
  const card = find(tree, 'BookNotice').props;
  assert.equal(card.title, '删除笔记？');
  assert.equal(card.message, '删除后无法恢复；原文中的高亮与笔记也会移除。');
  card.actions[0].onPress();
  tree = ui.render();
  assert.equal(find(tree, 'BookNotice'), undefined);
  assert.equal(find(tree, 'TextInput', 'note-body').props.value, '已有正文');
  assert.equal(find(tree, 'Modal').props.visible, true);
  assert.equal(deleted, 0);
});

test('confirmed consumer callback is consumed once and old cancelled callbacks cannot delete a later note', () => {
  let deleted = 0;
  const ui = sheet(base(() => deleted++));
  let tree = ui.render();
  find(tree, 'Pressable', 'note-delete').props.onPress();
  const old = find(ui.render(), 'BookNotice').props;
  old.actions[0].onPress(); ui.render();
  find(ui.render(), 'Pressable', 'note-delete').props.onPress();
  const current = find(ui.render(), 'BookNotice').props;
  old.actions[1].onPress();
  assert.equal(deleted, 0);
  current.actions[1].onPress(); current.actions[1].onPress();
  assert.equal(deleted, 1);
  assert.equal(find(ui.render(), 'BookNotice'), undefined);
});

test('external closure or unmount discards pending destructive callbacks', () => {
  let deleted = 0;
  const props = base(() => deleted++);
  const ui = sheet(props);
  find(ui.render(), 'Pressable', 'note-delete').props.onPress();
  const card = find(ui.render(), 'BookNotice').props;
  ui.render({ ...props, visible: false });
  card.actions[1].onPress();
  assert.equal(deleted, 0);
  const other = sheet(props);
  find(other.render(), 'Pressable', 'note-delete').props.onPress();
  const pending = find(other.render(), 'BookNotice').props;
  other.unmount(); pending.actions[1].onPress();
  assert.equal(deleted, 0);
});

test('failure notice is inside the existing editor modal and acknowledgment preserves the body', () => {
  let acknowledged = 0;
  const props = { ...base(() => {}), body: '未保存的新正文',
    notice: { title: '笔记保存失败', message: '内容仍在此页；请检查储存空间后重试保存。' },
    onDismissNotice: () => acknowledged++ };
  const ui = sheet(props);
  const tree = ui.render();
  const modal = find(tree, 'Modal');
  const card = find(modal, 'BookNotice');
  assert.equal(card.props.title, '笔记保存失败');
  card.props.onAcknowledge();
  assert.equal(acknowledged, 1);
  assert.equal(find(ui.render(), 'TextInput', 'note-body').props.value, '未保存的新正文');
  assert.equal(find(ui.render(), 'Modal').props.visible, true);
});
