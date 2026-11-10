/** MCP network boundary. Only saved, enabled, explicitly allowed tools can be offered to the Agent. */
import * as SecureStore from "expo-secure-store";
import { fetch } from "expo/fetch";
import { createLocalId } from "@shudeng/core";
import type { AgentExternalTool } from "@shudeng/core/agent";
import {
  invokeAuthorizedMCPTool,
  mcpConsentScope,
  prepareMCPServerSave,
} from "./settings/mcpAuthorization";
import { mcpToolConsentPrompt, requestMCPToolConsent } from "./settings/mcpToolConsent";
import {
  isRecord,
  mcpAgentToolName,
  parseMCPResponse,
  parseMCPServer,
  parseMCPServers,
  parseMCPTool,
  type MCPServer,
  type MCPTool,
} from "./settings/mcpPolicy";
export type { MCPServer, MCPTool } from "./settings/mcpPolicy";
export { parseMCPResponse } from "./settings/mcpPolicy";
const STORAGE = "shudeng.mcp-servers.v1";
export function newMCPServer(): MCPServer {
  return {
    id: createLocalId("mcp"),
    name: "",
    endpoint: "",
    transport: "http",
    enabled: false,
    headers: {},
    tools: [],
    allowedTools: [],
  };
}
export async function loadMCPServers(): Promise<readonly MCPServer[]> {
  const raw = await SecureStore.getItemAsync(STORAGE);
  if (!raw) return [];
  return parseMCPServers(raw);
}
let updates: Promise<unknown> = Promise.resolve();
function update<T>(work: () => Promise<T>): Promise<T> {
  const result = updates.then(work, work);
  updates = result.catch(() => undefined);
  return result;
}
export function saveMCPServer(server: MCPServer): Promise<MCPServer> {
  return update(async () => {
    const validated = parseMCPServer(server);
    const old = await loadMCPServers();
    const previous = old.find((item) => item.id === server.id);
    const row = prepareMCPServerSave(validated, previous);
    await SecureStore.setItemAsync(
      STORAGE,
      JSON.stringify([...old.filter((item) => item.id !== row.id), row]),
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );
    return row;
  });
}
export function removeMCPServer(id: string): Promise<void> {
  return update(async () => {
    const rows = await loadMCPServers();
    await SecureStore.setItemAsync(
      STORAGE,
      JSON.stringify(rows.filter((item) => item.id !== id)),
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );
  });
}

