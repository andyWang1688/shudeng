import test from "node:test";
import assert from "node:assert/strict";
import {
  aiConsentScope,
  validateServiceDraft,
} from "../../../platform/settings/aiCatalog.ts";
import { parseContextWindowTokens } from "../../../../../../packages/core/src/agent/context-window.ts";
import {
  hooks,
  jsx,
  loader,
  nativePorts,
  nodes,
  parts,
  flush,
} from "./platformHarness.mts";

const palette = { paper: "paper", lampInk: "ink" };
const basePorts = (h: ReturnType<typeof hooks>) => ({
  react: h.react,
  "react/jsx-runtime": { jsx, jsxs: jsx },
  "react-native": nativePorts([]),
  "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
  "../theme": { usePalette: () => palette },
  "./SettingsParts": parts,
  "./ServiceList": { ServiceList: "ServiceList" },
});
const row = (tree: any, title: string) =>
  nodes(tree, (n) => n.type === "SettingsRow" && n.props.title === title)[0];
const action = (tree: any, title: string) =>
  nodes(tree, (n) => n.type === "SettingsAction" && n.props.title === title)[0];

test("AI services load real configurations and keep unrelated settings off the list", async () => {
  const h = hooks();
  let unrelatedReads = 0;
  const Screen = loader({
    ...basePorts(h),
    "expo-router": { useFocusEffect: (fn: any) => h.react.useEffect(fn, [fn]) },
    "../components/BookNotice": { BookNotice: "BookNotice" },
    "./useAISendingConsent": { useAISendingConsent: () => ({ sendingConsent: null }) },
    "../../platform/settings/aiCatalog": { aiConsentScope },
    "../../platform/aiConfig": { loadAIServiceCatalog: async () => ({ version: 2, selectedId: null, services: [] }) },
    "../../platform/mcp": { loadMCPServers() { unrelatedReads++; throw new Error("unexpected MCP read"); } },
    "../../platform/semanticModel": { getSemanticModelState() { unrelatedReads++; throw new Error("unexpected semantic read"); } },
  })("apps/mobile/src/ui/settings/AISettingsScreen.tsx").AISettingsScreen;
  const render = () => h.render(() => Screen({ onBack() {}, onEditService() {} }));
  render(); await flush(); const tree = render();
  assert.equal(nodes(tree, (n) => n.type === "SettingsHeader")[0].props.title, "AI 服务");
  assert.equal(nodes(tree, (n) => n.type === "ServiceList")[0].props.disabled, false);
  for (const title of ["外部工具", "AI 发送说明", "自定义指令", "语义资料"]) assert.equal(row(tree, title), undefined);
  assert.equal(unrelatedReads, 0); h.unmount();
});

test("service draft retains the web-search choice across advanced-settings navigation", () => {
  const h = hooks();
  const Provider = loader({
    react: { ...h.react, createContext: () => ({ Provider: "DraftProvider" }) },
    "react/jsx-runtime": { jsx, jsxs: jsx },
  })("apps/mobile/src/ui/settings/AIServiceDraft.tsx").AIServiceDraftProvider;
  const render = () =>
    h.render(() =>
      Provider({ service: null, selected: false, children: null }),
    );
  let draft = render().props.value;
  assert.equal(draft.webSearchEnabled, false);
  draft.setWebSearchEnabled(true);
  draft.setBaseUrl("https://api.openai.com");
  draft = render().props.value;
  draft.setName("在高级设置修改的名称");
  draft = render().props.value;
  assert.equal(draft.webSearchEnabled, true);
  assert.equal(draft.name, "在高级设置修改的名称");
  h.unmount();
});

test("saved service drafts keep their original protocol while new drafts can choose one", () => {
  for (const existing of [false, true]) {
    const h = hooks();
    const Provider = loader({
      react: { ...h.react, createContext: () => ({ Provider: "DraftProvider" }) },
      "react/jsx-runtime": { jsx, jsxs: jsx },
    })("apps/mobile/src/ui/settings/AIServiceDraft.tsx").AIServiceDraftProvider;
    const service = existing ? { id: "saved", name: "Saved model", provider: "openai", model: "reading-model", baseUrl: "https://reader.example/v1" } : null;
    const render = () => h.render(() => Provider({ service, selected: false, children: null }));
    const draft = render().props.value;
    draft.setProvider("anthropic");
    assert.equal(render().props.value.provider, existing ? "openai" : "anthropic");
    h.unmount();
  }
});

const { resolveWebSearchPolicy } = loader({
  "@langchain/openai": { tools: {} },
  "@langchain/anthropic": { tools: {} },
})("packages/core/src/agent/web-search.ts");

