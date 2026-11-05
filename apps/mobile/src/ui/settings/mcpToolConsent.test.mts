import assert from "node:assert/strict";
import { test } from "node:test";
import { hooks, loader, jsx, nativePorts, flush } from "./__tests__/platformHarness.mts";

const tool = { name: "lookup", title: "查找标题", description: "Fake read-only tool", inputSchema: { type: "object" }, readOnly: true };
const server = { id: "mcp-audit", name: "本机工具", endpoint: "http://127.0.0.1:8765/mcp", transport: "http", enabled: true,
  headers: { authorization: "Bearer fake-only-header" }, tools: [tool], allowedTools: [tool.name], authorizationRevision: 1 };
const storageKey = "shudeng.mcp-servers.v1";

function fixture() {
  const h = hooks(), alerts: any[] = [], requests: any[] = [], writes: string[] = [];
  const entries = new Map([[storageKey, JSON.stringify([server])]]);
  const load = loader({
    react: h.react, "react/jsx-runtime": { jsx, jsxs: jsx }, "react-native": nativePorts(alerts),
    "../components/BookNotice": { BookNotice: "BookNotice" },
    "expo-secure-store": { WHEN_UNLOCKED_THIS_DEVICE_ONLY: "fake-only", getItemAsync: async (key: string) => entries.get(key) ?? null, setItemAsync: async (key: string, value: string) => { writes.push(key); entries.set(key, value); } },
    "expo/fetch": { async fetch(url: string, options: any) {
      const body = options.body ? JSON.parse(options.body) : null;
      requests.push({ url, method: options.method, body });
      if (body?.method === "notifications/initialized" || options.method === "DELETE") return new Response(null, { status: 202 });
      const result = body?.method === "initialize" ? { protocolVersion: "2025-03-26" } : { content: [{ type: "text", text: "fake-only-tool-result" }] };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "fake-only-session" } });
    } },
    "@shudeng/core": { createLocalId() { throw new Error("No save/create in a consent test"); } },
  });
  const api = load("apps/mobile/src/platform/mcp.ts");
  const bridge = load("apps/mobile/src/platform/settings/mcpToolConsent.ts");
  const Host = load("apps/mobile/src/ui/settings/MCPToolConsentHost.tsx").MCPToolConsentHost;
  const render = (options?: { active?: boolean; scope?: "fallback" | "screen"; depth?: number }) => h.render(() => Host(options));
  return { api, bridge, render, requests, writes, alerts, entries, unmount: h.unmount, restart: h.restart };
}
test("no tool-consent host fails closed before initialization or any storage write", async () => {
  const f = fixture();
  const tools = await f.api.loadMCPAgentTools();
  await assert.rejects(tools[0].invoke({ title: "never-send-this-argument" }), /取消/);
  assert.deepEqual(f.requests, []); assert.deepEqual(f.writes, []); assert.deepEqual(f.alerts, []);
});
test("first tool consent uses exact native paper text/actions and only allows the pending call once", async () => {
  const f = fixture(); f.render();
  const tools = await f.api.loadMCPAgentTools();
  const pending = tools[0].invoke({ title: "only-explicitly-approved-arguments" });
  await flush(); const card = f.render();
  assert.equal(card.type, "BookNotice"); assert.equal(card.props.title, "调用外部工具？");
  assert.equal(card.props.message, "「查找标题」由外部服务「本机工具」提供。将只发送本次工具参数，不会发送书库或 AI 密钥。");
  assert.ok(!JSON.stringify(card).includes("fake-only-header"));
  assert.ok(!JSON.stringify(card).includes("only-explicitly-approved-arguments"));
  assert.deepEqual(card.props.actions.map((action: any) => [action.title, action.style]), [["允许一次", undefined], ["取消", "cancel"]]);
  assert.deepEqual(f.requests, []);
  card.props.actions[0].onPress(); card.props.actions[0].onPress(); card.props.actions[1].onPress();
  assert.match(await pending, /fake-only-tool-result/);
  assert.equal(f.requests.filter(row => row.body?.method === "tools/call").length, 1);
  assert.deepEqual(f.requests.find(row => row.body?.method === "tools/call").body.params, { name: tool.name, arguments: { title: "only-explicitly-approved-arguments" } });
  assert.deepEqual(f.writes, []); assert.deepEqual(f.alerts, []); assert.equal(f.render(), null);
  f.unmount();
});
test("cancel, Abort and host unmount never initialize or call a tool; old actions stay inert", async () => {
  for (const outcome of ["cancel", "abort", "unmount"] as const) {
    const f = fixture(); f.render();
    const tools = await f.api.loadMCPAgentTools(); const abort = new AbortController();
    const pending = tools[0].invoke({ title: "forbidden" }, abort.signal); const rejected = assert.rejects(pending, /取消/);
    await flush(); const old = f.render(); assert.ok(old);
    if (outcome === "cancel") old.props.actions[1].onPress();
    else if (outcome === "abort") abort.abort(); else f.unmount();
    old.props.actions[0].onPress(); await rejected;
    assert.deepEqual(f.requests, []); assert.deepEqual(f.writes, []); assert.deepEqual(f.alerts, []);
    if (outcome !== "unmount") {
      const fresh = f.bridge.requestMCPToolConsent({ title: "fresh", message: "second-prompt" });
      const current = f.render(); old.props.actions[0].onPress();
      assert.equal(f.render().props.title, current.props.title); current.props.actions[1].onPress(); assert.equal(await fresh, false);
    }
    f.unmount();
    assert.equal(await f.bridge.requestMCPToolConsent({ title: "no-host", message: "deny" }), false);
  }
});
test("effect cleanup/setup denies the old request and cannot revive it on a new host lease", async () => {
  const f = fixture(); f.render();
  const first = f.bridge.requestMCPToolConsent({ title: "old", message: "old" }); const old = f.render();
  f.restart(); assert.equal(await first, false); assert.equal(f.render(), null);
  const next = f.bridge.requestMCPToolConsent({ title: "next", message: "next" }); const current = f.render();
  old.props.actions[0].onPress(); current.props.actions[1].onPress(); assert.equal(await next, false);
  f.unmount();
});
test("already-aborted and duplicate requests never replace a visible pending consent", async () => {
  const f = fixture(); f.render(); const abort = new AbortController(); abort.abort();
  assert.equal(await f.bridge.requestMCPToolConsent({ title: "aborted", message: "aborted" }, abort.signal), false);
  const pending = f.bridge.requestMCPToolConsent({ title: "one", message: "one" }); const current = f.render();
  assert.equal(await f.bridge.requestMCPToolConsent({ title: "two", message: "two" }), false);
  assert.equal(f.render().props.title, current.props.title); current.props.actions[1].onPress(); assert.equal(await pending, false);
  f.unmount();
});

test("a retained route rejects its pending card on blur and can present a fresh request on return", async () => {
  const f = fixture(); f.render({ active: true, scope: "screen", depth: 1 });
  const first = f.bridge.requestMCPToolConsent({ title: "before-blur", message: "public fixture" });
  const stale = f.render({ active: true, scope: "screen", depth: 1 });
  assert.equal(f.render({ active: false, scope: "screen", depth: 1 }), null);
  assert.equal(await first, false);
  assert.equal(await f.bridge.requestMCPToolConsent({ title: "no-active-route", message: "deny" }), false);
  f.render({ active: true, scope: "screen", depth: 1 });
  const second = f.bridge.requestMCPToolConsent({ title: "after-return", message: "public fixture" });
  const current = f.render({ active: true, scope: "screen", depth: 1 });
  stale.props.actions[0].onPress();
  assert.equal(f.render({ active: true, scope: "screen", depth: 1 }).props.title, "after-return");
  current.props.actions[1].onPress(); assert.equal(await second, false);
  assert.deepEqual(f.requests, []); assert.deepEqual(f.writes, []);
  f.unmount();
});
