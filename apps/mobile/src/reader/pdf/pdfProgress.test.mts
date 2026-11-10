import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const code = ts.transpileModule(
  readFileSync(new URL("./usePdfReader.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  },
).outputText;
async function mount(initialPage?: number, ports: Record<string, any> = {}) {
  const {
    installDOM,
  } = require("../../platform/library/__tests__/annotation-react-dom-host.cjs");
  const document = installDOM();
  const React = require("react"),
    ReactDOM = require("react-dom/client");
  const writes: any[] = [];
  const published: any[] = [];
  let options: any = {
    bookId: "owned",
    title: "PDF",
    fileUri: "file:///owned.pdf",
    initialPage,
    onAnnotationsChanged: (rows: any[]) => published.push(rows),
  };
  const mocks: Record<string, any> = {
    react: React,
    "react-native": { Alert: { alert() {} } },
    "expo-secure-store": {
      getItemAsync: async () => null,
      setItemAsync: async () => {},
    },
    "../../ui/appearance": { useAppearance: () => ({ resolvedMode: "light" }) },
    "../../ui/reader-question/ReaderQuestionProvider": {
      useReaderQuestions: () => ({ ask() {}, busy: false }),
    },
    "../../platform/library": {
      saveBookProgress: async (id: string, progress: any) =>
        writes.push({ id, ...progress }),
      ...ports,
    },
    "../../platform/library/readerPreferences": {
      loadReaderPreferences: async () => ({
        flow: "scrolled",
        theme: "light",
        format: "pdf",
      }),
    },
    "../../platform/library/legacyMigration": { parseLegacyJSON: () => null },
    "../../platform/pdfNative": {
      getLegacyHighlightColor: () => null,
      cancelPdfSearch() {},
      trimPdfSearchQuery: (value: string) => value.trim(),
      startPdfInspection: () => ({ promise: Promise.resolve({}), cancel() {} }),
      releasePdf: async () => {},
    },
    "./pdfReaderMetadata": {
      resolvePdfReaderPageInfo: () => ({
        textPageCount: 50,
        scannedPageCount: 0,
      }),
    },
    "./pdfBookmarkSummary": {},
  };
  const module = { exports: {} as any };
  runInNewContext(code, {
    module,
    exports: module.exports,
    require: (id: string) => {
      if (!(id in mocks)) throw Error("Unmocked " + id);
      return mocks[id];
    },
    Error,
    Map,
    JSON,
    Promise,
    WeakSet,
    setTimeout,
    clearTimeout,
  });
  let state: any;
  function Host() {
    state = module.exports.usePdfReader(options);
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
    writes,
    published,
    get state() {
      return state;
    },
    async update(next: any) {
      options = { ...options, ...next };
      await act(() => root.render(React.createElement(Host)));
    },
    async unmount() {
      await act(() => root.unmount());
      document.body.removeChild(container);
    },
  };
}
const pageEvent = (page: number) => ({
  type: "page",
  page,
  pageCount: 50,
  pageHasText: true,
});

test("the real PDF hook keeps its latest confirmed page across error and native retry", async () => {
  const h = await mount(4);
  try {
    assert.equal(h.state.page, 4);
    await h.act(() =>
      h.state.onEvent({ type: "ready", pageCount: 50, outline: [] }),
    );
    await h.act(() => h.state.onEvent(pageEvent(37)));
    assert.equal(h.state.page, 37);
    assert.equal(h.writes.at(-1).locator.page, 37);
    await h.act(() =>
      h.state.onEvent({
        type: "error",
        message: "native temporarily unavailable",
      }),
    );
    await h.act(() => h.state.retryOpen());
    assert.equal(h.state.retry, 1);
    assert.equal(
      h.state.page,
      37,
      "the new surface must receive this page instead of entry page 4",
    );
    await h.act(() =>
      h.state.onEvent({ type: "ready", pageCount: 50, outline: [] }),
    );
    await h.act(() => h.state.onEvent(pageEvent(h.state.page)));
    assert.equal(h.writes.at(-1).locator.page, 37);
    assert.ok(h.writes.every((write) => write.locator.page !== 4));
  } finally {
    await h.unmount();
  }
});

test("asynchronous entry progress navigates once and normal turns save the arriving page", async () => {
  const h = await mount();
  try {
    await h.act(() =>
      h.state.onEvent({ type: "ready", pageCount: 50, outline: [] }),
    );
    await h.update({ initialPage: 11 });
    const command = JSON.parse(h.state.command);
    assert.equal(command.type, "goTo");
    assert.equal(command.page, 11);
    assert.equal(h.state.page, 1, "an entry command is not an arrival receipt");
    await h.act(() => h.state.onEvent(pageEvent(11)));
    assert.equal(h.state.page, 11);
    await h.act(() => h.state.onEvent(pageEvent(12)));
    assert.equal(h.state.page, 12);
    assert.equal(h.writes.at(-1).locator.page, 12);
    assert.equal(
      JSON.parse(h.state.command).sequence,
      command.sequence,
      "page receipts must not enqueue another navigation",
    );
    await h.act(async () => {
      assert.equal(await h.state.flushProgress(), true);
    });
    assert.equal(h.writes.at(-1).locator.page, 12);
  } finally {
    await h.unmount();
  }
});

test("PDF annotation edits update the current renderer without navigation and old book callbacks are revoked", async () => {
  const h = await mount(17);
  const rows = [
    {
      id: "pdf-note",
      kind: "note",
      body: "已修改",
      locator: { type: "pdf", page: 7 },
    },
  ];
  try {
    const replace = h.state.replaceAnnotations;
    const command = h.state.command;
    await h.act(() => replace(rows));
    assert.equal(h.state.annotations, rows);
    assert.equal(h.published[0], rows);
    assert.equal(h.state.page, 17);
    assert.equal(h.state.command, command);
    await h.update({
      bookId: "another",
      fileUri: "file:///another.pdf",
      initialAnnotations: [],
    });
    await h.act(() => replace(rows));
    assert.equal(h.state.annotations.length, 0);
    assert.equal(h.published.length, 1);
  } finally {
    await h.unmount();
  }
});

test("PDF annotation changes merge against the latest owner rows and publish concrete snapshots", async () => {
  const h = await mount();
  const first = { id: "first", body: "old" },
    second = { id: "second", body: "old" };
  try {
    await h.act(() => h.state.replaceAnnotations([first, second]));
    await h.act(() => {
      h.state.replaceAnnotations((rows: any[]) =>
        rows.map((row) =>
          row.id === "first" ? { ...row, body: "first saved" } : row,
        ),
      );
      h.state.replaceAnnotations((rows: any[]) =>
        rows.map((row) =>
          row.id === "second" ? { ...row, body: "second saved" } : row,
        ),
      );
    });
    assert.deepEqual(
      h.state.annotations.map((row: any) => row.body),
      ["first saved", "second saved"],
    );
    assert.ok(h.published.every(Array.isArray));
    assert.deepEqual(
      h.published.at(-1).map((row: any) => row.body),
      ["first saved", "second saved"],
    );
  } finally {
    await h.unmount();
  }
});

test("a late PDF save reload cannot overwrite a newer annotation update or incoming owner snapshot", async () => {
  for (const update of ["mutation", "props"]) {
    let finish!: (rows: any[]) => void;
    let reads = 0;
    const pending = new Promise<any[]>((resolve) => {
      finish = resolve;
    });
    const h = await mount(undefined, {
      saveReaderAnnotation: async () => ({}),
      loadBookAnnotations: () => {
        reads++;
        return pending;
      },
    });
    let saving!: Promise<void>;
    const latest = [{ id: "newest", body: "newer saved body" }];
    try {
      await h.act(() => {
        h.state.setNoteDraft({
          quote: "原文",
          locator: { type: "pdf", page: 1 },
          annotation: null,
        });
        h.state.setNoteBody("older save");
      });
      await h.act(() => {
        saving = h.state.saveNote();
      });
      assert.equal(reads, 1);
      if (update === "mutation")
        await h.act(() => h.state.replaceAnnotations(latest));
      else await h.update({ initialAnnotations: latest });
      await h.act(async () => {
        finish([{ id: "stale", body: "old body" }]);
        await saving;
      });
      assert.equal(h.state.annotations, latest);
      assert.ok(h.published.every((rows: any) => rows[0]?.id !== "stale"));
    } finally {
      finish([]);
      await saving;
      await h.unmount();
    }
  }
});
