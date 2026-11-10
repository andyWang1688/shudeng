import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const path = new URL("./useReaderState.ts", import.meta.url);
const code = ts.transpileModule(readFileSync(path, "utf8"), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const a = {
  id: "annotation-a",
  kind: "highlight",
  quote: "A",
  color: "yellow",
  locator: { type: "epub", cfi: "a" },
};
const b = {
  id: "annotation-b",
  kind: "highlight",
  quote: "B",
  color: "green",
  locator: { type: "epub", cfi: "b" },
};
const bookmark = {
  id: "bookmark-a",
  kind: "bookmark",
  quote: "Bookmarked passage",
  locator: { type: "epub", cfi: "epubcfi(/6/2!/4/2/1:0)", href: "chapter.xhtml" },
};
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function mount(io: Record<string, any> = {}, initialAnnotations: any[] = [a]) {
  const {
    installDOM,
  } = require("../platform/library/__tests__/annotation-react-dom-host.cjs");
  const document = installDOM();
  const React = require("react");
  const ReactDOM = require("react-dom/client");
  const alerts: any[] = [],
    published: any[] = [];
  const stubs: Record<string, any> = {
    react: React,
    "@shudeng/core/domain": { sameEpubSelection: (left: any, right: any) => !!left?.cfi && left.cfi === right?.cfi },
    "react-native": {
      Alert: { alert: (...args: any[]) => alerts.push(args) },
      AppState: { addEventListener: () => ({ remove() {} }) },
    },
    "expo-secure-store": {
      getItemAsync: async () => null,
      setItemAsync: async () => {},
    },
    "../platform/pdfNative": { getLegacyHighlightColor: () => null },
    "../platform/library": {
      deleteReaderAnnotation: async () => {},
      deleteReaderBookmarks: async () => {},
      loadBookAnnotations: async () => [],
      saveBookProgress: async () => {},
      saveReaderAnnotation: async () => ({}),
      updateReaderAnnotation: async () => {},
      loadReaderPreferences: async () => ({
        format: "epub",
        theme: "light",
        fontScale: 1,
        flow: "paginated",
      }),
      saveReaderPreferences: async () => {},
      ...io,
    },
    "./readerMapping": {
      annotationSeedFromShelfAnnotation: () => null,
      storedLocatorFromReaderLocator: (value: any) => value,
      readerLocatorFromStoredLocator: (value: any) => value,
    },
  };
  const module = { exports: {} as any };
  runInNewContext(code, {
    module,
    exports: module.exports,
    require: (id: string) => {
      if (!(id in stubs)) throw Error("Unmocked " + id);
      return stubs[id];
    },
    setTimeout,
    clearTimeout,
    Error,
    Map,
    Date,
    JSON,
    Promise,
  });
  const useReaderState = module.exports.useReaderState;
  let options = {
    bookId: "book-a",
    initialAnnotations,
    onAnnotationsChanged: (rows: any[]) => published.push(["a", rows]),
  };
  let state: any;
  let renders = 0;
  function Host() {
    renders++;
    state = useReaderState(options);
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
    alerts,
    published,
    act,
    get state() {
      return state;
    },
    get renders() { return renders; },
    async switchBook() {
      options = {
        bookId: "book-b",
        initialAnnotations: [b],
        onAnnotationsChanged: (rows) => published.push(["b", rows]),
      };
      await act(() => root.render(React.createElement(Host)));
    },
    async updateAnnotations(rows: any[]) {
      options = { ...options, initialAnnotations: rows };
      await act(() => root.render(React.createElement(Host)));
    },
    async unmount() {
      await act(() => root.unmount());
      document.body.removeChild(container);
    },
  };
}

test("an EPUB without bookmarks sends no bookmark context requests while its viewport progresses", async () => {
  const requests: any[] = [];
  const h = await mount({}, []);
  try {
    h.state.readerRef.current = {
      requestContents() {},
      captureBookmarkContext: (...args: any[]) => requests.push(args),
    };
    await h.act(() => h.state.onReaderEvent({ type: "ready" }));
    for (let index = 0; index < 5; index++) {
      await h.act(() => h.state.onReaderEvent({ type: "progress", percent: index / 10, locator: bookmark.locator }));
    }
    assert.equal(requests.length, 0, "empty bookmark state must not ask WebKit to capture the visible text");
    assert.equal(h.state.bookmarked, false);
  } finally { await h.unmount(); }
});

test("reading progress updates the saved location without rerendering the EPUB interface", async () => {
  const writes: any[] = [];
  const h = await mount({ saveBookProgress: async (...args: any[]) => writes.push(args) }, []);
  try {
    h.state.readerRef.current = { requestContents() {} };
    await h.act(() => h.state.onReaderEvent({ type: "ready" }));
    const before = h.renders;
    let locator: any;
    for (let index = 1; index <= 5; index++) {
      locator = { type: "epub", cfi: "position-" + index, chapter: "Chapter " + index };
      await h.act(() => h.state.onReaderEvent({ type: "progress", percent: index / 10, locator }));
    }
    assert.equal(h.renders, before, "position-only events must not refresh the reader surface and closed panels");
    assert.equal(h.state.getLatestLocator().cfi, locator.cfi);
    await h.act(() => h.state.flushProgress());
    assert.equal(writes.at(-1)[0], "book-a");
    assert.equal(writes.at(-1)[1].locator.cfi, locator.cfi);
    assert.equal(writes.at(-1)[1].percent, 0.5);
    assert.equal(writes.at(-1)[1].chapter, "Chapter 5");
  } finally { await h.unmount(); }
});

test("EPUB progress received before ready is preserved when the first ready reader flushes", async () => {
  const writes: any[] = [];
  const h = await mount({ saveBookProgress: async (...args: any[]) => writes.push(args) }, []);
  const locator = { type: "epub", cfi: "opening-position", chapter: "Opening chapter" };
  try {
    h.state.readerRef.current = { requestContents() {} };
    await h.act(() => h.state.onReaderEvent({ type: "progress", percent: 0.1, locator: { ...locator, cfi: "earlier-opening-position" } }));
    await h.act(() => h.state.onReaderEvent({ type: "progress", percent: 0.4, locator }));
    assert.equal(writes.length, 0, "opening progress cannot be persisted before the reader is ready");
    assert.equal(h.state.getLatestLocator(), null);
    await h.act(() => h.state.onReaderEvent({ type: "ready" }));
    assert.equal(h.state.getLatestLocator().cfi, locator.cfi);
    await h.act(async () => assert.equal(await h.state.flushProgress(), true));
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0], "book-a");
    assert.equal(writes[0][1].locator.cfi, locator.cfi);
    assert.equal(writes[0][1].percent, 0.4);
    assert.equal(writes[0][1].chapter, locator.chapter);
  } finally { await h.unmount(); }
});

