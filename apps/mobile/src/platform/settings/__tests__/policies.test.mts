import assert from "node:assert/strict";
import test from "node:test";
import {
  aiConsentScope,
  normalizeAIAddress,
  parseAICatalog,
  validateServiceDraft,
} from "../aiCatalog.ts";
import {
  mcpAgentToolName,
  normalizeMCPAddress,
  parseMCPResponse,
  parseMCPServers,
  validateMCPHeaders,
} from "../mcpPolicy.ts";
import { promoteModelDirectory } from "../modelInstall.ts";
import { createRuntimeQueue } from "../runtimeQueue.ts";

const draft = {
  name: "服务",
  provider: "openai" as const,
  baseUrl: "https://api.example.com/v1/",
  model: "example",
};
const service = { ...draft, id: "service-1", secretId: "shudeng.key-1" };
const tool = {
  name: "lookup",
  inputSchema: { type: "object" },
  readOnly: true,
};
const server = {
  id: "server-1",
  name: "外部工具",
  endpoint: "https://tools.example.com/mcp",
  transport: "sse",
  enabled: true,
  headers: {},
  tools: [tool],
  allowedTools: ["lookup"],
};

test("AI destinations accept secure APIs and explicit local test addresses", () => {
  assert.equal(normalizeAIAddress(draft.baseUrl), "https://api.example.com/v1");
  assert.equal(
    normalizeAIAddress("http://[::1]:3000/v1"),
    "http://[::1]:3000/v1",
  );
  for (const address of [
    "http://example.com",
    "https://user:secret@example.com",
    "https://example.com?key=secret",
    "https://example.com/#fragment",
    "file:///private/key",
  ]) {
    assert.throws(() => normalizeAIAddress(address));
  }
});

