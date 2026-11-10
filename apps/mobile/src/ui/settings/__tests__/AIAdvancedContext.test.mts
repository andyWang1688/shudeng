import test from "node:test";
import assert from "node:assert/strict";
import { hooks, jsx, loader, nativePorts, nodes } from "./platformHarness.mts";
import { parseContextWindowTokens } from "../../../../../../packages/core/src/agent/context-window.ts";

function harness() {
  const h = hooks();
  const draft: any = {
    provider: "openai",
    baseUrl: "https://gateway.example/v1",
    model: "gpt-4.1",
    windowAutomatic: true,
    windowSize: "",
    manualWindowSize: "",
    setProvider() {
      throw new Error("Context settings cannot change the protocol");
    },
  };
  for (const key of ["windowAutomatic", "windowSize", "manualWindowSize"])
    draft["set" + key[0].toUpperCase() + key.slice(1)] = (value: any) => {
      draft[key] = value;
    };
  const Screen = loader({
    react: h.react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": nativePorts([]),
    "expo-router": { useRouter: () => ({ back: () => undefined }) },
    "@shudeng/core/agent": {
      parseContextWindowTokens,
      inspectModelContext: () => ({
        source: "profile",
        contextWindowTokens: 1047576,
        notice: "未验证此服务限制。",
      }),
    },
    "../../../src/ui/settings/AIServiceDraft": {
      useAIServiceDraft: () => draft,
    },
    "../../../src/ui/settings/SettingsEditorLayout": {
      SettingsEditorLayout: "SettingsEditorLayout",
    },
    "../../../src/ui/settings/SettingsParts": {
      SettingsHeader: "SettingsHeader",
      SettingsRow: "SettingsRow",
      SettingsSection: "SettingsSection",
      showSettingsChoices() {},
    },
    "../../../src/ui/theme": { usePalette: () => ({}) },
    "../theme": { usePalette: () => ({}) },
    "./SettingsParts": {
      SettingsRow: "SettingsRow",
      SettingsSection: "SettingsSection",
    },
  })("apps/mobile/app/settings/ai-service/advanced.tsx").default;
  return {
    draft,
    render: () =>
      h.render(() => {
        const tree = Screen();
        for (const form of nodes(
          tree,
          (node) =>
            typeof node.type === "function" &&
            node.type.name === "AIContextForm",
        ))
          form.props = { ...form.props, rendered: form.type(form.props) };
        return tree;
      }),
  };
}
const control = (tree: any, label: string) =>
  nodes(tree, (n) => n.props?.accessibilityLabel === label)[0];
test("manual context mode stays editable when empty and retains exact values across automatic toggles", () => {
  const h = harness();
  let tree = h.render();
  assert.ok(
    nodes(
      tree,
      (n) =>
        n.props?.title === "模型资料" && n.props?.detail === "1,047,576 Token",
    ).length,
  );
  assert.equal(tree.props.title, "上下文窗口");
  assert.equal(nodes(tree, (n) => n.props?.title === "接口格式").length, 0);
  control(tree, "自动设置上下文窗口").props.onValueChange(false);
  tree = h.render();
  assert.ok(control(tree, "上下文 Token 数"));
  control(tree, "上下文 Token 数").props.onEndEditing({
    nativeEvent: { text: "" },
  });
  tree = h.render();
  assert.ok(
    nodes(
      tree,
      (n) => n.props?.children === "请输入上下文 Token 数，或切回自动。",
    ).length,
  );
  control(tree, "上下文 Token 数").props.onChangeText("1047576");
  tree = h.render();
  control(tree, "自动设置上下文窗口").props.onValueChange(true);
  tree = h.render();
  assert.equal(control(tree, "上下文 Token 数"), undefined);
  control(tree, "自动设置上下文窗口").props.onValueChange(false);
  tree = h.render();
  assert.equal(control(tree, "上下文 Token 数").props.value, "1047576");
  control(tree, "上下文 Token 数").props.onChangeText("");
  tree = h.render();
  assert.ok(
    control(tree, "上下文 Token 数"),
    "clearing a manual value must not silently switch to auto",
  );
  assert.equal(h.draft.windowAutomatic, false);
});

test("switching to automatic ignores a late blur and input from the removed manual field", () => {
  const h = harness();
  let tree = h.render();
  control(tree, "自动设置上下文窗口").props.onValueChange(false);
  tree = h.render();
  const manual = control(tree, "上下文 Token 数");
  control(tree, "自动设置上下文窗口").props.onValueChange(true);
  manual.props.onEndEditing({ nativeEvent: { text: "" } });
  manual.props.onChangeText("late");
  tree = h.render();
  assert.equal(h.draft.windowSize, "");
  assert.equal(h.draft.manualWindowSize, "");
  assert.equal(
    nodes(
      tree,
      (n) => n.props?.children === "请输入上下文 Token 数，或切回自动。",
    ).length,
    0,
  );
  assert.equal(h.draft.provider, "openai");
});

test("native manual context entry preserves typing and validates the latest native value", () => {
  const h = hooks();
  const updates: string[] = [],
    validated: string[] = [],
    writes: string[] = [];
  const state = {
    value: "1M",
    get() {
      return this.value;
    },
    set(value: string) {
      this.value = value;
      writes.push(value);
    },
  };
  const modifiers = new Proxy(
    {},
    {
      get:
        (_target, name) =>
        (...values: any[]) => ({ name, values }),
    },
  );
  const Form = loader({
    react: h.react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "@expo/ui/swift-ui": {
      ...Object.fromEntries(
        [
          "Form",
          "LabeledContent",
          "Section",
          "Text",
          "TextField",
          "Toggle",
        ].map((name) => [name, name]),
      ),
      useNativeState(value: string) {
        const instance = h.react.useRef(null);
        if (!instance.current) {
          state.value = value;
          instance.current = state;
        }
        return instance.current;
      },
    },
    "@expo/ui/swift-ui/modifiers": modifiers,
  })("apps/mobile/src/ui/settings/AIContextForm.ios.tsx").AIContextForm;
  const props: any = {
    automatic: false,
    windowSize: "1M",
    contextWindowTokens: 1047576,
    source: "profile",
    notice: "notice",
    error: "",
    onAutomaticChange() {},
    onWindowSizeChange(value: string) {
      updates.push(value);
      props.windowSize = value;
    },
    onValidate(value: string) {
      validated.push(value);
    },
  };
  const render = () => {
    const tree = Form(props);
    const manual = nodes(tree, (node) => typeof node.type === "function")[0];
    return h.render(() => manual.type(manual.props));
  };
  let field = nodes(render(), (node) => node.type === "TextField")[0];
  state.value = "1.05M";
  field.props.onTextChange("1.0M");
  field.props.onTextChange("1.05M");
  field = nodes(render(), (node) => node.type === "TextField")[0];
  assert.deepEqual(writes, []);
  assert.deepEqual(updates, ["1.0M", "1.05M"]);
  field.props.onFocusChange(false);
  assert.deepEqual(validated, ["1.05M"]);
  h.unmount();
});