test("an EPUB retry without new opening progress preserves the latest readable position when flushed", async () => {
  const writes: any[] = [];
  const h = await mount({ saveBookProgress: async (...args: any[]) => writes.push(args) }, []);
  const locator = { type: "epub", cfi: "latest-readable-position", chapter: "Later chapter" };
  try {
    h.state.readerRef.current = { requestContents() {} };
    await h.act(() => h.state.onReaderEvent({ type: "progress", percent: 0.1, locator: { ...locator, cfi: "first-opening-position", chapter: "First chapter" } }));
    await h.act(() => h.state.onReaderEvent({ type: "ready" }));
    await h.act(() => h.state.onReaderEvent({ type: "progress", percent: 0.7, locator }));
    assert.equal(h.state.getLatestLocator().cfi, locator.cfi);
    await h.act(() => h.state.retryReader());
    assert.equal(h.state.readerReady, false);
    await h.act(() => h.state.onReaderEvent({ type: "ready" }));
    await h.act(async () => assert.equal(await h.state.flushProgress(), true));
    assert.equal(writes.at(-1)[0], "book-a");
    assert.equal(writes.at(-1)[1].locator.cfi, locator.cfi, "retry cannot reuse the first opening's stale position");
    assert.equal(writes.at(-1)[1].percent, 0.7);
    assert.equal(writes.at(-1)[1].chapter, locator.chapter);
  } finally { await h.unmount(); }
});