test("context capacity is optional and a changed destination invalidates sending consent", () => {
  assert.equal(validateServiceDraft(draft).contextWindowTokens, undefined);
  assert.equal(
    validateServiceDraft({ ...draft, contextWindowTokens: 128000 })
      .contextWindowTokens,
    128000,
  );
  for (const size of [1_000_000, 1_047_576, 2_000_000, Number.MAX_SAFE_INTEGER]) {
    assert.equal(validateServiceDraft({ ...draft, contextWindowTokens: size }).contextWindowTokens, size);
    const saved = parseAICatalog(JSON.stringify({ version: 2, selectedId: service.id,
      services: [{ ...service, contextWindowTokens: size }] }));
    assert.equal(saved.services[0]?.contextWindowTokens, size);
  }
  for (const size of [999, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() =>
      validateServiceDraft({ ...draft, contextWindowTokens: size }),
    );
  assert.equal(
    aiConsentScope(draft),
    aiConsentScope({ ...draft, baseUrl: "https://api.example.com/v1" }),
  );
  assert.notEqual(
    aiConsentScope(draft),
    aiConsentScope({ ...draft, baseUrl: "https://proxy.example.com/v1" }),
  );
  assert.equal(
    aiConsentScope(draft),
    aiConsentScope({ ...draft, model: "another" }),
  );
  assert.notEqual(aiConsentScope(draft), aiConsentScope({ ...draft, name: "重命名服务" }));
  assert.notEqual(aiConsentScope(draft), aiConsentScope({ ...draft, provider: "anthropic" }));
  assert.notEqual(aiConsentScope(draft), aiConsentScope({ ...draft, provider: "deepseek" }));
  assert.equal(aiConsentScope(draft), aiConsentScope({ ...draft, baseUrl: "https://api.example.com/v1/chat/completions/" }));
  assert.equal(aiConsentScope({ ...draft, baseUrl: "https://api.example.com" }), aiConsentScope(draft));
});

test("corrupt AI catalogs fail closed and do not supply a fallback service", () => {
  assert.equal(
    parseAICatalog(
      JSON.stringify({
        version: 2,
        selectedId: service.id,
        services: [service],
      }),
    ).services[0]?.baseUrl,
    "https://api.example.com/v1",
  );
  for (const catalog of [
    { version: 1, selectedId: null, services: [] },
    { version: 2, selectedId: "missing", services: [service] },
    { version: 2, selectedId: service.id, services: [service, service] },
    {
      version: 2,
      selectedId: service.id,
      services: [{ ...service, model: null }],
    },
    {
      version: 2,
      selectedId: service.id,
      services: [{ ...service, secretId: "" }],
    },
  ])
    assert.throws(() => parseAICatalog(JSON.stringify(catalog)));
});

test("MCP stores validate endpoint, protocol headers, tool schema and allowlist before use", () => {
  assert.equal(parseMCPServers(JSON.stringify([server]))[0]?.transport, "sse");
  assert.equal(
    normalizeMCPAddress("https://tools.example.com/mcp?region=cn"),
    "https://tools.example.com/mcp?region=cn",
  );
  assert.deepEqual(validateMCPHeaders({ Authorization: "Bearer value" }), {
    authorization: "Bearer value",
  });
  for (const headers of [
    { Authorization: "Bearer value\r\nHost: other" },
    { "Mcp-Protocol-Version": "override" },
    { Authorization: "a", authorization: "b" },
  ])
    assert.throws(() => validateMCPHeaders(headers));
  for (const value of [
    { ...server, endpoint: "http://remote.example.com" },
    { ...server, allowedTools: ["unknown"] },
    { ...server, enabled: "yes" },
    { ...server, tools: [{ ...tool, inputSchema: null }] },
  ])
    assert.throws(() => parseMCPServers(JSON.stringify([value])));
});

test("MCP parses matching JSON, batch and SSE replies, and preserves protocol errors", () => {
  const reply = { jsonrpc: "2.0", id: 7, result: { tools: [] } };
  assert.deepEqual(parseMCPResponse(JSON.stringify(reply), 7), { tools: [] });
  assert.deepEqual(
    parseMCPResponse(JSON.stringify([{ ...reply, id: 8 }, reply]), 7),
    { tools: [] },
  );
  assert.deepEqual(
    parseMCPResponse(
      ": heartbeat\r\n\r\nevent: message\r\ndata: " +
        JSON.stringify(reply) +
        "\r\n\r\n",
      7,
    ),
    { tools: [] },
  );
  assert.throws(() => parseMCPResponse(JSON.stringify(reply), 8), /匹配/);
  assert.throws(
    () =>
      parseMCPResponse(
        JSON.stringify({ jsonrpc: "2.0", id: 7, error: { message: "denied" } }),
        7,
      ),
    /denied/,
  );
  assert.throws(
    () => parseMCPResponse(JSON.stringify({ id: 7, result: {} }), 7),
    /协议/,
  );
});

test("sanitized and long MCP names cannot collide within a running tool catalog", () => {
  assert.notEqual(mcpAgentToolName(0, 0, "a.b"), mcpAgentToolName(0, 1, "a b"));
  assert.notEqual(
    mcpAgentToolName(0, 0, "x".repeat(128)),
    mcpAgentToolName(1, 0, "x".repeat(128)),
  );
  assert.ok(mcpAgentToolName(100, 100, "x".repeat(128)).length <= 64);
});

test("model promotion preserves installed data on a failed replacement and removes only old backup on success", () => {
  const paths = {
    staging: "/staged",
    installed: "/model",
    backup: "/previous",
  };
  function filesystem(fail: boolean) {
    const files = new Map([
      ["/model", "old"],
      ["/staged", "new"],
    ]);
    return {
      files,
      io: {
        exists: (path: string) => files.has(path),
        remove: (path: string) => {
          files.delete(path);
        },
        move: (from: string, to: string) => {
          if (fail && from === "/staged") {
            files.set(to, "partial");
            throw new Error("disk unavailable");
          }
          assert.ok(files.has(from));
          assert.ok(!files.has(to));
          files.set(to, files.get(from)!);
          files.delete(from);
        },
      },
    };
  }
  const failed = filesystem(true);
  assert.throws(
    () => promoteModelDirectory(paths, failed.io),
    /disk unavailable/,
  );
  assert.equal(failed.files.get("/model"), "old");
  assert.equal(failed.files.get("/staged"), "new");
  assert.ok(!failed.files.has("/previous"));
  const passed = filesystem(false);
  promoteModelDirectory(paths, passed.io);
  assert.deepEqual([...passed.files.entries()], [["/model", "new"]]);
});

test("model reset waits for active inference and a failed inference does not block later loads", async () => {
  const run = createRuntimeQueue();
  const order: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const inference = run(async () => {
    order.push("inference");
    await blocked;
    order.push("completed");
    throw new Error("inference failed");
  });
  const caught = assert.rejects(inference, /inference failed/);
  const reset = run(async () => {
    order.push("release and replace");
  });
  const next = run(async () => {
    order.push("load new model");
  });
  await Promise.resolve();
  assert.deepEqual(order, ["inference"]);
  release();
  await Promise.all([caught, reset, next]);
  assert.deepEqual(order, [
    "inference",
    "completed",
    "release and replace",
    "load new model",
  ]);
});
