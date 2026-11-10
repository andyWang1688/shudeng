import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { test } from "node:test";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function hooks() {
  const slots: any[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const differs = (a: any[], b: any[]) =>
    !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const api: any = {
    useRef(value: any) {
      return (slots[cursor++] ??= { current: value });
    },
    useState(initial: any) {
      const slot = (slots[cursor++] ??= {
        value: typeof initial === "function" ? initial() : initial,
      });
      return [
        slot.value,
        (value: any) => {
          slot.value = typeof value === "function" ? value(slot.value) : value;
        },
      ];
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
        const previous = slots[i];
        slots[i] = { deps };
        effects.push(() => {
          previous?.cleanup?.();
          slots[i].cleanup = effect();
        });
      }
    },
  };
  return {
    api,
    render(operation: () => any) {
      cursor = 0;
      const value = operation();
      const pending = effects;
      effects = [];
      pending.forEach((effect) => effect());
      return value;
    },
    unmount() {
      slots.forEach((slot) => slot.cleanup?.());
    },
  };
}
function find(tree: any, type: any, matches = (_props: any) => true): any {
  if (!tree || typeof tree !== "object") return;
  if (Array.isArray(tree))
    return tree.map((item) => find(item, type, matches)).find(Boolean);
  if (tree.type === type && matches(tree.props)) return tree;
  return find(tree.props?.children, type, matches);
}
const annotation = (id: string, extra: any = {}) => ({
  id,
  anchorId: "anchor-" + id,
  kind: "note",
  color: null,
  quote: "quote " + id,
  body: "body " + id,
  chapter: "第一章",
  page: null,
  createdAt: 1,
  position: 1,
  progression: 0.1,
  locator: { type: "epub", cfi: id },
  ...extra,
});
function harness(initial: any = {}, ports: any = {}) {
  const root = hooks();
  let activeHooks = root;
  const rows = new Map<string, ReturnType<typeof hooks>>();
  const writes: any[] = [],
    changes: any[] = [],
    navigation: any[] = [],
    files: any[] = [],
    shares: any[] = [],
    reads: string[] = [];
  let allowed = true;
  let props: any = {
    bookId: "book-a",
    title: "测试书",
    format: "EPUB",
    annotations: [annotation("one")],
    active: true,
    canInteract: () => allowed,
    onNavigate: (value: any) => navigation.push(value),
    onChanged: (value: any) => {
      const next =
        typeof value === "function" ? value(props.annotations) : value;
      changes.push(next);
      props = { ...props, annotations: next };
    },
    ...initial,
  };
  const jsx = (type: any, value: any) => ({ type, props: value });
  const palette = new Proxy({}, { get: (_target, key) => key });
  const mocks: Record<string, any> = {
    react: new Proxy(root.api, { get: (_target, key) => activeHooks.api[key] }),
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": {
      View: "View",
      Text: "Text",
      Pressable: "Pressable",
      ActivityIndicator: "ActivityIndicator",
      StyleSheet: { create: (value: any) => value, hairlineWidth: 0.5 },
      PlatformColor: (value: any) => value,
      Keyboard: { dismiss() {} },
      Share: {
        sharedAction: "sharedAction",
        share: async (value: any) => {
          shares.push(value);
          return ports.share ? ports.share(value) : { action: "sharedAction" };
        },
      },
    },
    "@gorhom/bottom-sheet": {
      BottomSheetFlatList: "AnnotationList",
      BottomSheetTextInput: "SearchInput",
    },
    "react-native-gesture-handler/ReanimatedSwipeable": {
      __esModule: true,
      default: "Swipeable",
    },
    "expo-symbols": { SymbolView: "SymbolView" },
    "expo-file-system": {
      Paths: { cache: "cache" },
      File: class {
        uri: string;
        name: string;
        exists = true;
        text = "";
        deleted = false;
        constructor(_root: any, name: string) {
          this.name = name;
          this.uri = "cache://" + name;
          if (ports.fileConstructor) ports.fileConstructor();
          files.push(this);
        }
        write(value: string) {
          if (ports.fileWrite) ports.fileWrite();
          this.text = value;
        }
        delete() {
          this.deleted = true;
        }
      },
    },
    "../../platform/library": {
      updateReaderAnnotation: async (id: string, patch: any) => {
        writes.push({ operation: "save", id, patch });
        if (ports.save) return ports.save(id, patch);
      },
      deleteReaderAnnotation: async (id: string) => {
        writes.push({ operation: "delete", id });
        if (ports.delete) return ports.delete(id);
      },
      loadBookAnnotations: async (bookId: string) => {
        reads.push(bookId);
        return ports.load ? ports.load(bookId) : props.annotations;
      },
    },
    "../reader/NoteSheet": { NoteSheet: "NoteSheet" },
    "../components/BookNotice": { BookNotice: "BookNotice" },
    "../components/EmptyState": { EmptyState: "EmptyState" },
    "../theme": { usePalette: () => palette },
  };
  const file = new URL("./BookAnnotationsContent.tsx", import.meta.url);
  const compiled: any = new Module(file.pathname);
  compiled.require = (id: string) => {
    if (id in mocks) return mocks[id];
    if (id.startsWith("./")) {
      const local = new Module(file.pathname + id);
      local.require = compiled.require;
      local._compile(
        ts.transpileModule(readFileSync(new URL(id + ".ts", file), "utf8"), {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.CommonJS,
          },
        }).outputText,
        file.pathname + id,
      );
      return local.exports;
    }
    throw Error("Unmocked " + id);
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
  const render = () =>
    root.render(() => compiled.exports.BookAnnotationsContent(props));
  return {
    render,
    writes,
    changes,
    navigation,
    files,
    shares,
    reads,
    setProps(next: any) {
      props = { ...props, ...next };
      return render();
    },
    block() {
      allowed = false;
    },
    unmount: root.unmount,
    row(
      id = props.annotations.find((entry: any) => entry.kind !== "bookmark")
        ?.id,
    ) {
      const list = find(render(), "AnnotationList");
      const entry = list.props.data.find((value: any) => value.id === id);
      assert.ok(entry, "expected visible annotation " + id);
      const row = list.props.renderItem({
        item: entry,
        index: list.props.data.indexOf(entry),
      });
      if (typeof row.type !== "function") return row;
      const rowHooks = rows.get(id) ?? hooks();
      rows.set(id, rowHooks);
      activeHooks = rowHooks;
      try {
        return rowHooks.render(() => row.type(row.props));
      } finally {
        activeHooks = root;
      }
    },
  };
}
const button = (tree: any, label: string) =>
  find(tree, "Pressable", (props) => props.accessibilityLabel === label).props;
