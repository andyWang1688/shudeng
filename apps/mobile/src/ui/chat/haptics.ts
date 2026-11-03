import { Platform, Vibration } from 'react-native';

/** 无 expo-haptics 依赖时的轻触反馈；模拟器/不支持设备静默。 */
export function tapFeedback(): void {
  if (Platform.OS === 'web') return;
  try {
    Vibration.vibrate(5);
  } catch {
    // 触感不是业务路径，失败忽略。
  }
}
