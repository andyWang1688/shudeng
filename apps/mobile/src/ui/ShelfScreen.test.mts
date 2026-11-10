import test from "node:test";
import assert from "node:assert/strict";
import {
  hooks,
  jsx,
  loader,
  nativePorts,
  nodes,
  flush,
} from "./settings/__tests__/platformHarness.mts";

const fixture = [
  {
    id: "sea",
    title: "海洋",
    author: "Alice",
    format: "EPUB",
    progressPercent: 32,
    removed: false,
  },
  {
    id: "forest",
    title: "森林",
    author: "Bob",
    format: "PDF",
    progressPercent: null,
    removed: false,
  },
  {
    id: "sky",
    title: "天空",
    author: "ALICE",
    format: "EPUB",
    progressPercent: 5,
    removed: false,
  },
];
const Stack = {
  Screen: "StackScreen",
  Toolbar: Object.assign("StackToolbar", { Button: "ToolbarButton" }),
};
function shelf(
  options: {
    importBook?: (args: any) => Promise<any>;
    width?: number;
    fontScale?: number;
    loadBooks?: (scope: { onlyRemoved: boolean }) => Promise<any>;
    initialize?: () => Promise<any>;
    migrate?: () => Promise<any>;
    removeBook?: (bookId: string) => Promise<void>;
  } = {},
) {
  const h = hooks(),
    pushes: any[] = [],
    locks: boolean[] = [];
  let focused = true;
  const native = nativePorts([]);
  native.useWindowDimensions = () => ({
    width: options.width ?? 390,
    height: 844,
    fontScale: options.fontScale ?? 1,
  });
  const Screen = loader({
    react: h.react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": native,
    "react-native-safe-area-context": {
      SafeAreaView: "SafeAreaView",
      useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    },
    "expo-router": {
      Stack,
      useRouter: () => ({ push: (value: any) => pushes.push(value) }),
      useFocusEffect: (fn: any) =>
        h.react.useEffect(() => (focused ? fn() : undefined), [fn, focused]),
    },
    "expo-symbols": { SymbolView: "SymbolView" },
    "@expo/ui/community/menu": { MenuView: "MenuView" },
    "../platform/db": {
      initializeDatabase: options.initialize ?? (async () => ({ ok: true })),
    },
    "../platform/library": {
      migrateLegacyLibraryIfNeeded:
        options.migrate ?? (async () => ({ failures: 0 })),
      loadShelfBooks: options.loadBooks ?? (async () => fixture),
      removeShelfBook: options.removeBook ?? (async () => {}),
      importBookFromPicker:
        options.importBook ?? (async () => ({ status: "cancelled" })),
    },
    "../platform/library/pdfImport": {
      importFailureNotice: (cause: unknown) => ({
        title: "导入未完成",
        message: String(cause),
      }),
    },
    "./components/BookCover": { BookCover: "BookCover" },
    "./components/BookNotice": { BookNotice: "BookNotice" },
    "./components/BookActionSheet": { BookActionSheet: "BookActionSheet" },
    "./components/EmptyState": { EmptyState: "EmptyState" },
    "./components/PageChrome": {
      PageHeading: "PageHeading",
      PageSearch: "PageSearch",
    },
    "./components/useHaptics": { useHaptics: () => () => {} },
    "./tabInteraction": {
      useTabInteractionLock: (value: boolean) => locks.push(value),
    },
    "./theme": {
      spacing: { screen: 20 },
      type: {},
      usePalette: () => ({
        paper: "paper",
        lamp: "lamp",
        ink: "ink",
        ink2: "ink2",
      }),
    },
  })("apps/mobile/src/ui/ShelfScreen.tsx").ShelfScreen;
  return {
    render: () => h.render(Screen),
    pushes,
    locks,
    unmount: h.unmount,
    blur() {
      focused = false;
    },
    focus() {
      focused = true;
    },
  };
}
const find = (tree: any, type: string) =>
  nodes(tree, (n) => n.type === type)[0];