const sheet = (ui: ReturnType<typeof harness>) =>
  find(ui.render(), "NoteSheet").props;
function actions(ui: ReturnType<typeof harness>, id = "one") {
  ui.row(id).props.onSwipeableWillOpen("left");
  return ui.row(id).props.renderRightActions();
}
function edit(ui: ReturnType<typeof harness>, id = "one") {
  button(actions(ui, id), "编辑笔记").onPress();
  return sheet(ui);
}
function remove(ui: ReturnType<typeof harness>, id = "one") {
  button(actions(ui, id), "删除标注").onPress();
  return find(ui.render(), "BookNotice").props;
}
const confirm = (notice: any) =>
  notice.actions.find((entry: any) => entry.style === "destructive").onPress();
const cancel = (notice: any) =>
  notice.actions.find((entry: any) => entry.style === "cancel").onPress();
test("the book list includes every highlight and note in reading order, excluding bookmarks", () => {
  const ui = harness({
    annotations: [
      annotation("legacy", { locator: null }),
      annotation("late", { progression: 0.9 }),
      annotation("mark", { kind: "bookmark" }),
      annotation("first", {
        kind: "highlight",
        body: null,
        color: "green",
        progression: 0.01,
      }),
    ],
  });
  const list = find(ui.render(), "AnnotationList");
  assert.deepEqual(
    list.props.data.map((entry: any) => entry.id),
    ["first", "late", "legacy"],
  );
  const row = ui.row("first");
  assert.equal(row.props.renderLeftActions, undefined);
  assert.equal(find(row, "Text").props.numberOfLines, 3);
  button(row, "高亮：quote first").onPress();
  assert.equal(ui.navigation[0].id, "first");
  button(ui.row("legacy"), "笔记：quote legacy").onPress();
  assert.equal(ui.navigation.length, 1);
  assert.equal(find(ui.render(), "BookNotice").props.title, "无法返回原文");
  ui.unmount();
});
test("search covers full current-book quote, body and chapter without preview truncation", () => {
  const entries = Array.from({ length: 17 }, (_, i) =>
    annotation(String(i), {
      quote: "excerpt " + i,
      body: "thought " + i,
      chapter: "chapter " + i,
    }),
  );
  const ui = harness({ annotations: entries });
  assert.equal(find(ui.render(), "AnnotationList").props.data.length, 17);
  for (const value of ["excerpt 16", "thought 16", "chapter 16"]) {
    find(ui.render(), "SearchInput").props.onChangeText(value);
    assert.deepEqual(
      find(ui.render(), "AnnotationList").props.data.map(
        (entry: any) => entry.id,
      ),
      ["16"],
    );
  }
  find(ui.render(), "SearchInput").props.onChangeText("missing");
  assert.equal(
    find(ui.render(), "AnnotationList").props.ListEmptyComponent.props.title,
    "没有找到相关标注",
  );
  find(ui.render(), "AnnotationList").props.ListEmptyComponent.props.onAction();
  assert.equal(find(ui.render(), "AnnotationList").props.data.length, 17);
  ui.unmount();
});
test("one left swipe exposes edit and delete together and closing disables retained actions", () => {
  const ui = harness();
  const row = ui.row();
  const initial = row.props.renderRightActions();
  assert.equal(initial.props.accessibilityElementsHidden, true);
  const opened = actions(ui);
  assert.ok(button(opened, "编辑笔记"));
  assert.ok(button(opened, "删除标注"));
  ui.row().props.onSwipeableWillClose();
  const closing = ui.row().props.renderRightActions();
  assert.equal(closing.props.accessibilityElementsHidden, true);
  button(opened, "编辑笔记").onPress();
  button(opened, "删除标注").onPress();
  assert.equal(find(ui.render(), "NoteSheet"), undefined);
  assert.equal(find(ui.render(), "BookNotice"), undefined);
  ui.unmount();
});
test("saving retains raw text and merges into the latest book annotations by id", async () => {
  const pending = deferred<void>();
  const ui = harness({}, { save: () => pending.promise });
  edit(ui).onChangeBody("  saved text\n");
  sheet(ui).onSave();
  const newest = annotation("newest");
  ui.setProps({
    annotations: [annotation("one", { chapter: "new chapter" }), newest],
  });
  pending.resolve();
  await flush();
  assert.deepEqual(ui.writes, [
    { operation: "save", id: "one", patch: { body: "  saved text\n" } },
  ]);
  assert.equal(ui.changes[0][0].body, "  saved text\n");
  assert.equal(ui.changes[0][0].chapter, "new chapter");
  assert.equal(ui.changes[0][1], newest);
  assert.equal(find(ui.render(), "NoteSheet"), undefined);
  ui.unmount();
});
test("delete confirmation is consumed once and cancelled old callbacks cannot delete", async () => {
  const ui = harness();
  const first = remove(ui);
  cancel(first);
  confirm(first);
  assert.deepEqual(ui.writes, []);
  const current = remove(ui);
  confirm(first);
  confirm(current);
  confirm(current);
  await flush();
  assert.deepEqual(ui.writes, [{ operation: "delete", id: "one" }]);
  assert.deepEqual(ui.changes, [[]]);
  ui.unmount();
});
test("closing discards the edit and stale callbacks cannot affect a new editor", async () => {
  const ui = harness({ annotations: [annotation("one"), annotation("two")] });
  const first = edit(ui);
  first.onChangeBody("discard me");
  first.onClose();
  const next = edit(ui, "two");
  next.onChangeBody("second draft");
  first.onChangeBody("stale");
  first.onSave();
  first.onDelete();
  first.onClose();
  await flush();
  assert.deepEqual(ui.writes, []);
  assert.equal(sheet(ui).body, "second draft");
  sheet(ui).onClose();
  assert.equal(edit(ui).body, "body one");
  ui.unmount();
});
test("a failed save preserves the draft and an accepted write blocks duplicate save or immediate close", async () => {
  const pending = deferred<void>();
  const ui = harness({}, { save: () => pending.promise });
  edit(ui).onChangeBody("failed draft");
  const editing = sheet(ui);
  editing.onSave();
  editing.onSave();
  editing.onClose();
  assert.equal(sheet(ui).body, "failed draft");
  pending.reject(Error("disk full"));
  await flush();
  assert.equal(ui.writes.length, 1);
  assert.equal(sheet(ui).body, "failed draft");
  assert.equal(sheet(ui).saving, false);
  assert.equal(sheet(ui).notice.title, "笔记保存失败");
  assert.deepEqual(ui.changes, []);
  ui.unmount();
});
test("deactivation and book switches discard transient editors and ignore retained actions", async () => {
  const ui = harness();
  const oldRow = ui.row();
  const oldEditor = edit(ui);
  ui.setProps({ active: false });
  oldEditor.onSave();
  oldEditor.onDelete();
  button(oldRow, "笔记：quote one").onPress();
  assert.equal(find(ui.render(), "NoteSheet"), undefined);
  assert.deepEqual(ui.writes, []);
  assert.deepEqual(ui.navigation, []);
  ui.setProps({
    active: true,
    bookId: "book-b",
    annotations: [annotation("other")],
  });
  oldEditor.onChangeBody("stale book");
  oldEditor.onSave();
  assert.equal(edit(ui, "other").body, "body other");
  assert.deepEqual(ui.writes, []);
  ui.unmount();
});
test("accepted writes sync the same book after close but never publish into a different book", async () => {
  for (const switchesBook of [false, true]) {
    const pending = deferred<void>();
    const ui = harness({}, { save: () => pending.promise });
    edit(ui).onChangeBody("accepted body");
    sheet(ui).onSave();
    ui.setProps(
      switchesBook
        ? { bookId: "book-b", annotations: [annotation("other")] }
        : { active: false },
    );
    pending.resolve();
    await flush();
    assert.equal(ui.changes.length, switchesBook ? 0 : 1);
    if (!switchesBook) assert.equal(ui.changes[0][0].body, "accepted body");
    assert.equal(find(ui.render(), "NoteSheet"), undefined);
    assert.equal(find(ui.render(), "BookNotice"), undefined);
    ui.unmount();
  }
});
test("an accepted write finishing after unmount merges its change into the owner's latest rows without another read", async () => {
  const pending = deferred<void>();
  const refreshed = [annotation("one"), annotation("added after close")];
  const ui = harness(
    {},
    { save: () => pending.promise, load: async () => refreshed },
  );
  edit(ui).onChangeBody("accepted body");
  sheet(ui).onSave();
  ui.unmount();
  ui.setProps({ annotations: refreshed });
  pending.resolve();
  await flush();
  assert.deepEqual(
    ui.reads,
    [],
    "a closed panel cannot replace newer owner rows with a late full reload",
  );
  assert.equal(ui.changes[0][0].body, "accepted body");
  assert.equal(ui.changes[0][1], refreshed[1]);
});
test("export always shares all current-book annotations, excluding bookmarks and filtered scope", async () => {
  const ui = harness({
    annotations: [
      annotation("one"),
      annotation("two", { kind: "highlight", body: null }),
      annotation("bookmark", { kind: "bookmark" }),
    ],
  });
  find(ui.render(), "SearchInput").props.onChangeText("quote two");
  button(ui.render(), "导出标注").onPress();
  await flush();
  assert.equal(ui.files.length, 1);
  assert.equal(ui.shares.length, 1);
  assert.match(ui.files[0].text, /《测试书》/);
  assert.match(ui.files[0].text, /原文：quote one/);
  assert.match(ui.files[0].text, /想法：body one/);
  assert.match(ui.files[0].text, /原文：quote two/);
  assert.doesNotMatch(ui.files[0].text, /bookmark/);
  assert.equal(ui.files[0].deleted, true);
  assert.deepEqual(ui.writes, []);
  ui.unmount();
});
test("export failures retain annotations, clean cache and release the busy state", async () => {
  const ui = harness(
    {},
    {
      share: async () => {
        throw Error("share failed");
      },
    },
  );
  button(ui.render(), "导出标注").onPress();
  await flush();
  assert.equal(ui.files[0].deleted, true);
  assert.equal(button(ui.render(), "导出标注").disabled, false);
  assert.equal(find(ui.render(), "BookNotice").props.title, "无法导出");
  assert.deepEqual(ui.changes, []);
  ui.unmount();
});

