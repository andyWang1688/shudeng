import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { loader } from "../../../ui/settings/__tests__/platformHarness.mts";
import {
  aiConsentScope,
  parseAICatalog,
  validateServiceDraft,
} from "../aiCatalog.ts";

const CATALOG_KEY = "shudeng.ai-services.v2";
const LEGACY_KEY = "shudeng.ai-config.v1";
const PREFERENCE_KEY = "assistant-preferences:v1";
const a = {
  id: "service-a",
  secretId: "key-a",
  name: "服务 A",
  provider: "openai" as const,
  model: "gpt-4.1",
  baseUrl: "https://api.openai.com/v1",
  contextWindowTokens: 128000,
};
const b = {
  id: "service-b",
  secretId: "key-b",
  name: "服务 B",
  provider: "anthropic" as const,
  model: "claude-sonnet-4-5",
  baseUrl: "https://api.anthropic.com/v1",
};
const services = [
  { ...a, consentScope: aiConsentScope(a) },
  { ...b, consentScope: aiConsentScope(b) },
];
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function harness(
  options: {
    catalog?: any;
    absentCatalog?: boolean;
    preferences?: string | null;
    legacy?: string;
  } = {},
) {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(
    "CREATE TABLE app_preferences (key TEXT PRIMARY KEY NOT NULL, value_json TEXT NOT NULL)",
  );
  const preferences =
    options.preferences === undefined
      ? JSON.stringify({
          version: 1,
          instructions: "# 我的指令\n保留全文",
          webSearchEnabled: true,
        })
      : options.preferences;
  if (preferences !== null)
    db.prepare("INSERT INTO app_preferences VALUES (?, ?)").run(
      PREFERENCE_KEY,
      preferences,
    );
  const entries = new Map<string, string>([
    [a.secretId, "synthetic-key-a"],
    [b.secretId, "synthetic-key-b"],
  ]);
  if (!options.absentCatalog)
    entries.set(
      CATALOG_KEY,
      JSON.stringify(
        options.catalog ?? { version: 2, selectedId: a.id, services },
      ),
    );
  if (options.legacy) entries.set(LEGACY_KEY, options.legacy);
  const reads: string[] = [],
    writes: string[] = [],
    deletes: string[] = [];
  let preferenceReads = 0,
    sequence = 0,
    failCatalogWrites = false;
  const load = loader({
    "expo-secure-store": {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
      getItemAsync: async (key: string) => {
        reads.push(key);
        return entries.get(key) ?? null;
      },
      setItemAsync: async (key: string, value: string) => {
        writes.push(key);
        if (key === CATALOG_KEY && failCatalogWrites)
          throw new Error("catalog write failed");
        entries.set(key, value);
      },
      deleteItemAsync: async (key: string) => {
        deletes.push(key);
        entries.delete(key);
      },
    },
    "@shudeng/core": {
      createLocalId: (prefix: string) => prefix + ".test-" + ++sequence,
    },
    "./db": {
      getDataLayer: async () => ({
        driver: {
          all: async (sql: string, params: any[]) => {
            preferenceReads++;
            return db.prepare(sql).all(...params);
          },
          run: async (sql: string, params: any[]) =>
            db.prepare(sql).run(...params),
        },
      }),
    },
  });
  return {
    api: load("apps/mobile/src/platform/aiConfig.ts"),
    preferences: load("apps/mobile/src/platform/assistantPreferences.ts"),
    entries,
    reads,
    writes,
    deletes,
    stored: () => JSON.parse(entries.get(CATALOG_KEY)!),
    rawPreferences: () =>
      db
        .prepare("SELECT value_json FROM app_preferences WHERE key=?")
        .get(PREFERENCE_KEY)?.value_json,
    preferenceReadCount: () => preferenceReads,
    failWrites: (enabled: boolean) => {
      failCatalogWrites = enabled;
    },
  };
}

test("old global true migrates once to the selected service without reading or changing keys or instructions", async () => {
  const h = harness();
  const originalPrefs = h.rawPreferences();
  const first = await h.api.loadAIServiceCatalog();
  assert.equal(first.webSearchMigrated, true);
  assert.equal(first.selectedId, a.id);
  assert.deepEqual(first.services[0], {
    ...services[0],
    webSearchEnabled: true,
  });
  assert.deepEqual(first.services[1], services[1]);
  assert.equal(h.entries.get(a.secretId), "synthetic-key-a");
  assert.equal(h.entries.get(b.secretId), "synthetic-key-b");
  assert.deepEqual(h.writes, [CATALOG_KEY]);
  assert.deepEqual(h.deletes, []);
  assert.deepEqual(h.reads, [CATALOG_KEY]);
  assert.equal(h.rawPreferences(), originalPrefs);
  await h.api.loadAIServiceCatalog();
  assert.equal(h.preferenceReadCount(), 1);
  assert.deepEqual(h.writes, [CATALOG_KEY]);
  await h.api.selectAIService(b.id);
  assert.equal((await h.api.loadAIConfig()).webSearchEnabled, false);
  await h.api.selectAIService(a.id);
  assert.equal((await h.api.loadAIConfig()).webSearchEnabled, true);
  assert.equal(h.stored().webSearchMigrated, true);
});

