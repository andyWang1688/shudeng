import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { loader } from "../../../ui/settings/__tests__/platformHarness.mts";

test("SQLite adapter isolates its key, upserts, and reads committed data from a new instance", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "CREATE TABLE app_preferences (key TEXT PRIMARY KEY NOT NULL, value_json TEXT NOT NULL)",
    );
    db.prepare("INSERT INTO app_preferences VALUES (?, ?)").run(
      "appearance",
      '"dark"',
    );
    const getDataLayer = async () => ({
      driver: {
        all: async (sql: string, params: any[]) =>
          db.prepare(sql).all(...params),
        run: async (sql: string, params: any[]) =>
          db.prepare(sql).run(...params),
      },
    });
    const fresh = () =>
      loader({ "./db": { getDataLayer } })(
        "apps/mobile/src/platform/assistantPreferences.ts",
      );
    const first = fresh();
    assert.deepEqual(
      await first.loadAssistantPreferences(),
      first.DEFAULT_ASSISTANT_PREFERENCES,
    );
    await first.saveAssistantPreferences({
      instructions: "# 第一版\n中文 Markdown",
    });
    await first.saveAssistantPreferences({
      instructions: "# 第二版",
    });
    const reopened = fresh();
    assert.deepEqual(await reopened.loadAssistantPreferences(), {
      instructions: "# 第二版",
    });
    const rows = db
      .prepare("SELECT key, value_json FROM app_preferences ORDER BY key")
      .all();
    assert.equal(rows.length, 2);
    assert.equal(
      rows.find((row) => row.key === "appearance")?.value_json,
      '"dark"',
    );
    assert.equal(
      rows.find((row) => row.key === "assistant-preferences:v1")?.value_json,
      JSON.stringify({
        version: 2,
        instructions: "# 第二版",
      }),
    );
  } finally {
    db.close();
  }
});

test("SQLite adapter reports a corrupt row and leaves it available for recovery", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "CREATE TABLE app_preferences (key TEXT PRIMARY KEY NOT NULL, value_json TEXT NOT NULL)",
    );
    db.prepare("INSERT INTO app_preferences VALUES (?, ?)").run(
      "assistant-preferences:v1",
      "broken JSON",
    );
    const getDataLayer = async () => ({
      driver: {
        all: async (sql: string, params: any[]) =>
          db.prepare(sql).all(...params),
        run: async (sql: string, params: any[]) =>
          db.prepare(sql).run(...params),
      },
    });
    const adapter = loader({ "./db": { getDataLayer } })(
      "apps/mobile/src/platform/assistantPreferences.ts",
    );
    await assert.rejects(adapter.loadAssistantPreferences(), /已损坏/);
    assert.equal(
      db.prepare("SELECT value_json FROM app_preferences").get()?.value_json,
      "broken JSON",
    );
  } finally {
    db.close();
  }
});