test("bookmark visibility only rerenders when the visible badge changes", async () => {
  const requests: any[] = [];
  const h = await mount({}, [bookmark]);
  const respond = (visibleIds: string[]) => h.act(() => h.state.onReaderEvent({
    type: "bookmarkContext", context: { requestId: requests.at(-1)[1], locator: null, quote: "", visibleIds },
  }));
  try {
    h.state.readerRef.current = { requestContents() {}, captureBookmarkContext: (...args: any[]) => requests.push(args) };
    await h.act(() => h.state.onReaderEvent({ type: "ready" }));
    const before = h.renders;
    await respond([]);
    assert.equal(h.renders, before);
    for (let index = 0; index < 3; index++) {
      await h.act(() => h.state.onReaderEvent({ type: "progress", percent: index / 10, locator: bookmark.locator }));
      await respond([]);
    }
    assert.equal(h.renders, before, "an unchanged bookmark icon must not refresh the reader");
    await respond([bookmark.id]);
    assert.equal(h.state.bookmarked, false, "a completed request cannot be replayed");
    await h.act(() => h.state.onReaderEvent({ type: "progress", percent: 0.4, locator: bookmark.locator }));
    await respond([bookmark.id]);
    assert.equal(h.state.bookmarked, true);
    const withBadge = h.renders;
    await h.act(() => h.state.onReaderEvent({ type: "progress", percent: 0.5, locator: bookmark.locator }));
    await respond([bookmark.id]);
    assert.equal(h.renders, withBadge);
    await h.act(() => h.state.replaceAnnotations([]));
    assert.equal(h.state.bookmarked, false);
  } finally { await h.unmount(); }
});

test("a highlight is saved under its selected chapter rather than a later viewport chapter", async () => {
  const writes: any[] = [];
  const h = await mount({ saveReaderAnnotation: async (_bookId: string, input: any) => { writes.push(input); return { annotationId: "saved" }; } }, []);
  try {
    h.state.readerRef.current = { requestContents() {}, clearSelection() {} };
    await h.act(() => h.state.onReaderEvent({ type: "ready" }));
    await h.act(() => h.state.onReaderEvent({ type: "progress", percent: 0.5, locator: { type: "epub", cfi: "viewport", chapter: "Viewport chapter" } }));
    await h.act(() => h.state.onReaderEvent({ type: "annotationAdded", quote: "Selected text", locator: { type: "epub", cfi: "selection", chapter: "Selected chapter" } }));
    assert.equal(writes[0].chapter, "Selected chapter");
  } finally { await h.unmount(); }
});

test("EPUB bookmark refresh requests visibility without capturing a new original-text location", async () => {
  const requests: any[] = [];
  const h = await mount({}, [bookmark]);
  try {
    h.state.readerRef.current = {
      requestContents() {},
      captureBookmarkContext: (...args: any[]) => requests.push(args),
    };
    await h.act(() => h.state.onReaderEvent({ type: "ready" }));
    await h.act(() => h.state.onReaderEvent({ type: "progress", percent: 0.5, locator: bookmark.locator }));
    assert.equal(requests.length, 2);
    assert.equal(requests[0][2], false);
    assert.equal(requests[1][2], false);
    assert.equal(requests[0][0][0].id, bookmark.id);
  } finally { await h.unmount(); }
});

