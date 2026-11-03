import '../src/shims/installGlobals';
import { useMemo } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppearanceProvider, useAppearance } from '../src/ui/appearance';
import { usePalette } from '../src/ui/theme';

export default function RootLayout() {
  return (
    <AppearanceProvider>
      <RootLayoutContent />
    </AppearanceProvider>
  );
}

function RootLayoutContent() {
  const palette = usePalette();
  const { resolvedMode } = useAppearance();
  const contentStyle = useMemo(() => ({ backgroundColor: palette.paper }), [palette]);
  return (
    <SafeAreaProvider>
      <StatusBar style={resolvedMode === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle,
          // 通读/设置类页面仍按 iOS push（从右向左）进入；根四栏在下面关掉动画。
          animation: 'slide_from_right',
        }}
      >
        {/* 根四栏是 Expo Router Tabs；自定义 tabBar 保留各 Tab 状态。 */}
        <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
        <Stack.Screen name="ai-settings" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="appearance" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="about" options={{ animation: 'slide_from_right' }} />
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
