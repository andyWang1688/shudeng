import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSISTANT_INSTRUCTIONS_MAX_LENGTH,
  DEFAULT_ASSISTANT_PREFERENCES,
  createAssistantPreferencesStore,
} from "../assistantPreferences.ts";

test("a new install reads defaults without writing and returns independent values", async () => {
  let writes = 0;
  const store = createAssistantPreferencesStore({
    read: async () => null,
    write: async () => {
      writes++;
    },
  });
  const value = await store.load();
  assert.deepEqual(value, DEFAULT_ASSISTANT_PREFERENCES);
  assert.equal("webSearchEnabled" in value, false);
  assert.notEqual(value, await store.load());
  assert.equal(writes, 0);
});

test("settings round trip through a fresh store including empty or exact Markdown instructions", async () => {
  let json: string | null = null;
  const storage = {
    read: async () => json,
    write: async (value: string) => {
      json = value;
    },
  };
  for (const instructions of ["# 我的助手\n\n先解释，再举例。  \n", ""]) {
    await createAssistantPreferencesStore(storage).save({
      instructions,
    });
    assert.deepEqual(await createAssistantPreferencesStore(storage).load(), {
      instructions,
    });
    assert.equal(JSON.parse(json!).version, 2);
  }
});

test("corrupt and unsupported stored values fail without replacing saved content", async () => {
  for (const json of [
    "{bad",
    "null",
    JSON.stringify({ version: 2 }),
    JSON.stringify({ version: 1, instructions: 12, webSearchEnabled: false }),
    JSON.stringify({
      version: 1,
      instructions: "hello",
      webSearchEnabled: "false",
    }),
  ]) {
    let writes = 0;
    const store = createAssistantPreferencesStore({
      read: async () => json,
      write: async () => {
        writes++;
      },
    });
    await assert.rejects(store.load());
    assert.equal(writes, 0);
  }
});

test("storage read and write failures propagate; a failed write never becomes a cached success", async () => {
  let json = JSON.stringify({
    version: 1,
    instructions: "saved",
    webSearchEnabled: false,
  });
  let failRead = false;
  let failWrite = true;
  const store = createAssistantPreferencesStore({
    read: async () => {
      if (failRead) throw new Error("read failed");
      return json;
    },
    write: async (value) => {
      if (failWrite) throw new Error("disk full");
      json = value;
    },
  });
  await assert.rejects(store.save({ instructions: "draft" }), /disk full/);
  assert.deepEqual(await store.load(), {
    instructions: "saved",
  });
  failRead = true;
  await assert.rejects(store.load(), /read failed/);
  failRead = false;
  failWrite = false;
  await store.save({ instructions: "draft" });
  assert.deepEqual(await store.load(), {
    instructions: "draft",
  });
});

test("overlong instructions are rejected without truncation or writing", async () => {
  let writes = 0;
  const store = createAssistantPreferencesStore({
    read: async () => null,
    write: async () => {
      writes++;
    },
  });
  await assert.rejects(
    store.save({
      instructions: "字".repeat(ASSISTANT_INSTRUCTIONS_MAX_LENGTH + 1),
    }),
    /最多/,
  );
  assert.equal(writes, 0);
});

test("v1 global search is migration-only, and editing instructions preserves it until catalog migration", async () => {
  let json = JSON.stringify({
    version: 1,
    instructions: "旧人设",
    webSearchEnabled: true,
  });
  const storage = {
    read: async () => json,
    write: async (value: string) => {
      json = value;
    },
  };
  const store = createAssistantPreferencesStore(storage);
  assert.deepEqual(await store.load(), { instructions: "旧人设" });
  assert.equal(await store.loadLegacyWebSearchEnabled(), true);
  await store.save({ instructions: "新指令" });
  assert.deepEqual(JSON.parse(json), {
    version: 2,
    instructions: "新指令",
    legacyWebSearchEnabled: true,
  });
  const reopened = createAssistantPreferencesStore(storage);
  assert.deepEqual(await reopened.load(), { instructions: "新指令" });
  assert.equal(await reopened.loadLegacyWebSearchEnabled(), true);
});

test("new preferences carry no global switch and explicit restore can repair damaged settings", async () => {
  let json: string | null = null;
  const store = createAssistantPreferencesStore({
    read: async () => json,
    write: async (value) => {
      json = value;
    },
  });
  assert.equal(await store.loadLegacyWebSearchEnabled(), undefined);
  await store.save({ instructions: "人设" });
  assert.deepEqual(JSON.parse(json!), { version: 2, instructions: "人设" });
  json = "broken JSON";
  await assert.rejects(store.load(), /损坏/);
  await store.save(DEFAULT_ASSISTANT_PREFERENCES);
  assert.deepEqual(await store.load(), DEFAULT_ASSISTANT_PREFERENCES);
});
