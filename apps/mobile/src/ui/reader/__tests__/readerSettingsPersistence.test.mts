import assert from "node:assert/strict";
import { test } from "node:test";
import { readerComponent } from "./readerSheetHarness.mts";

const initialPreferences = {
  format: "epub",
  flow: "paginated",
  theme: "light",
  fontScale: 1,
};

function nodes(tree: any, type: string): any[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, type));
  return [
    ...(tree.type === type ? [tree] : []),
    ...nodes(tree.props?.children, type),
  ];
}

function setting(tree: any, label: string) {
  const control = nodes(tree, "Pressable").find(
    (node) =>
      node.props.accessibilityLabel === label ||
      nodes(node, "Text").some((text) => text.props.children === label),
  );
  assert.ok(control, "setting is available: " + label);
  return control.props.onPress;
}

function epub(onApply: (next: any) => Promise<boolean>) {
  const props = {
    visible: true,
    preferences: initialPreferences,
    curlAvailable: true,
    onClose() {},
    onApply,
  };
  const ui = readerComponent(
    new URL("../ReaderPanels.tsx", import.meta.url),
    "ReaderSettingsPanel",
    props,
    {
      "./ReaderPanel": { ReaderPanel: "ReaderPanel" },
      "../appearance": { useAppearance: () => ({ resolvedMode: "light" }) },
    },
  );
  return {
    render(next: any = {}) {
      const panel = ui.render({ ...props, ...next });
      return {
        panel,
        body: panel.props.children({
          canInteract: () => true,
          blocked: panel.props.busy,
        }),
      };
    },
    unmount: ui.unmount,
  };
}

test("a queued EPUB theme change preserves the font size already confirmed by storage", async () => {
  const writes: any[] = [];
  const ui = epub(async (next) => {
    writes.push(next);
    return true;
  });
  const { body } = ui.render();
  setting(body, "增大字号")();
  await Promise.resolve();
  // Both callbacks can already be in the native event queue when props rerender.
  setting(body, "深色")();
  await Promise.resolve();
  assert.deepEqual(writes, [
    { ...initialPreferences, fontScale: 1.25 },
    { ...initialPreferences, fontScale: 1.25, theme: "dark" },
  ]);
  ui.unmount();
});

test("successive EPUB font buttons use the last confirmed size before parent props commit", async () => {
  const writes: any[] = [];
  const ui = epub(async (next) => {
    writes.push(next);
    return true;
  });
  const { body } = ui.render();
  const larger = setting(body, "增大字号");
  larger();
  await Promise.resolve();
  larger();
  await Promise.resolve();
  setting(body, "滚动")();
  await Promise.resolve();
  assert.deepEqual(writes, [
    { ...initialPreferences, fontScale: 1.25 },
    { ...initialPreferences, fontScale: 1.5 },
    { ...initialPreferences, fontScale: 1.5, flow: "scrolled" },
  ]);
  ui.unmount();
});

test("a failed EPUB save keeps the confirmed settings for the next change", async () => {
  const writes: any[] = [];
  const ui = epub(async (next) => {
    writes.push(next);
    return writes.length !== 1;
  });
  const { body } = ui.render();
  setting(body, "增大字号")();
  await Promise.resolve();
  setting(body, "深色")();
  await Promise.resolve();
  assert.deepEqual(writes, [
    { ...initialPreferences, fontScale: 1.25 },
    { ...initialPreferences, theme: "dark" },
  ]);
  assert.equal(ui.render().panel.props.busy, false);
  ui.unmount();
});

test("a pending EPUB write keeps its lock across reopen and does not admit overlapping changes", async () => {
  let complete!: (success: boolean) => void;
  const pending = new Promise<boolean>((resolve) => {
    complete = resolve;
  });
  const writes: any[] = [];
  const ui = epub(async (next) => {
    writes.push(next);
    return writes.length === 1 ? pending : true;
  });
  const { body } = ui.render();
  setting(body, "增大字号")();
  ui.render({ visible: false });
  const reopened = ui.render();
  assert.equal(reopened.panel.props.busy, true);
  setting(body, "深色")();
  setting(reopened.body, "滚动")();
  assert.equal(writes.length, 1);
  complete(true);
  await pending;
  await new Promise<void>((resolve) => setImmediate(resolve));
  const ready = ui.render();
  assert.equal(ready.panel.props.busy, false);
  setting(ready.body, "滚动")();
  await Promise.resolve();
  assert.deepEqual(writes.at(-1), {
    ...initialPreferences,
    fontScale: 1.25,
    flow: "scrolled",
  });
  ui.unmount();
});

test("new parent preferences replace the confirmed base without stale controls reverting other fields", async () => {
  const writes: any[] = [];
  const ui = epub(async (next) => {
    writes.push(next);
    return true;
  });
  const { body } = ui.render();
  const changed = {
    ...initialPreferences,
    fontScale: 1.75,
    theme: "dark",
    flow: "scrolled",
  };
  ui.render({ preferences: changed });
  setting(body, "缩小字号")();
  await Promise.resolve();
  assert.deepEqual(writes, [{ ...changed, fontScale: 1.5 }]);
  ui.unmount();
});
