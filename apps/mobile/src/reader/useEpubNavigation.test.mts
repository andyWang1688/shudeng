import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const code = ts.transpileModule(
  readFileSync(new URL("./useEpubNavigation.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  },
).outputText;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function mount(search: (...args: any[]) => Promise<any[]>) {
  const {
    installDOM,
  } = require("../platform/library/__tests__/annotation-react-dom-host.cjs");
  const document = installDOM();
  const React = require("react");
  const ReactDOM = require("react-dom/client");
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const alerts: any[] = [],
    navigated: string[] = [];
  const stubs: Record<string, any> = {
    react: React,
    "react-native": { Alert: { alert: (...args: any[]) => alerts.push(args) } },
    "@shudeng/core/domain": { decodeEpubAnchor: (value: any) => value?.type === "epub" && value.cfi ? value : null },
    "../platform/ai/bookIndex": {
      getLocalBookIndexStatus: async () => ({
        available: true,
        semantic: false,
        state: "ready",
        detail: "ready",
      }),
      rebuildBookIndex: async () => {},
    },
    "../platform/ai/searchBookText": { searchBookText: search },
  };
  const module = { exports: {} as any };
  runInNewContext(code, {
    module,
    exports: module.exports,
    require: (id: string) => {
      if (!(id in stubs)) throw Error("Unmocked " + id);
      return stubs[id];
    },
    setTimeout: (callback: () => void) => {
      timers.set(++nextTimer, callback);
      return nextTimer;
    },
    clearTimeout: (id: number) => timers.delete(id),
    setInterval: () => {
      throw Error("Ready source must not poll");
    },
    clearInterval: () => {},
    AbortController,
    Error,
    Map,
    Object,
    JSON,
    Promise,
  });
  let options: any = {
    bookId: "book-a",
    visible: true,
    contents: [],
    contentsLoaded: true,
    annotations: [],
    onClose: () => {},
    onNavigate: (locator: string) => navigated.push(locator),
    onRemoveBookmark: async () => true,
  };
  let navigation: any;
  function Host() {
    navigation = module.exports.useEpubNavigation(options);
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  const act = async (action: () => unknown) =>
    React.act(async () => {
      await action();
    });
  await act(() => root.render(React.createElement(Host)));
  return {
    act,
    alerts,
    navigated,
    get navigation() {
      return navigation;
    },
    async update(patch: Record<string, unknown>) {
      options = { ...options, ...patch };
      await act(() => root.render(React.createElement(Host)));
    },
    async flushSearch() {
      await act(() => {
        const pending = [...timers.values()];
        timers.clear();
        pending.forEach((run) => run());
      });
    },
    async search(query: string) {
      await act(() => navigation.onAction({ action: "searchOpen" }));
      await act(() => navigation.onAction({ action: "query", query }));
      await this.flushSearch();
    },
    async unmount() {
      await act(() => root.unmount());
      document.body.removeChild(container);
    },
  };
}
const hit = (locator: string) => ({
  id: "same-source",
  chapter: "章节",
  context: "原文",
  locator,
});
const selection = (row: any) => ({
  id: row.id,
  selectionKey: row.selectionKey,
});

test("late search results cannot replace a newer query and accepted results navigate once", async () => {
  const slow = deferred<any[]>();
  const h = await mount(async (_book, query) =>
    query === "old" ? slow.promise : [hit("new-locator")],
  );
  try {
    await h.search("old");
    await h.act(() => h.navigation.onAction({ action: "query", query: "new" }));
    await h.flushSearch();
    const current = h.navigation.snapshot.results[0];
    await h.act(() => slow.resolve([hit("old-locator")]));
    assert.equal(
      h.navigation.snapshot.results[0].selectionKey,
      current.selectionKey,
    );
    await h.act(() => {
      h.navigation.onAction({
        action: "selectSearchResult",
        ...selection(current),
      });
      h.navigation.onAction({
        action: "navigate",
        source: "search",
        ...selection(current),
      });
      h.navigation.onAction({
        action: "navigate",
        source: "search",
        ...selection(current),
      });
    });
    assert.deepEqual(h.navigated, ["new-locator"]);
  } finally {
    await h.unmount();
  }
});

test("validated selection survives closing once, while reopening invalidates the old selection", async () => {
  const h = await mount(async () => [hit("selected-locator")]);
  try {
    await h.search("find");
    const row = selection(h.navigation.snapshot.results[0]);
    await h.act(() =>
      h.navigation.onAction({ action: "selectSearchResult", ...row }),
    );
    await h.update({ visible: false });
    await h.act(() =>
      h.navigation.onAction({ action: "navigate", source: "search", ...row }),
    );
    await h.update({ visible: true });
    await h.act(() =>
      h.navigation.onAction({ action: "navigate", source: "search", ...row }),
    );
    assert.deepEqual(h.navigated, ["selected-locator"]);
  } finally {
    await h.unmount();
  }
});

test("switching books discards late search data and exposes active search failures for retry", async () => {
  const slow = deferred<any[]>();
  const h = await mount(async (book, query) => {
    if (book === "book-a") return slow.promise;
    if (query === "fail") throw Error("本机检索失败");
    return [hit("book-b-locator")];
  });
  try {
    await h.search("find");
    await h.update({ bookId: "book-b" });
    await h.act(() => slow.resolve([hit("book-a-locator")]));
    assert.equal(h.navigation.snapshot.results.length, 0);
    await h.search("fail");
    assert.equal(h.navigation.snapshot.searchError, "本机检索失败");
    assert.equal(h.navigation.snapshot.searchBusy, false);
    await h.act(() =>
      h.navigation.onAction({ action: "query", query: "retry" }),
    );
    await h.flushSearch();
    assert.equal(h.navigation.snapshot.searchError, null);
    const row = selection(h.navigation.snapshot.results[0]);
    await h.act(() => {
      h.navigation.onAction({ action: "selectSearchResult", ...row });
      h.navigation.onAction({ action: "navigate", source: "search", ...row });
    });
    assert.deepEqual(h.navigated, ["book-b-locator"]);
  } finally {
    await h.unmount();
  }
});

test("the book keeps its annotations tab across close and search without carrying it into another book", async () => {
  const h = await mount(async () => []);
  try {
    await h.act(() => h.navigation.onAction({ action: "tab", tab: "annotations" }));
    await h.update({ visible: false });
    await h.update({ visible: true });
    assert.equal(h.navigation.snapshot.tab, "annotations");
    await h.act(() => h.navigation.onAction({ action: "searchOpen" }));
    await h.act(() => h.navigation.onAction({ action: "searchClose" }));
    assert.equal(h.navigation.snapshot.tab, "annotations");
    await h.update({ bookId: "book-b" });
    assert.equal(h.navigation.snapshot.tab, "contents");
  } finally { await h.unmount(); }
});

test("annotation navigation uses its original EPUB locator and missing locations stay in the panel", async () => {
  const h = await mount(async () => []);
  const locator = { type: "epub", cfi: "epubcfi(/6/4!/4/2)", href: "chapter.xhtml" };
  try {
    await h.update({ annotations: [
      { id: "note", kind: "note", locator },
      { id: "missing", kind: "highlight", locator: null },
      { id: "wrong-format", kind: "highlight", locator: { type: "pdf", page: 7 } },
    ] });
    await h.act(() => h.navigation.onAction({ action: "navigate", source: "annotations", id: "note" }));
    assert.deepEqual(h.navigated, [JSON.stringify(locator)]);
    for (const id of ["missing", "wrong-format", "retired"]) {
      await h.act(() => h.navigation.onAction({ action: "navigate", source: "annotations", id }));
      assert.match(h.navigation.snapshot.feedback, /原文位置/);
    }
    assert.equal(h.navigated.length, 1);
    assert.deepEqual(h.alerts, []);
  } finally { await h.unmount(); }
});
