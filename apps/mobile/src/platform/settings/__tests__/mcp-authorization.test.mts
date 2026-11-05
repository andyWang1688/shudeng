import assert from "node:assert/strict";
import test from "node:test";
import {
  invokeAuthorizedMCPTool,
  mcpConsentScope,
  mcpToolFingerprint,
  prepareMCPServerSave,
  requireMCPAuthorization,
  retainedMCPToolPermissions,
} from "../mcpAuthorization.ts";
import { parseMCPServers, type MCPServer, type MCPTool } from "../mcpPolicy.ts";
import { createRuntimeQueue } from "../runtimeQueue.ts";

const tool: MCPTool = {
  name: "lookup",
  description: "Look up a public title",
  inputSchema: { type: "object", properties: { title: { type: "string" } } },
  readOnly: true,
};
const server: MCPServer = {
  id: "mcp-1",
  name: "Tools",
  endpoint: "https://example.com/mcp",
  transport: "http",
  enabled: true,
  headers: { authorization: "Bearer local-only" },
  tools: [tool],
  allowedTools: [tool.name],
  authorizationRevision: 1,
};

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("legacy MCP catalogs get revision zero; malformed versions fail closed", () => {
  const { authorizationRevision: _unused, ...legacy } = server;
  assert.equal(
    parseMCPServers(JSON.stringify([legacy]))[0]?.authorizationRevision,
    0,
  );
  for (const revision of [-1, 0.5, "1", Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() =>
      parseMCPServers(
        JSON.stringify([{ ...server, authorizationRevision: revision }]),
      ),
    );
});

test("tool definitions use canonical schema keys but every semantic change invalidates consent and permission", () => {
  const reordered = {
    ...tool,
    inputSchema: { properties: { title: { type: "string" } }, type: "object" },
  };
  assert.equal(mcpToolFingerprint(reordered), mcpToolFingerprint(tool));
  assert.deepEqual(retainedMCPToolPermissions(server, [reordered]), [
    tool.name,
  ]);
  for (const changed of [
    { ...tool, readOnly: false },
    { ...tool, description: "Write a title to a remote record" },
    { ...tool, inputSchema: { type: "object", required: ["delete"] } },
    { ...tool, title: "Changed display meaning" },
  ]) {
    assert.notEqual(
      mcpConsentScope(server, changed),
      mcpConsentScope(server, tool),
    );
    assert.throws(
      () =>
        requireMCPAuthorization(server, tool, { ...server, tools: [changed] }),
      /变更/,
    );
    const discovered = prepareMCPServerSave(
      { ...server, tools: [changed] },
      server,
    );
    assert.deepEqual(discovered.allowedTools, []);
    assert.equal(discovered.authorizationRevision, 2);
    assert.notEqual(
      mcpConsentScope(discovered, changed),
      mcpConsentScope(server, tool),
    );
    const allowedAgain = prepareMCPServerSave(
      { ...discovered, allowedTools: [tool.name] },
      discovered,
    );
    assert.deepEqual(allowedAgain.allowedTools, [tool.name]);
    assert.equal(allowedAgain.authorizationRevision, 3);
    assert.throws(
      () => requireMCPAuthorization(server, tool, allowedAgain),
      /变更/,
    );
  }
  assert.deepEqual(retainedMCPToolPermissions(server, []), []);
  assert.deepEqual(
    retainedMCPToolPermissions(
      { ...server, tools: [], allowedTools: [] },
      [tool],
      [tool.name],
    ),
    [],
  );
});

test("authorization versions prevent stale saves, deletion resurrection, and revoke/reallow reuse", () => {
  const renamed = prepareMCPServerSave(
    { ...server, name: "Other label" },
    server,
  );
  assert.equal(renamed.authorizationRevision, 1);
  const revoked = prepareMCPServerSave({ ...server, allowedTools: [] }, server);
  const allowedAgain = prepareMCPServerSave(
    { ...revoked, allowedTools: [tool.name] },
    revoked,
  );
  assert.equal(allowedAgain.authorizationRevision, 3);
  assert.throws(
    () => requireMCPAuthorization(server, tool, allowedAgain),
    /变更/,
  );
  assert.throws(() => prepareMCPServerSave(server, revoked), /重新打开/);
  assert.throws(() => prepareMCPServerSave(server), /已删除/);
  const changedConnection = prepareMCPServerSave(
    { ...server, headers: { authorization: "new" } },
    server,
  );
  assert.deepEqual(changedConnection.tools, []);
  assert.deepEqual(changedConnection.allowedTools, []);
  assert.equal(changedConnection.authorizationRevision, 2);
  assert.throws(
    () =>
      requireMCPAuthorization(server, tool, {
        ...server,
        headers: { authorization: "different" },
      }),
    /变更/,
  );
});

function fixture(waitAt: "confirm" | "initialize" | "response") {
  let current: MCPServer | undefined = server;
  const queue = createRuntimeQueue();
  const blocked = deferred();
  const arrived = deferred();
  const methods: string[] = [];
  let closed = 0;
  const wait = async (at: typeof waitAt) => {
    if (at === waitAt) {
      arrived.resolve();
      await blocked.promise;
    }
  };
  const ports = {
    exclusive: queue,
    load: async () => (current ? [current] : []),
    confirm: async () => {
      await wait("confirm");
    },
    connect: () => ({
      initialize: async () => {
        methods.push("initialize");
        await wait("initialize");
      },
      request: async (method: string, params: Record<string, unknown>) => {
        methods.push(method);
        assert.deepEqual(params, {
          name: tool.name,
          arguments: { title: "test" },
        });
        await wait("response");
        return { content: [{ type: "text", text: "result" }] };
      },
      close: async () => {
        closed += 1;
      },
    }),
  };
  return {
    ports,
    methods,
    arrived,
    blocked,
    closed: () => closed,
    save: (change: Partial<MCPServer>) =>
      queue(async () => {
        current = prepareMCPServerSave({ ...current!, ...change }, current);
      }),
    remove: () =>
      queue(async () => {
        current = undefined;
      }),
  };
}

const changes: readonly [
  string,
  (f: ReturnType<typeof fixture>) => Promise<void>,
][] = [
  ["disabled", (f) => f.save({ enabled: false })],
  ["whitelist revoked", (f) => f.save({ allowedTools: [] })],
  [
    "connection header changed",
    (f) => f.save({ headers: { authorization: "rotated" } }),
  ],
  [
    "definition changed",
    (f) => f.save({ tools: [{ ...tool, readOnly: false }] }),
  ],
  ["deleted", (f) => f.remove()],
  [
    "revoked then reallowed",
    async (f) => {
      await f.save({ allowedTools: [] });
      await f.save({ allowedTools: [tool.name] });
    },
  ],
];

for (const at of ["confirm", "initialize"] as const) {
  for (const [name, mutate] of changes) {
    test(
      `MCP ${name} while awaiting ${at} never sends tools/call`,
      { timeout: 1000 },
      async () => {
        const f = fixture(at);
        const pending = invokeAuthorizedMCPTool(
          server,
          tool,
          { title: "test" },
          undefined,
          f.ports,
        );
        const rejected = assert.rejects(pending, /关闭或变更/);
        await f.arrived.promise;
        await mutate(f);
        f.blocked.resolve();
        await rejected;
        assert.ok(!f.methods.includes("tools/call"));
        assert.equal(f.closed(), at === "initialize" ? 1 : 0);
      },
    );
  }
}

test(
  "MCP cancellation during initialization closes without sending tool arguments",
  { timeout: 1000 },
  async () => {
    const f = fixture("initialize");
    const controller = new AbortController();
    const pending = invokeAuthorizedMCPTool(
      server,
      tool,
      { title: "test" },
      controller.signal,
      f.ports,
    );
    const rejected = assert.rejects(pending, { name: "AbortError" });
    await f.arrived.promise;
    controller.abort();
    f.blocked.resolve();
    await rejected;
    assert.deepEqual(f.methods, ["initialize"]);
    assert.equal(f.closed(), 1);
  },
);

test(
  "an authorized call starts once and releases the write queue before its network response",
  { timeout: 1000 },
  async () => {
    const f = fixture("response");
    const pending = invokeAuthorizedMCPTool(
      server,
      tool,
      { title: "test" },
      undefined,
      f.ports,
    );
    await f.arrived.promise;
    // This must finish while the network response remains blocked.
    await f.save({ allowedTools: [] });
    f.blocked.resolve();
    assert.deepEqual(await pending, {
      content: [{ type: "text", text: "result" }],
    });
    assert.deepEqual(f.methods, ["initialize", "tools/call"]);
    assert.equal(f.closed(), 1);
  },
);
