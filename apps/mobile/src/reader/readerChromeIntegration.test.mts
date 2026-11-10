import assert from "node:assert/strict";
import { test } from "node:test";
import {
  find,
  readerComponent,
} from "../ui/reader/__tests__/readerSheetHarness.mts";

const palette = new Proxy({}, { get: (_target, key) => String(key) });
function pdfView(visible: boolean, state: any = {}, props: any = {}) {
  const reader = {
    annotations: [],
    page: 1,
    total: 10,
    retry: 0,
    preferences: null,
    command: "",
    loading: false,
    openError: null,
    error: null,
    chromeVisible: visible,
    paletteTarget: null,
    savingAnnotation: false,
    noteDraft: null,
    noteBody: "",
    savingNote: false,
    panel: null,
    contentsTab: "contents",
    outline: [],
    query: "",
    queryEventCount: 0,
    searching: false,
    searchError: null,
    textPageCount: 10,
    scannedPageCount: 0,
    hits: [],
    questions: { referenceMode: false, busy: false },
    ...state,
  };
  const ui = readerComponent(
    new URL("./ImportedPdfReader.tsx", import.meta.url),
    "ImportedPdfReader",
    { bookId: "pdf", title: "测试 PDF", fileUri: "file:///test.pdf", ...props },
    {
      "expo-router": {
        Stack: { Screen: "Stack.Screen" },
        useRouter: () => ({ back() {} }),
      },
      "expo-status-bar": { StatusBar: "StatusBar" },
      "../ui/appearance": { useAppearance: () => ({ resolvedMode: "light" }) },
      "../ui/theme": { usePalette: () => palette },
      "../ui/reader/NoteSheet": { NoteSheet: "NoteSheet" },
      "../ui/reader/ReaderOverlays": {
        ReaderErrorBanner: "ReaderErrorBanner",
        ReaderLoadingOverlay: "ReaderLoadingOverlay",
        ReaderOpenErrorOverlay: "ReaderOpenErrorOverlay",
      },
      "../ui/components/BookNotice": { BookNotice: "BookNotice" },
      "./pdf/NativePdfSurface": { NativePdfSurface: "NativePdfSurface" },
      "./ReaderChrome": { ReaderChrome: "ReaderChrome" },
      "./pdf/PdfReaderPanels": {
        PdfColorPalette: "PdfColorPalette",
        PdfReaderPanels: "PdfReaderPanels",
      },
      "./pdf/usePdfReader": { usePdfReader: () => reader },
      "./pdf/pdfReaderMetadata": { pdfScannedPagesMessage: () => "" },
    },
  );
  const content = ui.render();
  return content.type(content.props);
}
function chrome(props: any) {
  const ui = readerComponent(
    new URL("./ReaderChrome.tsx", import.meta.url),
    "ReaderChrome",
    props,
    {
      "react-native": {
        Animated: {
          Value: class {
            constructor(_value: number) {}
          },
          timing: () => ({ start() {} }),
          View: "Animated.View",
        },
        Pressable: "Pressable",
        Text: "Text",
        View: "View",
        StyleSheet: { create: (value: any) => value },
      },
      "../ui/theme": { usePalette: () => palette },
      "../ui/chat/useReduceMotion": { useReduceMotion: () => false },
    },
  );
  return ui.render();
}

for (const visible of [true, false]) {
  test(`the actual PDF reader retains native menu boundaries while chrome is ${visible ? "visible" : "hidden"}`, () => {
    const tree = chrome(find(pdfView(visible), "ReaderChrome").props);
    for (const id of ["pdf-reader-toolbar", "pdf-reader-footer"]) {
      const boundary = find(tree, "View", id);
      assert.ok(
        boundary,
        "PDF native selection menu requires a real " + id + " boundary",
      );
      assert.equal(
        boundary.props.collapsable,
        false,
        "Fabric must retain the native boundary view",
      );
    }
    const root = find(tree, "Animated.View");
    assert.equal(root.props.pointerEvents, visible ? "box-none" : "none");
    assert.equal(root.props.accessibilityElementsHidden, !visible);
  });
}

test("EPUB chrome does not publish PDF-specific native boundaries", () => {
  const tree = chrome({
    title: "EPUB",
    visible: true,
    onBack() {},
    onAsk() {},
  });
  assert.equal(find(tree, "View", "pdf-reader-toolbar"), undefined);
  assert.equal(find(tree, "View", "pdf-reader-footer"), undefined);
});

test("retrying the native PDF surface reopens its latest page instead of its original entry page", () => {
  const tree = pdfView(true, { page: 37, retry: 1 }, { initialPage: 4 });
  const native = find(tree, "NativePdfSurface");
  assert.equal(
    native.props.page,
    37,
    "a retry must preserve the confirmed reading location",
  );
});

test("normal PDF page events and asynchronously loaded entry progress use the confirmed reader page", () => {
  for (const [entry, current] of [
    [4, 4],
    [4, 37],
    [1, 1],
    [11, 11],
  ]) {
    const tree = pdfView(
      true,
      { page: current, retry: 0 },
      { initialPage: entry },
    );
    assert.equal(find(tree, "NativePdfSurface").props.page, current);
  }
});

test("reopening the PDF directory preserves its annotations tab and connects edits to the renderer", () => {
  const opened: string[] = [],
    tabs: string[] = [];
  const replace = () => {};
  const tree = pdfView(true, {
    contentsTab: "annotations",
    setPanel: (panel: string) => opened.push(panel),
    setContentsTab: (tab: string) => tabs.push(tab),
    replaceAnnotations: replace,
  });
  find(tree, "ReaderChrome").props.onAnnotations();
  assert.deepEqual(opened, ["contents"]);
  assert.deepEqual(tabs, []);
  const panel = find(tree, "PdfReaderPanels").props;
  assert.equal(panel.bookId, "pdf");
  assert.equal(panel.title, "测试 PDF");
  assert.equal(panel.tab, "annotations");
  assert.equal(panel.onAnnotationsChanged, replace);
});

test("rapid PDF back taps flush and leave the reader once", async () => {
  let finish!: (saved: boolean) => void;
  let flushes = 0,
    exits = 0;
  const pending = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  const tree = pdfView(
    true,
    {
      flushProgress: () => {
        flushes++;
        return pending;
      },
    },
    { onBack: () => exits++ },
  );
  const back = find(tree, "ReaderChrome").props.onBack;
  back();
  back();
  assert.equal(flushes, 1);
  finish(true);
  for (let step = 0; step < 10; step++) await Promise.resolve();
  back();
  assert.equal(exits, 1);
});
