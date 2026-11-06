import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { aiConsentScope, validateServiceDraft } from "../../platform/settings/aiCatalog.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const settingsDirectory = new URL("./", import.meta.url);
const local = { id: "local-only", secretId: "fake-ref", name: "本机服务", provider: "openai" as const,
  baseUrl: "http://127.0.0.1:8765/private/v1", model: "fake-model" };
const jsx = (type: unknown, props: any, key?: unknown) => ({ type, props, key });

/** Runs real hooks/consumers with modeled React state and platform I/O. It does not
 * claim native Modal timing, which the shared BookNotice owns and tests separately. */
function harness(kind: "hook" | "editor" | "list", saved: any = null) {
  let cursor = 0, active = true;
  const slots: any[] = [], effects: (() => void)[] = [];
  const same = (a: any[], b: any[]) => a?.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react: any = {
    useState(value: any) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof value === "function" ? value() : value };
      return [slots[index].value, (next: any) => { slots[index].value = typeof next === "function" ? next(slots[index].value) : next; }];
    },
    useRef(value: any) { const index = cursor++; return slots[index] ?? (slots[index] = { current: value }); },
    useMemo(fn: any, deps: any[]) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: fn(), deps };
      return slots[index].value;
    },
    useCallback(fn: any, deps: any[]) { return react.useMemo(() => fn, deps); },
    useEffect(fn: any, deps: any[]) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) {
        const previous = slots[index];
        const slot = { deps, cleanup: undefined as any, setup: fn };
        slots[index] = slot;
        effects.push(() => { previous?.cleanup?.(); slot.cleanup = fn(); });
      }
    },
  };
  const calls = { save: [] as any[], select: [] as any[], alerts: [] as any[], changed: 0, closed: 0, choices: [] as any[] };
  const native = new Proxy({
    StyleSheet: { create: (value: any) => value, hairlineWidth: 1 }, Platform: { OS: "ios" },
    Alert: { alert: (...args: any[]) => calls.alerts.push(args) },
  }, { get(target: any, key) { return target[key] ?? String(key); } });
  const draft = { ...local, provider: local.provider, windowSize: "", key: "fake-only-key", setKey() {}, webSearchEnabled: false, setWebSearchEnabled() {} };
  const imports: Record<string, any> = {
    "react": react, "react/jsx-runtime": { jsx, jsxs: jsx }, "react-native": native,
    "expo-router": { useRouter: () => ({ push() {} }), useFocusEffect: (fn: any) => react.useEffect(fn, [fn]) },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" }, "expo-symbols": { SymbolView: "SymbolView" },
    "../components/BookNotice": { BookNotice: "BookNotice" }, "../theme": { usePalette: () => ({ paper: "paper" }) },
    "./AIServiceDraft": { AI_PRESETS: {}, useAIServiceDraft: () => draft },
    "@shudeng/core/agent": { resolveWebSearchPolicy: () => ({ state: { status: "unsupported" } }) },
    "../../platform/settings/aiCatalog": { aiConsentScope, validateServiceDraft },
    "../../platform/aiConfig": {
      saveAIService: async (...args: any[]) => calls.save.push(args),
      selectAIService: async (...args: any[]) => calls.select.push(args),
      loadAIServiceCatalog: async () => ({ version: 2, selectedId: null, services: [saved ?? local] }),
      loadAIServiceForTest: () => { throw new Error("No key reads allowed"); },
    },
    "../../platform/aiTest": { testAIConnection: () => { throw new Error("No network allowed"); } },
    "../../platform/mcp": { loadMCPServers: async () => [] },
    "../../platform/semanticModel": { getSemanticModelState: async () => ({ installed: false }) },
    "../../platform/settings/semanticPreparation": { observeSemanticPreparation: () => () => {} },
    "./SettingsParts": {
      SettingsAction: "SettingsAction", SettingsHeader: "SettingsHeader", SettingsRow: "SettingsRow", SettingsSection: "SettingsSection",
      showSettingsChoices: (_title: string, choices: any[]) => { calls.choices = choices; },
    },
  };
  function load(name: string) {
    const file = fileURLToPath(new URL(name, settingsDirectory));
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const compiled: any = new Module(file); compiled.filename = file;
    compiled.require = (id: string) => {
      if (id in imports) return imports[id];
      throw new Error("Unexpected dependency: " + id);
    };
    compiled._compile(code, file); return compiled.exports;
  }
  const hook = load("useAISendingConsent.tsx");
  imports["./useAISendingConsent"] = hook;
  const screen = kind === "editor" ? load("AIServiceEditor.tsx").AIServiceEditor
    : kind === "list" ? load("AISettingsScreen.tsx").AISettingsScreen : hook.useAISendingConsent;
  let result: any;
  const render = () => {
    assert.ok(active);
    cursor = 0;
    result = screen(kind === "editor" ? { service: saved, selected: false, onChanged: () => calls.changed++, onClose: () => calls.closed++ }
      : { onBack() {}, onEditService() {}, onMCPSettings() {}, onSendingDetails() {} });
    while (effects.length) effects.shift()!();
    return result;
  };
  const unmount = () => { active = false; slots.forEach(slot => slot?.cleanup?.()); };
  const restart = () => { slots.forEach(slot => { if (slot?.setup) { slot.cleanup?.(); slot.cleanup = slot.setup(); } }); render(); };
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); render(); };
  render();
  return { calls, render, flush, unmount, restart, get result() { return result; }, notice: () => kind === "hook" ? result.sendingConsent : find(result, node => node.type === "BookNotice") };
}
function find(node: any, predicate: (node: any) => boolean): any {
  if (!node) return null;
  if (Array.isArray(node)) return node.map(item => find(item, predicate)).find(Boolean);
  if (typeof node !== "object") return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node.props ?? {})) {
    const found = find(value, predicate); if (found) return found;
  }
  return null;
}

