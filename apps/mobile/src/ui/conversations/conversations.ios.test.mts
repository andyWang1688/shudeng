import test from "node:test";
import assert from "node:assert/strict";
import { hooks, jsx, loader, nativePorts, nodes, flush } from "../settings/__tests__/platformHarness.mts";
import { conversationSections, conversationTitle } from "./model.ts";

const item = (id: string, bookId = "a", extra: any = {}) => ({ conversationId: id, bookId, updatedAt: Number(id) || 1, question: "问题 " + id, answer: "回答 " + id, title: "标题 " + id, turns: 2, ...extra });
const book = { id: "a", title: "真实书名", format: "EPUB", removed: false };
const p = { paper: "paper", ink: "ink", ink2: "ink2", ink3: "ink3", lampInk: "lamp", line: "line", error: "red" };
function screen(initial: any = {}, dimensions = { height: 800, fontScale: 1 }) {
  const h = hooks(); let focused = true, motionChanged: ((value: boolean) => void) | null = null;
  const initialMotion = new Promise<boolean>(() => {});
  const calls = { pushed: [] as any[], expanded: [] as any[], dialogs: [] as any[], confirms: [] as any[], dismissed: [] as any[], navigated: [] as any[], retries: 0 };
  const state: any = { items: [item("1")], books: [book], collapsed: { a: false }, loading: false, loadError: false, dialog: null,
    setGroupExpanded: (...args: any[]) => calls.expanded.push(args), openDialog: (...args: any[]) => calls.dialogs.push(args),
    confirm: (...args: any[]) => calls.confirms.push(args), dismiss: (...args: any[]) => calls.dismissed.push(args), reload() { calls.retries++; }, ...initial };
  const Screen = loader({
    react: h.react, "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { ...nativePorts([]), View: "View", ActivityIndicator: "ActivityIndicator", Keyboard: { dismiss() {} }, StyleSheet: { create: (v: any) => v },
      useWindowDimensions: () => dimensions, AccessibilityInfo: { isReduceMotionEnabled: () => initialMotion, addEventListener: (_event: string, cb: any) => { motionChanged = cb; return { remove() { motionChanged = null; } }; } } },
    "expo-router": { Stack: { Screen: "StackScreen" }, useRouter: () => ({ push: (value: any) => calls.pushed.push(value), navigate: (value: any) => calls.navigated.push(value) }),
      useFocusEffect: (fn: any) => h.react.useEffect(() => focused ? fn() : undefined, [fn, focused]) },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" }, "../theme": { usePalette: () => p },
    "../components/BookNotice": { BookNotice: "BookNotice" }, "../components/EmptyState": { EmptyState: "EmptyState" },
    "../components/PageChrome": { PageHeading: "PageHeading", PageSearch: "PageSearch" }, "./ConversationRenamePrompt": { ConversationRenamePrompt: "RenamePrompt" },
    "./ConversationsList.ios": { ConversationsList: "ConversationsList" }, "./model": { conversationSections, conversationTitle }, "./useConversationList": { useConversationList: () => state },
  })("apps/mobile/src/ui/conversations/ConversationsScreen.ios.tsx").default;
  return { render: () => h.render(Screen), state, calls, blur() { focused = false; h.render(Screen); }, focus() { focused = true; h.render(Screen); }, unmount: h.unmount, motion(value: boolean) { motionChanged?.(value); } };
}
const get = (tree: any, type: string) => nodes(tree, n => n.type === type)[0];

