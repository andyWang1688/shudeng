import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NOTE_SHEET,
  noteSheetDragHeight,
  noteSheetKeyboardHeight,
  noteSheetKeyboardTransition,
  noteSheetRestingHeight,
  settleNoteSheetDrag,
} from "../noteSheetGeometry.ts";

const portrait = { height: 844, safeTop: 47, keyboardOverlap: 0 };
test("starts at 54% and can rest expanded at 92%", () => {
  assert.equal(
    noteSheetRestingHeight(portrait, NOTE_SHEET.initialRatio),
    844 * 0.54,
  );
  assert.equal(
    noteSheetRestingHeight(portrait, NOTE_SHEET.maximumRatio),
    844 * 0.92,
  );
});
test("drag height follows each movement continuously and clamps overshoot", () => {
  assert.equal(noteSheetDragHeight(460, -28, portrait), 488);
  assert.equal(noteSheetDragHeight(460, 83, portrait), 377);
  assert.equal(noteSheetDragHeight(460, 900, portrait), 0);
  assert.equal(noteSheetDragHeight(460, -900, portrait), 844 * 0.92 + 24);
});
test("below 44% dismisses; at 44% collapses rather than dismissing", () => {
  assert.deepEqual(settleNoteSheetDrag(844 * 0.44 - 0.1, 0, portrait), {
    dismiss: true,
  });
  assert.deepEqual(settleNoteSheetDrag(844 * 0.44, 0, portrait), {
    dismiss: false,
    height: 844 * 0.54,
    ratio: 0.54,
  });
});
test("only above 66% settles at the expanded detent", () => {
  assert.deepEqual(settleNoteSheetDrag(844 * 0.66, 0, portrait), {
    dismiss: false,
    height: 844 * 0.54,
    ratio: 0.54,
  });
  assert.deepEqual(settleNoteSheetDrag(844 * 0.66 + 0.1, 0, portrait), {
    dismiss: false,
    height: 844 * 0.92,
    ratio: 0.92,
  });
});
test("1200 points/sec fast dismissal applies even from the expanded detent", () => {
  assert.deepEqual(settleNoteSheetDrag(844 * 0.92, 1.21, portrait), {
    dismiss: true,
  });
  assert.equal(settleNoteSheetDrag(844 * 0.92, 1.2, portrait).dismiss, false);
});
test("software keyboard clamps the card to safe available space", () => {
  const keyboard = { ...portrait, keyboardOverlap: 350 };
  assert.equal(noteSheetKeyboardHeight(keyboard), 439);
  assert.equal(noteSheetRestingHeight(keyboard, 0.92), 439);
  assert.equal(noteSheetDragHeight(439, -400, keyboard), 439);
  assert.equal(settleNoteSheetDrag(439, 0, keyboard).dismiss, false);
});
test("landscape Chinese candidate rows leave the header above the keyboard", () => {
  const landscape = { height: 390, safeTop: 0, keyboardOverlap: 280 };
  assert.equal(noteSheetKeyboardHeight(landscape), 102);
  assert.equal(noteSheetDragHeight(102, -300, landscape), 102);
  const result = settleNoteSheetDrag(102, 0, landscape);
  assert.equal(result.dismiss, false);
  if (!result.dismiss) assert.equal(result.height, 102);
});
test("keyboard covering the window never creates a negative height", () => {
  assert.equal(
    noteSheetKeyboardHeight({ height: 390, safeTop: 20, keyboardOverlap: 500 }),
    0,
  );
});

test("willChangeFrame before willHide restores 54% once", () => {
  const keyboard = { ...portrait, keyboardOverlap: 350 };
  const frame = noteSheetKeyboardTransition(keyboard, 0.92, portrait.height);
  assert.deepEqual(frame, { height: 844 * 0.54, keyboardOverlap: 0, ratio: 0.54 });
  assert.equal(noteSheetKeyboardTransition(portrait, frame!.ratio, null), null);
});

test("willHide before willChangeFrame restores 54% once", () => {
  const keyboard = { ...portrait, keyboardOverlap: 350 };
  const hide = noteSheetKeyboardTransition(keyboard, 0.92, null);
  assert.deepEqual(hide, { height: 844 * 0.54, keyboardOverlap: 0, ratio: 0.54 });
  assert.equal(noteSheetKeyboardTransition(portrait, hide!.ratio, portrait.height), null);
});
