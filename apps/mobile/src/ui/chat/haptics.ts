import { AccessibilityInfo, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

let reduceMotion = false;
void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
  reduceMotion = enabled;
});
AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
  reduceMotion = enabled;
});

/** 关键动作轻触感；与共享 useHaptics 同一依赖，尊重 Reduce Motion。 */
export function tapFeedback(kind: 'light' | 'success' = 'light'): void {
  if (Platform.OS === 'web' || reduceMotion) return;
  const action =
    kind === 'success'
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  void action.catch(() => undefined);
}
