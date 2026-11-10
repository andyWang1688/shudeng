import test from "node:test";
import assert from "node:assert/strict";
import {
  flush,
  hooks,
  jsx,
  loader,
  nativePorts,
} from "../ui/settings/__tests__/platformHarness.mts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const note = (bookId: string, body: string) => ({
  id: bookId + "-note",
  kind: "note",
  body,
  quote: "原文",
  locator: { type: "epub", cfi: "epubcfi(/6/2!/4/2)" },
});
const book = (id: string) => ({ id, title: id, format: "epub" });

function route(options: {
  readonly getBook?: (bookId: string) => Promise<any>;
  readonly loadAnnotations?: (bookId: string) => Promise<readonly any[]>;
} = {}) {
  const h = hooks();
  let bookId = "book-a";
  let focused = true;
  const Route = loader({
    react: h.react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": nativePorts([]),
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "expo-router": {
      useRouter: () => ({ back() {} }),
      useLocalSearchParams: () => ({ id: bookId }),
      useFocusEffect: (fn: any) =>
        h.react.useEffect(() => (focused ? fn() : undefined), [fn, focused]),
    },
    "../../src/ui/ReaderShell": { ReaderShell: "ReaderShell" },
    "../../src/reader/ImportedPdfReader": { ImportedPdfReader: "ImportedPdfReader" },
    "../../src/platform/db": {
      getDataLayer: async () => ({
        store: { getBook: options.getBook ?? (async (id: string) => book(id)) },
      }),
    },
    "../../src/platform/bookFiles": {
      findBookFile: (row: any) => ({ uri: "file:///" + row.id + ".epub" }),
    },
    "../../src/platform/library": {
      loadBookProgress: async () => null,
      loadBookAnnotations: options.loadAnnotations ??
        (async (id: string) => [note(id, "原有正文")]),
    },
    "../../src/platform/library/pure": {
      readerLocatorFromLegacy: () => null,
      storedLocatorFromUnknown: () => null,
    },
    "../../src/ui/theme": { radius: {}, spacing: {}, usePalette: () => ({}) },
  })("apps/mobile/app/reader/[id].tsx").default;
  const render = () => h.render(Route);
  const reader = () => {
    const tree = render();
    assert.equal(tree.type, "ReaderShell");
    return tree.props;
  };
  return {
    render,
    reader,
    blur() { focused = false; render(); },
    focus() { focused = true; render(); },
    open(id: string) { bookId = id; render(); },
    unmount: h.unmount,
  };
}

test("an accepted in-book annotation edit invalidates an older focus read", async () => {
  const pending = deferred<readonly any[]>();
  let delayNextRead = false;
  const h = route({
    loadAnnotations: async (id) => {
      if (delayNextRead) {
        delayNextRead = false;
        return pending.promise;
      }
      return [note(id, "原有正文")];
    },
  });
  try {
    h.render();
    await flush();
    assert.equal(h.reader().initialAnnotations[0].body, "原有正文");
    h.blur();
    delayNextRead = true;
    h.focus();
    await flush();
    const saved = [note("book-a", "已保存修改")];
    h.reader().onAnnotationsChanged(saved);
    assert.deepEqual(h.reader().initialAnnotations, saved);
    pending.resolve([note("book-a", "旧读取正文")]);
    await flush();
    assert.deepEqual(h.reader().initialAnnotations, saved);
  } finally { h.unmount(); }
});

test("a retired book's editor callback cannot replace the current book's annotations", async () => {
  const h = route();
  try {
    h.render();
    await flush();
    const retired = h.reader().onAnnotationsChanged;
    h.open("book-b");
    await flush();
    assert.equal(h.reader().bookId, "book-b");
    const saved = [note("book-b", "B 已保存修改")];
    h.reader().onAnnotationsChanged(saved);
    retired([note("book-a", "迟到的 A 修改")]);
    assert.deepEqual(h.reader().initialAnnotations, saved);
  } finally { h.unmount(); }
});

test("an older book open cannot overwrite edits accepted by the replacement reader", async () => {
  const pending = deferred<any>();
  const h = route({
    getBook: async (id) => id === "book-a" ? pending.promise : book(id),
  });
  try {
    h.render();
    await flush();
    h.open("book-b");
    await flush();
    const saved = [note("book-b", "B 已保存修改")];
    h.reader().onAnnotationsChanged(saved);
    pending.resolve(book("book-a"));
    await flush();
    assert.equal(h.reader().bookId, "book-b");
    assert.equal(h.reader().title, "book-b");
    assert.deepEqual(h.reader().initialAnnotations, saved);
  } finally { h.unmount(); }
});
