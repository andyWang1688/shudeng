import assert from "node:assert/strict";
import { test } from "node:test";
import { find, readerComponent, readerSheet } from "./readerSheetHarness.mts";

const palette = new Proxy({}, { get: (_target, key) => key });
const preferences = { flow: "paginated", theme: "light", fontScale: 1 };
const navigation = {
  ReaderNavigationTabs: "ReaderNavigationTabs",
  ReaderNavigationRow: "ReaderNavigationRow",
  ReaderNavigationEmpty: "ReaderNavigationEmpty",
  ReaderSearchField: "ReaderSearchField",
};
const sheetMocks = {
  "./ReaderPanel": { ReaderPanel: "ReaderPanel" },
  "../appearance": { useAppearance: () => ({ resolvedMode: "light" }) },
};

/** Preserve real caller callbacks, then let the real host supply their lifecycle guard. */
function mount(
  file: string,
  name: string,
  props: any,
  mocks: Record<string, any>,
) {
  const caller = readerComponent(
    new URL(file, import.meta.url),
    name,
    props,
    mocks,
  );
  const outer = caller.render();
  assert.equal(outer.type, "ReaderPanel");
  const host = readerSheet("ReaderPanel", outer.props);
  const tree = host.render();
  const panel = find(tree, "AppSheet").props;
  panel.ref.current = { close() {} };
  return {
    tree,
    close: () => find(tree, "Modal").props.onRequestClose(),
    finishClose: () => panel.onClose(),
  };
}
function nodes(tree: any, type: string): any[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, type));
  return [
    ...(tree.type === type ? [tree] : []),
    ...nodes(tree.props?.children, type),
  ];
}
function pressable(tree: any, label: string) {
  const result = nodes(tree, "Pressable").find(
    (node) =>
      node.props.accessibilityLabel === label ||
      nodes(node, "Text").some((text) => text.props.children === label),
  );
  assert.ok(result, "Control is present: " + label);
  return result.props.onPress;
}

for (const color of ["黄色", "绿色", "蓝色", "粉色"]) {
  test(`the actual ${color} highlight callback stops before persistence when its panel is closing`, () => {
    let writes = 0,
      closed = 0;
    const ui = mount(
      "../ReaderPanels.tsx",
      "HighlightPalette",
      {
        visible: true,
        selected: "yellow",
        quote: "原文",
        onColor: () => writes++,
        onClose: () => closed++,
      },
      sheetMocks,
    );
    const pick = pressable(ui.tree, color + "高亮");
    pick();
    assert.equal(writes, 1, "an open palette still saves normally");
    writes = 0;
    ui.close();
    pick();
    assert.equal(writes, 0, "the old native callback cannot start a write");
    ui.finishClose();
    assert.equal(closed, 1);
  });
}

for (const label of [
  "分页",
  "滚动",
  "仿真",
  "缩小字号",
  "增大字号",
  "明亮",
  "深色",
]) {
  test(`the actual EPUB ${label} setting callback stops before persistence during close`, async () => {
    let writes = 0;
    const ui = mount(
      "../ReaderPanels.tsx",
      "ReaderSettingsPanel",
      {
        visible: true,
        preferences,
        curlAvailable: true,
        onClose() {},
        onApply: async () => {
          writes++;
          return true;
        },
      },
      sheetMocks,
    );
    const change = pressable(ui.tree, label);
    change();
    await Promise.resolve();
    assert.equal(
      writes,
      1,
      "the setting reaches its real apply boundary while open",
    );
    writes = 0;
    ui.close();
    change();
    await Promise.resolve();
    assert.equal(writes, 0);
  });
}