test("long annotations expand inline without navigating and stale expand callbacks do nothing", () => {
  const ui = harness({
    annotations: [
      annotation("one", {
        locator: null,
        quote: "全文摘录".repeat(80),
        body: "完整想法".repeat(40),
      }),
    ],
  });
  const expand = button(ui.row(), "展开标注全文");
  let stopped = 0;
  expand.onPress({
    stopPropagation() {
      stopped++;
    },
  });
  const full = ui.row();
  assert.equal(find(full, "Text").props.numberOfLines, undefined);
  assert.equal(button(full, "收起标注").accessibilityState.expanded, true);
  assert.equal(stopped, 1);
  assert.deepEqual(ui.navigation, []);
  button(full, "收起标注").onPress({ stopPropagation() {} });
  assert.equal(find(ui.row(), "Text").props.numberOfLines, 3);
  ui.setProps({ active: false });
  expand.onPress({ stopPropagation() {} });
  assert.equal(find(ui.row(), "Text").props.numberOfLines, 3);
  ui.unmount();
  const short = harness();
  assert.equal(
    find(
      short.row(),
      "Pressable",
      (props) => props.accessibilityLabel === "展开标注全文",
    ),
    undefined,
  );
  short.unmount();
});

test("search and the panel interaction guard invalidate retained row actions", () => {
  const ui = harness({ annotations: [annotation("one"), annotation("two")] });
  const previous = ui.row();
  const oldActions = actions(ui);
  find(ui.render(), "SearchInput").props.onChangeText("quote two");
  button(previous, "笔记：quote one").onPress();
  button(oldActions, "编辑笔记").onPress();
  assert.deepEqual(ui.navigation, []);
  assert.equal(find(ui.render(), "NoteSheet"), undefined);
  const current = ui.row("two");
  ui.block();
  button(current, "笔记：quote two").onPress();
  button(ui.render(), "导出标注").onPress();
  assert.deepEqual(ui.navigation, []);
  assert.deepEqual(ui.shares, []);
  ui.unmount();
});

