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

const annotation = {
  id: "note-a",
  kind: "note",
  quote: "原文",
  body: "想法",
  locator: { type: "epub", cfi: "epubcfi(/6/2!/4/2)" },
};
function screen(
  options: {
    removed?: boolean;
    file?: boolean;
    load?: () => Promise<any>;
    book?: any;
    getBook?: (id: string) => Promise<any>;
  } = {},
) {
  const h = hooks();
  let focused = true;
  let bookId = "book-a";
  const navigated: any[] = [];
  const requested: string[] = [];
  const book =
    options.book === undefined
      ? {
          id: "book-a",
          title: "一本书",
          format: "epub",
          removedAt: options.removed ? 1 : null,
        }
      : options.book;
  const Screen = loader({
    react: h.react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": nativePorts([]),
    "expo-router": {
      useRouter: () => ({
        back: () => navigated.push("back"),
        replace: (route: any) => navigated.push(route),
      }),
      useFocusEffect: (fn: any) =>
        h.react.useEffect(() => (focused ? fn() : undefined), [fn, focused]),
    },
    "../platform/db": {
      getDataLayer: async () => ({
        store: { getBook: options.getBook ?? (async () => book) },
      }),
    },
    "../platform/bookFiles": {
      findBookFile: () =>
        options.file === false ? null : { uri: "book.epub" },
    },
    "../platform/library": {
      loadBookAnnotations: async (id: string) => {
        requested.push(id);
        return options.load ? options.load() : [annotation];
      },
    },
    "./annotations/BookAnnotationsContent": {
      BookAnnotationsContent: "BookAnnotationsContent",
    },
    "./components/BookNotice": { BookNotice: "BookNotice" },
    "./components/EmptyState": { EmptyState: "EmptyState" },
    "./reader/ReaderPanel": { ReaderPanel: "ReaderPanel" },
    "./theme": { usePalette: () => ({}) },
  })("apps/mobile/src/ui/BookAnnotationsScreen.tsx").BookAnnotationsScreen;
  const render = () => h.render(() => Screen({ bookId }));
  const content = () =>
    find(render(), "ReaderPanel").props.children({ canInteract: () => true });
  return {
    render,
    content,
    requested,
    navigated,
    unmount: h.unmount,
    switchBook: (next: string) => {
      bookId = next;
      render();
    },
    blur: () => {
      focused = false;
      render();
    },
    focus: () => {
      focused = true;
      render();
    },
  };
}
const find = (tree: any, type: string) =>
  nodes(tree, (n) => n.type === type)[0];

test("single-book shortcut loads only its book, hosts the shared sheet and replaces it when locating original", async () => {
  const h = screen();
  h.render();
  await flush();
  const panel = find(h.render(), "ReaderPanel");
  assert.equal(panel.props.title, "一本书");
  const content = h.content();
  assert.equal(content.type, "BookAnnotationsContent");
  assert.deepEqual(h.requested, ["book-a"]);
  assert.equal(content.props.active, true);
  content.props.onNavigate(annotation);
  assert.deepEqual(h.navigated, [
    {
      pathname: "/reader/[id]",
      params: { id: "book-a", locator: JSON.stringify(annotation.locator) },
    },
  ]);
  h.unmount();
});

for (const unavailable of [{ removed: true }, { file: false }]) {
  test(
    "retained annotations remain readable and editable without the original: " +
      JSON.stringify(unavailable),
    async () => {
      const h = screen(unavailable);
      h.render();
      await flush();
      const content = h.content();
      assert.equal(content.props.annotations[0].body, "想法");
      content.props.onChanged([{ ...annotation, body: "新想法" }]);
      assert.equal(h.content().props.annotations[0].body, "新想法");
      h.content().props.onNavigate(annotation);
      assert.deepEqual(h.navigated, []);
      assert.match(
        find(h.render(), "BookNotice").props.message,
        /原书文件不可用/,
      );
      h.unmount();
    },
  );
}

test("legacy annotation without locator remains visible but does not navigate", async () => {
  const legacy = { ...annotation, locator: null };
  const h = screen({ load: async () => [legacy] });
  h.render();
  await flush();
  h.content().props.onNavigate(legacy);
  assert.deepEqual(h.navigated, []);
  assert.match(find(h.render(), "BookNotice").props.message, /缺少阅读位置/);
  h.unmount();
});

test("single-book loading failure has retry and is not an empty list", async () => {
  let count = 0;
  const h = screen({
    load: async () => {
      if (++count === 1) throw new Error("disk error");
      return [annotation];
    },
  });
  h.render();
  await flush();
  assert.equal(h.content().type, "EmptyState");
  assert.match(h.content().props.description, /disk error/);
  h.content().props.onAction();
  h.render();
  await flush();
  assert.equal(h.content().type, "BookAnnotationsContent");
  h.unmount();
});

test("blurred reads cannot overwrite an accepted edit, and old navigation does not act while hidden", async () => {
  let finish!: (rows: any[]) => void;
  let count = 0;
  const h = screen({
    load: () =>
      ++count === 1
        ? Promise.resolve([annotation])
        : new Promise((resolve) => {
            finish = resolve;
          }),
  });
  h.render();
  await flush();
  const old = h.content().props;
  h.blur();
  old.onNavigate(annotation);
  assert.deepEqual(h.navigated, []);
  h.focus();
  await flush();
  old.onChanged([{ ...annotation, body: "已保存" }]);
  finish([{ ...annotation, body: "旧快照" }]);
  await flush();
  assert.equal(h.content().props.annotations[0].body, "已保存");
  h.unmount();
});

test("permanently deleted book offers a failure state without opening another book", async () => {
  const h = screen({ book: null });
  h.render();
  await flush();
  assert.equal(h.content().type, "EmptyState");
  assert.match(h.content().props.description, /记录已不存在/);
  assert.deepEqual(h.requested, []);
  h.unmount();
});

test("an old book's accepted save cannot expose its rows while the next book is loading", async () => {
  let finish!: (rows: any[]) => void;
  let reads = 0;
  const h = screen({
    getBook: async (id) => ({ id, title: id, format: "epub", removedAt: null }),
    load: () =>
      ++reads === 1
        ? Promise.resolve([annotation])
        : new Promise((resolve) => {
            finish = resolve;
          }),
  });
  h.render();
  await flush();
  const old = h.content().props;
  h.switchBook("book-b");
  await flush();
  old.onChanged([{ ...annotation, body: "旧书刚保存" }]);
  assert.notEqual(
    h.content().type,
    "BookAnnotationsContent",
    "keep new book loading instead of exposing the old book's rows",
  );
  const next = { ...annotation, id: "note-b", body: "新书笔记" };
  finish([next]);
  await flush();
  assert.equal(h.content().props.bookId, "book-b");
  assert.equal(h.content().props.annotations[0].id, "note-b");
  h.unmount();
});
