import { useCallback } from 'react';
import { AccessibilityInfo } from 'react-native';

let reduceMotion = false;
void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { reduceMotion = enabled; });
AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => { reduceMotion = enabled; });

export type HapticKind = 'light' | 'success';

/**
 * 关键动作触感（打开书/切换 Tab/保存等）；尊重 Reduce Motion，静音/系统触感关闭由 iOS 处理。
 * 动态加载：未原生链接 expo-haptics 的旧安装包也不会因缺模块崩溃。
 */
export function useHaptics(): (kind?: HapticKind) => void {
  return useCallback((kind: HapticKind = 'light') => {
    if (reduceMotion) return;
    void import('expo-haptics')
      .then((Haptics) => {
        if (kind === 'success') return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      })
      .catch(() => {});
  }, []);
}