test("failed deletion retains the row and a fresh confirmation can retry", async () => {
  let attempts = 0;
  const ui = harness(
    {},
    {
      delete: async () => {
        if (++attempts === 1) throw Error("disk full");
      },
    },
  );
  confirm(remove(ui));
  await flush();
  assert.equal(find(ui.render(), "BookNotice").props.title, "删除失败");
  assert.equal(find(ui.render(), "AnnotationList").props.data.length, 1);
  find(ui.render(), "BookNotice").props.onAcknowledge();
  confirm(remove(ui));
  await flush();
  assert.deepEqual(ui.changes, [[]]);
  assert.equal(ui.writes.length, 2);
  ui.unmount();
});

test("a removed annotation cannot be resurrected by a save and current callbacks receive the merge", async () => {
  const pending = deferred<void>();
  const newest: any[] = [];
  const ui = harness({}, { save: () => pending.promise });
  edit(ui).onChangeBody("saved");
  sheet(ui).onSave();
  ui.setProps({
    annotations: [annotation("other")],
    onChanged: (update: any) =>
      newest.push(
        typeof update === "function" ? update([annotation("other")]) : update,
      ),
  });
  pending.resolve();
  await flush();
  assert.deepEqual(ui.changes, []);
  assert.deepEqual(
    newest[0].map((entry: any) => entry.id),
    ["other"],
  );
  ui.unmount();
});