const pdfMocks = {
  "../../ui/annotations/BookAnnotationsContent": { BookAnnotationsContent: "BookAnnotationsContent" },
  "../../ui/reader/ReaderPanel": { ReaderPanel: "ReaderPanel" },
  "../../ui/reader/ReaderPanels": { HighlightPalette: "HighlightPalette" },
  "../../ui/reader/ReaderNavigation": navigation,
  "../../ui/theme": { usePalette: () => palette },
  "../../platform/pdfSearchResults": {
    trimPdfSearchQuery: (value: string) => value.trim(),
  },
  "@gorhom/bottom-sheet": {
    BottomSheetFlatList: "FlatList",
    BottomSheetScrollView: "ScrollView",
  },
};
function pdfProps(extra: any = {}) {
  return {
    bookId: "pdf-book",
    title: "PDF书",
    panel: "contents",
    tab: "contents",
    outline: [],
    totalPages: 2,
    currentPage: 1,
    annotations: [],
    query: "",
    queryEventCount: 0,
    searching: false,
    searchError: null,
    searchAvailable: true,
    hits: [],
    preferences,
    onTab() {},
    onQuery() {},
    async onPreferences() {},
    onJump() {},
    onDeleteBookmark() {},
    onAnnotationsChanged() {},
    onClose() {},
    ...extra,
  };
}
const pdf = (props: any) =>
  mount(
    "../../../reader/pdf/PdfReaderPanels.tsx",
    "PdfReaderPanels",
    props,
    pdfMocks,
  );
const firstPdfRow = (tree: any) => {
  const list = find(tree, "FlatList").props;
  return list.renderItem({ item: list.data[0] }).props;
};

test("the actual PDF flow callback cannot start preference persistence after close", async () => {
  let writes = 0;
  const ui = pdf(
    pdfProps({
      panel: "settings",
      onPreferences: async () => {
        writes++;
      },
    }),
  );
  const change = find(ui.tree, "ReaderNavigationTabs").props.onChange;
  change("scrolled");
  await Promise.resolve();
  assert.equal(writes, 1);
  writes = 0;
  ui.close();
  change("paginated");
  await Promise.resolve();
  assert.equal(writes, 0);
});

test("the actual PDF navigation, search header and tabs reject queued callbacks during close", () => {
  const calls: string[] = [];
  const ui = pdf(
    pdfProps({
      onJump: () => calls.push("jump"),
      onTab: () => calls.push("tab"),
    }),
  );
  const navigate = firstPdfRow(ui.tree).onPress;
  const changeTab = find(ui.tree, "ReaderNavigationTabs").props.onChange;
  const search = pressable(ui.tree, "书内搜索");
  navigate();
  changeTab("bookmarks");
  search();
  assert.deepEqual(calls, ["jump", "tab", "tab"]);
  calls.length = 0;
  ui.close();
  navigate();
  changeTab("bookmarks");
  search();
  assert.deepEqual(calls, []);
});

test("the actual PDF bookmark deletion and search input reject queued callbacks during close", () => {
  let deleted = 0,
    queries = 0;
  const bookmark = {
    id: "mark",
    kind: "bookmark",
    locator: { type: "pdf", page: 1 },
    quote: "",
  };
  const bookmarks = pdf(
    pdfProps({
      tab: "bookmarks",
      annotations: [bookmark],
      onDeleteBookmark: () => deleted++,
    }),
  );
  const remove = firstPdfRow(bookmarks.tree).onDelete;
  remove();
  assert.equal(deleted, 1);
  deleted = 0;
  bookmarks.close();
  remove();
  assert.equal(deleted, 0);
  const searching = pdf(pdfProps({ tab: "search", onQuery: () => queries++ }));
  const input = find(searching.tree, "ReaderSearchField").props.onChange;
  input("正常查询");
  assert.equal(queries, 1);
  queries = 0;
  searching.close();
  input("迟到的查询");
  assert.equal(queries, 0);
});

function epub(snapshotExtra: any = {}, propsExtra: any = {}) {
  const calls: any[] = [];
  const item = { id: "item", title: "原文", selectionKey: "result" };
  const snapshot = {
    searchOpen: false,
    tab: "contents",
    contents: [item],
    bookmarks: [item],
    results: [item],
    query: "",
    searchBusy: false,
    searchError: null,
    contentsStatus: "",
    preparationMessage: "",
    canPrepare: true,
    preparationFailed: false,
    feedback: null,
    ...snapshotExtra,
  };
  const ui = mount(
    "../../../reader/EpubNavigationPanel.tsx",
    "EpubNavigationPanel",
    { bookId: "epub-book", title: "EPUB书", annotations: [], visible: true, onClose() {}, onAnnotationsChanged() {}, ...propsExtra },
    {
      "../ui/reader/ReaderPanel": { ReaderPanel: "ReaderPanel" },
      "../ui/annotations/BookAnnotationsContent": { BookAnnotationsContent: "BookAnnotationsContent" },
      "../ui/reader/ReaderNavigation": navigation,
      "../ui/theme": { usePalette: () => palette },
      "./useEpubNavigation": {
        useEpubNavigation: () => ({
          snapshot,
          onAction: (action: any) => calls.push(action),
        }),
      },
      "@gorhom/bottom-sheet": { BottomSheetFlatList: "FlatList" },
    },
  );
  return { ...ui, calls };
}

