import '../src/shims/installGlobals';
import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { darkColors, lightColors } from '../src/ui/theme';

export default function RootLayout() {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  const palette = dark ? darkColors : lightColors;
  const contentStyle = useMemo(() => ({ backgroundColor: palette.paper }), [palette]);
  return (
    <SafeAreaProvider>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle,
          // 通读/设置类页面仍按 iOS push（从右向左）进入；根四栏在下面关掉动画。
          animation: 'slide_from_right',
        }}
      >
        {/* 根四栏是底部 Tab 语义：切换时不要 push 动画。 */}
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        <Stack.Screen name="notes" options={{ animation: 'none' }} />
        <Stack.Screen name="conversations" options={{ animation: 'none' }} />
        <Stack.Screen name="profile" options={{ animation: 'none' }} />
        <Stack.Screen name="ai-settings" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="reader/index" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="reader/[id]" options={{ animation: 'slide_from_right' }} />
        {/* 书内问答是浮层：底部上滑，透出下层阅读页。 */}
        <Stack.Screen
          name="book-chat"
          options={{
            presentation: 'transparentModal',
            animation: 'slide_from_bottom',
            // 全局 contentStyle 会把 transparentModal 填成纸白；这里必须显式透明，才能露出下层阅读页。
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}
