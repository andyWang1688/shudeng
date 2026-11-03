/**
 * 外观偏好：system / light / dark，持久化到 SecureStore，异步加载后即时生效。
 * 放在 UI 层但不依赖 theme（theme.usePalette 反向读取本模块），避免循环依赖。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type AppearanceMode = 'system' | 'light' | 'dark';
export type ResolvedAppearanceMode = 'light' | 'dark';

const STORAGE_KEY = 'shudeng.appearance';

type AppearanceContextValue = {
  /** 用户偏好：system / light / dark。 */
  readonly mode: AppearanceMode;
  /** 实际生效的明暗（system 时跟随系统）。 */
  readonly resolvedMode: ResolvedAppearanceMode;
  /** SecureStore 偏好是否已读取完成。 */
  readonly hydrated: boolean;
  readonly setMode: (mode: AppearanceMode) => void;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function isAppearanceMode(value: unknown): value is AppearanceMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function AppearanceProvider({ children }: { readonly children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<AppearanceMode>('system');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let mounted = true;
    void SecureStore.getItemAsync(STORAGE_KEY)
      .then((raw) => {
        if (!mounted || !isAppearanceMode(raw)) return;
        setModeState(raw);
      })
      .catch(() => {
        // 读取失败按「跟随系统」处理，不影响使用。
      })
      .finally(() => {
        if (mounted) setHydrated(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const setMode = useCallback((next: AppearanceMode) => {
    setModeState(next);
    void SecureStore.setItemAsync(STORAGE_KEY, next, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }).catch(() => {
      // 写入失败时本次会话仍即时生效；下次启动回落到已保存值/系统。
    });
  }, []);

  const resolvedMode: ResolvedAppearanceMode = mode === 'system'
    ? systemScheme === 'dark' ? 'dark' : 'light'
    : mode;

  const value = useMemo<AppearanceContextValue>(
    () => ({ mode, resolvedMode, hydrated, setMode }),
    [mode, resolvedMode, hydrated, setMode],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('useAppearance 必须在 AppearanceProvider 内使用');
  return value;
}

/** 用户偏好（system/light/dark）；theme.usePalette 用它决定实际色板。 */
export function useAppearanceMode(): AppearanceMode {
  return useAppearance().mode;
}
