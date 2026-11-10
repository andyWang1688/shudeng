import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");

async function mount(native: boolean, initial: Record<string, unknown> = {}) {
  const { installDOM } = require("../platform/library/__tests__/annotation-react-dom-host.cjs");
  const document = installDOM();
  const React = require("react");
  const ReactDOM = require("react-dom/client");
  const messages: any[] = [];
  const events: any[] = [];
  let surface: any;
  let surfaceRenders = 0;
  let acknowledgedId = 0;
  const palette = {};
  const injectedWindow = {
    __readerHost: (message: unknown) => messages.push(JSON.parse(JSON.stringify(message))),
  };
  const WebView = React.forwardRef((props: any, ref: any) => {
    surfaceRenders++;
    surface = props;
    React.useImperativeHandle(ref, () => ({
      injectJavaScript: (script: string) => runInNewContext(script, {
        window: injectedWindow,
        document: { getElementById: () => true },
      }),
    }));
    return null;
  });
  const NativeEpubSurface = (props: any) => {
    surfaceRenders++;
    surface = props;
    return null;
  };
  const stubs: Record<string, any> = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "react-native": { View: (props: any) => props.children, StyleSheet: { create: (value: any) => value } },
    "react-native-webview": { WebView },
    "../ui/theme": { usePalette: () => palette },
    "./readerWebHtml": { readerWebHtml: "<html></html>" },
    "./ReaderSelectionBar": { ReaderSelectionBar: () => null },
    "./NativeEpubSurface": { NativeEpubSurface: native ? NativeEpubSurface : null },
    "../platform/epubArchive": {},
  };
  const load = (filename: string) => {
    const compiled: any = new Module(filename);
    compiled.filename = filename;
    compiled.require = (id: string) => {
      if (id in stubs) return stubs[id];
      if (id === "./readerProtocol") return load(fileURLToPath(new URL("./readerProtocol.ts", import.meta.url)));
      throw Error("Unmocked " + id);
    };
    compiled._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, filename);
    return compiled.exports;
  };
  const ReaderWebView = load(fileURLToPath(new URL("./ReaderWebView.tsx", import.meta.url))).ReaderWebView;
  let props = {
    bookId: "book-a", initialLocation: undefined,
    openOverride: { format: "epub", title: "Explicit EPUB", mimeType: "application/epub+zip", dataBase64: "AA==" },
    theme: "light", fontScale: 1, flow: "paginated", onEvent: (event: any) => events.push(event), ...initial,
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  const act = async (action: () => unknown) => React.act(async () => { await action(); });
  const emit = (message: object) => act(() => {
    if (native) surface.onEpubEvent({ nativeEvent: { message: JSON.stringify(message) } });
    else surface.onMessage({ nativeEvent: { data: JSON.stringify(message) } });
  });
  await act(() => root.render(React.createElement(ReaderWebView, props)));
  return {
    emit,
    events,
    get surfaceRenders() { return surfaceRenders; },
    get acknowledgedId() { return acknowledgedId; },
    async update(next: Record<string, unknown>) {
      props = { ...props, ...next };
      await act(() => root.render(React.createElement(ReaderWebView, props)));
    },
    async loaded() {
      if (native) await emit({ type: "native:loaded" });
      else await act(() => surface.onLoadEnd());
    },
    ready: () => emit({ type: "reader:ready", payload: { format: props.bookId.includes("pdf") ? "pdf" : "epub", title: "Fixture", flow: "paginated" } }),
    async drain() {
      if (native) {
        const queued = JSON.parse(surface.command);
        if (queued.length) {
          messages.push(...queued.map((command: any) => command.message));
          acknowledgedId = queued.at(-1).id;
          await emit({ type: "native:ack", payload: { id: acknowledgedId } });
        }
      }
      return messages.splice(0);
    },
    async preferences() {
      return (await this.drain()).filter(message => /^reader:(theme|fontSize|flow)$/.test(message.type));
    },
    async unmount() {
      await act(() => root.unmount());
      document.body.removeChild(container);
    },
  };
}

