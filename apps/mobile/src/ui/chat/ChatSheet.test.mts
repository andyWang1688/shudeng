import assert from "node:assert/strict";
import { test } from "node:test";
import {
  find,
  readerComponent,
} from "../reader/__tests__/readerSheetHarness.mts";

function chatSheet() {
  let closed = 0;
  const detents: number[] = [];
  const snaps: number[] = [];
  let closes = 0;
  const ui = readerComponent(
    new URL("./ChatSheet.tsx", import.meta.url),
    "ChatSheet",
    {
      title: "书",
      palette: {},
      topInset: 47,
      bottomInset: 34,
      initialDetent: 0,
      onClose: () => closed++,
      onDetentChange: (index: number) => detents.push(index),
      children: null,
    },
    {
      "./haptics": { tapFeedback() {} },
      "./AssistantSheetAdapter": {
        useAssistantSheetBodyLayout: () => () => {},
      },
    },
  );
  const tree = ui.render();
  const panel = find(tree, "AppSheet").props;
  panel.ref.current = {
    close: () => closes++,
    snapToIndex: (index: number) => snaps.push(index),
  };
  return {
    ui,
    tree,
    panel,
    detents,
    snaps,
    get closed() {
      return closed;
    },
    get closes() {
      return closes;
    },
  };
}

test("closing chat revokes queued header actions before rerender and routes back once", () => {
  const h = chatSheet();
  const close = find(h.tree, "Pressable", "question-sheet-close").props.onPress;
  const expand = find(h.tree, "Pressable", "question-sheet-expand").props
    .onPress;
  close();
  expand();
  close();
  assert.deepEqual(h.snaps, [], "expand cannot interrupt an accepted close");
  assert.equal(h.closes, 1);
  h.panel.onClose();
  h.panel.onClose();
  assert.equal(
    h.closed,
    1,
    "duplicate completion must not navigate back twice",
  );
  h.panel.onChange(1);
  assert.deepEqual(
    h.detents,
    [],
    "late detents must not replace the saved open state",
  );
});

test("native gesture closing locks chat controls and unmount revokes old callbacks", () => {
  const h = chatSheet();
  h.panel.onChange(1);
  assert.deepEqual(h.detents, [1]);
  find(h.tree, "Pressable", "question-sheet-expand").props.onPress();
  assert.deepEqual(h.snaps, [1], "ready chat still expands normally");
  h.snaps.length = 0;
  h.panel.onAnimate?.(1, -1);
  find(h.tree, "Pressable", "question-sheet-expand").props.onPress();
  assert.deepEqual(h.snaps, []);
  h.ui.unmount();
  h.panel.onClose();
  h.panel.onChange(0);
  find(h.tree, "Pressable", "question-sheet-close").props.onPress();
  assert.equal(h.closes, 0);
  assert.equal(h.closed, 0);
  assert.deepEqual(h.detents, [1]);
});
