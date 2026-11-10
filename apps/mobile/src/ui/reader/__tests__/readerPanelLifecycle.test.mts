import assert from "node:assert/strict";
import { test } from "node:test";
import { find, readerSheet } from "./readerSheetHarness.mts";

type Actions = { canInteract(): boolean; blocked: boolean };
const button = (id: string, actions: Actions, onPress: () => void) => ({
  type: "Pressable",
  props: {
    testID: id,
    disabled: actions.blocked,
    onPress: () => {
      if (actions.canInteract()) onPress();
    },
  },
});

test("a close in flight completes once through its original owner even if later props are busy", () => {
  let closed = 0,
    replacementClosed = 0,
    animations = 0;
  const props = {
    visible: true,
    title: "高亮",
    children: null,
    onClose: () => closed++,
  };
  const ui = readerSheet("ReaderPanel", props);
  const tree = ui.render();
  const sheet = find(tree, "AppSheet").props;
  sheet.ref.current = { close: () => animations++ };
  find(tree, "Modal").props.onRequestClose();
  const closingTree = ui.render({
    ...props,
    busy: true,
    onClose: () => replacementClosed++,
  });
  find(closingTree, "AppSheet").props.onClose();
  sheet.onClose();
  assert.equal(animations, 1);
  assert.equal(closed, 1);
  assert.equal(replacementClosed, 0);
});

for (const action of ["color", "setting", "delete", "navigate"]) {
  test(`close revokes a queued ${action} callback and cannot strand a transparent modal`, () => {
    let busy = false,
      visible = true,
      started = 0;
    const props = {
      visible,
      title: "阅读面板",
      testID: "reader-panel",
      onClose: () => {
        if (!busy) visible = false;
      },
      children: (actions: Actions) =>
        button(action, actions, () => {
          started++;
          busy = true;
        }),
    };
    const ui = readerSheet("ReaderPanel", props);
    const tree = ui.render();
    const panel = find(tree, "AppSheet").props;
    panel.ref.current = { close() {} };
    find(tree, "Modal").props.onRequestClose();
    // This native callback was queued before pointerEvents or disabled rerendered.
    find(tree, "Pressable", action).props.onPress();
    assert.equal(started, 0);
    assert.equal(busy, false);
    const closingTree = ui.render();
    assert.equal(
      find(closingTree, "View", "reader-panel").props.pointerEvents,
      "none",
    );
    panel.onAnimate(0, -1);
    find(closingTree, "AppSheet").props.onClose();
    assert.equal(visible, false);
    assert.equal(
      find(ui.render({ ...props, visible }), "Modal").props.visible,
      false,
    );
  });
}

test("gesture dismissal locks content and header actions before the next render", () => {
  let actions = 0,
    closed = 0;
  const ui = readerSheet("ReaderPanel", {
    visible: true,
    title: "目录",
    onClose: () => closed++,
    action: (guard: Actions) => button("header-search", guard, () => actions++),
    children: (guard: Actions) => button("bookmark", guard, () => actions++),
  });
  const tree = ui.render();
  const panel = find(tree, "AppSheet").props;
  panel.onAnimate(1, -1);
  find(tree, "Pressable", "header-search").props.onPress();
  find(tree, "Pressable", "bookmark").props.onPress();
  panel.onClose();
  panel.onClose();
  assert.equal(actions, 0);
  assert.equal(closed, 1);
});

test("busy rejects queued close and child actions, restoring any native close to its current detent", () => {
  let closed = 0,
    actions = 0,
    animations = 0;
  const snaps: number[] = [];
  const props = {
    visible: true,
    title: "阅读设置",
    testID: "reader-panel",
    busy: false,
    onClose: () => closed++,
    children: (guard: Actions) => button("setting", guard, () => actions++),
  };
  const ui = readerSheet("ReaderPanel", props);
  const oldTree = ui.render();
  const oldPanel = find(oldTree, "AppSheet").props;
  oldPanel.ref.current = {
    close: () => animations++,
    snapToIndex: (index: number) => snaps.push(index),
  };
  oldPanel.onAnimate(0, 1);
  const busyTree = ui.render({ ...props, busy: true });
  find(oldTree, "Modal").props.onRequestClose();
  find(oldTree, "Pressable", "setting").props.onPress();
  find(busyTree, "View", "reader-panel").props.onAccessibilityEscape();
  const panel = find(busyTree, "AppSheet").props;
  assert.equal(panel.enablePanDownToClose, false);
  assert.equal(panel.backdropPressBehavior, "none");
  panel.onAnimate(1, -1);
  panel.onClose();
  assert.deepEqual(snaps, [1, 1]);
  assert.equal(animations, 0);
  assert.equal(actions, 0);
  assert.equal(closed, 0);
  const readyTree = ui.render(props);
  find(readyTree, "Modal").props.onRequestClose();
  find(readyTree, "AppSheet").props.onClose();
  assert.equal(animations, 1);
  assert.equal(closed, 1);
  ui.render({ ...props, visible: false });
  const reopened = ui.render({ ...props, busy: true });
  find(reopened, "AppSheet").props.onClose();
  assert.deepEqual(
    snaps,
    [1, 1, 0],
    "a new presentation starts at its own detent",
  );
  assert.equal(closed, 1);
});

test("callbacks from a closed presentation cannot act on or close a reopened panel", () => {
  let closed = 0,
    actions = 0,
    animations = 0;
  const props = {
    visible: true,
    title: "目录",
    onClose: () => closed++,
    children: (guard: Actions) => button("navigate", guard, () => actions++),
  };
  const ui = readerSheet("ReaderPanel", props);
  const oldTree = ui.render();
  const oldPanel = find(oldTree, "AppSheet").props;
  oldPanel.ref.current = { close: () => animations++ };
  find(oldTree, "Modal").props.onRequestClose();
  ui.render({ ...props, visible: false });
  const currentTree = ui.render(props);
  oldPanel.onAnimate(0, -1);
  oldPanel.onClose();
  find(oldTree, "Modal").props.onRequestClose();
  find(oldTree, "Pressable", "navigate").props.onPress();
  assert.equal(closed, 0);
  assert.equal(actions, 0);
  assert.equal(animations, 1);
  find(currentTree, "Pressable", "navigate").props.onPress();
  assert.equal(actions, 1);
  find(currentTree, "Modal").props.onRequestClose();
  find(currentTree, "AppSheet").props.onClose();
  assert.equal(closed, 1);
  assert.equal(animations, 2);
});

test("external hide and unmount revoke old child callbacks", () => {
  let actions = 0,
    closed = 0;
  const props = {
    visible: true,
    title: "高亮",
    onClose: () => closed++,
    children: (guard: Actions) => button("color", guard, () => actions++),
  };
  const ui = readerSheet("ReaderPanel", props);
  const oldTree = ui.render();
  ui.render({ ...props, visible: false });
  find(oldTree, "Pressable", "color").props.onPress();
  find(oldTree, "AppSheet").props.onClose();
  const newTree = ui.render(props);
  ui.unmount();
  find(newTree, "Pressable", "color").props.onPress();
  find(newTree, "AppSheet").props.onClose();
  assert.equal(actions, 0);
  assert.equal(closed, 0);
});