test("explicit service false wins over the old global true and is not overwritten", async () => {
  const explicit = { ...services[0], webSearchEnabled: false };
  const h = harness({
    catalog: {
      version: 2,
      selectedId: a.id,
      services: [explicit, { ...services[1], webSearchEnabled: true }],
    },
  });
  const migrated = await h.api.loadAIServiceCatalog();
  assert.deepEqual(migrated.services, [
    explicit,
    { ...services[1], webSearchEnabled: true },
  ]);
  assert.equal((await h.api.loadAIConfig()).webSearchEnabled, false);
});

test("a new service defaults off, while edits and compatibility saves preserve or explicitly change its own setting", async () => {
  const h = harness();
  await h.api.loadAIServiceCatalog();
  const added = await h.api.saveAIService(
    {
      name: "新服务",
      provider: "openai",
      model: "gpt-4.1",
      baseUrl: "https://api.openai.com/v1",
    },
    "synthetic-new-key",
    true,
  );
  assert.equal(added.webSearchEnabled, false);
  const updated = await h.api.saveAIService(
    { ...a, model: "gpt-4.1-mini" },
    "",
  );
  assert.equal(updated.webSearchEnabled, true);
  await h.api.saveAIConfig({ ...a, apiKey: "", webSearchEnabled: false });
  assert.equal((await h.api.loadAIConfig()).webSearchEnabled, false);
  await h.api.saveAIConfig({ ...a, apiKey: "", webSearchEnabled: true });
  await h.api.saveAIConfig({ ...a, apiKey: "" });
  assert.equal((await h.api.loadAIConfig()).webSearchEnabled, true);
  assert.equal(
    h.stored().services.find((row: any) => row.id === b.id).webSearchEnabled,
    undefined,
  );
  assert.equal(h.entries.get(a.secretId), "synthetic-key-a");
  assert.equal(h.entries.get(b.secretId), "synthetic-key-b");
  assert.deepEqual(h.deletes, []);
});

test("an unselected or absent catalog consumes the old switch without enabling a future new service", async () => {
  for (const options of [
    { catalog: { version: 2, selectedId: null, services } },
    { absentCatalog: true },
  ]) {
    const h = harness(options);
    assert.equal((await h.api.loadAIServiceCatalog()).webSearchMigrated, true);
    const fresh = await h.api.saveAIService(
      {
        name: "后加入",
        provider: "openai",
        model: "gpt-4.1",
        baseUrl: "https://api.openai.com/v1",
      },
      "synthetic-key",
      true,
    );
    assert.equal(fresh.webSearchEnabled, false);
    assert.equal(h.stored().webSearchMigrated, true);
  }
});

test("missing or false legacy preferences retain off defaults and never change unrelated service data", async () => {
  for (const preferences of [
    null,
    JSON.stringify({
      version: 1,
      instructions: "保留",
      webSearchEnabled: false,
    }),
    JSON.stringify({ version: 2, instructions: "保留" }),
  ]) {
    const h = harness({ preferences });
    assert.deepEqual((await h.api.loadAIServiceCatalog()).services, services);
    assert.equal((await h.api.loadAIConfig()).webSearchEnabled, false);
    assert.deepEqual(h.deletes, []);
  }
});

test("a failed migration leaves the catalog, preferences and keys unchanged and can be retried", async () => {
  const h = harness();
  const before = new Map(h.entries);
  const oldPrefs = h.rawPreferences();
  h.failWrites(true);
  await assert.rejects(h.api.loadAIServiceCatalog(), /catalog write failed/);
  assert.deepEqual(h.entries, before);
  assert.equal(h.rawPreferences(), oldPrefs);
  assert.deepEqual(h.deletes, []);
  assert.ok(!h.reads.includes(a.secretId));
  await assert.rejects(
    h.api.saveAIService(
      { ...a, webSearchEnabled: false },
      "synthetic-replacement",
      true,
    ),
    /catalog write failed/,
  );
  assert.deepEqual(h.entries, before);
  h.failWrites(false);
  assert.equal(
    (await h.api.loadAIServiceCatalog()).services[0].webSearchEnabled,
    true,
  );
});