for (const native of [true, false]) {
  test(`${native ? "native EPUB" : "WebView EPUB"} ignores unrelated host renders while still accepting changed event handlers`, async () => {
    const first: any[] = [], second: any[] = [];
    const reader = await mount(native, { onEvent: (event: any) => first.push(event) });
    try {
      await reader.loaded(); await reader.drain(); await reader.ready(); await reader.drain();
      const before = reader.surfaceRenders;
      await reader.update({});
      assert.equal(reader.surfaceRenders, before, "unchanged reader props must not rerender the document surface");
      await reader.update({ onEvent: (event: any) => second.push(event) });
      await reader.emit({ type: "reader:progress", payload: { format: "epub", fraction: 0.5, locator: { type: "epub", cfi: "new-position" } } });
      assert.equal(second.at(-1)?.type, "progress");
      assert.notEqual(first.at(-1)?.type, "progress");
    } finally { await reader.unmount(); }
  });

  test(`${native ? "native EPUB" : "WebView EPUB"} preserves visibility-only and full bookmark capture commands`, async () => {
    const React = require("react");
    const ref = React.createRef();
    const reader = await mount(native, { ref });
    const bookmarks = [{ id: "bookmark-a", locator: { type: "epub", cfi: "epubcfi(/6/2)" } }];
    try {
      await reader.loaded();
      await reader.drain();
      await React.act(async () => {
        ref.current.captureBookmarkContext(bookmarks, 41, false);
        ref.current.captureBookmarkContext(bookmarks, 42, true);
        ref.current.captureBookmarkContext(bookmarks, 43);
      });
      assert.deepEqual(await reader.drain(), [
        { type: "reader:bookmark-context", payload: { bookmarks, requestId: 41, captureLocation: false } },
        { type: "reader:bookmark-context", payload: { bookmarks, requestId: 42, captureLocation: true } },
        { type: "reader:bookmark-context", payload: { bookmarks, requestId: 43 } },
      ]);
    } finally { await reader.unmount(); }
  });

  test(`${native ? "native EPUB" : "WebView EPUB"} opens with its requested preferences and only sends the changed setting`, async () => {
    const reader = await mount(native, { theme: "dark", fontScale: 1.2, flow: "scrolled", initialLocation: "epubcfi(/6/2)" });
    try {
      await reader.loaded();
      const [opening] = await reader.drain();
      assert.equal(opening.type, "reader:open");
      assert.equal(opening.payload.title, "Explicit EPUB");
      assert.equal(opening.payload.dataBase64, "AA==");
      assert.equal(opening.payload.theme, "dark");
      assert.equal(opening.payload.fontSize, 1.2 * 18.5);
      assert.equal(opening.payload.flow, "scrolled");
      assert.equal(opening.payload.initialLocation, "epubcfi(/6/2)");
      await reader.ready();
      assert.deepEqual(await reader.preferences(), [], "ready cannot clear the native page cache for preferences already carried by open");
      await reader.update({ theme: "light" });
      assert.deepEqual(await reader.preferences(), [{ type: "reader:theme", payload: { theme: "light" } }]);
      await reader.update({ fontScale: 1.4 });
      assert.deepEqual(await reader.preferences(), [{ type: "reader:fontSize", payload: { fontSize: 1.4 * 18.5 } }]);
      await reader.update({ flow: "paginated" });
      assert.deepEqual(await reader.preferences(), [{ type: "reader:flow", payload: { flow: "paginated" } }]);
      await reader.update({ flow: "curl" });
      assert.deepEqual(await reader.preferences(), [], "native curl uses the existing paginated web engine");
      await reader.ready();
      await reader.update({ theme: "light", fontScale: 1.4, flow: "curl", onEvent() {} });
      assert.deepEqual(await reader.preferences(), [], "repeated ready and unrelated renders must not resend preferences");
    } finally { await reader.unmount(); }
  });

  test(`${native ? "native EPUB" : "WebView EPUB"} rejects absent source content without mounting a sample`, async () => {
    const reader = await mount(native, { openOverride: undefined });
    try {
      assert.equal(reader.surfaceRenders, 0);
      assert.equal(reader.events.length, 1);
      assert.equal(reader.events[0].type, "error");
      assert.match(reader.events[0].message, /书籍内容缺失/);
    } finally { await reader.unmount(); }
  });

  test(`${native ? "native EPUB" : "WebView EPUB"} rejects empty explicitly supplied content`, async () => {
    const reader = await mount(native, { openOverride: { format: "epub", title: "Missing", mimeType: "application/epub+zip", dataBase64: "  " } });
    try {
      assert.equal(reader.surfaceRenders, 0);
      assert.match(reader.events[0]?.message ?? "", /书籍内容缺失/);
    } finally { await reader.unmount(); }
  });

  test(`${native ? "native EPUB" : "WebView EPUB"} reconciles preference changes made while open is waiting for ready`, async () => {
    const reader = await mount(native);
    try {
      await reader.loaded();
      await reader.drain();
      await reader.update({ theme: "dark", flow: "scrolled" });
      assert.deepEqual(await reader.preferences(), [], "configuration waits until the reader is ready");
      await reader.ready();
      assert.deepEqual(await reader.preferences(), [
        { type: "reader:theme", payload: { theme: "dark" } },
        { type: "reader:flow", payload: { flow: "scrolled" } },
      ]);
    } finally { await reader.unmount(); }
  });
}

test("duplicate native acknowledgements do not rerender the reader surface", async () => {
  const reader = await mount(true);
  try {
    await reader.loaded(); await reader.drain(); await reader.ready(); await reader.drain();
    const before = reader.surfaceRenders;
    assert.ok(reader.acknowledgedId > 0);
    for (let index = 0; index < 3; index++) await reader.emit({ type: "native:ack", payload: { id: reader.acknowledgedId } });
    assert.equal(reader.surfaceRenders, before);
  } finally { await reader.unmount(); }
});

test("the PDF WebView fallback retains its ready-time flow synchronization", async () => {
  const reader = await mount(false, { bookId: "book-pdf", flow: "scrolled", openOverride: { format: "pdf", title: "Explicit PDF", mimeType: "application/pdf", dataBase64: "AA==" } });
  try {
    await reader.loaded();
    await reader.drain();
    await reader.ready();
    assert.deepEqual(await reader.preferences(), [{ type: "reader:flow", payload: { flow: "scrolled" } }]);
  } finally { await reader.unmount(); }
});

test("a new EPUB opening owns its own preference snapshot", async () => {
  const reader = await mount(true);
  try {
    await reader.loaded();
    await reader.drain();
    await reader.ready();
    await reader.drain();
    await reader.update({ bookId: "book-b", theme: "dark", fontScale: 1.3, flow: "scrolled" });
    assert.deepEqual(await reader.preferences(), [], "the old ready state cannot publish the next book's settings");
    await reader.loaded();
    const [opening] = await reader.drain();
    assert.equal(opening.type, "reader:open");
    assert.equal(opening.payload.theme, "dark");
    assert.equal(opening.payload.fontSize, 1.3 * 18.5);
    assert.equal(opening.payload.flow, "scrolled");
    await reader.ready();
    assert.deepEqual(await reader.preferences(), []);
  } finally { await reader.unmount(); }
});
