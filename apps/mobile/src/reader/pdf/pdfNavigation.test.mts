import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const ts = createRequire(import.meta.url)("typescript");
const code = ts.transpileModule(
  readFileSync(new URL("./PdfReaderPanels.tsx", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
function panel(overrides: any = {}) {
  const slots: any[] = [];
  let cursor = 0,
    tree: any;
  const palette = new Proxy({}, { get: (_, key) => String(key) });
  const jsx = (type: any, props: any) => ({ type, props });
  const exports: any = {};
  const mocks: Record<string, any> = {
    react: {
      useMemo: (fn: any) => fn(),
      useRef: (value: any) => (slots[cursor++] ??= { current: value }),
      useState: (initial: any) => {
        const slot = (slots[cursor++] ??= { value: initial });
        return [
          slot.value,
          (value: any) => {
            slot.value = value;
          },
        ];
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": {
      StyleSheet: { create: (value: any) => value, hairlineWidth: 1 },
      View: "View",
      Text: "Text",
      Pressable: "Pressable",
    },
    "@gorhom/bottom-sheet": {
      BottomSheetFlatList: "List",
      BottomSheetScrollView: "Scroll",
      BottomSheetTextInput: "Input",
    },
    "lucide-react-native": {
      ChevronLeft: "ChevronLeft",
      Search: "Search",
      Trash2: "Trash2",
    },
    "../../platform/pdfSearchResults": {
      trimPdfSearchQuery: (text: string) => text.trim(),
    },
    "../../ui/reader/ReaderPanels": { HighlightPalette: "Palette" },
    "../../ui/reader/ReaderPanel": { ReaderPanel: "Panel" },
    "../../ui/annotations/BookAnnotationsContent": { BookAnnotationsContent: "Annotations" },
    "../../ui/reader/ReaderNavigation": {
      ReaderNavigationTabs: "Tabs",
      ReaderSearchField: "SearchField",
      ReaderNavigationRow: "Row",
      ReaderNavigationEmpty: "Empty",
    },
    "../../ui/theme": { usePalette: () => palette },
  };
  runInNewContext(code, {
    exports,
    require: (id: string) => {
      if (!(id in mocks)) throw new Error(id);
      return mocks[id];
    },
  });
  const jumps: any[] = [];
  let props: any = {
    bookId: "pdf-book",
    title: "PDF书",
    panel: "contents",
    tab: "contents",
    onTab() {},
    outline: [],
    totalPages: 212,
    currentPage: 111,
    annotations: [],
    query: "",
    queryEventCount: 0,
    onQuery() {},
    searching: false,
    searchError: null,
    searchAvailable: true,
    hits: [],
    preferences: { flow: "paginated" },
    onPreferences: async () => {},
    onJump: (locator: any) => jumps.push(locator),
    onDeleteBookmark() {},
    onAnnotationsChanged() {},
    onClose() {},
    ...overrides,
  };
  function render(next?: any) {
    props = { ...props, ...next };
    cursor = 0;
    tree = exports.PdfReaderPanels(props);
    return tree;
  }
  function nodes() {
    const all: any[] = [];
    const visit = (node: any) => {
      if (!node) return;
      if (Array.isArray(node)) return node.forEach(visit);
      if (typeof node === "function")
        return visit(node({ canInteract: () => true, blocked: false }));
      if (typeof node !== "object") return;
      all.push(node);
      visit(node.props?.children);
    };
    visit(tree);
    return all;
  }
  render();
  return {
    render,
    nodes,
    jumps,
    list: () => nodes().find((node) => node.type === "List"),
  };
}
test("a PDF without an outline still exposes every page and jumps to its real page locator", () => {
  const ui = panel();
  const list = ui.list();
  assert.equal(list.props.data.length, 212);
  const last = list.props.data.at(-1);
  assert.equal(last.title, "第 212 页");
  const row = list.props.renderItem({ item: last });
  if (row.type === "Row") row.props.onPress();
  else row.props.children[0].props.onPress();
  assert.equal(ui.jumps[0]?.type, "pdf");
  assert.equal(ui.jumps[0]?.page, 212);
});
test("an existing outline keeps its hierarchy instead of being replaced by page rows", () => {
  const ui = panel({ outline: [{ title: "第三部分", depth: 2, page: 137 }] });
  const data = ui.list().props.data;
  assert.equal(data.length, 1);
  assert.equal(data[0].title, "第三部分");
  assert.equal(data[0].depth, 2);
});
test("a changed search revokes the old row callback", () => {
  const ui = panel({
    tab: "search",
    query: "原文",
    hits: [{ page: 3, text: "原文", rects: [] }],
  });
  const list = ui.list();
  const row = list.props.renderItem({ item: list.props.data[0] });
  const press =
    row.type === "Row"
      ? row.props.onPress
      : row.props.children[0].props.onPress;
  ui.render({ query: "新版", hits: [] });
  press();
  assert.equal(ui.jumps.length, 0);
});
