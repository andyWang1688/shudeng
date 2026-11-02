/**
 * Hermes 缺少 Web 全局 `crypto` 时会打断 LangChain（getRandomValues/randomUUID）。
 * 在 RootLayout 最先加载，提供最小 Web Crypto 兼容面；不覆盖已存在实现。
 */
import { getRandomValues, randomBytes, randomUUID } from './crypto';

type CryptoLike = {
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
  randomUUID?: () => string;
  randomBytes?: (size: number) => Uint8Array;
  subtle?: unknown;
};

const scope = globalThis as unknown as { crypto?: CryptoLike };
const existing = scope.crypto;
if (typeof existing?.getRandomValues !== 'function') {
  const compatibility: CryptoLike = {
    getRandomValues,
    randomBytes,
    randomUUID,
    subtle: existing?.subtle,
  };
  scope.crypto = compatibility;
}

// langsmith 的 isJsDom() 直接调用 navigator.userAgent.includes；Hermes 的 navigator 只读且无 userAgent。
// Hermes 上不能给 globalThis.navigator 赋值，只能尝试就地 defineProperty。
type NavigatorLike = { userAgent?: string; [key: string]: unknown };
const navigatorScope = globalThis as unknown as { navigator?: NavigatorLike };
const existingNavigator = navigatorScope.navigator;
if (existingNavigator && typeof existingNavigator.userAgent !== 'string') {
  try {
    Object.defineProperty(existingNavigator, 'userAgent', { value: 'ReactNative', configurable: true, writable: true });
  } catch {
    // 若宿主对象不可扩展，后续只能依赖 Metro 侧 shim/patch。
  }
} else if (!existingNavigator) {
  try {
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'ReactNative' }, configurable: true });
  } catch {
    // 同上。
  }
}