test("iOS history searches all real summaries before previewing and opens an original conversation snapshot", () => {
  const records = Array.from({ length: 10 }, (_, i) => item(String(i + 1), "a", { bookTitle: "原书快照", answer: i === 0 ? "tail search value" : "answer" }));
  const h = screen({ items: records }); let tree = h.render();
  let list = get(tree, "ConversationsList").props;
  assert.equal(list.sections[0].data.length, 10); assert.equal(list.previewLimit, 3);
  list.onToggleAll("a"); list = get(h.render(), "ConversationsList").props; assert.equal(list.allBooks.has("a"), true);
  get(tree, "PageSearch").props.onChange("tail search value"); tree = h.render(); list = get(tree, "ConversationsList").props;
  assert.equal(list.searching, true); assert.deepEqual(list.sections[0].data.map((v: any) => v.conversationId), ["1"]);
  list.onExpandedChange("a", false); assert.deepEqual(h.calls.expanded, []);
  list.onOpen(records[0]); assert.deepEqual(h.calls.pushed, [{ pathname: "/book-chat", params: { bookId: "a", conversationId: "1", bookTitle: "原书快照" } }]);
  get(tree, "PageSearch").props.onChange(""); tree = h.render(); list = get(tree, "ConversationsList").props;
  assert.equal(list.sections[0].data.length, 10); list.onExpandedChange("a", false); assert.deepEqual(h.calls.expanded, [["a", false]]); h.unmount();
});
test("iOS history retains the smaller preview and distinct loading/error/empty recovery paths", () => {
  const h = screen({}, { height: 650, fontScale: 1.5 });
  assert.equal(get(h.render(), "ConversationsList").props.previewLimit, 2);
  h.state.loadError = true; let tree = h.render(); get(tree, "EmptyState").props.onAction(); assert.equal(h.calls.retries, 1);
  h.state.loadError = false; h.state.items = []; h.state.loading = true; assert.ok(get(h.render(), "ActivityIndicator"));
  h.state.loading = false; tree = h.render(); get(tree, "EmptyState").props.onAction(); assert.deepEqual(h.calls.navigated, ["/(tabs)"]);
  get(tree, "PageSearch").props.onChange("missing"); tree = h.render(); assert.equal(get(tree, "EmptyState").props.title, "没有找到相关对话");
  get(tree, "EmptyState").props.onAction(); assert.equal(get(h.render(), "PageSearch").props.value, ""); h.unmount();
});
test("native row, disclosure, search and dialog callbacks expire on blur and stay expired after return", () => {
  const h = screen(); let tree = h.render(); const oldList = get(tree, "ConversationsList").props, oldSearch = get(tree, "PageSearch").props;
  h.state.dialog = { id: 1, kind: "delete", item: item("1") }; const oldNotice = get(h.render(), "BookNotice").props;
  h.blur(); assert.equal(get(h.render(), "ConversationsList").props.active, false); h.focus();
  oldList.onOpen(item("1")); oldList.onRename(item("1")); oldList.onDelete(item("1")); oldList.onToggleAll("a"); oldList.onExpandedChange("a", false); oldSearch.onChange("late"); oldNotice.actions[1].onPress();
  assert.deepEqual(h.calls.pushed, []); assert.deepEqual(h.calls.dialogs, []); assert.deepEqual(h.calls.expanded, []); assert.deepEqual(h.calls.confirms, []);
  tree = h.render(); assert.equal(get(tree, "PageSearch").props.value, ""); get(tree, "ConversationsList").props.onRename(item("1")); assert.equal(h.calls.dialogs.length, 1);
  const currentList = get(tree, "ConversationsList").props; h.unmount(); currentList.onOpen(item("1")); currentList.onDelete(item("1")); assert.equal(h.calls.pushed.length, 0);
});
test("native history forwards rename separately from the original question and keeps confirmation before deletion", () => {
  const original = item("1", "a", { title: "展示标题", question: "原始问题" }); const h = screen({ items: [original] });
  const list = get(h.render(), "ConversationsList").props; list.onDelete(original); assert.deepEqual(h.calls.dialogs, [["delete", original]]); assert.deepEqual(h.calls.confirms, []);
  h.state.dialog = { id: 5, kind: "rename", item: original }; const prompt = get(h.render(), "RenamePrompt").props;
  assert.equal(prompt.initialName, "展示标题"); prompt.onSave("新标题"); assert.deepEqual(h.calls.confirms, [[5, original, "新标题"]]); assert.equal(original.question, "原始问题");
  h.state.dialog = { id: 6, kind: "delete", item: original }; const notice = get(h.render(), "BookNotice").props;
  notice.actions[0].onPress(); assert.deepEqual(h.calls.dismissed, [[6]]); assert.equal(h.calls.confirms.length, 1); h.unmount();
});
test("native history forwards reduce motion updates to its system list", async () => {
  const h = screen(); h.render(); h.motion(false); await flush(); assert.equal(get(h.render(), "ConversationsList").props.reduceMotion, false);
  h.motion(true); assert.equal(get(h.render(), "ConversationsList").props.reduceMotion, true); h.unmount();
});
test("native rows removed by a new search cannot open, mutate or persist disclosure changes", () => {
  const h = screen(); const tree = h.render(); const previousList = get(tree, "ConversationsList").props;
  get(tree, "PageSearch").props.onChange("missing"); h.render();
  previousList.onOpen(item("1")); previousList.onRename(item("1")); previousList.onDelete(item("1")); previousList.onExpandedChange("a", false); previousList.onToggleAll("a");
  assert.deepEqual(h.calls.pushed, []); assert.deepEqual(h.calls.dialogs, []); assert.deepEqual(h.calls.expanded, []); h.unmount();
});

