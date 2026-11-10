import assert from "node:assert/strict";
import { test } from "node:test";
import { find, readerComponent } from "../ui/reader/__tests__/readerSheetHarness.mts";

function openPalette(color = "yellow", newlySaved = false) {
  const writes: unknown[][] = [];
  const annotation = { id: "saved-highlight", kind: "highlight", color, quote: "原文" };
  const reader = {
    selectedAnnotation: annotation,
    // Model the state immediately after a selection has already been saved.
    newHighlightId: newlySaved ? annotation.id : null,
    readerTheme: "light", readerReady: true, readerError: null,
    preferencesLoaded: true, preferences: { fontScale: 1, flow: "paginated" },
    annotations: [],
    removeAnnotation: async (value: unknown) => { writes.push(["remove", value]); return true; },
    changeHighlightColor: async (...args: unknown[]) => { writes.push(["color", ...args]); },
  };
  const ui = readerComponent(new URL("../ui/ReaderShell.tsx", import.meta.url), "ReaderShell", { bookId: "book" }, {
    "expo-router": { useRouter: () => ({ back() {} }) },
    "expo-status-bar": { StatusBar: "StatusBar" },
    "../reader/ReaderChrome": { ReaderChrome: "ReaderChrome" },
    "../reader/ReaderWebView": { ReaderWebView: "ReaderWebView" },
    "../reader/NativeEpubSurface": { NativeEpubSurface: null },
    "../reader/EpubNavigationPanel": { EpubNavigationPanel: "EpubNavigationPanel" },
    "../reader/useReaderState": { useReaderState: () => reader },
    "./reader/NoteSheet": { NoteSheet: "NoteSheet" },
    "./reader/ReaderPanels": { HighlightPanel: "HighlightPanel", ReaderSettingsPanel: "ReaderSettingsPanel" },
    "./reader/ReaderOverlays": {},
    "./reader/SelectionBar": { SelectionBar: "SelectionBar" },
    "./theme": { usePalette: () => ({}) },
    "./appearance": { AppearanceOverride: "AppearanceOverride" },
    "./reader-question/ReaderQuestionProvider": { useReaderQuestions: () => ({ referenceMode: false, busy: false }) },
  });
  const content = ui.render().props.children;
  const panel = find(content.type(content.props), "HighlightPanel");
  return { writes, annotation, panel };
}

for (const newlySaved of [false, true]) {
  test(`clicking the selected EPUB color removes a ${newlySaved ? "just-saved" : "previously saved"} highlight`, async () => {
    const h = openPalette("yellow", newlySaved);
    h.panel.props.onColor("yellow");
    await Promise.resolve();
    assert.deepEqual(h.writes, [["remove", h.annotation]], "the selected color must cancel the durable highlight");
  });
}

test("a different EPUB color edits the saved highlight and pink aliases still cancel", async () => {
  const h = openPalette("yellow", true);
  h.panel.props.onColor("green");
  await Promise.resolve();
  assert.deepEqual(h.writes, [["color", h.annotation, "green"]]);
  const legacy = openPalette("pink", true);
  legacy.panel.props.onColor("rose");
  await Promise.resolve();
  assert.deepEqual(legacy.writes, [["remove", legacy.annotation]]);
});
