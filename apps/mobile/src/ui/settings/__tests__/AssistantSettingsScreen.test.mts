import test from "node:test";
import assert from "node:assert/strict";
import {
  hooks,
  jsx,
  loader,
  nativePorts,
  nodes,
  parts,
  flush,
} from "./platformHarness.mts";
import {
  DEFAULT_ASSISTANT_PREFERENCES,
  ASSISTANT_INSTRUCTIONS_MAX_LENGTH,
  type AssistantPreferences,
} from "../../../platform/settings/assistantPreferences.ts";

function setup(
  options: {
    load?: () => Promise<AssistantPreferences>;
    save?: (v: AssistantPreferences) => Promise<void>;
  } = {},
) {
  let current = hooks();
  let stored: AssistantPreferences = {
    instructions: "已保存指令",
  };
  const writes: AssistantPreferences[] = [];
  let backs = 0;
  const load = loader({
    react: new Proxy({}, { get: (_, key) => current.react[key] }),
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": nativePorts([]),
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "./SettingsParts": parts,
    "../theme": {
      usePalette: () => ({
        paper: "paper",
        lampInk: "lampInk",
        ink3: "ink3",
        ink: "ink",
        error: "error",
      }),
    },
    "../../platform/assistantPreferences": {
      DEFAULT_ASSISTANT_PREFERENCES,
      ASSISTANT_INSTRUCTIONS_MAX_LENGTH,
      loadAssistantPreferences: options.load ?? (async () => stored),
      saveAssistantPreferences: async (value: AssistantPreferences) => {
        writes.push(value);
        if (options.save) await options.save(value);
        stored = { ...value };
      },
    },
  });
  const { AssistantSettingsScreen } = load(
    "apps/mobile/src/ui/settings/AssistantSettingsScreen.tsx",
  );
  const render = () =>
    current.render(() =>
      AssistantSettingsScreen({
        onBack: () => {
          backs++;
        },
      }),
    );
  return {
    render,
    writes,
    backCount: () => backs,
    replaceStored: (value: AssistantPreferences) => {
      stored = value;
    },
    replayEffects: () => current.restart(),
    reopen: () => {
      current.unmount();
      current = hooks();
      return render();
    },
  };
}
const field = (tree: any) =>
  nodes(tree, (n) => n.props?.testID === "assistant-instructions")[0];
const action = (tree: any, title: string) =>
  nodes(tree, (n) => n.type === "SettingsAction" && n.props.title === title)[0];
const textIncludes = (tree: any, value: string) =>
  JSON.stringify(tree).includes(value);

