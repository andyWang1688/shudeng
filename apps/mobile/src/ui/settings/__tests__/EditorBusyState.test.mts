import test from "node:test";
import { parseContextWindowTokens } from "../../../../../../packages/core/src/agent/context-window.ts";
import assert from "node:assert/strict";
import { aiConsentScope, validateServiceDraft } from "../../../platform/settings/aiCatalog.ts";
import { hooks, jsx, loader, nativePorts, nodes, parts, flush } from "./platformHarness.mts";

const row = (tree: any, title: string) => nodes(tree, n => n.type === "SettingsRow" && n.props.title === title)[0];
const action = (tree: any, title: string) => nodes(tree, n => n.type === "SettingsAction" && n.props.title === title)[0];
const input = (tree: any, label: string) => nodes(tree, n => n.props?.accessibilityLabel === label)[0];
const serviceForm = (tree: any) => nodes(tree, n => typeof n.type === "function" && n.type.name === "AIServiceForm")[0];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const basePorts = (h: ReturnType<typeof hooks>, alerts: any[], menus: any[]) => ({
  react: h.react, "react/jsx-runtime": { jsx, jsxs: jsx },
  "react-native": nativePorts(alerts), "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
  "../theme": { usePalette: () => ({}), font: { serif: "test-serif" } },
  "./SettingsParts": { ...parts, showSettingsChoices: (_title: string, choices: any[]) => menus.push(choices) },
});
function aiHarness(options: { key?: string; isNew?: boolean } = {}) {
  const h = hooks(), alerts: any[] = [], menus: any[] = [], saves: any[] = [], checks: any[] = [], selected: any[] = [], removed: any[] = [], pushed: any[] = [];
  const check = deferred<{ message: string }>(), save = deferred<void>(), select = deferred<void>(), remove = deferred<void>();
  let changed = 0, closed = 0, removalBlocked = false; const prevented: any[] = [];
  const service: any = { id: "ai-1", name: "Original service", provider: "openai", model: "test", baseUrl: "https://api.openai.com", secretId: "saved-key" };
  service.consentScope = aiConsentScope(service);
  const draft: any = { ...service, key: options.key ?? "original-key", windowSize: "", windowAutomatic: true, webSearchEnabled: false };
  for (const [method, key] of Object.entries({ setProvider: "provider", setName: "name", setModel: "model", setBaseUrl: "baseUrl", setKey: "key", setWebSearchEnabled: "webSearchEnabled" }))
    draft[method] = (value: any) => { draft[key] = value; };
  const Editor = loader({
    ...basePorts(h, alerts, menus), "expo-router": { useRouter: () => ({ push: (value: any) => pushed.push(value) }), usePreventRemove: (value: boolean, callback: any) => { removalBlocked = value; prevented.push({value, callback}); return () => { removalBlocked = false; }; } }, "./SettingsEditorLayout": { SettingsEditorLayout: "SettingsEditorLayout" },
    "@shudeng/core/agent": { parseContextWindowTokens, resolveWebSearchPolicy: () => ({ state: { status: "enabled" } }) },
    "./AIServiceDraft": { AI_PRESETS: { deepseek: { name: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-flash" }, openai: { name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1" }, anthropic: { name: "Anthropic", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-5" } }, useAIServiceDraft: () => draft },
    "../../platform/settings/aiCatalog": { aiConsentScope, validateServiceDraft },
    "../../platform/aiConfig": {
      saveAIService: (...args: any[]) => { saves.push(args); return save.promise; },
      selectAIService: (...args: any[]) => { selected.push(args); return select.promise; },
      removeAIService: (...args: any[]) => { removed.push(args); return remove.promise; },
      loadAIServiceForTest: async () => ({ ...service, apiKey: "saved-key" }),
    },
    "../../platform/aiTest": { testAIConnection: (...args: any[]) => { checks.push(args); return check.promise; } },
    "./useAISendingConsent": { useAISendingConsent: () => ({ sendingConsent: null, confirmAISending: async () => true }) },
  })("apps/mobile/src/ui/settings/AIServiceEditor.tsx").AIServiceEditor;
  return { render: () => h.render(() => {
    const tree = Editor({ service: options.isNew ? null : service, selected: false, onChanged: () => changed++, onClose: () => { if (!removalBlocked) closed++; } });
    for (const form of nodes(tree, node => typeof node.type === "function" && node.type.name === "AIServiceForm"))
      form.props = { ...form.props, rendered: form.type(form.props) };
    return tree;
  }),
    alerts, menus, saves, checks, selected, removed, pushed, draft, prevented, check, save, select, remove,
    changed: () => changed, closed: () => closed, unmount: h.unmount };
}
function oldAIControls(h: ReturnType<typeof aiHarness>, tree: any) {
  row(tree, "删除这个服务").props.onPress();
  return () => {
    serviceForm(tree).props.onChoosePreset();
    serviceForm(tree).props.onProviderChange("anthropic");
    input(tree, "API Key").props.onChangeText("late-key");
    input(tree, "允许联网搜索，保存后生效").props.onValueChange(true);
    row(tree, "上下文窗口").props.onPress();
    h.alerts[0][2][1].onPress();
    row(tree, "删除这个服务").props.onPress();
  };
}
test("AI connection checks freeze the draft and stale menus before a state rerender", async () => {
  const h = aiHarness(), tree = h.render(), mutate = oldAIControls(h, tree);
  row(tree, "检查连接").props.onPress();
  mutate();
  action(tree, "保存").props.onPress();
  row(tree, "检查连接").props.onPress();
  await flush();
  assert.equal(h.checks.length, 1);
  assert.equal(h.draft.provider, "openai");
  assert.equal(h.draft.key, "original-key");
  assert.equal(h.draft.webSearchEnabled, false);
  assert.equal(h.saves.length + h.selected.length + h.removed.length + h.pushed.length, 0);
  assert.equal(h.alerts.length, 1);
  const pending = h.render();
  for (const title of ["上下文窗口", "正在检查连接…", "删除这个服务"])
    assert.equal(row(pending, title).props.disabled, true, title);
  assert.equal(input(pending, "自定义模型 ID").props.editable, false);
  h.check.resolve({ message: "原配置连接成功" });
  await flush();
  assert.ok(row(h.render(), "原配置连接成功；尚未保存。"));
  assert.equal(action(h.render(), "保存").props.disabled, false);
  h.unmount();
});
test("AI save/delete each take a same-tick lock and ignore completion after unmount", async () => {
  for (const operation of ["save", "remove"] as const) {
    const h = aiHarness(), tree = h.render(), mutate = oldAIControls(h, tree);
    const start = operation === "save" ? action(tree, "保存").props.onPress
      : h.alerts[0][2][1].onPress;
    start(); start(); mutate(); row(tree, "检查连接").props.onPress();
    await flush();
    assert.equal(h.saves.length, operation === "save" ? 1 : 0);
    assert.equal(h.selected.length, 0);
    assert.equal(h.removed.length, operation === "remove" ? 1 : 0);
    assert.equal(h.checks.length, 0);
    assert.equal(h.draft.key, "original-key");
    h.unmount();
    h[operation].resolve(); await flush();
    assert.equal(h.changed(), 0); assert.equal(h.closed(), 0);
  }
});
test("AI check cancellation and back remain available while draft edits are locked", async () => {
  const h = aiHarness(), tree = h.render();
  row(tree, "检查连接").props.onPress(); await flush();
  const pending = h.render();
  row(pending, "取消检查").props.onPress();
  assert.equal(h.checks[0][1].signal.aborted, true);
  nodes(pending, n => n.type === "SettingsHeader")[0].props.onBack();
  assert.equal(h.closed(), 1);
  h.unmount();
  h.check.resolve({ message: "迟到的成功" }); await flush();
  assert.equal(h.changed(), 0); assert.equal(h.alerts.length, 0);
});
test("failed AI checks release the lock for editing and saving", async () => {
  const h = aiHarness(), tree = h.render();
  row(tree, "检查连接").props.onPress(); await flush();
  h.check.reject(new Error("检查失败")); await flush();
  const failed = h.render();
  assert.equal(action(failed, "保存").props.disabled, false);
  assert.ok(row(failed, "检查失败"));
  input(failed, "API Key").props.onChangeText("new-key");
  action(h.render(), "保存").props.onPress(); await flush();
  assert.equal(h.saves.length, 1); assert.equal(h.saves[0][1], "new-key");
  h.save.resolve(); await flush();
  assert.equal(h.changed(), 1); assert.equal(h.closed(), 1);
  h.unmount();
});
test("AI back invalidates pending save/delete before the navigation transition unmounts", async () => {
  for (const operation of ["save", "remove"] as const) {
    const h = aiHarness(), tree = h.render();
    if (operation === "save") action(tree, "保存").props.onPress();
    else { row(tree, "删除这个服务").props.onPress(); h.alerts[0][2][1].onPress(); }
    await flush();
    const back = nodes(tree, n => n.type === "SettingsHeader")[0].props.onBack;
    back(); back();
    h[operation].resolve(); await flush();
    action(tree, "保存").props.onPress();
    assert.equal(h.closed(), 1); assert.equal(h.changed(), 0);
    assert.equal(h.saves.length, operation === "save" ? 1 : 0);
    h.unmount();
  }
});

test("AI exact context tokens reach persistence, while invalid manual values never save", async () => {
  for (const [text, expected] of [["1M", 1000000], ["1047576", 1047576], ["1.001M", 1001000]] as const) {
    const h = aiHarness(); h.render(); h.draft.windowAutomatic = false; h.draft.windowSize = text;
    action(h.render(), "保存").props.onPress(); await flush();
    assert.equal(h.saves.length, 1); assert.equal(h.saves[0][0].contextWindowTokens, expected);
    h.save.resolve(); await flush(); h.unmount();
  }
  for (const text of ["", "0", "-1", "NaN"]) {
    const h = aiHarness(); h.render(); h.draft.windowAutomatic = false; h.draft.windowSize = text;
    action(h.render(), "保存").props.onPress(); await flush();
    assert.equal(h.saves.length, 0); assert.equal(h.alerts.at(-1)[0], "操作未完成"); h.unmount();
  }
});
test("AI dirty close offers continue and discard while retaining the draft", async () => {
  const h = aiHarness(); h.render(); h.draft.name = "Edited service";
  let tree = h.render(); nodes(tree, n => n.type === "SettingsHeader")[0].props.onBack();
  assert.equal(h.closed(), 0); assert.equal(h.alerts[0][0], "保存修改？");
  h.alerts[0][2][0].onPress(); assert.equal(h.draft.name, "Edited service");
  nodes(h.render(), n => n.type === "SettingsHeader")[0].props.onBack();
  h.alerts[1][2][1].onPress(); assert.equal(h.closed(), 1); assert.equal(h.saves.length, 0); h.unmount();
});
test("AI successful save disables dirty route prevention before dismissing", async () => {
  const h = aiHarness(); h.render(); h.draft.name = "Changed service";
  const tree = h.render(); assert.equal(h.prevented.at(-1).value, true);
  action(tree, "保存").props.onPress(); await flush(); h.save.resolve(); await flush();
  assert.equal(h.changed(), 1); assert.equal(h.closed(), 1);
  h.render(); assert.equal(h.prevented.at(-1).value, false); h.unmount();
});
test("AI system dismissal resumes the blocked action after discard", () => {
  const h = aiHarness(); h.render(); h.draft.name = "Changed service"; h.render();
  let repeated = 0;
  h.prevented.at(-1).callback({ data: { action: { type: "POP" } }, repeat: () => repeated++ });
  assert.equal(repeated, 0);
  h.alerts.at(-1)[2][1].onPress(); assert.equal(repeated, 1);
  h.render(); assert.equal(h.prevented.at(-1).value, false); h.unmount();
});

test("AI saved credentials stay hidden until replacement and cancelling replacement retains the saved key", async () => {
  const h = aiHarness({ key: "" });
  let tree = h.render();
  assert.equal(input(tree, "API Key"), undefined);
  assert.equal(row(tree, "API Key").props.detail, "已保存 · 更换");
  assert.equal(row(tree, "尚未检查连接。"), undefined);
  row(tree, "API Key").props.onPress();
  tree = h.render();
  input(tree, "API Key").props.onChangeText("replacement-key");
  assert.equal(h.draft.key, "replacement-key");
  row(h.render(), "取消更换密钥").props.onPress();
  tree = h.render();
  assert.equal(h.draft.key, "");
  assert.equal(input(tree, "API Key"), undefined);
  action(tree, "保存").props.onPress(); await flush();
  assert.equal(h.saves.length, 1);
  assert.equal(h.saves[0][1], "");
  h.save.resolve(); await flush(); h.unmount();
});

test("AI choosing a preset protects edited new fields until replacement is confirmed", () => {
    const h = aiHarness({ isNew: true });
    h.render();
    h.draft.name = "Custom reading model";
    h.draft.baseUrl = "https://reader.example/v1";
    h.draft.model = "reading-1";
    const before = { provider: h.draft.provider, name: h.draft.name, baseUrl: h.draft.baseUrl, model: h.draft.model, key: h.draft.key };
    row(h.render(), "使用预设").props.onPress();
    h.menus.at(-1)[0].onPress();
    assert.equal(h.alerts.length, 1);
    assert.deepEqual({ provider: h.draft.provider, name: h.draft.name, baseUrl: h.draft.baseUrl, model: h.draft.model, key: h.draft.key }, before);
    h.alerts.at(-1)[2].find((button: any) => button.style === "cancel").onPress?.();
    assert.deepEqual({ provider: h.draft.provider, name: h.draft.name, baseUrl: h.draft.baseUrl, model: h.draft.model, key: h.draft.key }, before);
    h.unmount();
});

test("AI confirmed preset replacement never reuses saved credentials for another service", async () => {
  for (const operation of ["保存", "检查连接"]) {
    const h = aiHarness({ isNew: true, key: "" });
    h.render();
    h.draft.name = "Custom reading service";
    row(h.render(), "使用预设").props.onPress();
    h.menus.at(-1)[0].onPress();
    h.alerts.at(-1)[2].find((button: any) => button.style !== "cancel").onPress();
    let tree = h.render();
    assert.equal(h.draft.provider, "deepseek");
    assert.equal(h.draft.baseUrl, "https://api.deepseek.com");
    assert.equal(h.draft.model, "deepseek-flash");
    assert.equal(h.draft.key, "");
    assert.ok(input(tree, "API Key"));
    (operation === "保存" ? action(tree, operation) : row(tree, operation)).props.onPress(); await flush();
    assert.equal(h.saves.length, 0, operation);
    assert.equal(h.checks.length, 0, operation);
    tree = h.render();
    input(tree, "API Key").props.onChangeText("new-service-key");
    action(h.render(), "保存").props.onPress(); await flush();
    assert.equal(h.saves.length, 1);
    assert.equal(h.saves[0][1], "new-service-key");
    h.save.resolve(); await flush(); h.unmount();
  }
});

test("AI custom preset preserves entered fields and a pristine new service can accept defaults", () => {
  const custom = aiHarness({ isNew: true });
  const tree = custom.render();
  const before = { name: custom.draft.name, model: custom.draft.model, baseUrl: custom.draft.baseUrl, key: custom.draft.key };
  row(tree, "使用预设").props.onPress();
  custom.menus.at(-1).find((choice: any) => choice.title === "自定义").onPress();
  assert.equal(custom.alerts.length, 0);
  assert.deepEqual({ name: custom.draft.name, model: custom.draft.model, baseUrl: custom.draft.baseUrl, key: custom.draft.key }, before);
  custom.unmount();
  const fresh = aiHarness({ isNew: true, key: "" });
  row(fresh.render(), "使用预设").props.onPress();
  fresh.menus.at(-1)[0].onPress();
  assert.equal(fresh.alerts.length, 0);
  assert.equal(fresh.draft.provider, "deepseek");
  assert.equal(fresh.draft.name, "DeepSeek");
  assert.equal(fresh.draft.model, "deepseek-flash");
  fresh.unmount();
});

test("AI saved services expose no protocol switch and ignore retained creation callbacks", () => {
  const h = aiHarness({ key: "" });
  const tree = h.render();
  const form = serviceForm(tree);
  const before = { provider: h.draft.provider, name: h.draft.name, model: h.draft.model, baseUrl: h.draft.baseUrl, key: h.draft.key };
  assert.equal(row(tree, "使用预设"), undefined);
  assert.equal(row(tree, "接口格式"), undefined);
  form.props.onChoosePreset();
  form.props.onProviderChange("anthropic");
  assert.deepEqual({ provider: h.draft.provider, name: h.draft.name, model: h.draft.model, baseUrl: h.draft.baseUrl, key: h.draft.key }, before);
  assert.deepEqual(h.menus, []);
  assert.deepEqual(h.alerts, []);
  h.unmount();
});

test("AI saved services retain their original protocol in persistence and connection requests", async () => {
  for (const operation of ["save", "check"] as const) {
    const h = aiHarness();
    h.render();
    h.draft.provider = "anthropic";
    const tree = h.render();
    if (operation === "save") action(tree, "保存").props.onPress();
    else row(tree, "检查连接").props.onPress();
    await flush();
    const calls = operation === "save" ? h.saves : h.checks;
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0].provider, "openai");
    if (operation === "save") h.save.resolve();
    else h.check.resolve({ message: "连接成功" });
    await flush();
    h.unmount();
  }
});

test("AI new services choose a custom protocol before the first save", async () => {
  const h = aiHarness({ isNew: true });
  const tree = h.render();
  const before = { name: h.draft.name, model: h.draft.model, baseUrl: h.draft.baseUrl, key: h.draft.key };
  row(tree, "使用预设").props.onPress();
  h.menus.at(-1).find((choice: any) => choice.title === "自定义").onPress();
  serviceForm(h.render()).props.onProviderChange("anthropic");
  assert.equal(h.draft.provider, "anthropic");
  assert.deepEqual({ name: h.draft.name, model: h.draft.model, baseUrl: h.draft.baseUrl, key: h.draft.key }, before);
  action(h.render(), "保存").props.onPress();
  await flush();
  assert.equal(h.saves.length, 1);
  assert.equal(h.saves[0][0].provider, "anthropic");
  h.save.resolve(); await flush(); h.unmount();
});

test("AI new-service checks block retained preset and protocol changes before rerender", async () => {
  const h = aiHarness({ isNew: true });
  row(h.render(), "使用预设").props.onPress();
  h.menus.at(-1).find((choice: any) => choice.title === "自定义").onPress();
  const tree = h.render();
  const form = serviceForm(tree);
  row(tree, "使用预设").props.onPress();
  const preset = h.menus.at(-1)[0];
  row(tree, "检查连接").props.onPress();
  preset.onPress();
  form.props.onProviderChange("anthropic");
  input(tree, "服务名称").props.onChangeText("late-name");
  await flush();
  assert.equal(h.checks.length, 1);
  assert.equal(h.draft.provider, "openai");
  assert.equal(h.draft.name, "Original service");
  assert.equal(h.alerts.length, 0);
  h.check.resolve({ message: "连接成功" });
  await flush(); h.unmount();
});

function mcpHarness() {
  const h = hooks(), alerts: any[] = [], menus: any[] = [], saves: any[] = [], discoveries: any[] = [], removed: any[] = [];
  const save = deferred<any>(), discovery = deferred<any>(), remove = deferred<void>();
  let holdSaves = false, changed = 0, closed = 0;
  const initial: any = { id: "mcp-1", name: "Original tools", endpoint: "https://tools.example/mcp", transport: "http", enabled: true, headers: {}, tools: [{ name: "lookup", inputSchema: {}, readOnly: true }], allowedTools: [] };
  const Editor = loader({
    ...basePorts(h, alerts, menus),
    "../../platform/mcp": {
      saveMCPServer: (value: any) => { saves.push(value); return holdSaves ? save.promise : Promise.resolve(value); },
      discoverMCPTools: (...args: any[]) => { discoveries.push(args); return discovery.promise; },
      removeMCPServer: (...args: any[]) => { removed.push(args); return remove.promise; },
    },
  })("apps/mobile/src/ui/settings/MCPServerEditor.tsx").MCPServerEditor;
  return { render: () => h.render(() => Editor({ initial, isNew: false, onChanged: () => changed++, onClose: () => closed++ })),
    alerts, menus, saves, discoveries, removed, save, discovery, remove, initial, hold: () => { holdSaves = true; },
    changed: () => changed, closed: () => closed, unmount: h.unmount };
}
function oldMCPControls(h: ReturnType<typeof mcpHarness>, tree: any) {
  row(tree, "传输方式").props.onPress(); row(tree, "删除这个外部工具").props.onPress();
  return () => {
    h.menus[0][1].onPress();
    input(tree, "外部工具名称").props.onChangeText("late-name");
    input(tree, "外部工具地址").props.onChangeText("https://other.example/mcp");
    input(tree, "请求 Header").props.onChangeText("x-late: true");
    input(tree, "启用外部工具").props.onValueChange(false);
    input(tree, "允许 lookup").props.onValueChange(true);
    h.alerts[0][2][1].onPress();
    row(tree, "删除这个外部工具").props.onPress();
  };
}
test("MCP connection commits refresh their owner even when discovery later fails", async () => {
  const h = mcpHarness();
  let tree = h.render();
  input(tree, "外部工具地址").props.onChangeText("https://new.example/mcp");
  tree = h.render();
  row(tree, "读取可用工具").props.onPress();
  await flush();
  h.discovery.reject(new Error("读取工具失败"));
  await flush();
  tree = h.render();
  assert.equal(h.saves[0].endpoint, "https://new.example/mcp");
  assert.equal(h.changed(), 1, "the owner must show the connection that already committed");
  assert.ok(nodes(tree, n => n.type === "Text" && n.props.children === "读取工具失败").length);
  nodes(tree, n => n.type === "SettingsHeader")[0].props.onBack();
  assert.equal(h.closed(), 1);
  h.unmount();
});
test("MCP accepted connection writes refresh their owner after the editor closes", async () => {
  const h = mcpHarness();
  h.hold();
  const tree = h.render();
  row(tree, "读取可用工具").props.onPress();
  nodes(tree, n => n.type === "SettingsHeader")[0].props.onBack();
  h.unmount();
  h.save.resolve(h.initial);
  await flush();
  assert.equal(h.changed(), 1, "closing does not cancel an accepted connection commit");
  assert.equal(h.discoveries.length, 0, "closed editors must not start network discovery");
  assert.equal(h.closed(), 1);
});
test("MCP discovery freezes transport, fields and permissions including retained menu callbacks", async () => {
  const h = mcpHarness(), tree = h.render(), mutate = oldMCPControls(h, tree);
  row(tree, "读取可用工具").props.onPress(); mutate();
  action(tree, "保存").props.onPress(); row(tree, "读取可用工具").props.onPress();
  await flush();
  assert.equal(h.saves.length, 1); assert.equal(h.discoveries.length, 1); assert.equal(h.removed.length, 0);
  const pending = h.render();
  assert.equal(input(pending, "外部工具名称").props.value, h.initial.name);
  assert.equal(input(pending, "外部工具地址").props.value, h.initial.endpoint);
  assert.equal(input(pending, "请求 Header").props.value, "");
  assert.equal(input(pending, "启用外部工具").props.value, true);
  assert.equal(row(pending, "传输方式").props.detail, "HTTP");
  for (const title of ["传输方式", "正在读取工具…", "删除这个外部工具"]) assert.equal(row(pending, title).props.disabled, true, title);
  row(pending, "取消连接").props.onPress();
  assert.equal(h.discoveries[0][1].aborted, true);
  h.discovery.resolve(h.initial.tools); await flush();
  assert.equal(h.saves.length, 1, "cancelled discovery must not persist late tool results");
  assert.equal(h.changed(), 1, "the saved connection still refreshes its owner");
  h.unmount();
});
test("MCP save/tool-toggle/delete notify committed changes without closing again after unmount", async () => {
  for (const operation of ["save", "toggle", "remove"] as const) {
    const h = mcpHarness(), tree = h.render(), mutate = oldMCPControls(h, tree);
    h.hold();
    const start = operation === "save" ? action(tree, "保存").props.onPress
      : operation === "toggle" ? () => input(tree, "允许 lookup").props.onValueChange(true) : h.alerts[0][2][1].onPress;
    start(); start(); mutate(); row(tree, "读取可用工具").props.onPress(); await flush();
    assert.equal(h.saves.length, operation === "remove" ? 0 : 1);
    assert.equal(h.removed.length, operation === "remove" ? 1 : 0);
    assert.equal(h.discoveries.length, 0);
    assert.equal(input(h.render(), "外部工具名称").props.value, h.initial.name);
    h.unmount();
    if (operation === "remove") h.remove.resolve(); else h.save.resolve(h.initial);
    await flush(); assert.equal(h.changed(), 1); assert.equal(h.closed(), 0);
  }
});
test("failed MCP saves release the lock and back aborts a pending discovery", async () => {
  const h = mcpHarness(), tree = h.render();
  h.hold(); action(tree, "保存").props.onPress();
  h.save.reject(new Error("保存失败")); await flush();
  const failed = h.render();
  assert.equal(action(failed, "保存").props.disabled, false);
  input(failed, "外部工具名称").props.onChangeText("Retry name");
  const editable = h.render();
  assert.equal(input(editable, "外部工具名称").props.value, "Retry name");
  row(editable, "删除这个外部工具").props.onPress();
  h.alerts[0][2][1].onPress(); await flush();
  assert.equal(h.removed.length, 1);
  h.remove.resolve(); await flush();
  assert.equal(h.changed(), 1); assert.equal(h.closed(), 1);
  h.unmount();

  const discovery = mcpHarness();
  row(discovery.render(), "读取可用工具").props.onPress(); await flush();
  const pending = discovery.render();
  nodes(pending, n => n.type === "SettingsHeader")[0].props.onBack();
  assert.equal(discovery.closed(), 1);
  assert.equal(discovery.discoveries[0][1].aborted, true);
  discovery.discovery.resolve(discovery.initial.tools); await flush();
  assert.equal(discovery.saves.length, 1); assert.equal(discovery.changed(), 1);
  discovery.unmount();
});
test("MCP back rejects new writes while accepted commits refresh the owner", async () => {
  for (const operation of ["save", "toggle", "remove"] as const) {
    const h = mcpHarness(), tree = h.render(); h.hold();
    if (operation === "save") action(tree, "保存").props.onPress();
    else if (operation === "toggle") input(tree, "允许 lookup").props.onValueChange(true);
    else { row(tree, "删除这个外部工具").props.onPress(); h.alerts[0][2][1].onPress(); }
    const back = nodes(tree, n => n.type === "SettingsHeader")[0].props.onBack;
    back(); back();
    if (operation === "remove") h.remove.resolve(); else h.save.resolve(h.initial);
    await flush();
    action(tree, "保存").props.onPress();
    assert.equal(h.closed(), 1); assert.equal(h.changed(), 1);
    assert.equal(h.saves.length, operation === "remove" ? 0 : 1);
    h.unmount();
  }
});
test("MCP result commit is not cancellable and its saved tools and revision reach the editor", async () => {
  const h = mcpHarness();
  row(h.render(), "读取可用工具").props.onPress(); await flush();
  const cancel = row(h.render(), "取消连接").props.onPress;
  h.hold();
  h.discovery.resolve([{ name: "new-tool", inputSchema: {}, readOnly: true }]); await flush();
  assert.equal(h.saves.length, 2);
  const committing = h.render();
  assert.equal(row(committing, "取消连接"), undefined);
  assert.ok(row(committing, "正在保存工具…"));
  cancel();
  assert.equal(h.discoveries[0][1].aborted, false);
  const saved = { ...h.saves[1], authorizationRevision: 7 };
  h.save.resolve(saved); await flush();
  const complete = h.render();
  assert.ok(row(complete, "new-tool"));
  assert.equal(h.changed(), 2, "connection and tool commits both refresh the owner");
  assert.equal(nodes(complete, n => n.type === "Text" && n.props.children === "连接已取消。").length, 0);
  action(complete, "保存").props.onPress(); await flush();
  assert.equal(h.saves[2].authorizationRevision, 7);
  h.unmount();
});
test("MCP connection commit retains its saved revision before cancellation becomes available", async () => {
  const h = mcpHarness(); h.initial.authorizationRevision = 6; h.hold();
  let tree = h.render();
  input(tree, "外部工具地址").props.onChangeText("https://new.example/mcp");
  tree = h.render();
  row(tree, "读取可用工具").props.onPress();
  const committing = h.render();
  assert.ok(row(committing, "正在保存连接…"));
  assert.equal(row(committing, "取消连接"), undefined);
  assert.equal(h.discoveries.length, 0);
  h.save.resolve({ ...h.saves[0], authorizationRevision: 7 }); await flush();
  const connecting = h.render();
  assert.equal(h.discoveries[0][0].authorizationRevision, 7);
  row(connecting, "取消连接").props.onPress();
  h.discovery.resolve([]); await flush();
  action(h.render(), "保存").props.onPress(); await flush();
  assert.equal(h.saves[1].authorizationRevision, 7);
  assert.equal(h.saves[1].endpoint, "https://new.example/mcp");
  h.unmount();
});
test("SettingsRow disables native interaction and accessibility without making display rows buttons", () => {
  const h = hooks();
  const Row = loader({ ...basePorts(h, [], []), "expo-symbols": { SymbolView: "SymbolView" } })("apps/mobile/src/ui/settings/SettingsParts.tsx").SettingsRow;
  const disabled = h.render(() => Row({ title: "连接", onPress() {}, disabled: true }));
  assert.equal(disabled.type, "Pressable"); assert.equal(disabled.props.disabled, true);
  assert.deepEqual(disabled.props.accessibilityState, { selected: false, disabled: true });
  const display = h.render(() => Row({ title: "模型", disabled: true }));
  assert.equal(display.type, "View"); assert.equal(display.props.onPress, undefined);
  h.unmount();
});
