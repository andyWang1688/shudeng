import type { DatabaseStatus } from './index';

/** Web 预览不加载 expo-sqlite 的 WASM 驱动；SQLite 只在 iOS/Android 验证。 */
export function initializeDatabase(): Promise<DatabaseStatus> {
  return Promise.resolve({
    ok: false,
    engine: 'expo-sqlite',
    detail: 'Web 预览未配置 SQLite WASM（iOS/Android 验证）',
  });
}
