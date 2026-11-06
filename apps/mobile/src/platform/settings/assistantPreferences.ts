/** User-editable reading preferences. Application policy remains outside these instructions. */
export type AssistantPreferences = {
  readonly instructions: string;
};

export const ASSISTANT_INSTRUCTIONS_MAX_LENGTH = 16_000;
export const DEFAULT_ASSISTANT_PREFERENCES: AssistantPreferences =
  Object.freeze({
    instructions: `# 书灯阅读助手

你是我的读书伙伴，帮助我读懂当前这本书，鼓励我形成自己的理解。

## 回答偏好
- 默认用中文，先回答问题，再补充必要解释。
- 语言清楚、具体；遇到抽象概念，结合书中内容举例。
- 区分作者的观点、你的推断和书外知识。依据不足时明确说明。
- 根据问题决定解释深度，避免重复和无关扩展。
- 可以提出一个有助于继续阅读或思考的问题。`,
  });

export interface AssistantPreferencesStorage {
  read(): Promise<string | null>;
  write(json: string): Promise<void>;
}

function validate(value: unknown): AssistantPreferences {
  if (
    typeof value !== "object" ||
    value === null ||
    !("instructions" in value) ||
    typeof value.instructions !== "string"
  )
    throw new Error("阅读助手设置格式无效；请恢复默认后保存。");
  if (value.instructions.length > ASSISTANT_INSTRUCTIONS_MAX_LENGTH)
    throw new Error(
      `助手指令最多 ${ASSISTANT_INSTRUCTIONS_MAX_LENGTH.toLocaleString("en-US")} 个字符；请缩短后保存。`,
    );
  return { instructions: value.instructions };
}

function parseStored(json: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw new Error(
      "阅读助手设置已损坏；已有内容未覆盖，请重试或恢复默认后保存。",
    );
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    (value.version !== 1 && value.version !== 2)
  )
    throw new Error("无法读取此版本的阅读助手设置；请重试或恢复默认后保存。");
  return value as Record<string, unknown>;
}

/** Migration-only data: never exposed as an assistant preference or used as a runtime fallback. */
function legacyWebSearch(value: Record<string, unknown>): boolean | undefined {
  const enabled =
    value.version === 1 ? value.webSearchEnabled : value.legacyWebSearchEnabled;
  if (value.version === 1 || enabled !== undefined) {
    if (typeof enabled !== "boolean")
      throw new Error("旧版联网搜索设置无效；已有内容未覆盖。");
    return enabled;
  }
  return undefined;
}

/** No cache: each new question can read the last successfully committed settings. */
export function createAssistantPreferencesStore(
  storage: AssistantPreferencesStorage,
) {
  let writes: Promise<unknown> = Promise.resolve();
  return {
    async load(): Promise<AssistantPreferences> {
      await writes;
      const json = await storage.read();
      if (json === null) return { ...DEFAULT_ASSISTANT_PREFERENCES };
      const value = parseStored(json);
      legacyWebSearch(value);
      return validate(value);
    },
    async loadLegacyWebSearchEnabled(): Promise<boolean | undefined> {
      await writes;
      const json = await storage.read();
      return json === null ? undefined : legacyWebSearch(parseStored(json));
    },
    async save(value: AssistantPreferences): Promise<void> {
      const checked = validate(value);
      const work = async () => {
        const json = await storage.read();
        let pending: boolean | undefined;
        // Explicit save/restore may repair corrupt preferences. Preserve every readable old switch
        // until the independently committed AI catalog has recorded its one-time migration.
        if (json !== null) {
          try {
            pending = legacyWebSearch(parseStored(json));
          } catch {
            /* User explicitly replaces unreadable settings. */
          }
        }
        await storage.write(
          JSON.stringify({
            version: 2,
            ...checked,
            ...(pending !== undefined
              ? { legacyWebSearchEnabled: pending }
              : {}),
          }),
        );
      };
      const pending = writes.then(work, work);
      writes = pending.catch(() => undefined);
      return pending;
    },
  };
}
