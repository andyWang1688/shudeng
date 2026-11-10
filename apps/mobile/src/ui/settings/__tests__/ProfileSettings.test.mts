import test from "node:test";
import assert from "node:assert/strict";
import { hooks, jsx, loader, nativePorts, nodes, parts, flush } from "./platformHarness.mts";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
function profile() {
  const h = hooks(); let focused = true;
  const catalogs: ReturnType<typeof deferred<any>>[] = [], models: ReturnType<typeof deferred<any>>[] = [], pushed: any[] = [];
  const Screen = loader({
    react: h.react, "react/jsx-runtime": { jsx, jsxs: jsx }, "react-native": nativePorts([]),
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "expo-router": { Stack: { Screen: "Screen" }, useRouter: () => ({ push(value: any) { pushed.push(value); } }), useFocusEffect: (fn: any) => h.react.useEffect(() => focused ? fn() : undefined, [fn, focused]) },
    "lucide-react-native": { ChevronRight: "Icon", CircleHelp: "Icon", Download: "Icon", FilePenLine: "Icon", SlidersHorizontal: "Icon" },
    "../../../src/platform/aiConfig": { loadAIServiceCatalog() { const d = deferred<any>(); catalogs.push(d); return d.promise; } },
    "../../../src/platform/semanticModel": { getSemanticModelState() { const d = deferred<any>(); models.push(d); return d.promise; } },
    "../../../src/ui/components/PageChrome": { PageHeading: "PageHeading" },
    "../../../src/ui/settings/SettingsParts": parts,
    "../../../src/ui/theme": { usePalette: () => ({}) },
  })("apps/mobile/app/(tabs)/(profile)/profile.tsx").default;
  return { render: () => h.render(Screen), catalogs, models, pushed, blur() { focused = false; }, focus() { focused = true; }, unmount: h.unmount };
}
const row = (tree: any, title: string) => nodes(tree, n => n.type === "SettingsRow" && n.props.title === title)[0];
test("profile exposes the four confirmed destinations with current service and offline state", async () => {
  const h = profile(); h.render();
  h.catalogs[0]!.resolve({ selectedId: "service", services: [{ id: "service", name: "我的服务" }] }); h.models[0]!.resolve({ installed: true }); await flush();
  const tree = h.render();
  assert.deepEqual(nodes(tree, n => n.type === "SettingsSection").map(n => n.props.title), ["AI 与助手", "通用"]);
  assert.deepEqual(nodes(tree, n => n.type === "SettingsRow").map(n => n.props.title), ["AI 服务", "助手指令", "离线语义资料", "关于书灯"]);
  assert.equal(row(tree, "AI 服务").props.accessibilityValue, "我的服务"); assert.equal(row(tree, "离线语义资料").props.accessibilityValue, "已下载");
  for (const title of ["AI 服务", "助手指令", "离线语义资料", "关于书灯"]) row(tree, title).props.onPress();
  assert.deepEqual(h.pushed, ["/ai-settings", "/assistant-settings", "/semantic-settings", "/about"]); h.unmount();
});
test("profile ignores old state reads after returning and reports live read failures", async () => {
  const h = profile(); h.render(); h.blur(); h.render(); h.focus(); h.render();
  h.catalogs[1]!.resolve({ selectedId: null, services: [] }); h.models[1]!.reject(new Error("read failed")); await flush();
  h.catalogs[0]!.resolve({ selectedId: "old", services: [{ id: "old", name: "old" }] }); h.models[0]!.resolve({ installed: true }); await flush();
  const tree = h.render(); assert.equal(row(tree, "AI 服务").props.accessibilityValue, "未选择"); assert.equal(row(tree, "离线语义资料").props.accessibilityValue, "读取失败"); h.unmount();
});