test("stale EPUB bookmark visibility cannot replace the latest viewport or repopulate cleared bookmarks", async () => {
  const requests: any[] = [];
  const h = await mount({}, [bookmark]);
  const respond = (index: number, visibleIds: string[]) => h.act(() => h.state.onReaderEvent({
    type: "bookmarkContext", context: { requestId: requests[index][1], locator: null, quote: "", visibleIds },
  }));
  const progress = () => h.act(() => h.state.onReaderEvent({ type: "progress", percent: 0.5, locator: bookmark.locator }));
  try {
    h.state.readerRef.current = { requestContents() {}, captureBookmarkContext: (...args: any[]) => requests.push(args) };
    await h.act(() => h.state.onReaderEvent({ type: "ready" }));
    await progress();
    await respond(1, []);
    await respond(0, [bookmark.id]);
    assert.equal(h.state.bookmarked, false, "an old viewport response cannot restore the badge");
    await progress();
    await respond(2, [bookmark.id]);
    assert.equal(h.state.bookmarked, true);
    await progress();
    await h.act(() => h.state.replaceAnnotations([]));
    assert.equal(h.state.bookmarked, false, "removing the last bookmark clears the badge without another request");
    assert.equal(requests.length, 4);
    await respond(3, [bookmark.id]);
    assert.equal(h.state.bookmarked, false, "a response sent before deletion cannot repopulate the badge");
  } finally { await h.unmount(); }
});

for (const mode of ["add", "toggle"] as const) {
  test(`explicit EPUB bookmark ${mode} keeps its own capture receipt while visibility refreshes overlap`, async () => {
    const requests: any[] = [], saved: any[] = [], removed: any[] = [];
    const h = await mount({
      saveReaderAnnotation: async (bookId: string, input: any) => { saved.push({ bookId, input }); return { annotationId: "new-bookmark" }; },
      deleteReaderBookmarks: async (bookId: string, ids: string[]) => removed.push({ bookId, ids }),
    }, [bookmark]);
    let pending!: Promise<boolean>;
    const locator = { ...bookmark.locator, cfi: "epubcfi(/6/2!/4/4/1:17)" };
    try {
      h.state.readerRef.current = { requestContents() {}, captureBookmarkContext: (...args: any[]) => requests.push(args) };
      await h.act(() => h.state.onReaderEvent({ type: "ready" }));
      await h.act(() => { pending = h.state.saveBookmark(mode); });
      await h.act(() => h.state.onReaderEvent({ type: "progress", percent: 0.5, locator: bookmark.locator }));
      assert.equal(requests.length, 3);
      assert.equal(requests[1][2], true, "a user action still captures a precise location and original text");
      await h.act(() => h.state.onReaderEvent({ type: "bookmarkContext", context: { requestId: requests[2][1], locator: null, quote: "", visibleIds: [] } }));
      await h.act(async () => {
        h.state.onReaderEvent({ type: "bookmarkContext", context: { requestId: requests[1][1], locator, quote: "Exact original text", visibleIds: [bookmark.id] } });
        assert.equal(await pending, true, "a newer automatic request cannot strand the user action's Promise");
      });
      if (mode === "add") {
        assert.equal(saved.length, 1);
        assert.equal(saved[0].bookId, "book-a");
        assert.equal(saved[0].input.locator.cfi, locator.cfi);
        assert.equal(saved[0].input.quote, "Exact original text");
        assert.equal(removed.length, 0);
      } else {
        assert.deepEqual(removed, [{ bookId: "book-a", ids: [bookmark.id] }]);
        assert.equal(saved.length, 0);
      }
      assert.equal(h.state.bookmarked, false);
      assert.equal(h.state.error, null);
    } finally { await h.unmount(); await pending; }
  });
}