test("service search is an unsaved choice and unsupported gateways cannot be saved enabled", async () => {
  for (const baseUrl of [
    "https://api.openai.com/v1",
    "https://gateway.example/v1",
  ]) {
    const h = hooks(),
      writes: any[] = [];
    let closes = 0,
      confirms = 0;
    const saved = {
      id: "model-1",
      secretId: "retained-secret",
      name: "My model",
      provider: "openai" as const,
      model: "test-model",
      baseUrl,
      webSearchEnabled: false,
    };
    const service = { ...saved, consentScope: aiConsentScope(saved) };
    const draft = {
      ...service,
      windowSize: "",
      key: "",
      setKey() {},
      setWebSearchEnabled(value: boolean) {
        draft.webSearchEnabled = value;
      },
    };
    const Editor = loader({
      ...basePorts(h),
      "expo-router": { useRouter: () => ({ push() {} }), usePreventRemove: () => () => undefined },
      "@shudeng/core/agent": { resolveWebSearchPolicy, parseContextWindowTokens },
      "./AIServiceDraft": { AI_PRESETS: {}, useAIServiceDraft: () => draft },
      "../../platform/settings/aiCatalog": {
        aiConsentScope,
        validateServiceDraft,
      },
      "../../platform/aiConfig": {
        saveAIService: async (...args: any[]) => {
          writes.push(args);
        },
      },
      "../../platform/aiTest": {},
      "./useAISendingConsent": {
        useAISendingConsent: () => ({
          sendingConsent: null,
          confirmAISending() {
            confirms++;
            return true;
          },
        }),
      },
    })("apps/mobile/src/ui/settings/AIServiceEditor.tsx").AIServiceEditor;
    const render = () =>
      h.render(() => {
        const tree = Editor({
          service,
          selected: true,
          onClose() {
            closes++;
          },
          onChanged() {},
        });
        for (const form of nodes(tree, node => typeof node.type === "function" && node.type.name === "AIServiceForm"))
          form.props = { ...form.props, rendered: form.type(form.props) };
        return tree;
      });
    let tree = render();
    let toggle = nodes(
      tree,
      (n) => n.props?.testID === "ai-service-web-search",
    )[0];
    const supported = baseUrl.startsWith("https://api.openai.com");
    if (supported) {
      assert.equal(toggle.props.disabled, false);
      toggle.props.onValueChange(true);
    } else {
      assert.equal(toggle, undefined);
      assert.equal(row(tree, "联网搜索"), undefined);
      const form = nodes(tree, node => typeof node.type === "function" && node.type.name === "AIServiceForm")[0];
      form.props.onWebSearchChange(true);
    }
    tree = render();
    toggle = nodes(tree, (n) => n.props?.testID === "ai-service-web-search")[0];
    if (supported) assert.equal(toggle.props.value, true);
    else assert.equal(draft.webSearchEnabled, false);
    assert.equal(writes.length, 0);
    action(tree, "保存").props.onPress();
    await flush();
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0].webSearchEnabled, supported);
    assert.equal(writes[0][1], "");
    assert.equal(writes[0][2], true);
    assert.equal(confirms, 0);
    assert.equal(closes, 1);
    h.unmount();
  }
});

function mcpHarness(serverId?: string, initiallyBroken = false) {
  const h = hooks();
  let broken = initiallyBroken,
    backs = 0;
  let servers = [
    {
      id: "saved",
      name: "Saved MCP",
      endpoint: "https://tools.example/mcp",
      enabled: true,
      allowedTools: ["search"],
    },
  ];
  const Screen = loader({
    ...basePorts(h),
    "./MCPServerEditor": { MCPServerEditor: "MCPServerEditor" },
    "../../platform/mcp": {
      loadMCPServers: async () => {
        if (broken) throw new Error("配置读取失败");
        return servers;
      },
      newMCPServer: () => ({
        id: "new",
        name: "",
        enabled: false,
        tools: [],
        allowedTools: [],
      }),
    },
  })("apps/mobile/src/ui/settings/MCPSettingsScreen.tsx").MCPSettingsScreen;
  return {
    render: () =>
      h.render(() =>
        Screen({
          serverId,
          onBack() {
            backs++;
          },
        }),
      ),
    repair: () => {
      broken = false;
    },
    rename: () => {
      servers = [{ ...servers[0]!, name: "Updated MCP" }];
    },
    backs: () => backs,
    unmount: h.unmount,
  };
}

test("MCP list opens saved servers, refreshes edits and supports a disabled new draft", async () => {
  const h = mcpHarness();
  h.render();
  await flush();
  let tree = h.render();
  row(tree, "Saved MCP").props.onPress();
  tree = h.render();
  assert.equal(tree.type, "MCPServerEditor");
  assert.equal(tree.props.isNew, false);
  assert.equal(tree.props.initial.id, "saved");
  h.rename();
  tree.props.onChanged();
  tree.props.onClose();
  await flush();
  tree = h.render();
  assert.ok(row(tree, "Updated MCP"));
  action(tree, "添加").props.onPress();
  tree = h.render();
  assert.equal(tree.props.isNew, true);
  assert.equal(tree.props.initial.enabled, false);
  tree.props.onClose();
  assert.ok(row(h.render(), "Updated MCP"));
  assert.equal(h.backs(), 0);
  h.unmount();
});

test("MCP editing deep links preserve their destination and back behavior", async () => {
  const h = mcpHarness("saved");
  h.render();
  await flush();
  const tree = h.render();
  assert.equal(tree.type, "MCPServerEditor");
  assert.equal(tree.props.initial.id, "saved");
  assert.equal(tree.props.isNew, false);
  tree.props.onClose();
  assert.equal(h.backs(), 1);
  h.unmount();
  const missing = mcpHarness("missing");
  missing.render();
  await flush();
  assert.equal(
    nodes(missing.render(), (n) => n.type === "MCPServerEditor").length,
    0,
  );
  missing.unmount();
});

test("MCP read failure offers retry without opening or creating a replacement server", async () => {
  const h = mcpHarness(undefined, true);
  h.render();
  await flush();
  let tree = h.render();
  assert.equal(action(tree, "添加").props.disabled, true);
  assert.equal(nodes(tree, (n) => n.type === "MCPServerEditor").length, 0);
  h.repair();
  row(tree, "配置读取失败").props.onPress();
  await flush();
  tree = h.render();
  assert.ok(row(tree, "Saved MCP"));
  assert.equal(action(tree, "添加").props.disabled, false);
  h.unmount();
});
