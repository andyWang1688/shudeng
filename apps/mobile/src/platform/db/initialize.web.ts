/**
 * Web 预览：明确 stub。
 *
 * 不加载 expo-sqlite 的 WASM 驱动、不引入 better-sqlite3；本地数据库只在 iOS/Android 验证。
 * 该文件保证 Web bundle 不包含 native SQLite 初始化路径（Metro 平台解析）。
 */
import type { DatabaseInitResult } from './types';
import type { ShudengDataLayer } from './engine';

const WEB_STUB_DETAIL = 'Web 预览不加载 SQLite WASM：本地数据库仅在 iOS/Android 可用（未验证）';

export async function initializeDatabase(): Promise<DatabaseInitResult> {
  return { ok: false, engine: 'web-stub', detail: WEB_STUB_DETAIL };
}

export async function getDataLayer(): Promise<ShudengDataLayer> {
  throw new Error(WEB_STUB_DETAIL);
}

export async function closeDatabase(): Promise<void> {
  // Web stub 无连接可关闭。
}
