/** Versioned AI services. Catalog and independent secret revisions live in device SecureStore. */
import * as SecureStore from "expo-secure-store";
import { createLocalId } from "@shudeng/core";
import { loadLegacyAssistantWebSearchEnabled } from "./assistantPreferences";
import {
  aiConsentScope,
  EMPTY_CATALOG,
  parseAICatalog,
  validateServiceDraft,
  type AICatalog,
  type AIService,
  type AIServiceDraft,
} from "./settings/aiCatalog";
export type {
  AIService,
  AIServiceDraft,
  AIProvider,
} from "./settings/aiCatalog";
export type AIConfig = {
  readonly id?: string;
  readonly name?: string;
  readonly provider: "deepseek" | "openai" | "anthropic";
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
  readonly contextWindowTokens?: number;
  readonly webSearchEnabled?: boolean;
};
const CATALOG_KEY = "shudeng.ai-services.v2";
const LEGACY_KEY = "shudeng.ai-config.v1";
const OPTIONS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
let writes: Promise<unknown> = Promise.resolve();
function mutate<T>(work: () => Promise<T>): Promise<T> {
  const pending = writes.then(work, work);
  writes = pending.catch(() => undefined);
  return pending;
}
async function storedCatalog(): Promise<AICatalog> {
  const raw = await SecureStore.getItemAsync(CATALOG_KEY);
  if (raw) return parseAICatalog(raw);
  const legacy = await SecureStore.getItemAsync(LEGACY_KEY);
  if (!legacy) return EMPTY_CATALOG;
  const value = JSON.parse(legacy) as AIConfig;
  const draft = validateServiceDraft({
    name: value.name ?? value.provider,
    provider: value.provider,
    baseUrl: value.baseUrl,
    model: value.model,
    ...(value.contextWindowTokens
      ? { contextWindowTokens: value.contextWindowTokens }
      : {}),
  });
  if (typeof value.apiKey !== "string" || !value.apiKey.trim())
    throw new Error("已有 API Key 不可用，请重新填写；已有配置未覆盖。");
  return {
    version: 2,
    selectedId: "legacy",
    services: [{ ...draft, id: "legacy", secretId: LEGACY_KEY }],
  };
}
/** Commit the destination and completion marker in one SecureStore write. Never touch a key. */
async function catalog(): Promise<AICatalog> {
  const value = await storedCatalog();
  if (value.webSearchMigrated) return value;
  const enabled = await loadLegacyAssistantWebSearchEnabled();
  const migrated: AICatalog = {
    ...value,
    webSearchMigrated: true,
    services: value.services.map((row) =>
      enabled === true &&
      row.id === value.selectedId &&
      row.webSearchEnabled === undefined
        ? { ...row, webSearchEnabled: true }
        : row,
    ),
  };
  await SecureStore.setItemAsync(
    CATALOG_KEY,
    JSON.stringify(migrated),
    OPTIONS,
  );
  return migrated;
}
async function readKey(row: AIService): Promise<string> {
  const raw = await SecureStore.getItemAsync(row.secretId);
  const key =
    row.secretId === LEGACY_KEY && raw
      ? (JSON.parse(raw) as AIConfig).apiKey
      : raw;
  if (typeof key !== "string" || !key.trim())
    throw new Error(
      "已保存的 API Key 无法读取，请解锁设备或重新填写；已有配置未覆盖。",
    );
  return key;
}
export async function loadAIServiceCatalog(): Promise<AICatalog> {
  // Reads can perform the one-time migration, so they share the mutation queue.
  return mutate(catalog);
}
export async function loadAIConfig(): Promise<AIConfig | null> {
  const value = await loadAIServiceCatalog();
  const row = value.services.find((item) => item.id === value.selectedId);
  if (!row) return null;
  if (row.consentScope !== aiConsentScope(row))
    throw new Error("请先到「我的 → AI 与助手」确认此服务的发送说明。");
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    baseUrl: row.baseUrl,
    model: row.model,
    apiKey: await readKey(row),
    webSearchEnabled: row.webSearchEnabled ?? false,
    ...(row.contextWindowTokens
      ? { contextWindowTokens: row.contextWindowTokens }
      : {}),
  };
}
export async function loadAIServiceForTest(id: string): Promise<AIConfig> {
  const row = (await loadAIServiceCatalog()).services.find(
    (item) => item.id === id,
  );
  if (!row) throw new Error("找不到这个服务。");
  return {
    ...row,
    webSearchEnabled: row.webSearchEnabled ?? false,
    apiKey: await readKey(row),
  };
}
export function saveAIService(
  draft: AIServiceDraft,
  newKey: string,
  confirmingSendConsent = false,
): Promise<AIService> {
  return mutate(async () => {
    const next = await catalog();
    const validated = validateServiceDraft(draft);
    const old = draft.id
      ? next.services.find((item) => item.id === draft.id)
      : undefined;
    if (draft.id && !old) throw new Error("这个服务已不存在，请重新打开设置。");
    if (old && validated.provider !== old.provider)
      throw new Error("接口格式在创建后不能更改，请添加新的 AI 服务。");
    const id = old?.id ?? createLocalId("service");
    const key = newKey.trim();
    if (!key && !old) throw new Error("请填写 API Key。");
    const secretId = key ? createLocalId("shudeng.ai-key") : old!.secretId;
    const scope = aiConsentScope(validated);
    if (!confirmingSendConsent && old?.consentScope !== scope)
      throw new Error("请先确认 AI 服务发送说明。");
    const row: AIService = {
      ...validated,
      id,
      secretId,
      consentScope: scope,
      webSearchEnabled:
        validated.webSearchEnabled ?? old?.webSearchEnabled ?? false,
    };
    if (key) await SecureStore.setItemAsync(secretId, key, OPTIONS);
    else await readKey(row);
    try {
      await SecureStore.setItemAsync(
        CATALOG_KEY,
        JSON.stringify({
          ...next,
          selectedId: next.selectedId ?? id,
          services: [...next.services.filter((item) => item.id !== id), row],
        }),
        OPTIONS,
      );
    } catch (error) {
      if (key)
        await SecureStore.deleteItemAsync(secretId).catch(() => undefined);
      throw error;
    }
    if (old && old.secretId !== secretId && old.secretId !== LEGACY_KEY)
      await SecureStore.deleteItemAsync(old.secretId).catch(() => undefined);
    return row;
  });
}
export function selectAIService(
  id: string,
  confirmingSendConsent = false,
): Promise<void> {
  return mutate(async () => {
    const value = await catalog();
    const row = value.services.find((item) => item.id === id);
    if (!row) throw new Error("找不到这个服务。");
    await readKey(row);
    const scope = aiConsentScope(row);
    if (!confirmingSendConsent && row.consentScope !== scope)
      throw new Error("请先确认 AI 服务发送说明。");
    await SecureStore.setItemAsync(
      CATALOG_KEY,
      JSON.stringify({
        ...value,
        selectedId: id,
        services: value.services.map((item) =>
          item.id === id ? { ...item, consentScope: scope } : item,
        ),
      }),
      OPTIONS,
    );
  });
}
export function removeAIService(id: string): Promise<void> {
  return mutate(async () => {
    const value = await catalog();
    const row = value.services.find((item) => item.id === id);
    await SecureStore.setItemAsync(
      CATALOG_KEY,
      JSON.stringify({
        ...value,
        selectedId: value.selectedId === id ? null : value.selectedId,
        services: value.services.filter((item) => item.id !== id),
      }),
      OPTIONS,
    );
    if (row && row.secretId !== LEGACY_KEY)
      await SecureStore.deleteItemAsync(row.secretId).catch(() => undefined);
  });
}
/** Compatibility API. A save is not itself evidence of sending consent. */
export async function saveAIConfig(
  config: AIConfig,
  confirmingSendConsent = false,
): Promise<void> {
  const value = await loadAIServiceCatalog();
  const id = config.id ?? value.selectedId;
  await saveAIService(
    {
      ...(id ? { id } : {}),
      name: config.name ?? config.provider,
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.model,
      ...(config.contextWindowTokens
        ? { contextWindowTokens: config.contextWindowTokens }
        : {}),
      ...(config.webSearchEnabled !== undefined
        ? { webSearchEnabled: config.webSearchEnabled }
        : {}),
    },
    config.apiKey,
    confirmingSendConsent,
  );
}
export async function hasAIConfig(): Promise<boolean> {
  return (await loadAIConfig()) !== null;
}
