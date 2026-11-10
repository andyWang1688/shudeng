import test from "node:test";
import assert from "node:assert/strict";
import { hooks, jsx, loader, nodes } from "./platformHarness.mts";

function nativeFormHarness() {
  const h = hooks();
  const writes: string[] = [];
  const changes: [string, string][] = [];
  const state = {
    value: "",
    set(value: string) {
      this.value = value;
      writes.push(value);
    },
  };
  const components = Object.fromEntries(
    [
      "Button",
      "Form",
      "HStack",
      "Image",
      "LabeledContent",
      "ProgressView",
      "Picker",
      "Section",
      "SecureField",
      "Text",
      "TextField",
      "Toggle",
      "VStack",
    ].map((name) => [name, name]),
  );
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
      ...components,
      useNativeState(value: string) {
        const current = h.react.useRef(null);
        if (!current.current) {
          state.value = value;
          current.current = state;
        }
        return current.current;
      },
    },
    "@expo/ui/swift-ui/modifiers": modifiers,
    "../theme": {
      usePalette: () => ({
        paper: "paper",
        surface: "surface",
        ink: "ink",
        ink2: "ink2",
        ink3: "ink3",
      }),
    },
  })("apps/mobile/src/ui/settings/AIServiceForm.ios.tsx").AIServiceForm;
  const props: any = {
    fields: {
      name: "Saved service",
      baseUrl: "https://model.example/v1",
      model: "reading-model",
      key: "",
    },
    fieldRevision: 0,
    existingService: true,
    canChooseProtocol: false,
    changingKey: false,
    canCancelKey: true,
    busy: false,
    testing: false,
    status: "",
    providerLabel: "自定义",
    provider: "openai",
    supportsWebSearch: false,
    webSearchEnabled: false,
    onFieldChange(name: string, value: string) {
      changes.push([name, value]);
      props.fields[name] = value;
    },
    onChoosePreset() {},
    onProviderChange() {},
    onChangeKey() {},
    onCancelKey() {},
    onAdvanced() {},
    onWebSearchChange() {},
    onTest() {},
    onCancelTest() {},
    onRemove() {},
  };
  const render = () => Form(props);
  const renderField = (name: string) => {
    const field = nodes(
      render(),
      (node) => typeof node.type === "function" && node.props.name === name,
    )[0];
    return h.render(() => field.type(field.props));
  };
  return {
    props,
    render,
    renderField,
    writes,
    changes,
    state,
    unmount: h.unmount,
  };
}

test("iOS service fields keep native typing intact and synchronize external preset changes once", () => {
  const h = nativeFormHarness();
  let tree = h.renderField("baseUrl");
  let field = nodes(tree, (node) => node.type === "TextField")[0];
  assert.equal(field.props.axis, "vertical");
  assert.equal(h.state.value, "https://model.example/v1");
  assert.deepEqual(h.writes, []);
  h.state.value = "https://typed.example/v1";
  field.props.onTextChange(h.state.value);
  assert.deepEqual(h.changes, [["baseUrl", "https://typed.example/v1"]]);
  h.renderField("baseUrl");
  assert.deepEqual(
    h.writes,
    [],
    "native keystrokes must not be written back and disturb selection",
  );
  h.props.fields.baseUrl = "https://api.deepseek.com";
  h.props.fieldRevision++;
  tree = h.renderField("baseUrl");
  field = nodes(tree, (node) => node.type === "TextField")[0];
  assert.equal(field.props.text.value, "https://api.deepseek.com");
  assert.deepEqual(h.writes, ["https://api.deepseek.com"]);
  h.renderField("baseUrl");
  assert.deepEqual(h.writes, ["https://api.deepseek.com"]);
  h.unmount();
});

test("iOS delayed input echoes never replace newer native text", () => {
  const h = nativeFormHarness();
  const tree = h.renderField("name");
  const field = nodes(tree, (node) => node.type === "TextField")[0];
  h.state.value = "AB";
  field.props.onTextChange("A");
  field.props.onTextChange("AB");
  h.props.fields.name = "A";
  h.renderField("name");
  assert.equal(h.state.value, "AB");
  assert.deepEqual(h.writes, []);
  h.props.fields.name = "AB";
  h.renderField("name");
  assert.equal(h.state.value, "AB");
  h.unmount();
});

test("iOS saved service forms expose neither preset nor protocol selection", () => {
  const h = nativeFormHarness();
  const tree = h.render();
  assert.equal(nodes(tree, node => node.type === "Picker").length, 0);
  assert.equal(nodes(tree, node => node.props?.onPress === h.props.onChoosePreset).length, 0);
  assert.equal(nodes(tree, node => node.props?.onPress === h.props.onAdvanced).length, 1);
  assert.equal(nodes(tree, node => node.type === "Toggle").length, 0);
  h.unmount();
});

test("iOS new service forms expose protocol selection and preserve its callback", () => {
  const h = nativeFormHarness();
  h.props.existingService = false;
  h.props.canChooseProtocol = true;
  h.props.changingKey = true;
  h.props.canCancelKey = false;
  const selected: string[] = [];
  h.props.onProviderChange = (provider: string) => selected.push(provider);
  const tree = h.render();
  const picker = nodes(tree, node => node.type === "Picker")[0];
  assert.ok(picker);
  assert.equal(picker.props.selection, "openai");
  picker.props.onSelectionChange("anthropic");
  assert.deepEqual(selected, ["anthropic"]);
  h.unmount();
});

test("iOS credential replacement uses an empty secure field and preserves cancellation availability", () => {
  const h = nativeFormHarness();
  let tree = h.render();
  assert.equal(
    nodes(
      tree,
      (node) => typeof node.type === "function" && node.props.name === "key",
    ).length,
    0,
  );
  assert.equal(
    nodes(
      tree,
      (node) => node.type === "Button" && node.props.label === "已保存 · 更换",
    ).length,
    1,
  );
  h.props.changingKey = true;
  tree = h.renderField("key");
  const secure = nodes(tree, (node) => node.type === "SecureField")[0];
  assert.equal(secure.props.text.value, "");
  secure.props.onTextChange("replacement");
  assert.deepEqual(h.changes, [["key", "replacement"]]);
  assert.equal(
    nodes(
      h.render(),
      (node) => node.type === "Button" && node.props.label === "取消更换密钥",
    ).length,
    1,
  );
  h.props.canCancelKey = false;
  assert.equal(
    nodes(
      h.render(),
      (node) => node.type === "Button" && node.props.label === "取消更换密钥",
    ).length,
    0,
  );
  h.props.testing = true;
  h.props.busy = true;
  tree = h.render();
  assert.equal(nodes(tree, (node) => node.type === "ProgressView").length, 1);
  const cancel = nodes(
    tree,
    (node) => node.type === "Button" && node.props.label === "取消检查",
  )[0];
  assert.equal(cancel.props.onPress, h.props.onCancelTest);
  assert.equal(cancel.props.modifiers, undefined);
  h.unmount();
});