test("PDF export uses geometry page and preserves original body whitespace", async () => {
  const ui = harness({
    title: "PDF书",
    format: "PDF",
    annotations: [
      annotation("one", {
        page: 7,
        position: 2,
        body: "  保留空白\n",
        chapter: null,
      }),
      annotation("two", { page: null, position: 3, body: null }),
    ],
  });
  button(ui.render(), "导出标注").onPress();
  await flush();
  assert.equal(
    ui.files[0].text,
    "《PDF书》\n\n第 7 页\n原文：quote one\n想法：  保留空白\n\n\n第 3 页\n原文：quote two\n",
  );
  ui.unmount();
});

test("PDF annotations and export follow page order rather than creation ids", async () => {
  const pdf = (id: string, page: number) =>
    annotation(id, {
      page,
      progression: undefined,
      position: undefined,
      locator: { type: "pdf", page },
    });
  const ui = harness({
    format: "PDF",
    annotations: [pdf("a-later", 12), pdf("z-first", 2), pdf("m-middle", 7)],
  });
  assert.deepEqual(
    find(ui.render(), "AnnotationList").props.data.map((row: any) => row.id),
    ["z-first", "m-middle", "a-later"],
  );
  button(ui.render(), "导出标注").onPress();
  await flush();
  assert.ok(
    ui.files[0].text.indexOf("第 2 页") < ui.files[0].text.indexOf("第 7 页"),
  );
  assert.ok(
    ui.files[0].text.indexOf("第 7 页") < ui.files[0].text.indexOf("第 12 页"),
  );
  ui.unmount();
});

