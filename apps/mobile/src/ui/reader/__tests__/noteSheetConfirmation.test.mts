import assert from "node:assert/strict";
import { test } from "node:test";
import { find, readerSheet } from "./readerSheetHarness.mts";

const sheet = (initial: any) => readerSheet("NoteSheet", initial);

function base(onDelete: () => void) {
  return {
    visible: true,
    quote: "原文",
    body: "已有正文",
    saving: false,
    onDelete,
    onClose() {},
    onSave() {},
    onChangeBody() {},
  };
}

test("editor opens one native-copy confirmation and cancelling never deletes or closes the editor", () => {
  let deleted = 0;
  const ui = sheet(base(() => deleted++));
  let tree = ui.render();
  find(tree, "Pressable", "note-delete").props.onPress();
  tree = ui.render();
  const card = find(tree, "BookNotice").props;
  assert.equal(card.title, "删除笔记？");
  assert.equal(card.message, "删除后无法恢复；原文中的高亮与笔记也会移除。");
  card.actions[0].onPress();
  tree = ui.render();
  assert.equal(find(tree, "BookNotice"), undefined);
  assert.equal(find(tree, "TextInput", "note-body").props.value, "已有正文");
  assert.equal(find(tree, "Modal").props.visible, true);
  assert.equal(deleted, 0);
});

test("confirmed consumer callback is consumed once and old cancelled callbacks cannot delete a later note", () => {
  let deleted = 0;
  const ui = sheet(base(() => deleted++));
  let tree = ui.render();
  find(tree, "Pressable", "note-delete").props.onPress();
  const old = find(ui.render(), "BookNotice").props;
  old.actions[0].onPress();
  ui.render();
  find(ui.render(), "Pressable", "note-delete").props.onPress();
  const current = find(ui.render(), "BookNotice").props;
  old.actions[1].onPress();
  assert.equal(deleted, 0);
  current.actions[1].onPress();
  current.actions[1].onPress();
  assert.equal(deleted, 1);
  assert.equal(find(ui.render(), "BookNotice"), undefined);
});

test("external closure or unmount discards pending destructive callbacks", () => {
  let deleted = 0;
  const props = base(() => deleted++);
  const ui = sheet(props);
  find(ui.render(), "Pressable", "note-delete").props.onPress();
  const card = find(ui.render(), "BookNotice").props;
  ui.render({ ...props, visible: false });
  card.actions[1].onPress();
  assert.equal(deleted, 0);
  const other = sheet(props);
  find(other.render(), "Pressable", "note-delete").props.onPress();
  const pending = find(other.render(), "BookNotice").props;
  other.unmount();
  pending.actions[1].onPress();
  assert.equal(deleted, 0);
});

test("failure notice is inside the existing editor modal and acknowledgment preserves the body", () => {
  let acknowledged = 0;
  const props = {
    ...base(() => {}),
    body: "未保存的新正文",
    notice: {
      title: "笔记保存失败",
      message: "内容仍在此页；请检查储存空间后重试保存。",
    },
    onDismissNotice: () => acknowledged++,
  };
  const ui = sheet(props);
  const tree = ui.render();
  const modal = find(tree, "Modal");
  const card = find(modal, "BookNotice");
  assert.equal(card.props.title, "笔记保存失败");
  card.props.onAcknowledge();
  assert.equal(acknowledged, 1);
  assert.equal(
    find(ui.render(), "TextInput", "note-body").props.value,
    "未保存的新正文",
  );
  assert.equal(find(ui.render(), "Modal").props.visible, true);
});