test("controls remain disabled until persisted settings have loaded", async () => {
  let finish!: (v: AssistantPreferences) => void;
  const harness = setup({
    load: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  let tree = harness.render();
  assert.equal(field(tree).props.editable, false);
  assert.equal(
    nodes(tree, (n) => n.props?.testID === "assistant-web-search").length,
    0,
  );
  assert.equal(action(tree, "保存").props.disabled, true);
  finish({ instructions: "loaded" });
  await flush();
  tree = harness.render();
  assert.equal(field(tree).props.value, "loaded");
  assert.equal(field(tree).props.editable, true);
});

test("a superseded load cannot replace newer settings after effect replay", async () => {
  const pending: ((v: AssistantPreferences) => void)[] = [];
  const harness = setup({
    load: () => new Promise((resolve) => pending.push(resolve)),
  });
  harness.render();
  harness.replayEffects();
  pending[1]!({ instructions: "new settings" });
  await flush();
  pending[0]!({ instructions: "stale settings" });
  await flush();
  const tree = harness.render();
  assert.equal(field(tree).props.value, "new settings");
});

test("a failed save retains instructions, blocks duplicate writes, and succeeds on retry", async () => {
  let reject!: (cause: Error) => void;
  let first = true;
  const harness = setup({
    save: () =>
      first
        ? new Promise((_, fail) => {
            reject = fail;
          })
        : Promise.resolve(),
  });
  harness.render();
  await flush();
  let tree = harness.render();
  field(tree).props.onChangeText("# 我的草稿");
  tree = harness.render();
  const save = action(tree, "保存").props.onPress;
  save();
  save();
  assert.equal(harness.writes.length, 1);
  tree = harness.render();
  assert.equal(field(tree).props.editable, false);
  reject(new Error("disk full"));
  await flush();
  tree = harness.render();
  assert.equal(field(tree).props.value, "# 我的草稿");
  assert.equal(textIncludes(tree, "disk full"), true);
  assert.equal(textIncludes(tree, "草稿仍保留"), true);
  first = false;
  action(tree, "保存").props.onPress();
  await flush();
  tree = harness.render();
  assert.deepEqual(harness.writes[1], {
    instructions: "# 我的草稿",
  });
  assert.equal(textIncludes(tree, "已保存，下一次提问生效。"), true);
  assert.equal(harness.backCount(), 0);
});

test("restore defaults only edits the draft until explicitly saved", async () => {
  const harness = setup();
  harness.render();
  await flush();
  let tree = harness.render();
  action(tree, "恢复默认").props.onPress();
  tree = harness.render();
  assert.equal(
    field(tree).props.value,
    DEFAULT_ASSISTANT_PREFERENCES.instructions,
  );
  assert.equal(harness.writes.length, 0);
  assert.equal(action(tree, "保存").props.disabled, false);
  action(tree, "保存").props.onPress();
  await flush();
  assert.deepEqual(harness.writes, [DEFAULT_ASSISTANT_PREFERENCES]);
});

test("saved or reverted drafts do not override later persisted settings on reopening", async () => {
  for (const shouldSave of [true, false]) {
    const harness = setup();
    harness.render();
    await flush();
    let tree = harness.render();
    field(tree).props.onChangeText("临时草稿");
    tree = harness.render();
    if (shouldSave) {
      action(tree, "保存").props.onPress();
      await flush();
    } else {
      field(tree).props.onChangeText("已保存指令");
    }
    harness.replaceStored({
      instructions: "更新后的持久化设置",
    });
    harness.reopen();
    await flush();
    tree = harness.render();
    assert.equal(field(tree).props.value, "更新后的持久化设置");
    assert.equal(action(tree, "保存").props.disabled, true);
  }
});

test("unsaved edits survive removal and reopening without changing saved settings", async () => {
  const harness = setup();
  harness.render();
  await flush();
  let tree = harness.render();
  field(tree).props.onChangeText("返回也保留");
  harness.reopen();
  await flush();
  tree = harness.render();
  assert.equal(field(tree).props.value, "返回也保留");
  assert.equal(harness.writes.length, 0);
  assert.equal(action(tree, "保存").props.disabled, false);
  action(tree, "保存").props.onPress();
  await flush();
  harness.reopen();
  await flush();
  tree = harness.render();
  assert.equal(field(tree).props.value, "返回也保留");
  assert.equal(action(tree, "保存").props.disabled, true);
});

test("read failure offers retry without overwriting; explicit restore can recover damaged settings", async () => {
  const harness = setup({
    load: async () => {
      throw new Error("配置已损坏");
    },
  });
  harness.render();
  await flush();
  let tree = harness.render();
  assert.equal(field(tree).props.editable, false);
  assert.equal(harness.writes.length, 0);
  assert.ok(
    nodes(
      tree,
      (n) => n.type === "SettingsRow" && n.props.title === "配置已损坏",
    )[0].props.onPress,
  );
  action(tree, "恢复默认").props.onPress();
  tree = harness.render();
  assert.equal(field(tree).props.editable, true);
  assert.equal(harness.writes.length, 0);
  action(tree, "保存").props.onPress();
  await flush();
  assert.deepEqual(harness.writes, [DEFAULT_ASSISTANT_PREFERENCES]);
});

test("overlong instructions remain editable and cannot be saved or silently truncated", async () => {
  const harness = setup();
  harness.render();
  await flush();
  let tree = harness.render();
  const long = "字".repeat(ASSISTANT_INSTRUCTIONS_MAX_LENGTH + 1);
  field(tree).props.onChangeText(long);
  tree = harness.render();
  assert.equal(field(tree).props.value, long);
  assert.equal(action(tree, "保存").props.disabled, true);
  action(tree, "保存").props.onPress();
  await flush();
  assert.equal(harness.writes.length, 0);
});