test("EPUB position outranks chapter-local progress when annotations span chapters", () => {
  const ui = harness({
    annotations: [
      annotation("late", {
        progression: undefined,
        localProgression: 0.1,
        position: 80,
      }),
      annotation("early", {
        progression: undefined,
        localProgression: 0.9,
        position: 2,
      }),
    ],
  });
  assert.deepEqual(
    find(ui.render(), "AnnotationList").props.data.map((row: any) => row.id),
    ["early", "late"],
  );
  ui.unmount();
});

test("PDF export retains a valid locator page when the optional anchor page is missing", async () => {
  const ui = harness({
    format: "PDF",
    annotations: [
      annotation("one", {
        page: null,
        position: undefined,
        locator: { type: "pdf", page: 8 },
      }),
    ],
  });
  button(ui.render(), "导出标注").onPress();
  await flush();
  assert.match(ui.files[0].text, /第 8 页/);
  ui.unmount();
});

test("duplicate export taps share once and late failures after close do not reopen notices", async () => {
  const pending = deferred<any>();
  const ui = harness({}, { share: () => pending.promise });
  const action = button(ui.render(), "导出标注");
  action.onPress();
  action.onPress();
  assert.equal(ui.files.length, 1);
  ui.setProps({ active: false });
  pending.reject(Error("share interrupted"));
  await flush();
  assert.equal(find(ui.render(), "BookNotice"), undefined);
  assert.equal(ui.files[0].deleted, true);
  ui.unmount();
});