test("closing locks stale save, delete and input callbacks before animation finishes", () => {
  let saved = 0,
    deleted = 0,
    changed = 0,
    closed = 0,
    replacementClosed = 0,
    animations = 0;
  const props = {
    ...base(() => deleted++),
    onSave: () => saved++,
    onChangeBody: () => changed++,
    onClose: () => closed++,
  };
  const ui = sheet(props);
  const tree = ui.render();
  const panel = find(tree, "AppSheet").props;
  panel.ref.current = { close: () => animations++ };
  find(tree, "Pressable", "note-close").props.onPress();
  // These callbacks come from the same render as the close button: no rerender
  // has disabled their native controls yet.
  find(tree, "Pressable", "note-save").props.onPress();
  find(tree, "Pressable", "note-delete").props.onPress();
  find(tree, "TextInput", "note-body").props.onChangeText("迟到的输入");
  assert.equal(saved, 0);
  assert.equal(deleted, 0);
  assert.equal(changed, 0);
  assert.equal(animations, 1);
  let closingTree = ui.render({
    ...props,
    saving: true,
    onClose: () => replacementClosed++,
  });
  assert.equal(
    find(closingTree, "Pressable", "note-save").props.disabled,
    true,
  );
  assert.equal(
    find(closingTree, "TextInput", "note-body").props.editable,
    false,
  );
  // A later saving prop cannot strand the already closing modal. Its original
  // close request completes exactly once and retains the captured callback.
  find(closingTree, "AppSheet").props.onClose();
  panel.onClose();
  assert.equal(closed, 1);
  assert.equal(replacementClosed, 0);
  closingTree = ui.render(props);
  find(closingTree, "Pressable", "note-save").props.onPress();
  assert.equal(
    saved,
    0,
    "a late save failure must not reopen a retired editor",
  );
  ui.render({ ...props, visible: false });
  ui.render(props);
  find(ui.render(), "Pressable", "note-save").props.onPress();
  assert.equal(saved, 1, "the next presentation can save normally");
});

test("gesture dismissal locks late saves and its completion cannot close the next presentation", () => {
  let saved = 0,
    closed = 0;
  const props = {
    ...base(() => {}),
    onSave: () => saved++,
    onClose: () => closed++,
  };
  const ui = sheet(props);
  const tree = ui.render();
  const oldPanel = find(tree, "AppSheet").props;
  oldPanel.onAnimate(0, -1);
  find(tree, "Pressable", "note-save").props.onPress();
  assert.equal(saved, 0);
  ui.render({ ...props, visible: false });
  ui.render(props);
  oldPanel.onClose();
  assert.equal(closed, 0);
  find(ui.render(), "Pressable", "note-save").props.onPress();
  assert.equal(saved, 1);
});

test("closing revokes a pending delete confirmation before its delayed destructive callback", () => {
  let deleted = 0;
  const ui = sheet(base(() => deleted++));
  find(ui.render(), "Pressable", "note-delete").props.onPress();
  const tree = ui.render();
  const confirmation = find(tree, "BookNotice").props;
  find(tree, "AppSheet").props.onAnimate(0, -1);
  confirmation.actions[1].onPress();
  assert.equal(deleted, 0);
  assert.equal(find(ui.render(), "BookNotice"), undefined);
});

test("a delayed keyboard text measurement from a retired editor cannot resize the next note", () => {
  const props = base(() => {});
  const ui = sheet(props);
  const oldInput = find(ui.render(), "TextInput", "note-body").props;
  oldInput.onContentSizeChange({
    nativeEvent: { contentSize: { height: 540 } },
  });
  ui.render({ ...props, visible: false });
  ui.render({ ...props, body: "另一条笔记" });
  // Native text layout can arrive after the modal and input have unmounted.
  oldInput.onContentSizeChange({
    nativeEvent: { contentSize: { height: 720 } },
  });
  const current = find(ui.render(), "TextInput", "note-body").props;
  assert.equal(current.value, "另一条笔记");
  assert.equal(
    current.style.at(-1).height,
    180,
    "the next editor must start at its own content height",
  );
});

test("the current editor still measures text while its save keeps interaction locked", () => {
  const props = base(() => {});
  const ui = sheet(props);
  const input = find(ui.render(), "TextInput", "note-body").props;
  const saving = find(
    ui.render({ ...props, saving: true }),
    "TextInput",
    "note-body",
  ).props;
  assert.equal(saving.editable, false);
  input.onContentSizeChange({ nativeEvent: { contentSize: { height: 420 } } });
  const current = find(ui.render(), "TextInput", "note-body").props;
  assert.equal(current.style.at(-1).height, 420);
  assert.equal(current.value, props.body);
});