const search = (tree: any) => find(tree, "PageSearch").props;
const importAction = (tree: any) =>
  nodes(tree, (n) => n.props?.accessibilityLabel === "导入书籍")[0];
const ids = (tree: any) =>
  find(tree, "FlatList").props.data.map((book: any) => book.id);
async function ready(options: Parameters<typeof shelf>[0] = {}) {
  const h = shelf(options);
  h.render();
  await flush();
  return h;
}

test("shelf keeps fixed heading and controlled search above the real two-column grid", async () => {
  const h = await ready(),
    tree = h.render(),
    options = search(tree);
  assert.equal(options.placeholder, "搜索书名或作者");
  assert.equal(options.value, "");
  assert.equal(find(tree, "StackScreen").props.options.headerShown, false);
  assert.equal(find(tree, "PageHeading").props.title, "书架");
  const list = find(tree, "FlatList");
  assert.equal(list.props.numColumns, 2);
  assert.equal(list.props.contentInsetAdjustmentBehavior, "never");
  assert.equal(
    nodes(
      list.props.ListHeaderComponent,
      (n) => n.type === "PageHeading" || n.type === "PageSearch",
    ).length,
    0,
  );
  assert.deepEqual(tree.props.edges, ["top", "left", "right"]);
  assert.equal(importAction(tree).props.accessibilityRole, "button");
  h.unmount();
});

test("controlled search filters title and author immediately and opening a result preserves its book id", async () => {
  const h = await ready();
  let tree = h.render();
  search(tree).onChange("  aLiCe  ");
  tree = h.render();
  assert.deepEqual(ids(tree), ["sea", "sky"]);
  search(tree).onChange("森林");
  tree = h.render();
  assert.deepEqual(ids(tree), ["forest"]);
  const result = find(tree, "FlatList").props.renderItem({
    item: find(tree, "FlatList").props.data[0],
  });
  find(result, "Pressable").props.onPress();
  assert.deepEqual(h.pushes, [
    { pathname: "/reader/[id]", params: { id: "forest" } },
  ]);
  h.unmount();
});

test("query changes reset the list to the beginning so matches below the old offset stay reachable", async () => {
  const h = await ready(),
    tree = h.render();
  const scrolled: any[] = [];
  find(tree, "FlatList").props.ref.current = {
    scrollToOffset: (value: any) => scrolled.push(value),
  };
  find(tree, "FlatList").props.onScroll({
    nativeEvent: { contentOffset: { y: 240 } },
  });
  search(tree).onChange("森林");
  assert.deepEqual(ids(h.render()), ["forest"]);
  assert.deepEqual(scrolled, [{ offset: 0, animated: false }]);
  h.unmount();
});

test("empty-search recovery clears the controlled field and keeps the selected sorting", async () => {
  const h = await ready();
  let tree = h.render();
  find(
    find(tree, "FlatList").props.ListHeaderComponent,
    "MenuView",
  ).props.onPressAction({ nativeEvent: { event: "title" } });
  tree = h.render();
  const ordered = ids(tree);
  search(tree).onChange("missing");
  tree = h.render();
  const empty = find(tree, "FlatList").props.ListEmptyComponent;
  find(empty, "EmptyState").props.onAction();
  tree = h.render();
  assert.equal(search(tree).value, "");
  assert.deepEqual(ids(tree), ordered);
  h.unmount();
});