test("a failed service edit after migration retains its old setting and key reference", async () => {
  const h = harness();
  await h.api.loadAIServiceCatalog();
  const before = new Map(h.entries);
  h.failWrites(true);
  await assert.rejects(
    h.api.saveAIService(
      { ...a, webSearchEnabled: false },
      "synthetic-replacement",
    ),
    /catalog write failed/,
  );
  assert.deepEqual(h.entries, before);
  assert.equal(h.stored().services[0].webSearchEnabled, true);
  assert.equal(h.stored().services[0].secretId, a.secretId);
  assert.equal(h.entries.get(a.secretId), "synthetic-key-a");
  assert.equal(h.entries.get(b.secretId), "synthetic-key-b");
  assert.equal(h.deletes.length, 1);
  assert.notEqual(h.deletes[0], a.secretId);
  assert.notEqual(h.deletes[0], b.secretId);
});

test("editing assistant instructions before catalog migration retains the historical switch privately", async () => {
  const h = harness();
  await h.preferences.saveAssistantPreferences({
    instructions: "# 新人设\n保留换行",
  });
  assert.deepEqual(await h.preferences.loadAssistantPreferences(), {
    instructions: "# 新人设\n保留换行",
  });
  assert.deepEqual(JSON.parse(h.rawPreferences() as string), {
    version: 2,
    instructions: "# 新人设\n保留换行",
    legacyWebSearchEnabled: true,
  });
  assert.equal(
    (await h.api.loadAIServiceCatalog()).services[0].webSearchEnabled,
    true,
  );
  assert.equal(
    (await h.preferences.loadAssistantPreferences()).instructions,
    "# 新人设\n保留换行",
  );
});

test("concurrent catalog reads and a service switch serialize around one migration destination", async () => {
  const h = harness();
  const [first, second] = await Promise.all([
    h.api.loadAIServiceCatalog(),
    h.api.loadAIServiceCatalog(),
    h.api.selectAIService(b.id),
  ]);
  assert.equal(first.services[0].webSearchEnabled, true);
  assert.equal(second.services[0].webSearchEnabled, true);
  assert.equal(h.preferenceReadCount(), 1);
  assert.equal(h.stored().selectedId, b.id);
  assert.equal((await h.api.loadAIConfig()).webSearchEnabled, false);
  assert.equal(h.writes.filter((key) => key === CATALOG_KEY).length, 2);
});

test("legacy v1 service keeps its original key reference and sending still requires explicit confirmation", async () => {
  const legacy = JSON.stringify({
    provider: "openai",
    name: "旧服务",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1",
    apiKey: "synthetic-legacy-key",
  });
  const h = harness({ absentCatalog: true, legacy });
  const catalog = await h.api.loadAIServiceCatalog();
  assert.equal(catalog.selectedId, "legacy");
  assert.equal(catalog.services[0].secretId, LEGACY_KEY);
  assert.equal(catalog.services[0].webSearchEnabled, true);
  await assert.rejects(h.api.loadAIConfig(), /确认.*发送说明/);
  assert.equal(h.entries.get(LEGACY_KEY), legacy);
  assert.deepEqual(h.deletes, []);
  assert.deepEqual(h.writes, [CATALOG_KEY]);
});

test("corrupt catalogs and preferences fail without migration writes or secret changes", async () => {
  for (const options of [
    { preferences: "broken JSON" },
    { catalog: { version: 2, selectedId: "missing", services } },
  ]) {
    const h = harness(options);
    const before = new Map(h.entries);
    const oldPrefs = h.rawPreferences();
    await assert.rejects(h.api.loadAIServiceCatalog());
    assert.deepEqual(h.entries, before);
    assert.equal(h.rawPreferences(), oldPrefs);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.deletes, []);
  }
});

test("per-service values and the migration marker reject malformed types while old schemas remain readable", () => {
  assert.equal(
    parseAICatalog(JSON.stringify({ version: 2, selectedId: a.id, services }))
      .services[0]?.webSearchEnabled,
    undefined,
  );
  for (const webSearchEnabled of ["false", 1, null]) {
    assert.throws(
      () => validateServiceDraft({ ...a, webSearchEnabled } as any),
      /联网搜索设置/,
    );
    assert.throws(() =>
      parseAICatalog(
        JSON.stringify({
          version: 2,
          selectedId: a.id,
          services: [{ ...services[0], webSearchEnabled }],
        }),
      ),
    );
  }
  for (const webSearchMigrated of [false, 1, "true"])
    assert.throws(() =>
      parseAICatalog(
        JSON.stringify({
          version: 2,
          selectedId: a.id,
          services,
          webSearchMigrated,
        }),
      ),
    );
});
