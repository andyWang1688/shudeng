/** AI 服务配置：key 存 SecureStore，不写沙盒明文文件。 */
import * as SecureStore from 'expo-secure-store';

export type AIConfig = {
  readonly provider: 'deepseek' | 'openai' | 'anthropic';
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
};

const STORAGE_KEY = 'shudeng.ai-config.v1';

export async function loadAIConfig(): Promise<AIConfig | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AIConfig>;
    if (!parsed.provider || !parsed.baseUrl || !parsed.model || !parsed.apiKey) return null;
    return parsed as AIConfig;
  } catch {
    return null;
  }
}

export async function saveAIConfig(config: AIConfig): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(config), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function hasAIConfig(): Promise<boolean> {
  return (await loadAIConfig()) !== null;
}