function presentation() {
  const nativeNames = ["Button", "DisclosureGroup", "Group", "Host", "HStack", "Image", "List", "Rectangle", "RoundedRectangle", "Spacer", "SwipeActions", "Text", "VStack", "ZStack"];
  const native: any = Object.fromEntries(nativeNames.map(name => [name, Object.assign(() => {}, { nativeName: name })]));
  native.List.ForEach = "List.ForEach"; native.DisclosureGroup.Label = "DisclosureGroup.Label"; native.SwipeActions.Actions = "SwipeActions.Actions";
  const jsxNative = (type: any, props: any) => ({ type: type.nativeName ?? type, props });
  const modifiers = new Proxy({ Animation: { easeInOut: (value: any) => value } }, { get(target: any, key) { return target[key] ?? ((...args: any[]) => ({ type: key, args })); } });
  const List = loader({ "react/jsx-runtime": { jsx: jsxNative, jsxs: jsxNative }, "@expo/ui/swift-ui": native, "@expo/ui/swift-ui/modifiers": modifiers,
    "../appearance": { useAppearance: () => ({ resolvedMode: "dark" }) }, "../theme": { usePalette: () => p, bookSwatchTone: () => ({ background: "cover", ink: "coverInk" }) },
    "./model": { conversationTitle } })("apps/mobile/src/ui/conversations/ConversationsList.ios.tsx").ConversationsList;
  const calls: any[] = [];
  const render = (overrides: any = {}) => {
    const sections = conversationSections([item("1"), item("2"), item("3"), item("4"), item("5")], [book as any], "", { a: false });
    return List({ sections, searching: false, previewLimit: 3, allBooks: new Set(), active: true, reduceMotion: false,
      onExpandedChange: (...args: any[]) => calls.push(["expand", ...args]), onToggleAll: (...args: any[]) => calls.push(["all", ...args]),
      onOpen: (...args: any[]) => calls.push(["open", ...args]), onRename: (...args: any[]) => calls.push(["rename", ...args]), onDelete: (...args: any[]) => calls.push(["delete", ...args]), ...overrides });
  };
  // Models native ForEach input and user callbacks, not SwiftUI gesture rendering.
  const expand = (tree: any): any => {
    if (!tree || typeof tree !== "object") return tree;
    if (Array.isArray(tree)) return tree.map(expand);
    if (tree.type === "List.ForEach") return expand(tree.props.data.map((item: any) => tree.props.children({ item })));
    if (typeof tree.type === "function") return expand(tree.type(tree.props));
    return { ...tree, props: Object.fromEntries(Object.entries(tree.props ?? {}).map(([key, value]) => [key, key === "children" ? expand(value) : value])) };
  };
  return { render: (overrides?: any) => expand(render(overrides)), calls };
}
test("system conversation list uses real grouped previews, explicit selection actions and non-destructive-role swipes", () => {
  const h = presentation(); const tree = h.render();
  assert.equal(get(tree, "Host").props.colorScheme, "dark"); assert.ok(get(tree, "List"));
  const disclosure = get(tree, "DisclosureGroup"); assert.equal(disclosure.props.isExpanded, true); disclosure.props.onIsExpandedChange(false);
  const swipes = nodes(tree, n => n.type === "SwipeActions"); assert.equal(swipes.length, 3);
  const deletes = nodes(tree, n => n.type === "Button" && n.props.label === "删除"); assert.equal(deletes.length, 3);
  for (const action of deletes) assert.equal(action.props.role, undefined);
  deletes[0].props.onPress(); const rename = nodes(tree, n => n.type === "Button" && n.props.label === "重命名")[0]; rename.props.onPress();
  assert.deepEqual(h.calls.map(call => call[0]), ["expand", "delete", "rename"]);
  const titles = nodes(tree, n => n.type === "Text").map(n => n.props.children); assert.ok(titles.includes("真实书名")); assert.ok(titles.includes("标题 5")); assert.ok(!titles.includes("问题 5")); assert.ok(!titles.includes("回答 5"));
  const all = nodes(tree, n => n.type === "Button" && n.props.label === "查看全部 5 条对话")[0]; all.props.onPress(); assert.deepEqual(h.calls.at(-1), ["all", "a"]);
});
test("native search exposes all matches without disclosure or preview limits", () => {
  const h = presentation(); const tree = h.render({ searching: true });
  assert.equal(get(tree, "DisclosureGroup"), undefined); assert.equal(nodes(tree, n => n.type === "SwipeActions").length, 5);
  assert.equal(nodes(tree, n => n.type === "Button" && n.props.label?.startsWith("查看全部")).length, 0);
});
test("all-expanded and reduced-motion states stay in the native list", () => {
  const h = presentation(); const tree = h.render({ allBooks: new Set(["a"]), reduceMotion: true, active: false });
  assert.equal(nodes(tree, n => n.type === "SwipeActions").length, 5); assert.equal(get(tree, "Host").props.pointerEvents, "none");
  const animations = get(tree, "DisclosureGroup").props.modifiers.filter((m: any) => m.type === "animation");
  assert.equal(animations.length, 2); for (const effect of animations) assert.equal(effect.args[0].duration, 0);
});