test("late A annotation reload completes its write without publishing or clearing the reused B reader", async () => {
  const reload = gate();
  let reads = 0,
    deleted = "";
  const h = await mount({
    deleteReaderAnnotation: async (id: string) => {
      deleted = id;
    },
    loadBookAnnotations: async (id: string) => {
      reads++;
      assert.equal(id, "book-a");
      await reload.promise;
      return [a];
    },
  });
  let pending!: Promise<boolean>;
  try {
    await h.act(() => {
      pending = h.state.removeAnnotation(a);
    });
    assert.equal(reads, 1);
    await h.switchBook();
    await h.act(() => {
      h.state.setNoteBody("B 未保存的正文");
      h.state.setSelectedAnnotation(b);
    });
    let completed: boolean | undefined;
    await h.act(async () => {
      reload.release();
      completed = await pending;
    });
    assert.equal(deleted, a.id, "the already authorized A write completes");
    assert.equal(
      completed,
      false,
      "the retired caller has no authority to close the next editor",
    );
    assert.equal(h.state.annotations[0]?.id, b.id);
    assert.equal(h.state.selectedAnnotation?.id, b.id);
    assert.equal(h.state.noteBody, "B 未保存的正文");
    assert.deepEqual(h.published, []);
    assert.deepEqual(h.alerts, []);
  } finally {
    reload.release();
    await pending;
    await h.unmount();
  }
});

test("a retired A write rejection cannot publish an error after switching book or unmounting", async () => {
  for (const leave of ["switch", "unmount"]) {
    const write = gate();
    const h = await mount({
      deleteReaderAnnotation: async () => {
        await write.promise;
        throw Error("late A disk error");
      },
    });
    let pending!: Promise<boolean>;
    let unmounted = false;
    try {
      await h.act(() => {
        pending = h.state.removeAnnotation(a);
      });
      if (leave === "switch") await h.switchBook();
      else {
        await h.unmount();
        unmounted = true;
      }
      await h.act(async () => {
        write.release();
        await pending;
      });
      assert.deepEqual(h.alerts, []);
      assert.deepEqual(h.published, []);
      if (!unmounted) {
        assert.equal(h.state.error, null);
        assert.equal(h.state.annotations[0]?.id, b.id);
      }
    } finally {
      write.release();
      await pending;
      if (!unmounted) await h.unmount();
    }
  }
});

test("finishing A note save cannot clear B draft or release B active save lock", async () => {
  const old = gate(),
    next = gate();
  const writes: string[] = [];
  const h = await mount({
    saveReaderAnnotation: async (id: string) => {
      writes.push(id);
      await (id === "book-a" ? old.promise : next.promise);
      return {};
    },
  });
  let oldSave!: Promise<boolean>, nextSave!: Promise<boolean>;
  const draft = async (body: string) =>
    h.act(() => {
      h.state.setNoteSelection({
        quote: "原文",
        locator: { type: "epub", cfi: body },
      });
      h.state.setNoteBody(body);
    });
  try {
    await draft("A 正文");
    await h.act(() => {
      oldSave = h.state.saveNote();
    });
    await h.switchBook();
    await draft("B 正文");
    await h.act(() => {
      nextSave = h.state.saveNote();
    });
    assert.equal(h.state.savingNote, true);
    await h.act(async () => {
      old.release();
      assert.equal(await oldSave, false);
    });
    assert.equal(h.state.savingNote, true);
    assert.equal(h.state.noteBody, "B 正文");
    await h.act(() => h.state.saveNote());
    assert.deepEqual(writes, ["book-a", "book-b"]);
    await h.act(async () => {
      next.release();
      assert.equal(await nextSave, true);
    });
    assert.equal(h.state.savingNote, false);
    assert.equal(h.state.noteBody, "");
    assert.deepEqual(h.alerts, []);
  } finally {
    old.release();
    next.release();
    await Promise.all([oldSave, nextSave]);
    await h.unmount();
  }
});

test("selecting an existing highlight refuses the note editor and preserves the original record", async () => {
  const writes: any[] = [];
  const h = await mount({ saveReaderAnnotation: async (...args: any[]) => writes.push(args) });
  try {
    await h.act(() => h.state.onReaderEvent({ type: "selection", quote: a.quote, locator: a.locator }));
    let opened: boolean | undefined;
    await h.act(() => { opened = h.state.beginNoteSelection(); });
    assert.equal(opened, false);
    assert.equal(h.state.noteSelection, null);
    assert.equal(h.state.editingAnnotation, null);
    assert.equal(h.state.noteBody, "");
    assert.equal(h.state.annotations[0].kind, "highlight");
    assert.match(h.state.notice, /取消高亮/);
    assert.deepEqual(writes, []);
  } finally { await h.unmount(); }
});

