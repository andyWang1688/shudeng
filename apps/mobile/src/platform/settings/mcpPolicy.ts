/** Pure validation at the persisted MCP configuration boundary. */
export interface MCPTool {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
  readonly readOnly: boolean;
}

export interface MCPServer {
  readonly id: string;
  readonly name: string;
  readonly endpoint: string;
  readonly transport: "http" | "sse";
  readonly enabled: boolean;
  readonly headers: Readonly<Record<string, string>>;
  readonly tools: readonly MCPTool[];
  readonly allowedTools: readonly string[];
  /** Missing only in legacy v1 data; normalized to zero when read. */
  readonly authorizationRevision?: number;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function normalizeMCPAddress(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("外部工具地址无效。");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    raw.length > 2048 ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && local))
  ) {
    throw new Error(
      "外部工具只支持 HTTPS；本机测试可使用 HTTP，地址不能含账号、密码或片段。",
    );
  }
  return url.toString();
}

export function validateMCPHeaders(
  value: unknown,
): Readonly<Record<string, string>> {
  if (!isRecord(value) || Object.keys(value).length > 30)
    throw new Error("请求 Header 无效。");
  const headers: Record<string, string> = {};
  for (const [name, content] of Object.entries(value)) {
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
      typeof content !== "string" ||
      /[\r\n]/.test(content) ||
      content.length > 8192
    ) {
      throw new Error("请求 Header 无效。");
    }
    const lower = name.toLowerCase();
    if (
      [
        "host",
        "content-length",
        "content-type",
        "accept",
        "mcp-session-id",
        "mcp-protocol-version",
      ].includes(lower)
    ) {
      throw new Error("此 Header 由连接协议管理。");
    }
    if (lower in headers) throw new Error("请求 Header 名称重复。");
    headers[lower] = content;
  }
  return headers;
}

export function parseMCPTool(value: unknown): MCPTool {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 128 ||
    !isRecord(value.inputSchema) ||
    typeof value.readOnly !== "boolean" ||
    (value.title !== undefined && typeof value.title !== "string") ||
    (value.description !== undefined && typeof value.description !== "string")
  ) {
    throw new Error("外部工具定义格式无效。");
  }
  return {
    name: value.name,
    inputSchema: value.inputSchema,
    readOnly: value.readOnly,
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.description === "string"
      ? { description: value.description }
      : {}),
  };
}

export function parseMCPServer(value: unknown): MCPServer {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    value.id.length > 128 ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 200 ||
    typeof value.endpoint !== "string" ||
    typeof value.enabled !== "boolean" ||
    !["http", "sse"].includes(String(value.transport)) ||
    !Array.isArray(value.tools) ||
    value.tools.length > 200 ||
    !Array.isArray(value.allowedTools)
  ) {
    throw new Error("外部工具配置读取失败，已有配置未覆盖。");
  }
  if (
    value.authorizationRevision !== undefined &&
    (!Number.isSafeInteger(value.authorizationRevision) ||
      Number(value.authorizationRevision) < 0)
  )
    throw new Error("外部工具授权版本无效，已有配置未覆盖。");
  const tools = value.tools.map(parseMCPTool);
  const names = new Set(tools.map((tool) => tool.name));
  if (
    names.size !== tools.length ||
    value.allowedTools.some(
      (name) => typeof name !== "string" || !names.has(name),
    ) ||
    new Set(value.allowedTools).size !== value.allowedTools.length
  )
    throw new Error("外部工具白名单无效，已有配置未覆盖。");
  return {
    id: value.id,
    name: value.name.trim(),
    endpoint: normalizeMCPAddress(value.endpoint),
    transport: value.transport as MCPServer["transport"],
    enabled: value.enabled,
    headers: validateMCPHeaders(value.headers),
    tools,
    allowedTools: value.allowedTools as string[],
    authorizationRevision: Number(value.authorizationRevision ?? 0),
  };
}

export function parseMCPServers(raw: string): readonly MCPServer[] {
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > 100)
    throw new Error("外部工具配置读取失败，已有配置未覆盖。");
  const servers = value.map(parseMCPServer);
  if (new Set(servers.map((server) => server.id)).size !== servers.length)
    throw new Error("外部工具标识重复，已有配置未覆盖。");
  return servers;
}

/** JSON-RPC accepts either one reply, a batch, or SSE data events. */
export function parseMCPResponse(
  raw: string,
  id: number,
): Record<string, unknown> {
  const candidates: unknown[] = [];
  try {
    const json: unknown = JSON.parse(raw);
    candidates.push(...(Array.isArray(json) ? json : [json]));
  } catch {
    /* SSE below. */
  }
  for (const event of raw.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data) {
      try {
        candidates.push(JSON.parse(data));
      } catch {
        /* Partial event or heartbeat. */
      }
    }
  }
  const reply = candidates.find((value) => isRecord(value) && value.id === id);
  if (!isRecord(reply)) throw new Error("外部工具未返回匹配的响应。");
  if (reply.jsonrpc !== "2.0") throw new Error("外部工具响应协议无效。");
  if (isRecord(reply.error))
    throw new Error(
      typeof reply.error.message === "string"
        ? reply.error.message
        : "外部工具返回错误。",
    );
  if (!isRecord(reply.result)) throw new Error("外部工具响应格式无效。");
  return reply.result;
}

/** Stable unique tool names preserve uniqueness even when server/tool names sanitize equally. */
export function mcpAgentToolName(
  serverIndex: number,
  toolIndex: number,
  name: string,
): string {
  return (
    "mcp_" +
    serverIndex +
    "_" +
    toolIndex +
    "_" +
    name.replace(/[^A-Za-z0-9_-]/g, "_")
  ).slice(0, 64);
}
