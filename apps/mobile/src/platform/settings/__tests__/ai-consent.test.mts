import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import * as rules from "../aiCatalog.ts";
import { resolveProviderEndpoint } from "../../../../../../packages/core/src/agent/provider-endpoint.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const configFile = fileURLToPath(new URL("../../aiConfig.ts", import.meta.url));
const configCode = ts.transpileModule(readFileSync(configFile, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const key = "shudeng.ai-services.v2";
const a = { id: "local-a", secretId: "local-key-a", name: "本机A", provider: "openai" as const,
  model: "model-a", baseUrl: "http://127.0.0.1:8765/v1" };
const b = { id: "local-b", secretId: "local-key-b", name: "本机B", provider: "anthropic" as const,
  model: "model-b", baseUrl: "http://127.0.0.1:8766/v1" };
function harness(services: readonly any[]) {
  const entries = new Map<string, string>([
    [key, JSON.stringify({ version: 2, selectedId: a.id, services })],
    [a.secretId, "fake-only-key-a"], [b.secretId, "fake-only-key-b"],
  ]);
  const reads: string[] = [], writes: string[] = [], deletes: string[] = [];
  let sequence = 0;
  const compiled: any = new Module(configFile);
  compiled.filename = configFile;
  compiled.require = (id: string) => {
    if (id === "expo-secure-store") return {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: "test-device-only",
      getItemAsync: async (id: string) => { reads.push(id); return entries.get(id) ?? null; },
      setItemAsync: async (id: string, value: string) => { writes.push(id); entries.set(id, value); },
      deleteItemAsync: async (id: string) => { deletes.push(id); entries.delete(id); },
    };
    if (id === "@shudeng/core") return { createLocalId: (prefix: string) => prefix + ".test-" + ++sequence };
    if (id === "./settings/aiCatalog") return rules;
    throw new Error("Unexpected dependency: " + id);
  };
  compiled._compile(configCode, configFile);
  return { api: compiled.exports, entries, reads, writes, deletes };
}

test("v2 sending scope binds the native name/provider/protocol/endpoint fields and excludes the model", () => {
  assert.deepEqual(JSON.parse(rules.aiConsentScope(a)), {
    version: 2, provider: "custom", name: "本机A", format: "OpenAI",
    endpoint: "http://127.0.0.1:8765/v1/chat/completions",
  });
  assert.equal(rules.aiConsentScope(a), rules.aiConsentScope({ ...a, model: "different-model" }));
  assert.notEqual(rules.aiConsentScope(a), rules.aiConsentScope({ ...a, name: "重命名" }));
  assert.notEqual(rules.aiConsentScope(a), rules.aiConsentScope({ ...a, provider: "deepseek" }));
  assert.notEqual(rules.aiConsentScope(a), rules.aiConsentScope({ ...a, provider: "anthropic" }));
  assert.notEqual(rules.aiConsentScope(a), rules.aiConsentScope({ ...a, baseUrl: "http://127.0.0.1:8767/v1" }));
  assert.equal(rules.aiConsentScope(a), rules.aiConsentScope({ ...a, name: "\u200B\t本机A\u3000" }));
  assert.notEqual(rules.aiConsentScope(a), rules.aiConsentScope({ ...a, name: "\uFEFF本机A" }));
});

test("root, API prefix and full text endpoint scopes bind the actual runtime endpoint", () => {
  for (const provider of ["openai", "deepseek", "anthropic"] as const) {
    for (const baseUrl of ["http://127.0.0.1:8765", "http://127.0.0.1:8765/",
      "http://127.0.0.1:8765/v1/", "http://127.0.0.1:8765/custom/v3/",
      "http://127.0.0.1:8765/v1/chat/completions/", "http://127.0.0.1:8765/v1/messages/"]) {
      const scope = JSON.parse(rules.aiConsentScope({ ...a, provider, baseUrl }));
      assert.equal(scope.endpoint, resolveProviderEndpoint(provider, baseUrl).endpoint);
    }
    const resource = provider === "anthropic" ? "/messages" : "/chat/completions";
    assert.equal(rules.aiConsentScope({ ...a, provider }), rules.aiConsentScope({ ...a, provider, baseUrl: a.baseUrl + resource }));
  }
});

test("old scope remains readable but cannot authorize sending or mutate keys without explicit reconfirmation", async () => {
  const legacy = { ...a, consentScope: JSON.stringify([a.provider, a.baseUrl, a.model]) };
  const h = harness([legacy, { ...b, consentScope: rules.aiConsentScope(b) }]);
  const before = new Map(h.entries);
  const catalog = await h.api.loadAIServiceCatalog();
  assert.equal(catalog.services[0].consentScope, legacy.consentScope);
  await assert.rejects(h.api.loadAIConfig(), /确认.*发送说明/);
  assert.ok(!h.reads.includes(a.secretId), "sending must stop before reading the old key");
  await assert.rejects(h.api.saveAIService(a, "", false), /确认.*发送说明/);
  await assert.rejects(h.api.selectAIService(a.id, false), /确认.*发送说明/);
  assert.deepEqual(h.entries, before);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.deletes, []);
});

test("explicit reconfirmation upgrades only that service scope and preserves independent existing keys", async () => {
  const legacy = { ...a, consentScope: JSON.stringify([a.provider, a.baseUrl, a.model]) };
  const other = { ...b, consentScope: rules.aiConsentScope(b) };
  const h = harness([legacy, other]);
  await h.api.selectAIService(a.id, true);
  const catalog = await h.api.loadAIServiceCatalog();
  assert.equal(catalog.services[0].consentScope, rules.aiConsentScope(a));
  assert.equal(catalog.services[0].secretId, a.secretId);
  assert.deepEqual(catalog.services[1], other);
  assert.equal((await h.api.loadAIConfig()).apiKey, "fake-only-key-a");
  assert.equal(h.entries.get(a.secretId), "fake-only-key-a");
  assert.equal(h.entries.get(b.secretId), "fake-only-key-b");
  assert.deepEqual(h.writes, [key]);
  assert.deepEqual(h.deletes, []);
});

test("a model-only save needs no new consent while rename is blocked until confirmed", async () => {
  const h = harness([{ ...a, consentScope: rules.aiConsentScope(a) }, { ...b, consentScope: rules.aiConsentScope(b) }]);
  await h.api.saveAIService({ ...a, model: "another-model" }, "", false);
  assert.equal((await h.api.loadAIConfig()).model, "another-model");
  const beforeRename = new Map(h.entries);
  await assert.rejects(h.api.saveAIService({ ...a, name: "新的名称" }, "", false), /确认.*发送说明/);
  assert.deepEqual(h.entries, beforeRename);
  await h.api.saveAIService({ ...a, name: "新的名称" }, "", true);
  assert.equal((await h.api.loadAIConfig()).name, "新的名称");
  assert.equal(h.entries.get(a.secretId), "fake-only-key-a");
  assert.equal(h.entries.get(b.secretId), "fake-only-key-b");
});

test("the compatibility save never grants consent implicitly and preserves unrelated service keys", async () => {
  const legacy = { ...a, consentScope: JSON.stringify([a.provider, a.baseUrl, a.model]) };
  const other = { ...b, consentScope: rules.aiConsentScope(b) };
  const h = harness([legacy, other]);
  const config = { ...a, apiKey: "" };
  const before = new Map(h.entries);
  await assert.rejects(h.api.saveAIConfig(config), /确认.*发送说明/);
  assert.deepEqual(h.entries, before);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.deletes, []);

  await h.api.saveAIConfig(config, true);
  assert.equal((await h.api.loadAIConfig()).apiKey, "fake-only-key-a");
  assert.deepEqual((await h.api.loadAIServiceCatalog()).services.find((row: any) => row.id === b.id), other);
  assert.equal(h.entries.get(b.secretId), "fake-only-key-b");
  await h.api.saveAIConfig({ ...config, model: "updated-model" });
  assert.equal((await h.api.loadAIConfig()).model, "updated-model");
  const confirmed = new Map(h.entries);
  await assert.rejects(h.api.saveAIConfig({ ...config, name: "different-name" }), /确认.*发送说明/);
  assert.deepEqual(h.entries, confirmed);
});