test("the actual EPUB directory, bookmark deletion, search header and tabs reject queued callbacks during close", () => {
  const ui = epub({ tab: "bookmarks" });
  const row = firstPdfRow(ui.tree);
  const changeTab = find(ui.tree, "ReaderNavigationTabs").props.onChange;
  const search = pressable(ui.tree, "书内搜索");
  row.onPress();
  row.onDelete();
  changeTab("contents");
  search();
  assert.deepEqual(
    ui.calls.map((call) => call.action),
    ["navigate", "deleteBookmark", "tab", "searchOpen"],
  );
  ui.calls.length = 0;
  ui.close();
  row.onPress();
  row.onDelete();
  changeTab("contents");
  search();
  assert.deepEqual(ui.calls, []);
});

test("the actual EPUB search result, query and preparation callbacks stop at the closing gate", () => {
  const ui = epub({ searchOpen: true });
  const navigate = firstPdfRow(ui.tree).onPress;
  const input = find(ui.tree, "ReaderSearchField").props.onChange;
  const prepare = pressable(ui.tree, "准备书内资料");
  navigate();
  input("正常查询");
  prepare();
  assert.deepEqual(
    ui.calls.map((call) => call.action),
    ["selectSearchResult", "navigate", "query", "prepare"],
  );
  ui.calls.length = 0;
  ui.close();
  navigate();
  input("迟到的查询");
  prepare();
  assert.deepEqual(ui.calls, []);
});

test("EPUB exposes one book's annotations beside directory and bookmarks and retains the close guard", () => {
  const rows = [{ id: "epub-note", kind: "note", locator: { type: "epub", cfi: "original" } }];
  const changed: any[] = [];
  const ui = epub({ tab: "annotations" }, { annotations: rows, onAnnotationsChanged: (next: any) => changed.push(next) });
  const tabs = find(ui.tree, "ReaderNavigationTabs").props;
  assert.deepEqual(tabs.items.map((item: any) => item.label), ["目录", "书签", "标注"]);
  const content = find(ui.tree, "BookAnnotationsContent").props;
  assert.equal(content.bookId, "epub-book");
  assert.equal(content.format, "EPUB");
  assert.equal(content.annotations, rows);
  content.onNavigate(rows[0]);
  assert.deepEqual(ui.calls, [{ action: "navigate", source: "annotations", id: "epub-note" }]);
  ui.close();
  content.onNavigate(rows[0]);
  assert.equal(ui.calls.length, 1);
  content.onChanged([]);
  assert.deepEqual(changed, [[]], "an accepted write can still synchronize after the panel begins closing");
});

test("PDF keeps page navigation beside annotations and forwards valid original locations only", () => {
  const jumps: any[] = [], changed: any[] = [];
  const ui = pdf(pdfProps({ tab: "annotations", onJump: (locator: any) => jumps.push(locator), onAnnotationsChanged: (next: any) => changed.push(next) }));
  const tabs = find(ui.tree, "ReaderNavigationTabs").props;
  assert.deepEqual(tabs.items.map((item: any) => item.label), ["页面", "书签", "标注"]);
  const content = find(ui.tree, "BookAnnotationsContent").props;
  assert.equal(content.bookId, "pdf-book");
  assert.equal(content.format, "PDF");
  const locator = { type: "pdf", page: 2, rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.1 }] };
  content.onNavigate({ id: "pdf-note", locator });
  for (const invalid of [null, { type: "epub", cfi: "wrong" }, { type: "pdf", page: 3 }]) content.onNavigate({ id: "invalid", locator: invalid });
  assert.deepEqual(jumps, [locator]);
  ui.close();
  content.onNavigate({ id: "pdf-note", locator });
  assert.equal(jumps.length, 1);
  content.onChanged([]);
  assert.deepEqual(changed, [[]]);
});
