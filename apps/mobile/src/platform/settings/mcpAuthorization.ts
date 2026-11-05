import type { MCPServer, MCPTool } from "./mcpPolicy";

/** Compare complete JSON definitions without depending on object or schema key order. */
function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === "object" && !Array.isArray(item))
      return Object.fromEntries(
        Object.entries(item).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      );
    return item;
  });
}

export function mcpToolFingerprint(tool: MCPTool): string {
  return fingerprint(tool);
}

function connectionFingerprint(server: MCPServer): string {
  return fingerprint([
    server.id,
    server.endpoint,
    server.transport,
    server.headers,
  ]);
}

export function mcpConsentScope(server: MCPServer, tool: MCPTool): string {
  return fingerprint([
    connectionFingerprint(server),
    server.authorizationRevision ?? 0,
    mcpToolFingerprint(tool),
  ]);
}

/** Rediscovery can retain permission only for an identical, previously known definition. */
export function retainedMCPToolPermissions(
  previous: MCPServer,
  tools: readonly MCPTool[],
  requested: readonly string[] = previous.allowedTools,
): readonly string[] {
  return requested.filter((name) => {
    const before = previous.tools.find((tool) => tool.name === name);
    const after = tools.find((tool) => tool.name === name);
    return (
      before &&
      after &&
      mcpToolFingerprint(before) === mcpToolFingerprint(after)
    );
  });
}

function authorizationFingerprint(server: MCPServer): string {
  return fingerprint([
    connectionFingerprint(server),
    server.enabled,
    [...server.allowedTools].sort(),
    [...server.tools]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(mcpToolFingerprint),
  ]);
}

/** Runs inside the persistence write queue. Stale editors cannot restore revoked grants. */
export function prepareMCPServerSave(
  next: MCPServer,
  previous?: MCPServer,
): MCPServer {
  if (
    !previous &&
    ((next.authorizationRevision ?? 0) !== 0 || next.tools.length > 0)
  )
    throw new Error("这个外部工具已删除，请返回列表重新添加；已有配置未覆盖。");
  if (
    previous &&
    (next.authorizationRevision ?? 0) !== (previous.authorizationRevision ?? 0)
  )
    throw new Error("外部工具设置已变更，请返回列表重新打开；已有配置未覆盖。");
  const changedConnection =
    previous && connectionFingerprint(previous) !== connectionFingerprint(next);
  const row = {
    ...next,
    ...(changedConnection
      ? { tools: [], allowedTools: [] }
      : previous
        ? {
            allowedTools: retainedMCPToolPermissions(
              previous,
              next.tools,
              next.allowedTools,
            ),
          }
        : {}),
  };
  const revision = previous?.authorizationRevision ?? 0;
  const changed =
    !previous ||
    authorizationFingerprint(previous) !== authorizationFingerprint(row);
  if (changed && revision >= Number.MAX_SAFE_INTEGER)
    throw new Error("外部工具授权版本已满，请删除后重新添加。");
  return { ...row, authorizationRevision: revision + (changed ? 1 : 0) };
}

export function requireMCPAuthorization(
  snapshot: MCPServer,
  tool: MCPTool,
  current: MCPServer | undefined,
): MCPServer {
  const currentTool = current?.tools.find((item) => item.name === tool.name);
  if (
    !current?.enabled ||
    !current.allowedTools.includes(tool.name) ||
    !currentTool ||
    mcpConsentScope(current, currentTool) !== mcpConsentScope(snapshot, tool)
  )
    throw new Error("这个外部工具已关闭或变更，请重新开始提问。");
  return current;
}

interface MCPConnectionPort {
  initialize(signal?: AbortSignal): Promise<void>;
  request(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

/**
 * Awaiting consent or initialization never reserves permission. Only the final
 * persisted check and synchronous request start share the short write queue;
 * the network response is awaited outside it, so revocation remains responsive.
 */
export async function invokeAuthorizedMCPTool(
  snapshot: MCPServer,
  tool: MCPTool,
  args: Record<string, unknown>,
  signal: AbortSignal | undefined,
  ports: {
    readonly exclusive: <T>(work: () => Promise<T>) => Promise<T>;
    readonly load: () => Promise<readonly MCPServer[]>;
    readonly confirm: (
      server: MCPServer,
      tool: MCPTool,
      signal?: AbortSignal,
    ) => Promise<void>;
    readonly connect: (server: MCPServer) => MCPConnectionPort;
  },
): Promise<Record<string, unknown>> {
  const authorized = <T>(work: (server: MCPServer) => T) =>
    ports.exclusive(async () => {
      const current = requireMCPAuthorization(
        snapshot,
        tool,
        (await ports.load()).find((server) => server.id === snapshot.id),
      );
      if (signal?.aborted)
        throw Object.assign(new Error("外部工具调用已取消。"), {
          name: "AbortError",
        });
      // A wrapper prevents promise assimilation from holding the queue during I/O.
      return { value: work(current) };
    });
  const initial = (await authorized((server) => server)).value;
  await ports.confirm(initial, tool, signal);
  const current = (await authorized((server) => server)).value;
  const connection = ports.connect(current);
  try {
    await connection.initialize(signal);
    const pending = (
      await authorized(() =>
        connection.request(
          "tools/call",
          { name: tool.name, arguments: args },
          signal,
        ),
      )
    ).value;
    return await pending;
  } finally {
    await connection.close();
  }
}
