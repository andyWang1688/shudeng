import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { test } from "node:test";
import {
  conversationSections,
  conversationTitle,
  initialCollapsed,
  mergeRuntimeConversations,
} from "./model.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const model = {
  conversationSections,
  conversationTitle,
  initialCollapsed,
  mergeRuntimeConversations,
};
const item = (
  id: string,
  bookId: string,
  updatedAt: number,
  extra: any = {},
) => ({
  conversationId: id,
  bookId,
  updatedAt,
  question: "问题-" + id,
  answer: "回答-" + id,
  turns: 2,
  submittedCount: 1,
  assistantIds: [id + ":assistant"],
  ...extra,
});
const book = (id: string) => ({
  id,
  title: "书名-" + id,
  format: "EPUB",
  removed: false,
});
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function load(path: string, mocks: Record<string, any>) {
  const file = new URL(path, import.meta.url);
  const compiled: any = new Module(file.pathname);
  compiled.require = (id: string) => {
    if (!(id in mocks)) throw Error("Unmocked " + id);
    return mocks[id];
  };
  compiled._compile(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    file.pathname,
  );
  return compiled.exports;
}
function hooks() {
  const slots: any[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const differs = (a: any[], b: any[]) =>
    !a ||
    !b ||
    a.length !== b.length ||
    a.some((value, i) => !Object.is(value, b[i]));
  const api: any = {
    useState(initial: any) {
      const i = cursor++;
      slots[i] ??= {
        value: typeof initial === "function" ? initial() : initial,
      };
      return [
        slots[i].value,
        (next: any) => {
          slots[i].value =
            typeof next === "function" ? next(slots[i].value) : next;
        },
      ];
    },
    useRef(initial: any) {
      const i = cursor++;
      return (slots[i] ??= { current: initial });
    },
    useMemo(factory: any, deps: any[]) {
      const i = cursor++;
      if (!slots[i] || differs(slots[i].deps, deps))
        slots[i] = { deps, value: factory() };
      return slots[i].value;
    },
    useCallback(callback: any, deps: any[]) {
      return api.useMemo(() => callback, deps);
    },
    useEffect(effect: any, deps: any[]) {
      const i = cursor++;
      if (!slots[i] || differs(slots[i].deps, deps)) {
        const old = slots[i];
        slots[i] = { deps };
        effects.push(() => {
          old?.cleanup?.();
          slots[i].cleanup = effect();
        });
      }
    },
    useSyncExternalStore(_subscribe: any, get: any) {
      return get();
    },
  };
  return {
    api,
    render(operation: any) {
      cursor = 0;
      const result = operation();
      const next = effects;
      effects = [];
      next.forEach((effect) => effect());
      return result;
    },
    unmount() {
      slots.forEach((slot) => slot.cleanup?.());
    },
  };
}

test("first expansion chooses the latest real timestamp while an existing empty preference keeps all groups closed", () => {
  const items = [
    item("old", "a", 1),
    item("latest", "b", 10),
    item("middle", "a", 3),
  ];
  assert.deepEqual(initialCollapsed(items, null), { a: true, b: false });
  assert.deepEqual(initialCollapsed(items, {}), { a: true, b: true });
  assert.deepEqual(
    initialCollapsed(items, { a: false, bogus: "not a boolean" }),
    { a: false, b: true },
  );
});

test("search expands matches transiently, restores saved folds, and does not search unrelated intermediate turns", () => {
  const items = [
    item("old", "a", 1, { searchText: "intermediate-only" }),
    item("latest", "b", 10, { bookTitle: "原书快照", answer: "LATEST answer" }),
    item("middle", "a", 3),
  ];
  const books = [book("a"), book("b")];
  assert.deepEqual(
    conversationSections(items, books, "", { a: true, b: false }).map(
      (section) => [section.bookId, section.count, section.data.length],
    ),
    [
      ["b", 1, 1],
      ["a", 2, 0],
    ],
  );
  assert.equal(
    conversationSections(items, books, "intermediate-only", {}).length,
    0,
  );
  const matching = conversationSections(items, books, " 原书快照 ", {
    b: true,
  });
  assert.equal(matching[0].data[0].conversationId, "latest");
  assert.equal(matching[0].collapsed, false);
  assert.equal(
    conversationSections(items, books, "", { b: true })[0].collapsed,
    true,
  );
});

test("removed books keep their original snapshot and conversations without exposing a current cover", () => {
  const sections = conversationSections(
    [item("one", "a", 1, { bookTitle: "历史书名" })],
    [{ ...book("a"), title: "当前书名", removed: true }],
    "",
    { a: false },
  );
  assert.equal(sections[0].title, "历史书名");
  assert.equal(sections[0].book, null);
  assert.equal(sections[0].count, 1);
  assert.equal(
    conversationTitle(item("empty", "a", 1, { question: "" })),
    "未填写的问题",
  );
  assert.equal(
    conversationTitle(item("long", "a", 1, { question: "字".repeat(60) })),
    "字".repeat(48),
  );
});

test("runtime overlays preserve first question/title and never count a persisted partial assistant twice", () => {
  const persisted = item("one", "a", 1, {
    title: "首个对话名",
    bookTitle: "首轮书名",
  });
  const record: any = {
    conversationId: "one",
    bookId: "a",
    bookTitle: "后续元数据",
    updatedAt: 8,
    running: false,
    turn: {
      id: "one:assistant",
      sourceQuestion: "后续问题",
      text: "实时答案",
      saveError: "磁盘满",
    },
  };
  let merged = mergeRuntimeConversations([persisted], [record]);
  assert.equal(merged[0].submittedCount, 1);
  assert.equal(merged[0].question, persisted.question);
  assert.equal(merged[0].bookTitle, "首轮书名");
  assert.equal(merged[0].unsaved, true);
  merged = mergeRuntimeConversations(
    [persisted],
    [{ ...record, turn: { ...record.turn, id: "new-turn" } }],
  );
  assert.equal(merged[0].submittedCount, 2);
  const unsavedNew = mergeRuntimeConversations([], [record])[0];
  assert.equal(unsavedNew.question, "后续问题");
  assert.equal(unsavedNew.submittedCount, 1);
  assert.equal(
    mergeRuntimeConversations(
      [],
      [{ ...record, turn: { ...record.turn, saveError: undefined } }],
    )[0].unsaved,
    true,
    "a new runtime conversation is unsaved before its first disk write",
  );
  assert.equal(
    mergeRuntimeConversations(
      [persisted],
      [{ ...record, turn: { ...record.turn, saveError: undefined } }],
    )[0].unsaved,
    false,
    "a persisted turn with no save error is not fabricated as unsaved",
  );
});

function listHarness(options: any = {}) {
  const react = hooks();
  let focused = true;
  let records = options.items ?? [item("one", "a", 1)];
  let preferences = options.preferences ?? {};
  const preferenceWrites: any[] = [];
  let failLoad = options.failLoad ?? false;
  let runtime: any[] = [];
  const writes: any[] = [];
  let loads = 0;
  const api = load("./useConversationList.ts", {
    react: react.api,
    "expo-router": {
      useFocusEffect: (callback: any) =>
        react.api.useEffect(
          () => (focused ? callback() : undefined),
          [callback, focused],
        ),
    },
    "./model": model,
    "../chat/conversationRuntime": {
      getConversationRuntimeSnapshots: () => runtime,
      subscribeConversationRuntime: () => () => {},
      discardConversationRun: (id: string) => {
        runtime = runtime.filter((record) => record.conversationId !== id);
      },
    },
    "../../platform/library": {
      loadConversationSummaries: async () => {
        loads++;
        if (failLoad) throw Error("read failed");
        return options.load ? options.load(loads) : records;
      },
      loadShelfBooks: async () => [book("a")],
      loadAppPreference: async () =>
        options.loadPreference ? options.loadPreference() : preferences,
      saveAppPreference: async (_key: string, next: any) => {
        preferenceWrites.push(next);
        if (options.savePreference) await options.savePreference(next);
        preferences = next;
      },
      renameBookConversation: async (id: string, title: string) => {
        writes.push(["rename", id, title]);
        if (options.rename) await options.rename();
        records = records.map((record: any) =>
          record.conversationId === id
            ? { ...record, title, updatedAt: 100 }
            : record,
        );
      },
      deleteBookConversation: async (id: string) => {
        writes.push(["delete", id]);
        if (options.remove) await options.remove();
        records = records.filter((record: any) => record.conversationId !== id);
      },
    },
  });
  let value: any;
  const render = () => {
    value = react.render(() => api.useConversationList());
    return value;
  };
  render();
  return {
    get value() {
      return value;
    },
    writes,
    preferenceWrites,
    get preferences() {
      return preferences;
    },
    get loads() {
      return loads;
    },
    render,
    blur() {
      focused = false;
      render();
    },
    focus() {
      focused = true;
      render();
    },
    unmount: react.unmount,
    setRuntime(value: any[]) {
      runtime = value;
    },
    setFailLoad(value: boolean) {
      failLoad = value;
    },
    async flush() {
      await settle();
      render();
      await settle();
      render();
    },
  };
}

test("a read failure offers a clean retry without overwriting records or persisting fabricated emptiness", async () => {
  const h = listHarness({ failLoad: true });
  await h.flush();
  assert.equal(h.value.loadError, true);
  assert.equal(h.value.loading, false);
  assert.deepEqual(h.writes, []);
  h.setFailLoad(false);
  await h.value.reload();
  h.render();
  assert.equal(h.value.loadError, false);
  assert.equal(h.value.items[0].conversationId, "one");
});

test("cancelled or unmounted dialog callbacks cannot mutate another conversation", async () => {
  const h = listHarness();
  await h.flush();
  const first = h.value.items[0];
  h.value.openDialog("delete", first);
  h.render();
  const old = h.value.dialog;
  h.value.dismiss(old.id);
  h.render();
  h.value.openDialog("rename", first);
  h.render();
  await h.value.confirm(old.id, first);
  assert.deepEqual(h.writes, []);
  const current = h.value.dialog;
  h.unmount();
  await h.value.confirm(current.id, first, "新名");
  assert.deepEqual(h.writes, []);
});

test("a dialog from an earlier focus cannot rename or delete after leaving and returning", async () => {
  for (const title of [undefined, "late renamed title"]) {
    const h = listHarness();
    await h.flush();
    const first = h.value.items[0];
    h.value.openDialog(title === undefined ? "delete" : "rename", first);
    h.render();
    const stale = h.value.dialog;
    h.blur();
    h.focus();
    await h.flush();
    await h.value.confirm(stale.id, first, title);
    assert.deepEqual(h.writes, []);
    h.unmount();
  }
});

test("system disclosure events set an explicit state and duplicate events do not reverse it", async () => {
  const h = listHarness({ preferences: { a: true } });
  await h.flush();
  h.value.setGroupExpanded("a", true);
  h.value.setGroupExpanded("a", true);
  await h.flush();
  assert.equal(h.value.collapsed.a, false);
  assert.equal(h.preferenceWrites.length, 1);
  h.value.setGroupExpanded("a", false);
  await h.flush();
  assert.equal(h.preferences.a, true);
  h.blur();
  h.value.setGroupExpanded("a", true);
  h.value.openDialog("delete", h.value.items[0]);
  await h.flush();
  assert.equal(h.preferenceWrites.length, 2);
  assert.equal(h.value.dialog, null);
  h.unmount();
});

test("confirmed mutations consume their token once and failure preserves the original list", async () => {
  const h = listHarness({
    remove: async () => {
      throw Error("disk full");
    },
  });
  await h.flush();
  const first = h.value.items[0];
  h.value.openDialog("delete", first);
  h.render();
  const dialog = h.value.dialog;
  await Promise.all([
    h.value.confirm(dialog.id, first),
    h.value.confirm(dialog.id, first),
  ]);
  h.render();
  assert.deepEqual(h.writes, [["delete", "one"]]);
  assert.equal(h.value.items.length, 1);
  assert.equal(h.value.dialog.kind, "notice");
  assert.equal(
    h.value.dialog.message,
    "删除失败，对话仍保留；生成已取消，请重试删除。",
  );
});

test("rename rechecks the current runtime at confirmation and refuses newly unsaved or active work", async () => {
  const h = listHarness();
  await h.flush();
  const first = h.value.items[0];
  h.value.openDialog("rename", first);
  h.render();
  const dialog = h.value.dialog;
  h.setRuntime([
    {
      conversationId: "one",
      bookId: "a",
      bookTitle: "原书",
      updatedAt: 2,
      running: false,
      turn: {
        id: "one:assistant",
        text: "回答",
        sourceQuestion: first.question,
        saveError: "failed",
      },
    },
  ]);
  await h.value.confirm(dialog.id, first, "新的名称");
  h.render();
  assert.deepEqual(h.writes, []);
  assert.equal(
    h.value.dialog.message,
    "改名尚未保存，原名称未变；请检查名称、生成及保存状态后重试。",
  );
});

test("a successful rename refreshes title/order while a confirmed delete removes only its original id", async () => {
  const h = listHarness({ items: [item("one", "a", 1), item("two", "a", 2)] });
  await h.flush();
  const first = h.value.items[0];
  h.value.openDialog("rename", first);
  h.render();
  await h.value.confirm(h.value.dialog.id, first, "保存后的标题");
  h.render();
  assert.equal(
    h.value.items.find((entry: any) => entry.conversationId === "one").title,
    "保存后的标题",
  );
  h.value.openDialog("delete", first);
  h.render();
  await h.value.confirm(h.value.dialog.id, first);
  h.render();
  assert.deepEqual(
    h.value.items.map((entry: any) => entry.conversationId),
    ["two"],
  );
});

test("an older in-flight reload cannot resurrect a successfully deleted conversation", async () => {
  let finish!: (value: any[]) => void;
  const pending = new Promise<any[]>((resolve) => {
    finish = resolve;
  });
  const h = listHarness({
    load: (count: number) => (count === 1 ? [item("one", "a", 1)] : pending),
  });
  await h.flush();
  const first = h.value.items[0];
  const oldLoad = h.value.reload();
  h.render();
  h.value.openDialog("delete", first);
  h.render();
  await h.value.confirm(h.value.dialog.id, first);
  h.render();
  assert.equal(h.value.items.length, 0);
  finish([first]);
  await oldLoad;
  h.render();
  assert.equal(h.value.items.length, 0);
  assert.equal(h.value.loading, false);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("consecutive group actions preserve both books before React rerenders", async () => {
  const h = listHarness({
    items: [item("one", "a", 1), item("two", "b", 2)],
    preferences: { a: false, b: false },
  });
  await h.flush();
  h.value.toggleGroup("a");
  h.value.toggleGroup("b");
  await h.flush();
  assert.deepEqual(h.value.collapsed, { a: true, b: true });
  assert.deepEqual(h.preferences, h.value.collapsed);
  h.unmount();
});

test("late preference writes cannot replace the user's last collapse choice", async () => {
  const pending: ReturnType<typeof deferred<void>>[] = [];
  const h = listHarness({
    preferences: { a: false },
    savePreference: () => {
      const task = deferred<void>();
      pending.push(task);
      return task.promise;
    },
  });
  await h.flush();
  h.value.toggleGroup("a");
  h.render();
  h.value.toggleGroup("a");
  h.render();
  await settle();
  assert.equal(h.value.collapsed.a, false);
  if (pending.length > 1) {
    pending[1]!.resolve();
    await h.flush();
  }
  pending[0]!.resolve();
  await h.flush();
  if (pending.length > 1) {
    pending[1]!.resolve();
    await h.flush();
  }
  assert.equal(h.preferences.a, false);
  h.blur();
  h.focus();
  await h.flush();
  assert.equal(h.value.collapsed.a, false);
  h.unmount();
});

test("an in-flight refresh preserves a group action made after its preference snapshot", async () => {
  const snapshot = deferred<any[]>();
  const h = listHarness({
    preferences: { a: false },
    load: (count: number) =>
      count === 1 ? [item("one", "a", 1)] : snapshot.promise,
  });
  await h.flush();
  const refresh = h.value.reload(false);
  h.value.toggleGroup("a");
  await h.flush();
  assert.equal(h.value.collapsed.a, true);
  snapshot.resolve([item("one", "a", 1)]);
  await refresh;
  h.render();
  assert.equal(h.value.collapsed.a, true);
  h.unmount();
});

test("rename refresh does not restore a stale persisted fold while its write is pending", async () => {
  const write = deferred<void>();
  const h = listHarness({
    preferences: { a: false },
    savePreference: () => write.promise,
  });
  await h.flush();
  h.value.toggleGroup("a");
  h.render();
  const first = h.value.items[0];
  h.value.openDialog("rename", first);
  h.render();
  await h.value.confirm(h.value.dialog.id, first, "renamed");
  h.render();
  assert.equal(h.value.items[0].title, "renamed");
  assert.equal(h.value.collapsed.a, true);
  write.resolve();
  await h.flush();
  h.unmount();
});

test("runtime completion on a hidden history tab defers its reload until focus", async () => {
  const h = listHarness();
  await h.flush();
  h.setRuntime([
    {
      conversationId: "one",
      bookId: "a",
      updatedAt: 2,
      running: false,
      turn: { id: "one:assistant", text: "done" },
    },
  ]);
  h.render();
  h.blur();
  const loads = h.loads;
  h.setRuntime([]);
  await h.flush();
  assert.equal(h.loads, loads);
  h.focus();
  await h.flush();
  assert.equal(h.loads, loads + 1);
  h.unmount();
});

test("rename writes finish after blur but do not refresh the hidden history page", async () => {
  const mutation = deferred<void>();
  const h = listHarness({ rename: () => mutation.promise });
  await h.flush();
  const first = h.value.items[0];
  h.value.openDialog("rename", first);
  h.render();
  const renamed = h.value.confirm(h.value.dialog.id, first, "after blur");
  h.blur();
  const loads = h.loads;
  mutation.resolve();
  await renamed;
  h.render();
  assert.equal(h.loads, loads);
  h.focus();
  await h.flush();
  assert.equal(h.value.items[0].title, "after blur");
  h.unmount();
});

test("a failed group write reports unsaved state and does not block the next choice", async () => {
  let saves = 0;
  const h = listHarness({
    preferences: { a: false },
    savePreference: async () => {
      if (++saves === 1) throw new Error("storage full");
    },
  });
  await h.flush();
  h.value.toggleGroup("a");
  await h.flush();
  assert.equal(h.value.collapsed.a, true);
  assert.equal(h.preferences.a, false);
  assert.equal(h.value.dialog.message, "分组状态尚未保存，请重试展开或收起。");
  h.value.dismiss(h.value.dialog.id);
  h.render();
  h.value.toggleGroup("a");
  await h.flush();
  assert.equal(h.preferences.a, false);
  assert.equal(h.value.dialog, null);
  assert.equal(saves, 2);
  h.unmount();
});

test("an obsolete group-write failure does not cover a newer successful choice with a notice", async () => {
  const first = deferred<void>();
  let saves = 0;
  const h = listHarness({
    preferences: { a: false },
    savePreference: () => (++saves === 1 ? first.promise : Promise.resolve()),
  });
  await h.flush();
  h.value.toggleGroup("a");
  h.render();
  await settle();
  h.value.toggleGroup("a");
  h.render();
  first.reject(new Error("obsolete write failure"));
  await h.flush();
  assert.equal(h.preferences.a, false);
  assert.equal(h.value.dialog, null);
  assert.equal(saves, 2);
  h.unmount();
});

test("accepted group writes finish after blur without publishing a late error dialog", async () => {
  for (const failure of [false, true]) {
    const pending = deferred<void>();
    const h = listHarness({
      preferences: { a: false },
      savePreference: () => pending.promise,
    });
    await h.flush();
    h.value.toggleGroup("a");
    h.render();
    await settle();
    h.blur();
    if (failure) pending.reject(new Error("hidden write failure"));
    else pending.resolve();
    await h.flush();
    assert.equal(h.value.dialog, null);
    assert.equal(h.preferences.a, failure ? false : true);
    h.unmount();
  }
});

function find(
  tree: any,
  type: any,
  matches: (props: any) => boolean = () => true,
): any {
  if (!tree || typeof tree !== "object") return;
  if (Array.isArray(tree))
    return tree.map((entry) => find(entry, type, matches)).find(Boolean);
  if (tree.type === type && matches(tree.props)) return tree;
  return find(tree.props?.children, type, matches);
}
const jsx = (type: any, props: any) => ({ type, props });
const palette = new Proxy({}, { get: (_target, key) => key });

function screenHarness(
  initial: any = {},
  dimensions = { height: 800, fontScale: 1 },
  initialReduceMotion: boolean | Promise<boolean> = false,
) {
  const react = hooks();
  let activeHooks = react;
  let focused = true;
  const state: any = {
    items: [item("one", "a", 1)],
    books: [book("a")],
    collapsed: { a: false },
    loading: false,
    loadError: false,
    dialog: null,
    reload() {
      retried++;
    },
    toggleGroup() {},
    openDialog() {},
    dismiss() {},
    confirm() {},
    ...initial,
  };
  let retried = 0;
  const navigation: string[] = [];
  const pushed: any[] = [];
  const alerts: any[] = [];
  const animations: any[] = [];
  let motionListener: ((enabled: boolean) => void) | undefined;
  const screen = load("./ConversationsScreen.tsx", {
    react: new Proxy(react.api, {
      get: (_target, key) => activeHooks.api[key],
    }),
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": {
      AccessibilityInfo: {
        isReduceMotionEnabled: () => Promise.resolve(initialReduceMotion),
        addEventListener: (
          _event: string,
          listener: (enabled: boolean) => void,
        ) => {
          motionListener = listener;
          return {
            remove: () => {
              motionListener = undefined;
            },
          };
        },
      },
      ActivityIndicator: "ActivityIndicator",
      LayoutAnimation: {
        configureNext: (config: any) => animations.push(config),
      },
      PlatformColor: (name: string) => name,
      Pressable: "Pressable",
      SectionList: "SectionList",
      StyleSheet: { create: (value: any) => value },
      Text: "Text",
      View: "View",
      useWindowDimensions: () => dimensions,
      Keyboard: { dismiss() {} },
      Alert: { alert: (...args: any[]) => alerts.push(args) },
    },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "expo-router": {
      Stack: { Screen: "StackScreen" },
      useFocusEffect: (callback: any) =>
        react.api.useEffect(
          () => (focused ? callback() : undefined),
          [callback, focused],
        ),
      useRouter: () => ({
        navigate: (route: string) => navigation.push(route),
        push: (route: any) => pushed.push(route),
      }),
    },
    "react-native-gesture-handler/ReanimatedSwipeable": {
      __esModule: true,
      default: "Swipeable",
    },
    "expo-symbols": { SymbolView: "SymbolView" },
    "../components/EmptyState": { EmptyState: "EmptyState" },
    "../components/BookNotice": { BookNotice: "BookNotice" },
    "../components/SectionHeader": { SectionHeader: "SectionHeader" },
    "../components/PageChrome": {
      PageHeading: "PageHeading",
      PageSearch: "PageSearch",
    },
    "../chat/format": { SERIF_BOLD: "serif" },
    "../theme": { usePalette: () => palette },
    "./ConversationRenamePrompt": { ConversationRenamePrompt: "RenamePrompt" },
    "./model": model,
    "./useConversationList": { useConversationList: () => state },
  });
  const render = () => react.render(() => screen.default());
  return {
    render,
    state,
    navigation,
    pushed,
    alerts,
    animations,
    setReduceMotion(enabled: boolean) {
      motionListener?.(enabled);
    },
    renderRow(rowHooks: ReturnType<typeof hooks>, operation: () => any) {
      activeHooks = rowHooks;
      try {
        return rowHooks.render(operation);
      } finally {
        activeHooks = react;
      }
    },
    blur() {
      focused = false;
      render();
    },
    focus() {
      focused = true;
      render();
    },
    unmount: react.unmount,
    get retried() {
      return retried;
    },
  };
}

test("the real screen uses fixed search, clears explicitly and exposes three separate recovery states", () => {
  const ui = screenHarness();
  const { render, state, navigation } = ui;
  let tree = render();
  const search = find(tree, "PageSearch").props;
  assert.equal(find(tree, "StackScreen").props.options.headerShown, false);
  assert.equal(find(tree, "PageHeading").props.title, "对话");
  search.onChange("unmatched");
  tree = render();
  let empty = find(tree, "SectionList").props.ListEmptyComponent.props.children;
  assert.equal(empty.props.title, "没有找到相关对话");
  assert.equal(empty.props.actionLabel, "清除搜索");
  empty.props.onAction();
  tree = render();
  assert.equal(find(tree, "PageSearch").props.value, "");
  assert.equal(find(tree, "SectionList").props.sections.length, 1);
  state.loadError = true;
  tree = render();
  empty = find(tree, "SectionList").props.ListEmptyComponent.props.children;
  assert.equal(empty.props.title, "对话读取失败");
  empty.props.onAction();
  assert.equal(ui.retried, 1);
  state.loadError = false;
  state.items = [];
  tree = render();
  empty = find(tree, "SectionList").props.ListEmptyComponent.props.children;
  assert.equal(empty.props.title, "还没有对话");
  empty.props.onAction();
  assert.deepEqual(navigation, ["/(tabs)"]);
});

test("group and preview disclosures animate positions while keeping SectionList virtualization", async () => {
  const ui = screenHarness({
    items: Array.from({ length: 8 }, (_, index) =>
      item("chat-" + index, "a", index),
    ),
  });
  const toggled: string[] = [];
  ui.state.toggleGroup = (bookId: string) => {
    assert.equal(ui.animations.length, toggled.length + 1);
    toggled.push(bookId);
    ui.state.collapsed[bookId] = !ui.state.collapsed[bookId];
  };
  ui.render();
  await settle();
  for (const expanded of [true, false]) {
    const list = find(ui.render(), "SectionList");
    const header = find(
      list.props.renderSectionHeader({ section: list.props.sections[0] }),
      "SectionHeader",
    );
    assert.equal(header.props.expanded, expanded);
    assert.equal(header.props.transitionDuration, 220);
    header.props.onPress();
  }
  for (const count of [3, 8]) {
    const list = find(ui.render(), "SectionList");
    assert.equal(list.props.sections[0].data.length, count);
    list.props
      .renderSectionFooter({ section: list.props.sections[0] })
      .props.onPress();
  }
  assert.deepEqual(toggled, ["a", "a"]);
  assert.deepEqual(
    ui.animations,
    Array.from({ length: 4 }, () => ({
      duration: 220,
      update: { type: "easeInEaseOut" },
    })),
  );
  assert.equal(
    find(ui.render(), "SectionList").props.sections[0].data.length,
    3,
  );
  ui.unmount();
});

test("reduce motion changes skip disclosure travel and an old initial read cannot override them", async () => {
  const pending = deferred<boolean>();
  const ui = screenHarness(
    {
      items: Array.from({ length: 8 }, (_, index) =>
        item("chat-" + index, "a", index),
      ),
    },
    undefined,
    pending.promise,
  );
  const header = () => {
    const list = find(ui.render(), "SectionList");
    return find(
      list.props.renderSectionHeader({ section: list.props.sections[0] }),
      "SectionHeader",
    );
  };
  header().props.onPress();
  assert.deepEqual(ui.animations, []);
  ui.setReduceMotion(false);
  assert.equal(header().props.transitionDuration, 220);
  header().props.onPress();
  assert.equal(ui.animations.length, 1);
  ui.setReduceMotion(true);
  pending.resolve(false);
  await settle();
  assert.equal(header().props.transitionDuration, 0);
  header().props.onPress();
  const list = find(ui.render(), "SectionList");
  list.props
    .renderSectionFooter({ section: list.props.sections[0] })
    .props.onPress();
  assert.equal(
    find(ui.render(), "SectionList").props.sections[0].data.length,
    8,
  );
  assert.equal(ui.animations.length, 1);
  ui.unmount();
});

test("filtering keeps matching groups open without scheduling a disclosure transition", async () => {
  const ui = screenHarness();
  let toggles = 0;
  ui.state.toggleGroup = () => {
    toggles++;
  };
  ui.render();
  await settle();
  find(ui.render(), "PageSearch").props.onChange("书名-a");
  const list = find(ui.render(), "SectionList");
  find(
    list.props.renderSectionHeader({ section: list.props.sections[0] }),
    "SectionHeader",
  ).props.onPress();
  assert.deepEqual(ui.animations, []);
  assert.equal(toggles, 0);
  ui.unmount();
});

test("disclosure arrows reverse from their current position and retain an accessible expanded state", () => {
  const headerHooks = hooks();
  const arrowHooks = hooks();
  let activeHooks = headerHooks;
  const animations: any[] = [];
  let stops = 0;
  class Value {
    constructor(readonly initial: number) {}
    interpolate(config: any) {
      return config;
    }
  }
  const { SectionHeader } = load("../components/SectionHeader.tsx", {
    react: new Proxy(headerHooks.api, {
      get: (_target, key) => activeHooks.api[key],
    }),
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "expo-image": { Image: "Image" },
    "expo-symbols": { SymbolView: "SymbolView" },
    "../theme": { usePalette: () => palette, type: { captionSmall: 12 } },
    "react-native": {
      Animated: {
        Value,
        View: "AnimatedView",
        timing: (_value: Value, config: any) => {
          animations.push(config);
          return {
            start() {},
            stop() {
              stops++;
            },
          };
        },
      },
      Easing: { ease: "ease", inOut: (value: any) => value },
      Pressable: "Pressable",
      StyleSheet: { create: (value: any) => value },
      Text: "Text",
      View: "View",
    },
  });
  const render = (expanded: boolean, transitionDuration: number) => {
    activeHooks = headerHooks;
    const header = headerHooks.render(() =>
      SectionHeader({
        title: "书名",
        variant: "group",
        expanded,
        transitionDuration,
        onPress() {},
      }),
    );
    assert.equal(header.props.accessibilityState.expanded, expanded);
    const arrow = header.props.children.at(-1);
    activeHooks = arrowHooks;
    return arrowHooks.render(() => arrow.type(arrow.props));
  };
  render(false, 220);
  const expanded = render(true, 220);
  assert.equal(expanded.props.children.props.name, "chevron.right");
  assert.deepEqual(expanded.props.style.transform[0].rotate.outputRange, [
    "0deg",
    "90deg",
  ]);
  render(false, 0);
  assert.deepEqual(
    animations.map(({ toValue, duration, useNativeDriver }) => ({
      toValue,
      duration,
      useNativeDriver,
    })),
    [
      { toValue: 0, duration: 220, useNativeDriver: true },
      { toValue: 1, duration: 220, useNativeDriver: true },
      { toValue: 0, duration: 0, useNativeDriver: true },
    ],
  );
  assert.equal(stops, 2);
  arrowHooks.unmount();
  headerHooks.unmount();
});

test("conversation previews expand in place and a tail match opens the original conversation", () => {
  const entries = Array.from({ length: 8 }, (_, index) =>
    item("chat-" + index, "a", index, { title: "对话 " + index }),
  );
  const ui = screenHarness({ items: entries });
  let tree = ui.render();
  let list = find(tree, "SectionList");
  assert.equal(list.props.sections[0].count, 8);
  assert.equal(list.props.sections[0].data.length, 3);
  list.props
    .renderSectionFooter({ section: list.props.sections[0] })
    .props.onPress();
  list = find(ui.render(), "SectionList");
  assert.equal(list.props.sections[0].data.length, 8);
  assert.deepEqual(ui.pushed, []);
  list.props
    .renderSectionFooter({ section: list.props.sections[0] })
    .props.onPress();
  assert.equal(
    find(ui.render(), "SectionList").props.sections[0].data.length,
    3,
  );
  find(ui.render(), "PageSearch").props.onChange("对话 0");
  tree = ui.render();
  list = find(tree, "SectionList");
  const section = list.props.sections[0];
  assert.deepEqual(
    section.data.map((entry: any) => entry.conversationId),
    ["chat-0"],
  );
  assert.equal(list.props.renderSectionFooter({ section }), null);
  list.props
    .renderItem({ item: section.data[0], section, index: 0 })
    .props.onOpen();
  assert.deepEqual(ui.pushed, [
    {
      pathname: "/book-chat",
      params: { bookId: "a", conversationId: "chat-0", bookTitle: "书名-a" },
    },
  ]);
  find(ui.render(), "PageSearch").props.onChange("");
  assert.equal(
    find(ui.render(), "SectionList").props.sections[0].data.length,
    3,
  );
});

test("small screens and larger fonts reduce the preview without restricting book-title searches", () => {
  for (const dimensions of [
    { height: 690, fontScale: 1 },
    { height: 800, fontScale: 1.4 },
  ]) {
    const ui = screenHarness(
      {
        items: Array.from({ length: 6 }, (_, index) =>
          item("row-" + index, "a", index),
        ),
      },
      dimensions,
    );
    assert.equal(
      find(ui.render(), "SectionList").props.sections[0].data.length,
      2,
    );
    find(ui.render(), "PageSearch").props.onChange("书名-a");
    assert.equal(
      find(ui.render(), "SectionList").props.sections[0].data.length,
      6,
    );
  }
});

function rowHarness(
  ui: ReturnType<typeof screenHarness>,
  entry = ui.state.items[0],
) {
  const react = hooks();
  let closes = 0;
  const render = () => {
    const list = find(ui.render(), "SectionList");
    const row = list.props.renderItem({ item: entry });
    return ui.renderRow(react, () => row.type(row.props));
  };
  const native = {
    close() {
      closes++;
    },
  };
  render().props.ref.current = native;
  return {
    render,
    native,
    get closes() {
      return closes;
    },
    unmount: react.unmount,
  };
}

test("leaving the conversation page closes its active swipe before returning", () => {
  const ui = screenHarness();
  const row = rowHarness(ui);
  row.render().props.onSwipeableWillOpen();
  row.render();
  assert.equal(row.closes, 0);
  ui.blur();
  assert.equal(row.closes, 1);
  ui.focus();
  ui.render();
  assert.equal(row.closes, 1);
  row.unmount();
  ui.unmount();
});

test("closing a swipe hides and deactivates its actions before the spring ends", () => {
  const dialogs: any[] = [];
  const ui = screenHarness({
    openDialog: (...args: any[]) => dialogs.push(args),
  });
  const row = rowHarness(ui);
  row.render().props.onSwipeableWillOpen();
  const open = row.render();
  const retainedActions = open.props.renderRightActions();
  assert.equal(retainedActions.props.accessibilityElementsHidden, false);
  open.props.onSwipeableWillClose?.();
  const closingActions = row.render().props.renderRightActions();
  assert.equal(closingActions.props.accessibilityElementsHidden, true);
  assert.equal(closingActions.props.children[0].props.disabled, true);
  assert.equal(closingActions.props.children[1].props.disabled, true);
  retainedActions.props.children[0].props.onPress();
  retainedActions.props.children[1].props.onPress();
  assert.deepEqual(dialogs, []);
  row.render().props.onSwipeableClose();
  row.render().props.onSwipeableWillOpen();
  const reopenedActions = row.render().props.renderRightActions();
  reopenedActions.props.children[0].props.onPress();
  reopenedActions.props.children[0].props.onPress();
  reopenedActions.props.children[1].props.onPress();
  assert.equal(dialogs[0][0], "rename");
  assert.equal(dialogs.length, 1);
  row.unmount();
  ui.unmount();
});

test("pressing a conversation opens it without a duplicate long-press action menu", () => {
  const ui = screenHarness();
  const row = rowHarness(ui);
  const press = find(
    row.render(),
    "Pressable",
    (props) => props.testID === "question-one",
  );
  press.props.onLongPress?.();
  assert.deepEqual(ui.alerts, []);
  press.props.onPress();
  assert.equal(ui.pushed.length, 1);
  row.unmount();
  ui.unmount();
});

test("tapping an exposed conversation closes its swipe before opening the conversation", () => {
  const ui = screenHarness();
  const row = rowHarness(ui);
  row.render().props.onSwipeableWillOpen();
  const press = () =>
    find(row.render(), "Pressable", (props) => props.testID === "question-one");
  press().props.onPress();
  assert.equal(row.closes, 1);
  assert.deepEqual(ui.pushed, []);
  press().props.onPress();
  assert.equal(ui.pushed.length, 1);
  row.unmount();
  ui.unmount();
});

test("retained row and accessibility actions cannot open dialogs or routes after page blur", () => {
  const dialogs: any[] = [];
  const ui = screenHarness({
    openDialog: (...args: any[]) => dialogs.push(args),
  });
  const row = rowHarness(ui);
  const press = find(
    row.render(),
    "Pressable",
    (props) => props.testID === "question-one",
  );
  ui.blur();
  press.props.onAccessibilityAction({ nativeEvent: { actionName: "rename" } });
  press.props.onAccessibilityAction({ nativeEvent: { actionName: "delete" } });
  press.props.onPress();
  assert.equal(ui.alerts.length, 0);
  const closesBeforeSwipe = row.closes;
  row.render().props.onSwipeableWillOpen();
  assert.equal(row.closes, closesBeforeSwipe + 1);
  assert.equal(
    row.render().props.renderRightActions().props.accessibilityElementsHidden,
    true,
  );
  assert.deepEqual(dialogs, []);
  assert.deepEqual(ui.pushed, []);
  ui.focus();
  find(
    row.render(),
    "Pressable",
    (props) => props.testID === "question-one",
  ).props.onPress();
  assert.equal(ui.pushed.length, 1);
  row.unmount();
  ui.unmount();
});

function promptHarness() {
  const react = hooks();
  const completions: any[] = [];
  const writes: string[] = [];
  let cancelled = 0;
  class Value {
    constructor(_value: number) {}
    stopAnimation() {}
  }
  const prompt = load("./ConversationRenamePrompt.tsx", {
    react: react.api,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "../theme": { usePalette: () => palette },
    "react-native": {
      AccessibilityInfo: {
        addEventListener: () => ({ remove() {} }),
        isReduceMotionEnabled: async () => false,
      },
      Animated: {
        Value,
        View: "AnimatedView",
        timing: () => ({
          start: (callback: any) => {
            if (callback) completions.push(callback);
          },
        }),
      },
      Easing: { ease: "ease", inOut: (value: any) => value },
      Platform: { OS: "ios" },
      Modal: "Modal",
      Pressable: "Pressable",
      StyleSheet: { create: (value: any) => value },
      Text: "Text",
      TextInput: "TextInput",
      View: "View",
    },
  });
  const render = () =>
    react.render(() =>
      prompt.ConversationRenamePrompt({
        initialName: "原名称",
        onCancel: () => {
          cancelled++;
        },
        onSave: (name: string) => writes.push(name),
      }),
    );
  return {
    render,
    writes,
    completions,
    unmount: react.unmount,
    get cancelled() {
      return cancelled;
    },
  };
}

test("rename prompt consumes save once, preserves raw text and waits for native dismissal before writing", () => {
  const h = promptHarness();
  let tree = h.render();
  find(tree, "TextInput").props.onChangeText("  新名称\n");
  tree = h.render();
  const save = find(
    tree,
    "Pressable",
    (props) => props.children.props.children === "保存",
  );
  save.props.onPress();
  save.props.onPress();
  assert.equal(h.completions.length, 1);
  assert.deepEqual(h.writes, []);
  h.completions[0]({ finished: true });
  tree = h.render();
  assert.equal(find(tree, "Modal").props.visible, false);
  assert.deepEqual(h.writes, []);
  find(tree, "Modal").props.onDismiss();
  find(tree, "Modal").props.onDismiss();
  assert.deepEqual(h.writes, ["  新名称\n"]);
  assert.equal(h.cancelled, 0);
});

test("rename cancellation never saves, and unmount drops a pending action before dismissal", () => {
  const h = promptHarness();
  let tree = h.render();
  find(
    tree,
    "Pressable",
    (props) => props.children.props.children === "取消",
  ).props.onPress();
  h.completions[0]({ finished: true });
  tree = h.render();
  find(tree, "Modal").props.onDismiss();
  assert.equal(h.cancelled, 1);
  assert.deepEqual(h.writes, []);
  const other = promptHarness();
  tree = other.render();
  find(
    tree,
    "Pressable",
    (props) => props.children.props.children === "保存",
  ).props.onPress();
  other.unmount();
  other.completions[0]({ finished: true });
  find(tree, "Modal").props.onDismiss();
  assert.deepEqual(other.writes, []);
});
