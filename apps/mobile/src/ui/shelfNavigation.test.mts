import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { hooks, jsx, loader, nativePorts, nodes, root } from './settings/__tests__/platformHarness.mts';

const require = createRequire(path.join(root, 'apps/mobile/package.json'));
const ts = require('typescript');
const { getRoutes } = require('expo-router/build/getRoutes');
const { getReactNavigationConfig } = require('expo-router/build/getReactNavigationConfig');
const { getStateFromPath } = require('expo-router/build/fork/getStateFromPath');
const { getValidInitialRouteName } = require('expo-router/build/routeNode');

// Use the real app file tree and exported route settings with Expo's own parser.
// Layout UI imports are not needed to exercise filesystem routing and anchors.
function routeTree() {
  const app = path.join(root, 'apps/mobile/app');
  const keys = readdirSync(app, { recursive: true }).filter(file => /.[jt]sx?$/.test(String(file))).map(file => './' + file);
  const context = Object.assign((key: string) => {
    const file = path.join(app, key);
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    let settings;
    for (const statement of source.statements) if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (declaration.name.getText(source) === 'unstable_settings') settings = Function('return (' + declaration.initializer.getText(source) + ')')();
    return { default: () => null, unstable_settings: settings };
  }, { keys: () => keys });
  return getRoutes(context, { skipGenerated: true, platform: 'ios' });
}
function activeNames(state: any): string[] {
  const names: string[] = [];
  while (state) { const route = state.routes[state.index ?? state.routes.length - 1]; names.push(route.name); state = route.state; }
  return names;
}

test('real Expo routes resolve root and the legacy tabs destination to the shelf stack', () => {
  const routes = routeTree(), config = getReactNavigationConfig(routes, true);
  const tabs = routes.children.find((route: any) => route.route === '(tabs)');
  assert.equal(getValidInitialRouteName(tabs), '(shelf)');
  assert.equal(getValidInitialRouteName(tabs.children.find((route: any) => route.route === '(shelf)')), 'index');
  for (const url of ['/', '/(tabs)', '/(tabs)/(shelf)'])
    assert.deepEqual(activeNames(getStateFromPath(url, config)), ['(tabs)', '(shelf)', 'index']);
  assert.deepEqual(activeNames(getStateFromPath('/notes', config)), ['(tabs)', 'notes', 'index']);
  assert.deepEqual(activeNames(getStateFromPath('/conversations', config)), ['(tabs)', 'conversations', 'index']);
  const book = getStateFromPath('/reader/book123', config);
  assert.deepEqual(activeNames(book), ['reader/[id]']); assert.equal(book.routes[0].params.id, 'book123');
});

test('shelf stack uses the same native large-title appearance as notes and loads the shelf route', () => {
  const palette = { lamp: 'lamp', paper: 'paper', ink: 'ink' };
  const load = loader({
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'expo-router': { Stack: 'Stack' },
    '../../../src/ui/theme': { usePalette: () => palette }, '../../../src/ui/ShelfScreen': { ShelfScreen: 'ShelfScreen' },
  });
  const shelf = load('apps/mobile/app/(tabs)/(shelf)/_layout.tsx').default().props.screenOptions;
  const notes = load('apps/mobile/app/(tabs)/notes/_layout.tsx').default().props.screenOptions;
  const conversations = load('apps/mobile/app/(tabs)/conversations/_layout.tsx').default().props.screenOptions;
  assert.deepEqual(shelf, { ...notes, title: '书架' });
  assert.deepEqual(conversations, { ...notes, title: '对话' });
  assert.equal(load('apps/mobile/app/(tabs)/(shelf)/index.tsx').default().type, 'ShelfScreen');
});

test('tabs keep shelf first and the bottom bar switches to the new shelf route key', () => {
  const h = hooks(), selected: string[] = [];
  const layout = loader({
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'expo-router': { Tabs: Object.assign('Tabs', { Screen: 'TabScreen' }) },
    '../../src/ui/BottomBar': { BottomBar: 'BottomBar' }, '../../src/ui/tabInteraction': { TabInteractionProvider: 'Provider' },
  })('apps/mobile/app/(tabs)/_layout.tsx').default();
  assert.deepEqual(nodes(layout, n => n.type === 'TabScreen').map(n => n.props.name), ['(shelf)', 'notes', 'conversations', '(profile)']);
  const BottomBar = loader({
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': nativePorts([]),
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    'expo-symbols': { SymbolView: 'SymbolView' }, './components/useHaptics': { useHaptics: () => () => {} },
    './tabInteraction': { useTabInteractionLocked: () => false }, './theme': { spacing: {}, type: {}, usePalette: () => ({}) },
  })('apps/mobile/src/ui/BottomBar.tsx').BottomBar;
  const state = { index: 1, routes: ['(shelf)', 'notes', 'conversations', '(profile)'].map((name, i) => ({ name, key: 'tab-' + i })) };
  const bar = h.render(() => BottomBar({ state, navigateToTab: (key: string) => selected.push(key) }));
  const buttons = nodes(bar, n => n.props?.accessibilityRole === 'tab');
  assert.deepEqual(buttons.map(n => n.props.accessibilityLabel), ['书架', '笔记', '对话', '我的']);
  assert.equal(buttons[1].props.accessibilityState.selected, true);
  buttons[0].props.onPress(); assert.deepEqual(selected, ['tab-0']);
  h.unmount();
});