test("heading import action retains progress, cancellation, and the tab interaction lock", async () => {
  let args: any, finish!: (value: any) => void;
  const h = await ready({
    importBook: (value) => {
      args = value;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  importAction(h.render()).props.onPress();
  await flush();
  let tree = h.render();
  assert.equal(importAction(tree).props.disabled, true);
  assert.equal(h.locks.at(-1), true);
  args.onProgress({ stage: "indexing", completed: 2, total: 6 });
  tree = h.render();
  const header = find(tree, "FlatList").props.ListHeaderComponent;
  assert.ok(JSON.stringify(header).includes("正在准备问答资料 · 2/6"));
  nodes(
    header,
    (n) => n.props?.accessibilityLabel === "取消导入",
  )[0].props.onPress();
  assert.equal(args.signal.aborted, true);
  finish({ status: "cancelled" });
  await flush();
  tree = h.render();
  assert.equal(importAction(tree).props.disabled, false);
  assert.equal(h.locks.at(-1), false);
  h.unmount();
});

test("queued import presses share one controller until the accepted picker settles", async () => {
  const attempts: { args: any; finish: (value: any) => void }[] = [];
  const h = await ready({
    importBook: (args) =>
      new Promise((finish) => attempts.push({ args, finish })),
  });
  const press = importAction(h.render()).props.onPress;
  press();
  press();
  assert.equal(attempts.length, 1, "only one picker may own this import");
  const tree = h.render();
  nodes(
    find(tree, "FlatList").props.ListHeaderComponent,
    (node) => node.props?.accessibilityLabel === "取消导入",
  )[0].props.onPress();
  assert.equal(attempts[0]!.args.signal.aborted, true);
  press();
  assert.equal(attempts.length, 1, "cancel does not release an unsettled picker");
  attempts[0]!.finish({ status: "cancelled" });
  await flush();
  importAction(h.render()).props.onPress();
  assert.equal(attempts.length, 2, "a settled import releases ownership");
  attempts[1]!.finish({ status: "cancelled" });
  await flush();
  h.unmount();
});

test("the shelf adapts to narrow screens and large text without removing books", async () => {
  for (const options of [{ width: 320 }, { fontScale: 1.6 }, { width: 1024 }]) {
    const h = await ready(options),
      tree = h.render(),
      list = find(tree, "FlatList");
    assert.equal(list.props.numColumns, options.width === 1024 ? 3 : 1);
    assert.equal(list.props.data.length, fixture.length);
    h.unmount();
  }
});

test("a failed load offers retry rather than claiming the library is empty", async () => {
  let attempts = 0;
  const h = await ready({
    loadBooks: async () => {
      if (++attempts === 1) throw new Error("storage unavailable");
      return fixture;
    },
  });
  const empty = find(
    find(h.render(), "FlatList").props.ListEmptyComponent,
    "EmptyState",
  );
  assert.equal(empty.props.title, "书架读取失败");
  assert.ok(empty.props.description.includes("storage unavailable"));
  await empty.props.onAction();
  await flush();
  assert.deepEqual(
    ids(h.render()),
    fixture.map((book) => book.id),
  );
  h.unmount();
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
const removedFixture = [{ ...fixture[0]!, id: "removed-book", removed: true }];
const toggleRemoved = (tree: any) =>
  find(tree, "MenuView").props.onPressAction({
    nativeEvent: { event: "removed" },
  });
const emptyState = (tree: any) =>
  find(find(tree, "FlatList").props.ListEmptyComponent, "EmptyState");

test("late results cannot replace the newest normal or removed shelf", async () => {
  for (const latestRemoved of [false, true]) {
    const jobs: {
      scope: { onlyRemoved: boolean };
      task: ReturnType<typeof deferred<any>>;
    }[] = [];
    const h = shelf({
      loadBooks: (scope) => {
        const task = deferred<any>();
        jobs.push({ scope, task });
        return task.promise;
      },
    });
    h.render();
    await flush();
    if (!latestRemoved) {
      jobs[0]!.task.resolve(fixture);
      await flush();
    }
    toggleRemoved(h.render());
    h.render();
    await flush();
    if (!latestRemoved) {
      toggleRemoved(h.render());
      h.render();
      await flush();
    }
    const newest = jobs.length - 1;
    const expected = latestRemoved ? removedFixture : fixture;
    assert.deepEqual(
      jobs.map((job) => job.scope.onlyRemoved),
      latestRemoved ? [false, true] : [false, true, false],
    );
    jobs[newest]!.task.resolve(expected);
    await flush();
    assert.deepEqual(
      ids(h.render()),
      expected.map((book) => book.id),
    );
    jobs[newest - 1]!.task.resolve(latestRemoved ? fixture : removedFixture);
    await flush();
    const tree = h.render();
    assert.equal(
      find(tree, "PageHeading").props.title,
      latestRemoved ? "已移除的书籍" : "书架",
    );
    assert.deepEqual(
      ids(tree),
      expected.map((book) => book.id),
    );
    h.unmount();
  }
});

test("an obsolete failure cannot stop the newest loading state or replace its error", async () => {
  const jobs: ReturnType<typeof deferred<any>>[] = [];
  const h = shelf({
    loadBooks: () => {
      const task = deferred<any>();
      jobs.push(task);
      return task.promise;
    },
  });
  h.render();
  await flush();
  jobs[0]!.resolve(fixture);
  await flush();
  toggleRemoved(h.render());
  h.render();
  await flush();
  toggleRemoved(h.render());
  h.render();
  await flush();
  jobs[1]!.reject(new Error("obsolete removed query"));
  await flush();
  let tree = h.render();
  assert.deepEqual(ids(tree), []);
  assert.ok(
    find(find(tree, "FlatList").props.ListEmptyComponent, "ActivityIndicator"),
  );
  jobs[2]!.reject(new Error("current shelf query"));
  await flush();
  tree = h.render();
  assert.match(emptyState(tree).props.description, /current shelf query/);
  assert.doesNotMatch(JSON.stringify(tree), /obsolete removed query/);
  h.unmount();
});

test("blur invalidates database and migration results before they publish or continue loading", async () => {
  for (const phase of ["database", "migration"] as const) {
    const stale = deferred<any>();
    let stageCalls = 0,
      reads = 0;
    const h = shelf({
      ...(phase === "database"
        ? {
            initialize: () =>
              ++stageCalls === 1
                ? stale.promise
                : Promise.resolve({ ok: true }),
          }
        : {
            migrate: () =>
              ++stageCalls === 1
                ? stale.promise
                : Promise.resolve({ failures: 0 }),
          }),
      loadBooks: async () => {
        reads++;
        return fixture;
      },
    });
    h.render();
    await flush();
    h.blur();
    h.render();
    stale.resolve(
      phase === "database"
        ? { ok: false, detail: "obsolete database failure" }
        : { failures: 7 },
    );
    await flush();
    let tree = h.render();
    assert.equal(reads, 0);
    assert.deepEqual(ids(tree), []);
    assert.ok(
      find(
        find(tree, "FlatList").props.ListEmptyComponent,
        "ActivityIndicator",
      ),
    );
    assert.doesNotMatch(
      JSON.stringify(tree),
      /obsolete database failure|7 条记录/,
    );
    h.focus();
    h.render();
    await flush();
    tree = h.render();
    assert.deepEqual(
      ids(tree),
      fixture.map((book) => book.id),
    );
    assert.equal(reads, 1);
    h.unmount();
  }
});

test("blurred and unmounted catalog requests cannot publish late rows or failures", async () => {
  const jobs: ReturnType<typeof deferred<any>>[] = [];
  const h = shelf({
    loadBooks: () => {
      const task = deferred<any>();
      jobs.push(task);
      return task.promise;
    },
  });
  h.render();
  await flush();
  h.blur();
  h.render();
  h.focus();
  h.render();
  await flush();
  jobs[1]!.resolve(fixture);
  await flush();
  assert.deepEqual(
    ids(h.render()),
    fixture.map((book) => book.id),
  );
  jobs[0]!.reject(new Error("blurred catalog failure"));
  await flush();
  assert.deepEqual(
    ids(h.render()),
    fixture.map((book) => book.id),
  );
  h.blur();
  h.render();
  h.focus();
  h.render();
  await flush();
  h.unmount();
  jobs[2]!.resolve(removedFixture);
  await flush();
  const tree = h.render();
  assert.deepEqual(ids(tree), []);
  assert.doesNotMatch(JSON.stringify(tree), /blurred catalog failure/);
});

test("removal completion refreshes the currently displayed shelf scope", async () => {
  const removal = deferred<void>();
  const scopes: boolean[] = [];
  const h = await ready({
    loadBooks: async (scope) => {
      scopes.push(scope.onlyRemoved);
      return scope.onlyRemoved ? removedFixture : fixture;
    },
    removeBook: () => removal.promise,
  });
  let tree = h.render();
  find(
    find(tree, "FlatList").props.renderItem({ item: fixture[0] }),
    "Pressable",
  ).props.onLongPress();
  find(h.render(), "BookActionSheet")
    .props.actions.find((action: any) => action.key === "remove")
    .onPress();
  tree = h.render();
  find(tree, "BookNotice")
    .props.actions.find((action: any) => action.style !== "cancel")
    .onPress();
  await flush();
  toggleRemoved(h.render());
  h.render();
  await flush();
  removal.resolve();
  await flush();
  tree = h.render();
  assert.deepEqual(scopes, [false, true, true]);
  assert.equal(find(tree, "PageHeading").props.title, "已移除的书籍");
  assert.deepEqual(ids(tree), ["removed-book"]);
  h.unmount();
});

test("an import from the removed shelf returns to and reloads the normal shelf", async () => {
  const importing = deferred<any>();
  const scopes: boolean[] = [];
  const h = await ready({
    loadBooks: async (scope) => {
      scopes.push(scope.onlyRemoved);
      return scope.onlyRemoved ? removedFixture : fixture;
    },
    importBook: () => importing.promise,
  });
  toggleRemoved(h.render());
  h.render();
  await flush();
  importAction(h.render()).props.onPress();
  h.render();
  importing.resolve({
    status: "imported",
    isDuplicate: false,
    book: fixture[0],
  });
  await flush();
  h.render();
  await flush();
  const tree = h.render();
  assert.deepEqual(scopes, [false, true, false]);
  assert.equal(find(tree, "PageHeading").props.title, "书架");
  assert.deepEqual(
    ids(tree),
    fixture.map((book) => book.id),
  );
  assert.equal(find(tree, "BookNotice").props.title, "已加入书架");
  h.unmount();
});

test("book menu opens only its annotations and revokes a repeated or dismissed menu action", async () => {
  const h = await ready();
  const card = find(h.render(), "FlatList").props.renderItem({
    item: fixture[0],
  });
  nodes(
    card,
    (n) => n.props?.accessibilityLabel === "海洋的更多操作",
  )[0].props.onPress();
  const menu = find(h.render(), "BookActionSheet");
  assert.deepEqual(
    menu.props.actions.map((action: any) => action.title),
    ["查看标注", "移除原书"],
  );
  const open = menu.props.actions[0].onPress;
  open();
  open();
  assert.deepEqual(h.pushes, [
    { pathname: "/book-annotations/[id]", params: { id: "sea" } },
  ]);
  find(card, "Pressable").props.onLongPress();
  const cancelled = find(h.render(), "BookActionSheet");
  cancelled.props.onCancel();
  cancelled.props.actions[0].onPress();
  assert.equal(h.pushes.length, 1);
  h.unmount();
});

test("removed book opens its retained annotations while permanent deletion stays behind the book menu", async () => {
  const h = await ready({
    loadBooks: async (scope) => (scope.onlyRemoved ? removedFixture : fixture),
  });
  toggleRemoved(h.render());
  h.render();
  await flush();
  const card = find(h.render(), "FlatList").props.renderItem({
    item: removedFixture[0],
  });
  find(card, "Pressable").props.onPress();
  assert.deepEqual(h.pushes, [
    { pathname: "/book-annotations/[id]", params: { id: "removed-book" } },
  ]);
  assert.equal(find(h.render(), "BookNotice"), undefined);
  find(card, "Pressable").props.onLongPress();
  const menu = find(h.render(), "BookActionSheet");
  assert.equal(menu.props.actions[1].title, "彻底删除书籍及记录");
  h.blur();
  h.render();
  menu.props.actions[0].onPress();
  menu.props.actions[1].onPress();
  assert.equal(h.pushes.length, 1);
  assert.equal(find(h.render(), "BookNotice"), undefined);
  h.unmount();
});
