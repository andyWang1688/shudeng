/** Pure catalog policy. Secrets are referenced by revision and never returned in list rows. */
export type AIProvider = "deepseek" | "openai" | "anthropic";
export interface AIService {
  readonly id: string;
  readonly name: string;
  readonly provider: AIProvider;
  readonly baseUrl: string;
  readonly model: string;
  readonly contextWindowTokens?: number;
  readonly webSearchEnabled?: boolean;
  readonly secretId: string;
  readonly consentScope?: string;
}
export interface AICatalog {
  readonly version: 2;
  readonly selectedId: string | null;
  readonly services: readonly AIService[];
  /** One-time migration of the historical app-wide preference has completed. */
  readonly webSearchMigrated?: true;
}
export interface AIServiceDraft {
  readonly id?: string;
  readonly name: string;
  readonly provider: AIProvider;
  readonly baseUrl: string;
  readonly model: string;
  readonly contextWindowTokens?: number;
  readonly webSearchEnabled?: boolean;
}
export const EMPTY_CATALOG: AICatalog = {
  version: 2,
  selectedId: null,
  services: [],
};
export function normalizeAIAddress(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("地址无效，请填写 HTTPS API 地址。");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "地址无效：请使用 HTTPS；本机测试可使用 HTTP，地址中不能包含密钥、查询参数或片段。",
    );
  }
  let result = url.toString();
  while (result.endsWith("/")) result = result.slice(0, -1);
  return result;
}
export function validateServiceDraft(draft: AIServiceDraft): AIServiceDraft {
  if (!["deepseek", "openai", "anthropic"].includes(draft.provider))
    throw new Error("接口格式无效。");
  if (
    draft.webSearchEnabled !== undefined &&
    typeof draft.webSearchEnabled !== "boolean"
  )
    throw new Error("联网搜索设置无效。");
  if (
    typeof draft.name !== "string" ||
    typeof draft.model !== "string" ||
    typeof draft.baseUrl !== "string" ||
    !draft.name.trim() ||
    !draft.model.trim()
  )
    throw new Error("请填写服务名称和模型。");
  if (
    draft.contextWindowTokens !== undefined &&
    (!Number.isInteger(draft.contextWindowTokens) ||
      draft.contextWindowTokens < 1000 ||
      draft.contextWindowTokens > 1_000_000)
  ) {
    throw new Error("上下文窗口需为 1,000–1,000,000 之间的整数。");
  }
  return {
    ...(draft.id !== undefined ? { id: draft.id } : {}),
    provider: draft.provider,
    name: draft.name.trim(),
    model: draft.model.trim(),
    baseUrl: normalizeAIAddress(draft.baseUrl),
    ...(draft.webSearchEnabled !== undefined
      ? { webSearchEnabled: draft.webSearchEnabled }
      : {}),
    ...(draft.contextWindowTokens !== undefined
      ? { contextWindowTokens: draft.contextWindowTokens }
      : {}),
  };
}
/** Version 2 binds the same fields as native AIConfigurationStore.SendScope.
 * The old [provider, address, model] string is deliberately never upgraded on read:
 * it cannot prove agreement to this service name/protocol/normalized endpoint.
 * Existing services and key references remain readable, but sending stays blocked
 * until an explicit save/select confirmation writes this scope. */
export function aiConsentScope(
  value: Pick<AIServiceDraft, "provider" | "name" | "baseUrl" | "model">,
): string {
  const format = value.provider === "anthropic" ? "Anthropic" : "OpenAI";
  const resource = format === "Anthropic" ? "/messages" : "/chat/completions";
  const url = new URL(normalizeAIAddress(value.baseUrl));
  let path = url.pathname.replace(/\/+$/, "");
  if (!path) path = "/v1";
  if (!path.endsWith(resource)) path += resource;
  url.pathname = path;
  return JSON.stringify({
    version: 2,
    provider: value.provider === "deepseek" ? "deepSeek" : "custom",
    // Foundation .whitespacesAndNewlines also trims U+200B and keeps a BOM.
    name: value.name.replace(
      /^[\t\p{Zs}\u200B\n\r\v\f\u0085\u2028\u2029]+|[\t\p{Zs}\u200B\n\r\v\f\u0085\u2028\u2029]+$/gu,
      "",
    ),
    format,
    endpoint: url.toString(),
  });
}
export function parseAICatalog(raw: string): AICatalog {
  const parsed: unknown = JSON.parse(raw);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("version" in parsed) ||
    parsed.version !== 2 ||
    !("services" in parsed) ||
    !Array.isArray(parsed.services) ||
    !("selectedId" in parsed)
  )
    throw new Error("AI 服务配置读取失败，已有配置未覆盖。");
  if ("webSearchMigrated" in parsed && parsed.webSearchMigrated !== true)
    throw new Error("联网搜索迁移记录无效，已有配置未覆盖。");
  const services = parsed.services.map((value: unknown): AIService => {
    if (
      !value ||
      typeof value !== "object" ||
      !("id" in value) ||
      typeof value.id !== "string" ||
      !("secretId" in value) ||
      typeof value.secretId !== "string" ||
      !value.id ||
      !/^[A-Za-z0-9_.-]+$/.test(value.secretId)
    )
      throw new Error("AI 服务配置不完整，已有配置未覆盖。");
    const row = value as AIService;
    if (row.consentScope !== undefined && typeof row.consentScope !== "string")
      throw new Error("AI 服务发送说明无效，已有配置未覆盖。");
    return {
      ...validateServiceDraft(row),
      id: row.id,
      secretId: row.secretId,
      ...(row.consentScope !== undefined
        ? { consentScope: row.consentScope }
        : {}),
    };
  });
  const selectedId = parsed.selectedId;
  if (
    selectedId !== null &&
    (typeof selectedId !== "string" ||
      !services.some((item) => item.id === selectedId))
  )
    throw new Error("当前 AI 服务引用无效，已有配置未覆盖。");
  if (new Set(services.map((item) => item.id)).size !== services.length)
    throw new Error("AI 服务标识重复，已有配置未覆盖。");
  return {
    version: 2,
    selectedId,
    services,
    ...("webSearchMigrated" in parsed ? { webSearchMigrated: true } : {}),
  };
}
