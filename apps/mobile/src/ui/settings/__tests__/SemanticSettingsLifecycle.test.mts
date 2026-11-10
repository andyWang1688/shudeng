import test from "node:test";
import assert from "node:assert/strict";
import { hooks, jsx, loader, nativePorts, nodes, parts, flush } from "./platformHarness.mts";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function semantic() {
  const h = hooks();
  const reads: ReturnType<typeof deferred<any>>[] = [];
  const removal = deferred<void>(), cancellation = deferred<void>();
  let focused = true, removed = 0, cancelled = 0, prepared = 0;
  let preparationChanged: (value: any) => void = () => {};
  const Screen = loader({
    react: h.react, "react/jsx-runtime": { jsx, jsxs: jsx }, "react-native": nativePorts([]),
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" }, "expo-symbols": { SymbolView: "SymbolView" },
    "../theme": { usePalette: () => ({}) }, "./SettingsParts": parts, "../components/BookNotice": { BookNotice: "BookNotice" },
    "expo-router": { useFocusEffect: (fn: any) => h.react.useEffect(() => focused ? fn() : undefined, [fn, focused]) },
    "../../platform/semanticModel": {
      getSemanticModelState() { const read = deferred<any>(); reads.push(read); return read.promise; },
      removeSemanticModel() { removed++; return removal.promise; },
    },
    "../../platform/settings/semanticPreparation": {
      observeSemanticPreparation(listener: (value: any) => void) { preparationChanged = listener; return () => { preparationChanged = () => {}; }; },
      cancelSemanticPreparation() { cancelled++; return cancellation.promise; },
      prepareExistingBooks() { prepared++; },
    },
  })("apps/mobile/src/ui/settings/SemanticSettingsScreen.tsx").SemanticSettingsScreen;
  return {
    render: () => h.render(() => Screen({ onBack() {} })), reads, removal, cancellation,
    emit(value: any) { preparationChanged(value); }, get removed() { return removed; }, get cancelled() { return cancelled; }, get prepared() { return prepared; },
    blur() { focused = false; }, focus() { focused = true; }, unmount: h.unmount,
  };
}
const row = (tree: any, id = "ai-semantic") => nodes(tree, n => n.props?.testID === id)[0];
const action = (tree: any, title: string) => nodes(tree, n => n.type === "SettingsAction" && n.props.title === title)[0];
const notice = (tree: any) => nodes(tree, n => n.type === "BookNotice")[0];

test("semantic state failures stay visible and block actions until retry succeeds", async () => {
  const h = semantic(); h.render(); h.reads[0]!.reject(new Error("disk unavailable")); await flush();
  let tree = h.render(); assert.equal(row(tree).props.disabled, true);
  const retry = nodes(tree, n => n.type === "SettingsRow" && n.props.title === "disk unavailable")[0]; assert.ok(retry);
  retry.props.onPress(); h.reads[1]!.resolve({ installed: true }); await flush();
  tree = h.render(); assert.equal(row(tree).props.disabled, false); assert.equal(row(tree).props.detail, "已下载 · 约 81MB"); h.unmount();
});
test("semantic stale refresh cannot overwrite a newer focused install state", async () => {
  const h = semantic(); h.render(); h.blur(); h.render(); h.focus(); h.render();
  h.reads[1]!.resolve({ installed: true }); await flush(); h.reads[0]!.resolve({ installed: false }); await flush();
  assert.equal(row(h.render()).props.detail, "已下载 · 约 81MB"); h.unmount();
});
test("semantic deletion waits for preparation cancellation and locks repeat operations", async () => {
  const h = semantic(); h.render(); h.reads[0]!.resolve({ installed: true }); await flush();
  row(h.render()).props.onPress(); const card = notice(h.render()); card.props.actions[1].onPress(); card.props.actions[1].onPress();
  assert.equal(h.cancelled, 1); assert.equal(h.removed, 0); assert.equal(row(h.render()).props.disabled, true);
  h.cancellation.resolve(); await flush(); assert.equal(h.removed, 1);
  h.removal.resolve(); await flush(); assert.equal(row(h.render()).props.detail, "未下载 · 约 81MB"); h.unmount();
});
test("semantic preparation reports progress and supports cancel then retry", async () => {
  const h = semantic(); h.render(); h.reads[0]!.resolve({ installed: true }); await flush();
  h.emit({ running: true, total: 3, completed: 1, failed: 0, cancelled: false, detail: "正在准备书籍" });
  const tree = h.render(); assert.ok(nodes(tree, n => n.type === "SettingsRow" && n.props.detail === "1 / 3 本 · 正在准备书籍").length);
  action(tree, "取消准备").props.onPress(); action(tree, "取消准备").props.onPress(); assert.equal(h.cancelled, 1);
  h.cancellation.resolve(); h.emit({ running: false, total: 3, completed: 1, failed: 0, cancelled: true, detail: "已取消准备" }); await flush();
  action(h.render(), "重试准备").props.onPress(); assert.equal(h.prepared, 1); h.unmount();
});
test("a semantic removal notice retained across blur cannot delete files", async () => {
  const h = semantic(); h.render(); h.reads[0]!.resolve({ installed: true }); await flush();
  row(h.render()).props.onPress(); const card = notice(h.render()); h.blur(); h.render(); card.props.actions[1].onPress(); await flush();
  assert.equal(h.cancelled, 0); assert.equal(h.removed, 0); h.unmount();
});