let rpcSequence = 0;
function abortError(): Error {
  return Object.assign(new Error("外部工具调用已取消。"), {
    name: "AbortError",
  });
}
class MCPConnection {
  private sessionId: string | undefined;
  private protocolVersion = "2025-03-26";
  constructor(private readonly server: MCPServer) {}
  private async send(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (signal?.aborted) throw abortError();
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(),
      method === "tools/call"
        ? 60_000
        : method === "initialize"
          ? 20_000
          : 30_000,
    );
    const id = ++rpcSequence;
    try {
      const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      if (new TextEncoder().encode(body).length > 65_536)
        throw new Error("外部工具请求内容过大。");
      const response = await fetch(this.server.endpoint, {
        method: "POST",
        headers: this.headers(),
        body,
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok)
        throw new Error("外部工具连接失败（HTTP " + response.status + "）。");
      const sessionId = response.headers.get("mcp-session-id");
      if (sessionId) this.sessionId = sessionId;
      // SSE may keep the response alive after the matching result. Read until that result arrives.
      if (response.body) {
        const stream = response.headers
          .get("content-type")
          ?.includes("text/event-stream");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let raw = "";
        let bytes = 0;
        try {
          for (;;) {
            const part = await reader.read();
            bytes += part.value?.byteLength ?? 0;
            if (bytes > 2_000_000) throw new Error("外部工具返回内容过大。");
            raw += decoder.decode(part.value, { stream: !part.done });
            if (stream) {
              try {
                return parseMCPResponse(raw, id);
              } catch (error) {
                if (
                  error instanceof Error &&
                  error.message !== "外部工具未返回匹配的响应。"
                )
                  throw error;
              }
            }
            if (part.done) return parseMCPResponse(raw, id);
          }
        } finally {
          await reader.cancel().catch(() => undefined);
        }
      }
      const raw = await response.text();
      if (new TextEncoder().encode(raw).length > 2_000_000)
        throw new Error("外部工具返回内容过大。");
      return parseMCPResponse(raw, id);
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (controller.signal.aborted)
        throw new Error("外部工具连接超时，请重试。");
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  private headers(): Record<string, string> {
    return {
      ...this.server.headers,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": this.protocolVersion,
      ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
    };
  }
  async initialize(signal?: AbortSignal): Promise<void> {
    const result = await this.send(
      "initialize",
      {
        protocolVersion: this.protocolVersion,
        capabilities: {},
        clientInfo: { name: "Shudeng", version: "0.5.0" },
      },
      signal,
    );
    if (
      typeof result.protocolVersion !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(result.protocolVersion)
    )
      throw new Error("外部工具未协商有效的协议版本。");
    this.protocolVersion = result.protocolVersion;
    if (signal?.aborted) throw abortError();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, 20_000);
    try {
      const response = await fetch(this.server.endpoint, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
          params: {},
        }),
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok)
        throw new Error("外部工具初始化失败（HTTP " + response.status + "）。");
      await response.body?.cancel();
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (controller.signal.aborted) throw new Error("外部工具初始化超时。");
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
  request(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    return this.send(method, params, signal);
  }
  async close(): Promise<void> {
    if (!this.sessionId) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      await fetch(this.server.endpoint, {
        method: "DELETE",
        headers: { ...this.server.headers, "Mcp-Session-Id": this.sessionId },
        signal: controller.signal,
        redirect: "error",
      });
    } catch {
      /* Closing is best effort. */
    } finally {
      clearTimeout(timeout);
    }
  }
}
export async function discoverMCPTools(
  server: MCPServer,
  signal?: AbortSignal,
): Promise<readonly MCPTool[]> {
  server = parseMCPServer(server);
  if (!server.enabled) throw new Error("请先启用这个外部工具，再读取工具。");
  const connection = new MCPConnection(server);
  const tools: MCPTool[] = [];
  try {
    await connection.initialize(signal);
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const result = await connection.request(
        "tools/list",
        cursor ? { cursor } : {},
        signal,
      );
      if (!Array.isArray(result.tools))
        throw new Error("外部工具列表格式无效。");
      for (const value of result.tools) {
        if (!isRecord(value)) throw new Error("外部工具定义格式无效。");
        tools.push(
          parseMCPTool({
            ...value,
            readOnly:
              isRecord(value.annotations) &&
              value.annotations.readOnlyHint === true,
          }),
        );
        if (tools.length > 200)
          throw new Error("外部工具超过 200 个，请在服务端缩小工具范围。");
      }
      cursor =
        typeof result.nextCursor === "string" ? result.nextCursor : undefined;
      if (cursor && seen.has(cursor)) throw new Error("外部工具分页游标重复。");
      if (cursor) seen.add(cursor);
    } while (cursor);
    if (new Set(tools.map((tool) => tool.name)).size !== tools.length)
      throw new Error("外部工具名称重复。");
    return tools.sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    await connection.close();
  }
}
const consented = new Map<string, string>();
async function confirmTool(
  server: MCPServer,
  tool: MCPTool,
  signal?: AbortSignal,
): Promise<void> {
  const key = JSON.stringify([server.id, tool.name]);
  const scope = mcpConsentScope(server, tool);
  if (consented.get(key) === scope) return;
  if (signal?.aborted) throw abortError();
  const granted = await requestMCPToolConsent(mcpToolConsentPrompt(server, tool), signal);
  if (!granted || signal?.aborted) throw abortError();
  consented.set(key, scope);
}
export async function loadMCPAgentTools(): Promise<
  readonly AgentExternalTool[]
> {
  const servers = await loadMCPServers();
  return servers
    .filter((server) => server.enabled)
    .flatMap((server, serverIndex) =>
      server.tools
        .filter((tool) => server.allowedTools.includes(tool.name))
        .map(
          (tool, toolIndex): AgentExternalTool => ({
            name: mcpAgentToolName(serverIndex, toolIndex, tool.name),
            description:
              (tool.description ?? tool.name) +
              "（外部服务：" +
              server.name +
              "）",
            inputSchema: tool.inputSchema,
            async invoke(args, signal) {
              const result = await invokeAuthorizedMCPTool(
                server,
                tool,
                isRecord(args) ? args : {},
                signal,
                {
                  exclusive: update,
                  load: loadMCPServers,
                  confirm: confirmTool,
                  connect: (current) => new MCPConnection(current),
                },
              );
              if (result.isError === true)
                throw new Error(
                  "外部工具执行失败：" + JSON.stringify(result.content),
                );
              return JSON.stringify(result);
            },
          }),
        ),
    );
}