test("selecting an existing note edits its original ID and new selections still create notes", async () => {
  const note = { ...a, kind: "note", body: "原有正文" };
  const updated: any[] = [], inserted: any[] = [];
  const h = await mount({
    updateReaderAnnotation: async (...args: any[]) => updated.push(args),
    saveReaderAnnotation: async (...args: any[]) => inserted.push(args),
  }, [note]);
  try {
    await h.act(() => h.state.onReaderEvent({ type: "selection", quote: note.quote, locator: note.locator }));
    await h.act(() => assert.equal(h.state.beginNoteSelection(), true));
    assert.equal(h.state.editingAnnotation.id, note.id);
    assert.equal(h.state.noteBody, "原有正文");
    await h.act(() => h.state.setNoteBody("更新正文"));
    await h.act(() => h.state.saveNote());
    assert.equal(updated.length, 1);
    assert.equal(updated[0][0], note.id);
    assert.equal(updated[0][1].body, "更新正文");
    assert.deepEqual(inserted, []);
    await h.act(() => h.state.onReaderEvent({ type: "selection", quote: "另一段原文", locator: { type: "epub", cfi: "different" } }));
    await h.act(() => assert.equal(h.state.beginNoteSelection(), true));
    await h.act(() => h.state.setNoteBody("新笔记"));
    await h.act(() => h.state.saveNote());
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0][1].kind, "note");
    assert.equal(inserted[0][1].locator.cfi, "different");
  } finally { await h.unmount(); }
});

test("identical text in a different selection creates a note without converting an existing highlight", async () => {
  const inserted: any[] = [];
  const h = await mount({
    saveReaderAnnotation: async (...args: any[]) => inserted.push(args),
    loadBookAnnotations: async () => [a],
  });
  try {
    await h.act(() => h.state.onReaderEvent({ type: "selection", quote: a.quote, locator: { type: "epub", cfi: "different" } }));
    await h.act(() => assert.equal(h.state.beginNoteSelection(), true));
    assert.equal(h.state.editingAnnotation, null);
    await h.act(() => h.state.setNoteBody("另一处的笔记"));
    await h.act(() => h.state.saveNote());
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0][1].kind, "note");
    assert.equal(inserted[0][1].locator.cfi, "different");
    assert.equal(h.state.annotations[0].id, a.id);
    assert.equal(h.state.annotations[0].kind, "highlight");
    assert.deepEqual(h.alerts, []);
  } finally { await h.unmount(); }
});

test("book annotations publish to the current reader and parent while retired callbacks cannot replace another book", async () => {
  const h = await mount();
  const edited = { ...a, kind: "note", body: "书内标注页修改" };
  try {
    const oldReplace = h.state.replaceAnnotations;
    await h.act(() => oldReplace([edited]));
    assert.equal(h.state.annotations[0].body, edited.body);
    assert.equal(h.published.length, 1);
    assert.equal(h.published[0][1][0].id, a.id);
    await h.switchBook();
    await h.act(() => oldReplace([]));
    assert.equal(h.state.annotations[0].id, b.id);
    assert.equal(h.published.length, 1);
    await h.act(() => h.state.replaceAnnotations([]));
    assert.equal(h.state.annotations.length, 0);
    assert.equal(h.published.at(-1)[0], "b");
  } finally { await h.unmount(); }
});

