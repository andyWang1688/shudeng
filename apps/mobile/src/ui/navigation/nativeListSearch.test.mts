import test from 'node:test';
import assert from 'node:assert/strict';
import { hooks, loader } from '../settings/__tests__/platformHarness.mts';
import { nativeListNavigationOptions } from './nativeListNavigationOptions.ts';

const palette = { lamp: 'lamp', ink: 'ink', paper: 'paper' };
const change = (text: string) => ({ nativeEvent: { text } });
const scroll = (y: number) => ({ nativeEvent: { contentOffset: { y } } });
function searchHarness() {
  const h = hooks(), restored: number[] = [];
  const useSearch = loader({ react: h.react })('apps/mobile/src/ui/navigation/useNativeListSearch.ts').useNativeListSearch;
  const render = (restoreOffset = (y: number) => { restored.push(y); }) => h.render(() => useSearch({ placeholder: 'Find books', palette, restoreOffset }));
  return { render, restored, unmount: h.unmount, replayEffects: h.restart };
}
function withFrames(operation: (frames: (() => void)[]) => void) {
  const frames: (() => void)[] = [];
  const previous = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = ((callback: () => void) => { frames.push(callback); return frames.length; }) as any;
  try { operation(frames); } finally { globalThis.requestAnimationFrame = previous; }
}

test('native list navigation preserves title geometry, scroll-edge transparency and palette colors', () => {
  for (const colors of [palette, { lamp: 'dark-lamp', ink: 'dark-ink', paper: 'dark-paper' }]) {
    const options = nativeListNavigationOptions(colors);
    assert.equal(options.headerShown, true); assert.equal(options.headerLargeTitleEnabled, true);
    assert.equal(options.headerLargeTitleShadowVisible, false); assert.equal(options.headerShadowVisible, false);
    assert.deepEqual(options.headerLargeStyle, { backgroundColor: 'transparent' });
    assert.deepEqual(options.headerStyle, { backgroundColor: colors.paper });
    assert.deepEqual(options.contentStyle, { backgroundColor: colors.paper });
    assert.deepEqual(options.headerLargeTitleStyle, { fontFamily: 'SongtiSC-Bold', fontSize: 30, fontWeight: '600', color: colors.ink });
    assert.deepEqual(options.headerTitleStyle, { fontFamily: 'SongtiSC-Bold', fontSize: 17, fontWeight: '600', color: colors.ink });
    assert.equal(options.headerTintColor, colors.lamp);
    assert.equal('title' in options, false);
  }
});

test('search owns the query without echoing text into native input and only clear sends a native command', () => {
  const h = searchHarness(); let state = h.render(), cleared = 0;
  const options = state.headerSearchBarOptions;
  options.ref.current = { clearText() { cleared++; } };
  assert.equal(state.query, '');
  options.onChangeText(change('Book')); state = h.render();
  assert.equal(state.query, 'Book'); assert.equal(cleared, 0);
  assert.equal('text' in state.headerSearchBarOptions || 'value' in state.headerSearchBarOptions, false);
  state.clear(); state = h.render();
  assert.equal(state.query, ''); assert.equal(cleared, 1); assert.deepEqual(h.restored, []);
  h.unmount();
});

test('cancel restores the first focus offset once after filtering has been cleared', () => withFrames(frames => {
  const h = searchHarness(); let state = h.render();
  state.onScroll(scroll(160)); state.headerSearchBarOptions.onFocus();
  state.onScroll(scroll(-100)); state.headerSearchBarOptions.onFocus();
  state.headerSearchBarOptions.onChangeText(change('Filter'));
  state = h.render(); state.headerSearchBarOptions.onCancelButtonPress();
  state.headerSearchBarOptions.onCancelButtonPress();
  assert.equal(h.render().query, ''); assert.deepEqual(h.restored, []);
  assert.equal(frames.length, 1); frames.shift()!();
  assert.deepEqual(h.restored, [160]); h.unmount();
}));

test('a new focus invalidates an earlier cancellation frame and captures the new session offset', () => withFrames(frames => {
  const h = searchHarness(), state = h.render(), options = state.headerSearchBarOptions;
  state.onScroll(scroll(140)); options.onFocus(); options.onCancelButtonPress();
  state.onScroll(scroll(360)); options.onFocus();
  frames.shift()!(); assert.deepEqual(h.restored, []);
  options.onCancelButtonPress(); frames.shift()!(); assert.deepEqual(h.restored, [360]);
  h.unmount();
}));

test('unmount and effect replay invalidate scheduled restoration without reviving old callbacks', () => withFrames(frames => {
  for (const replay of [false, true]) {
    const h = searchHarness(); let state = h.render();
    state.onScroll(scroll(80)); state.headerSearchBarOptions.onFocus(); state.headerSearchBarOptions.onCancelButtonPress();
    if (replay) h.replayEffects(); else h.unmount();
    frames.shift()!(); assert.deepEqual(h.restored, []);
    if (replay) {
      state = h.render(); state.onScroll(scroll(200)); state.headerSearchBarOptions.onFocus(); state.headerSearchBarOptions.onCancelButtonPress();
      frames.shift()!(); assert.deepEqual(h.restored, [200]); h.unmount();
    }
  }
}));

test('deferred restoration uses the current list callback after rendering', () => withFrames(frames => {
  const h = searchHarness(), old: number[] = [], current: number[] = [];
  const state = h.render(y => { old.push(y); });
  state.onScroll(scroll(270)); state.headerSearchBarOptions.onFocus(); state.headerSearchBarOptions.onCancelButtonPress();
  h.render(y => { current.push(y); }); frames.shift()!();
  assert.deepEqual(old, []); assert.deepEqual(current, [270]); h.unmount();
}));