test("consent uses the native paper-card title/message and save action resolves once", async () => {
  const h = harness("hook");
  let results = 0;
  const pending = h.result.confirmAISending(local, "同意并保存").then((value: boolean) => { results++; return value; });
  h.render();
  const card = h.notice();
  assert.equal(card.type, "BookNotice");
  assert.equal(card.props.title, "AI 服务发送说明");
  assert.equal(card.props.message, "问题、相关原文和必要对话将发送到“本机服务”（127.0.0.1），可能产生服务费用。");
  assert.deepEqual(card.props.actions.map((action: any) => [action.title, action.style]), [["取消", "cancel"], ["同意并保存", undefined]]);
  assert.equal(await h.result.confirmAISending(local, "重复请求"), false);
  card.props.actions[1].onPress(); card.props.actions[1].onPress(); card.props.actions[0].onPress();
  assert.equal(await pending, true); assert.equal(results, 1);
  h.render(); assert.equal(h.notice(), null); assert.deepEqual(h.calls.alerts, []);
});

test("cancel and unmount settle false and stale card callbacks cannot settle a newer request", async () => {
  const h = harness("hook");
  const first = h.result.confirmAISending(local, "同意并使用已保存服务"); h.render();
  const old = h.notice(); old.props.actions[0].onPress(); assert.equal(await first, false);
  const second = h.result.confirmAISending(local, "同意并保存"); h.render();
  const current = h.notice(); old.props.actions[1].onPress();
  assert.equal(h.notice(), current);
  h.unmount(); assert.equal(await second, false);
  current.props.actions[1].onPress();
  assert.equal(await h.result.confirmAISending(local, "卸载后请求"), false);
});

test("effect cleanup/setup cancels the old lease without reviving its consent", async () => {
  const h = harness("hook");
  const oldPending = h.result.confirmAISending(local, "同意并保存"); h.render();
  const old = h.notice(); h.restart(); assert.equal(await oldPending, false); assert.equal(h.notice(), null);
  const fresh = h.result.confirmAISending(local, "同意并保存"); h.render();
  old.props.actions[1].onPress(); h.notice().props.actions[0].onPress(); assert.equal(await fresh, false);
});

test("the real editor saves only after consent and never saves a cancelled or abandoned request", async () => {
  for (const result of ["allow", "cancel", "unmount"]) {
    const h = harness("editor");
    const save = find(h.result, node => node.type === "SettingsAction" && node.props.title === "保存");
    save.props.onPress(); h.render(); assert.equal(h.calls.save.length, 0);
    const card = h.notice(); assert.ok(card);
    if (result === "unmount") h.unmount();
    else { card.props.actions[result === "allow" ? 1 : 0].onPress(); await h.flush(); }
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.equal(h.calls.save.length, result === "allow" ? 1 : 0);
    assert.equal(h.calls.closed, result === "allow" ? 1 : 0);
    assert.deepEqual(h.calls.alerts, []);
  }
});

test("the real editor and list switch saved revisions only after consent; unmount cancels both", async () => {
  for (const kind of ["editor", "list"] as const) for (const result of ["allow", "cancel", "unmount"]) {
    const h = harness(kind, local); await h.flush();
    if (kind === "editor") find(h.result, node => node.type === "SettingsRow" && node.props.title === "使用这个服务").props.onPress();
    else {
      find(h.result, node => node.type === "SettingsAction" && node.props.title === "切换").props.onPress();
      h.calls.choices[0].onPress();
    }
    h.render(); const card = h.notice(); assert.ok(card); assert.equal(h.calls.select.length, 0);
    if (result === "unmount") h.unmount();
    else { card.props.actions[result === "allow" ? 1 : 0].onPress(); await h.flush(); }
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.deepEqual(h.calls.select, result === "allow" ? [[local.id, true]] : []);
    assert.deepEqual(h.calls.alerts, []);
  }
});