for (const operation of ["delete", "color", "highlight", "bookmark"] as const) {
  test(`EPUB durable ${operation} does not become a write failure when reloading its display fails`, async () => {
    const writes: string[] = [];
    let reads = 0;
    const h = await mount({
      deleteReaderAnnotation: async () => { writes.push("delete"); },
      updateReaderAnnotation: async () => { writes.push("color"); },
      saveReaderAnnotation: async (_bookId: string, input: any) => { writes.push(input.kind); return { annotationId: "new" }; },
      loadBookAnnotations: async () => {
        if (++reads === 1) throw new Error("display unavailable");
        return [a];
      },
    });
    try {
      if (operation === "delete") await h.act(() => h.state.removeAnnotation(a));
      else if (operation === "color") await h.act(() => h.state.changeHighlightColor(a, "blue"));
      else if (operation === "highlight") {
        await h.act(() => h.state.onReaderEvent({ type: "selection", quote: "new quote", locator: { type: "epub", cfi: "new" } }));
        await h.act(() => h.state.highlightSelection());
      } else {
        h.state.readerRef.current = {
          requestContents() {},
          captureBookmarkContext(_bookmarks: any, requestId: number) {
            h.state.onReaderEvent({ type: "bookmarkContext", context: { requestId, visibleIds: [], quote: "bookmark quote", locator: { type: "epub", cfi: "bookmark" } } });
          },
        };
        await h.act(() => h.state.onReaderEvent({ type: "ready" }));
        await h.act(() => h.state.saveBookmark());
      }
      assert.equal(writes.length, 1);
      assert.equal(reads, 1);
      assert.equal(h.alerts.length, 1);
      assert.doesNotMatch(h.alerts[0][0], /失败/);
      assert.match(h.alerts[0][1], /显示更新失败/);
      const retry = h.alerts[0][2].find((button: any) => button.text === "重试显示");
      await h.act(() => retry.onPress());
      assert.equal(reads, 2);
      assert.equal(writes.length, 1, "display retry cannot repeat a durable mutation");
      assert.equal(h.published.length, 1);
      assert.equal(h.state.annotations[0].id, a.id);
    } finally { await h.unmount(); }
  });
}

test("EPUB sequential annotation updater callbacks merge synchronously without losing another record", async () => {
  const h = await mount({}, [a, b]);
  try {
    await h.act(() => {
      h.state.replaceAnnotations((current: any[]) => current.map(row => row.id === a.id ? { ...row, color: "blue" } : row));
      h.state.replaceAnnotations((current: any[]) => current.filter(row => row.id !== b.id));
    });
    assert.equal(h.state.annotations.length, 1);
    assert.equal(h.state.annotations[0].id, a.id);
    assert.equal(h.state.annotations[0].color, "blue");
    assert.equal(h.published.length, 2);
    assert.equal(h.published[1][1][0].color, "blue");
  } finally { await h.unmount(); }
});

test("an older EPUB mutation reload cannot replace a newer accepted annotation updater", async () => {
  const reloaded = gate();
  const h = await mount({ loadBookAnnotations: async () => { await reloaded.promise; return [a, b]; } }, [a, b]);
  let pending!: Promise<boolean>;
  try {
    await h.act(() => { pending = h.state.removeAnnotation(b); });
    await h.act(() => h.state.replaceAnnotations((current: any[]) => current.filter(row => row.id !== b.id).map(row => ({ ...row, color: "blue" }))));
    await h.act(async () => { reloaded.release(); await pending; });
    assert.equal(h.state.annotations.length, 1);
    assert.equal(h.state.annotations[0].color, "blue");
    assert.equal(h.published.length, 1);
  } finally { reloaded.release(); await pending; await h.unmount(); }
});

test("new EPUB annotation props revoke a pending mutation display read", async () => {
  const reloaded = gate();
  const h = await mount({ loadBookAnnotations: async () => { await reloaded.promise; return [a]; } });
  let pending!: Promise<boolean>;
  try {
    await h.act(() => { pending = h.state.removeAnnotation(a); });
    const newest = [{ ...b, color: "blue" }];
    await h.updateAnnotations(newest);
    await h.act(async () => { reloaded.release(); await pending; });
    assert.equal(h.state.annotations, newest);
    assert.deepEqual(h.published, []);
  } finally { reloaded.release(); await pending; await h.unmount(); }
});
