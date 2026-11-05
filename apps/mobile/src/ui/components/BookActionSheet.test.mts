import assert from "node:assert/strict";
import { test } from "node:test";
import { hooks, jsx, loader, nodes } from "../settings/__tests__/platformHarness.mts";

// Actual component callbacks, with controllable native animation/dismissal ports.
// These checks do not establish UIKit rendering, geometry, or VoiceOver behavior.
const sheetFile = "apps/mobile/src/ui/components/BookActionSheet.tsx";
const profileFile = "apps/mobile/app/(tabs)/(profile)/profile.tsx";
const palette = { paper: "paper", paperDeep: "deep", ink: "ink", ink2: "ink2", line: "line" };
function harness(platform = "ios", reduced = false) {
  const state = hooks();
  const animations: { config: any; finish: (finished?: boolean) => void }[] = [];
  const native = {
    Platform: { OS: platform },
    AccessibilityInfo: {
      isReduceMotionEnabled: async () => reduced,
      addEventListener: () => ({ remove() {} }),
    },
    Animated: {
      Value: class { value: number; constructor(value: number) { this.value = value; } stopAnimation() {} },
      View: "AnimatedView",
      timing: (_value: unknown, config: any) => ({ start(callback?: (result: any) => void) {
        animations.push({ config, finish: (finished = true) => callback?.({ finished }) });
      } }),
    },
    Easing: { ease: "ease", inOut: (value: unknown) => value },
    Modal: "Modal", Pressable: "Pressable", Text: "Text", View: "View", ScrollView: "ScrollView",
    StyleSheet: { create: (value: unknown) => value },
  };
  const load = loader({
    react: state.react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": native,
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ bottom: 34 }), SafeAreaView: "SafeAreaView" },
    "../theme": { usePalette: () => palette },
  });
  const { BookActionSheet } = load(sheetFile);
  return { ...state, native, animations, render: (props: any) => state.render(() => BookActionSheet(props)) };
}
function one(tree: any, type: any, label?: string) {
  const matches = nodes(tree, node => node.type === type && (label === undefined || node.props.accessibilityLabel === label));
  assert.equal(matches.length, 1);
  return matches[0];
}
function fixture(selected: string[] = [], cancelled: string[] = []) {
  return {
    title: "外观", message: "选择适合此刻阅读的界面外观。",
    actions: ["跟随系统", "浅色", "深色"].map(title => ({ key: title, title, onPress: () => selected.push(title) })),
    onCancel: () => cancelled.push("cancel"),
  };
}

test("iOS选择必须等淡出和原生dismiss后才执行，重复输入只执行一次", async () => {
  const selected: string[] = [];
  const ui = harness(); const props = fixture(selected);
  let tree = ui.render(props);
  await one(tree, "Modal").props.onShow();
  assert.equal(ui.animations.at(-1)!.config.duration, 350);
  ui.animations.at(-1)!.finish();
  one(tree, "Pressable", "深色").props.onPress();
  one(tree, "Pressable", "浅色").props.onPress();
  assert.equal(ui.animations.at(-1)!.config.duration, 160);
  assert.deepEqual(selected, []);
  tree = ui.render(props);
  assert.equal(one(tree, "Pressable", "浅色").props.disabled, true);
  ui.animations.at(-1)!.finish();
  tree = ui.render(props);
  assert.equal(one(tree, "Modal").props.visible, false);
  assert.deepEqual(selected, []);
  one(tree, "Modal").props.onDismiss();
  one(tree, "Modal").props.onDismiss();
  assert.deepEqual(selected, ["深色"]);
  ui.unmount();
});

for (const exit of ["button", "backdrop", "system-back", "accessibility-escape"]) {
  test(exit + "取消只在关闭后返回，不保存任何外观", () => {
    const selected: string[] = [], cancelled: string[] = [];
    const ui = harness(); const props = fixture(selected, cancelled);
    let tree = ui.render(props);
    if (exit === "button") one(tree, "Pressable", "取消").props.onPress();
    if (exit === "backdrop") nodes(tree, n => n.props?.testID === "book-action-sheet-backdrop")[0].props.onPress();
    if (exit === "system-back") one(tree, "Modal").props.onRequestClose();
    if (exit === "accessibility-escape") nodes(tree, n => n.props?.accessibilityViewIsModal)[0].props.onAccessibilityEscape();
    assert.deepEqual(cancelled, []);
    ui.animations.at(-1)!.finish(); tree = ui.render(props);
    one(tree, "Modal").props.onDismiss();
    assert.deepEqual(selected, []); assert.deepEqual(cancelled, ["cancel"]);
    ui.unmount();
  });
}

test("非iOS没有onDismiss时仍在动画完成后仅调用一次", () => {
  const selected: string[] = []; const ui = harness("android"); const props = fixture(selected);
  const tree = ui.render(props); one(tree, "Pressable", "浅色").props.onPress();
  assert.deepEqual(selected, []); ui.animations.at(-1)!.finish();
  one(tree, "Modal").props.onDismiss(); assert.deepEqual(selected, ["浅色"]); ui.unmount();
});

test("减少动态效果仍等待关闭；unmount或中断动画不能保存选择", async () => {
  const selected: string[] = []; const ui = harness("ios", true); const props = fixture(selected);
  const tree = ui.render(props); await one(tree, "Modal").props.onShow();
  assert.equal(ui.animations.at(-1)!.config.duration, 0);
  one(tree, "Pressable", "浅色").props.onPress();
  assert.equal(ui.animations.at(-1)!.config.duration, 0);
  ui.animations.at(-1)!.finish(false); assert.deepEqual(selected, []);
  ui.unmount(); ui.animations.at(-1)!.finish(); one(tree, "Modal").props.onDismiss();
  assert.deepEqual(selected, []);
});

test("真实profile入口三选项保留当前✓与setMode，取消后可重开", () => {
  const state = hooks(); const saved: string[] = []; const Sheet = Symbol("BookActionSheet");
  const load = loader({
    react: state.react, "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { Pressable: "Pressable", ScrollView: "ScrollView", View: "View", Text: "Text", StyleSheet: { create: (x: any) => x } },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "expo-router": { useRouter: () => ({ push() {} }), useFocusEffect() {} },
    "expo-symbols": { SymbolView: "SymbolView" },
    "../../../src/platform/aiConfig": {},
    "../../../src/ui/appearance": { useAppearance: () => ({ mode: "dark", setMode: (x: string) => saved.push(x) }) },
    "../../../src/ui/theme": { usePalette: () => palette, spacing: {}, type: {} },
    "../../../src/ui/components/BookActionSheet": { BookActionSheet: Sheet },
  });
  const Profile = load(profileFile).default; const render = () => state.render(Profile);
  let tree = render();
  const open = one(tree, "Pressable", "外观"); open.props.onPress(); open.props.onPress();
  tree = render(); let sheet = one(tree, Sheet);
  assert.deepEqual(sheet.props.actions.map((a: any) => a.title), ["跟随系统", "浅色", "✓ 深色"]);
  assert.deepEqual(saved, []); sheet.props.onCancel();
  tree = render(); assert.equal(nodes(tree, n => n.type === Sheet).length, 0);
  one(tree, "Pressable", "外观").props.onPress(); tree = render(); sheet = one(tree, Sheet);
  sheet.props.actions[0].onPress();
  assert.deepEqual(saved, ["system"]);
  assert.equal(nodes(render(), n => n.type === Sheet).length, 0); state.unmount();
});
