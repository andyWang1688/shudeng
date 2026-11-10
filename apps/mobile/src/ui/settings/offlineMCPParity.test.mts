import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { root, loader, hooks, jsx, nodes, flush, nativePorts, parts } from "./__tests__/platformHarness.mts";

// Production UI/functions under modeled platform ports; no network/user data.
// Model manifest is obtained from the unchanged native source rather than RN constants.
const nativeSource = readFileSync(path.join(root, "ios/Shudeng/Sources/SemanticModelStore.swift"), "utf8");
const release = [...nativeSource.matchAll(/FileSpec\(\s*name: "([^"]+)",\s*bytes: ([\d_]+),\s*sha256: "([a-f0-9]+)"/g)]
  .map(match => ({ name: match[1], bytes: Number(match[2].replaceAll("_", "")), sha256: match[3] }));
assert.equal(release.length, 3);
function modelState(marker: unknown, missingFile?: string) {
  let writes = 0;
  class Directory { uri = "memory://SemanticModel"; exists = true; size = 10000000; constructor(..._args: any[]) {} }
  class File { name: string; constructor(_directory: any, name: string) { this.name = name; } get exists() { return this.name !== missingFile && (this.name !== ".installed.json" || marker !== undefined); } get size() { return this.name === "model.onnx" ? 1000001 : release.find(row => row.name === this.name)?.bytes ?? 0; } async text() { return JSON.stringify(marker); } write() { writes++; } }
  const pending = loader({ "expo-file-system": { Directory, File, FileMode: {}, Paths: { document: "memory://" } }, fflate: { Gunzip: class {} }, "./embedding": { resetEmbeddingRuntime() { throw new Error("unexpected inference"); } } })("apps/mobile/src/platform/semanticModel.ts").getSemanticModelState();
  return pending.then((state: any) => { assert.equal(writes, 0, "reading a native/RN receipt never grants or migrates an install"); return state; });
}
test("r11 installation requires a complete known marker and all release assets", async () => {
  for (const marker of [undefined, {}, { version: 1 }, { version: 2, files: release }]) {
    assert.equal((await modelState(marker)).installed, false, "missing marker/modelBytes cannot advertise installed");
  }
  const valid = { version: 2, files: release, modelBytes: 1000001 };
  assert.equal((await modelState(valid)).installed, true);
  assert.equal((await modelState(valid, "model.onnx.gz")).installed, false);
  assert.equal((await modelState({ ...valid, files: release.slice(1) })).installed, false);
  assert.equal((await modelState({ ...valid, files: release.map((row, i) => i ? row : { ...row, sha256: "bad" }) })).installed, false);
  assert.equal((await modelState({ ...valid, modelBytes: 1000002 })).installed, false);
  const native = { version: 1,
    bytes: Object.fromEntries(release.map(row => [row.name, row.bytes])),
    hashes: Object.fromEntries(release.map(row => [row.name, row.sha256])) };
  assert.equal((await modelState(native)).installed, true, "a complete native v1 receipt is readable without migration");
  assert.equal((await modelState(native, "model.onnx")).installed, true, "a complete compressed-only native installation is available for first-use local preparation; the state check never writes");
  assert.equal((await modelState({ ...native, hashes: {} })).installed, false);
  assert.equal((await modelState({ ...native, bytes: {} })).installed, false);
  assert.equal((await modelState({ ...native, version: 3 })).installed, false);
  assert.equal((await modelState({ ...valid, files: release.map(row => ({ sha256: row.sha256, bytes: row.bytes, name: row.name })).reverse() })).installed, true, "object key/manifest entry order does not alter release identity");
});

test("r11 disabled MCP discovery neither writes nor connects before showing native guidance", async () => {
  const h = hooks(), alerts: any[] = [], entries = new Map<string, string>();
  let requests = 0, writes = 0;
  const load = loader({
    react: h.react, "react/jsx-runtime": { jsx, jsxs: jsx }, "react-native": nativePorts(alerts),
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" }, "../theme": { usePalette: () => ({}) }, "./SettingsParts": parts,
    "expo-secure-store": { WHEN_UNLOCKED_THIS_DEVICE_ONLY: "fake-only", getItemAsync: async (key: string) => entries.get(key) ?? null, setItemAsync: async (key: string, value: string) => { writes++; entries.set(key, value); } },
    "expo/fetch": { fetch() { requests++; throw new Error("Network forbidden"); } }, "@shudeng/core": { createLocalId: (prefix: string) => prefix + ".r11-only" },
  });
  const mcp = load("apps/mobile/src/platform/mcp.ts"), Editor = load("apps/mobile/src/ui/settings/MCPServerEditor.tsx").MCPServerEditor;
  const initial = { ...mcp.newMCPServer(), name: "r11-disabled-draft", endpoint: "http://127.0.0.1:8765/mcp" };
  const render = () => h.render(() => Editor({ initial, isNew: true, onChanged() {}, onClose() {} }));
  let tree = render(); nodes(tree, n => n.type === "SettingsRow" && n.props.title === "读取可用工具")[0].props.onPress();
  await flush(); tree = render();
  assert.equal(requests, 0); assert.equal(writes, 0); assert.deepEqual(await mcp.loadMCPServers(), []);
  assert.ok(nodes(tree, n => n.type === "Text" && n.props.children === "请先启用这个外部工具，再读取工具。").length);
  h.unmount();
});

function screenHarness(installed = false, removeFailure = false) {
  const h = hooks(), alerts: any[] = []; let finish!: () => void, reject!: (error: Error) => void, progress!: (v: any) => void, preparation = 0, removed = 0, preparationCancelled = 0;
  const load = loader({
    react: h.react, "react/jsx-runtime": { jsx, jsxs: jsx }, "react-native": nativePorts(alerts),
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" }, "expo-symbols": { SymbolView: "SymbolView" }, "../components/BookNotice": { BookNotice: "BookNotice" },
    "expo-router": { useFocusEffect: (fn: any) => h.react.useEffect(fn, [fn]) }, "../theme": { usePalette: () => ({}) }, "./SettingsParts": parts,
    "./useAISendingConsent": { useAISendingConsent: () => ({ sendingConsent: null, confirmAISending() { throw new Error("unexpected consent"); } }) },
    "../../platform/aiConfig": { loadAIServiceCatalog: async () => ({ version: 2, selectedId: null, services: [] }) }, "../../platform/mcp": { loadMCPServers: async () => [] },
    "../../platform/semanticModel": { getSemanticModelState: async () => ({ installed, bytes: 0 }), installSemanticModel: ({ onProgress }: any) => { progress = onProgress; return new Promise<void>((yes, no) => { finish = yes; reject = no; }); }, async removeSemanticModel() { removed++; if (removeFailure) throw new Error("owned fixture failure"); } },
    "../../platform/settings/semanticPreparation": { observeSemanticPreparation: () => () => {}, prepareExistingBooks() { preparation++; }, async cancelSemanticPreparation() { preparationCancelled++; } },
  });
  const Screen = load("apps/mobile/src/ui/settings/SemanticSettingsScreen.tsx").SemanticSettingsScreen;
  const render = () => h.render(() => Screen({ onBack() {}, onEditService() {}, onMCPSettings() {}, onSendingDetails() {} }));
  return { render, alerts, unmount: h.unmount, finish: () => finish(), cancelComplete: () => reject(Object.assign(new Error("下载已取消。"), { name: "AbortError" })), lateProgress: () => progress({ stage: "download", fraction: .9 }), get preparation() { return preparation; }, get removed() { return removed; }, get preparationCancelled() { return preparationCancelled; } };
}
const modelRow = (tree: any) => nodes(tree, n => n.type === "SettingsRow" && n.props.testID === "ai-semantic")[0];
test("r11 cancellation restores normal not-installed state and ignores late progress", async () => {
  const h = screenHarness(); let tree = h.render(); await flush(); tree = h.render();
  modelRow(tree).props.onPress(); await flush(); tree = h.render();
  modelRow(tree).props.onPress(); h.lateProgress(); h.cancelComplete(); await flush(); tree = h.render();
  assert.equal(modelRow(tree).props.detail, "未下载 · 约 81MB");
  assert.equal(h.preparation, 0); assert.deepEqual(h.alerts, []);
  assert.equal(nodes(tree, n => n.type === "BookNotice").length, 0);
  h.unmount();
});
test("r11 successful install shows the native paper notice with 完成 action", async () => {
  const h = screenHarness(); let tree = h.render(); await flush(); tree = h.render();
  modelRow(tree).props.onPress(); h.finish(); await flush(); tree = h.render();
  assert.equal(modelRow(tree).props.detail, "已下载 · 约 81MB");
  const card = nodes(tree, n => n.type === "BookNotice")[0]; assert.ok(card);
  assert.equal(card.props.title, "语义资料已下载");
  assert.equal(card.props.message, "语义资料会在后台准备；阅读、原文搜索和笔记不受影响。");
  assert.deepEqual(card.props.actions.map((action: any) => action.title), ["完成"]);
  assert.equal(h.preparation, 1); assert.deepEqual(h.alerts, []);
  card.props.actions[0].onPress(); tree = h.render(); assert.equal(nodes(tree, n => n.type === "BookNotice").length, 0);
  h.unmount();
});

test("cancel then late successful resolution never advertises an install or starts preparation", async () => {
  const h = screenHarness(); let tree = h.render(); await flush(); tree = h.render();
  modelRow(tree).props.onPress(); tree = h.render(); modelRow(tree).props.onPress();
  h.lateProgress(); h.finish(); await flush(); tree = h.render();
  assert.equal(modelRow(tree).props.detail, "未下载 · 约 81MB");
  assert.equal(nodes(tree, n => n.type === "BookNotice").length, 0); assert.equal(h.preparation, 0);
  h.unmount();
});
test("unmount ignores late install progress/completion", async () => {
  const h = screenHarness(); let tree = h.render(); await flush(); tree = h.render();
  modelRow(tree).props.onPress(); h.unmount(); h.lateProgress(); h.finish(); await flush();
  assert.equal(h.preparation, 0); assert.deepEqual(h.alerts, []);
});
test("model removal uses native paper text; cancellation and repeated stale callbacks cannot remove data", async () => {
  const h = screenHarness(true); let tree = h.render(); await flush(); tree = h.render();
  modelRow(tree).props.onPress(); tree = h.render();
  const card = nodes(tree, n => n.type === "BookNotice")[0];
  assert.equal(card.props.title, "删除语义资料？");
  assert.equal(card.props.message, "删除后书内 AI 语义检索暂不可用；阅读、原文搜索和笔记不受影响。");
  assert.deepEqual(card.props.actions.map((action: any) => [action.title, action.style]), [["取消", "cancel"], ["删除", "destructive"]]);
  card.props.actions[0].onPress(); card.props.actions[1].onPress(); await flush(); tree = h.render();
  assert.equal(h.removed, 0); assert.equal(h.preparationCancelled, 0);
  assert.equal(modelRow(tree).props.detail, "已下载 · 约 81MB"); assert.deepEqual(h.alerts, []);
  h.unmount();
});
test("confirmed removal runs once; failure keeps installed state and shows native failure notice", async () => {
  for (const failing of [false, true]) {
    const h = screenHarness(true, failing); let tree = h.render(); await flush(); tree = h.render();
    modelRow(tree).props.onPress(); tree = h.render(); const card = nodes(tree, n => n.type === "BookNotice")[0];
    card.props.actions[1].onPress(); card.props.actions[1].onPress(); await flush(); tree = h.render();
    assert.equal(h.removed, 1); assert.equal(h.preparationCancelled, 1);
    assert.equal(modelRow(tree).props.detail, failing ? "已下载 · 约 81MB" : "未下载 · 约 81MB");
    const failure = nodes(tree, n => n.type === "BookNotice")[0];
    if (failing) { assert.equal(failure.props.title, "删除未完成"); assert.equal(failure.props.message, "语义资料仍保留；请稍后重试。"); }
    else assert.equal(failure, undefined);
    h.unmount();
  }
});
