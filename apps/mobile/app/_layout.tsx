import "../src/shims/installGlobals";
import "../global.css";
import { useEffect, useMemo } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Uniwind } from "uniwind";
import { AppearanceProvider, useAppearance } from "../src/ui/appearance";
import { usePalette } from "../src/ui/theme";
import { MCPToolConsentHost } from "../src/ui/settings/MCPToolConsentHost";
import { mcpToolConsentScreenLayout } from "../src/ui/settings/MCPToolConsentScreenHost";
import { ReaderQuestionProvider, useQuestionTransitionEnd } from "../src/ui/reader-question/ReaderQuestionProvider";

export const unstable_settings = { anchor: "(tabs)" };

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppearanceProvider>
        <ReaderQuestionProvider>
          <RootLayoutContent />
        </ReaderQuestionProvider>
      </AppearanceProvider>
    </GestureHandlerRootView>
  );
}

function RootLayoutContent() {
  const transitionEnd = useQuestionTransitionEnd();
  const palette = usePalette();
  const { resolvedMode } = useAppearance();
  useEffect(() => {
    Uniwind.setTheme(resolvedMode);
  }, [resolvedMode]);
  const contentStyle = useMemo(
    () => ({ backgroundColor: palette.paper }),
    [palette],
  );
  return (
    <SafeAreaProvider>
      <StatusBar style={resolvedMode === "dark" ? "light" : "dark"} />
      <Stack
        screenLayout={mcpToolConsentScreenLayout}
        screenListeners={{ transitionEnd }}
        screenOptions={{
          headerShown: false,
          contentStyle,
          // 覆盖层由根 Stack 承载；设置 push 属于各自的 Tab / 问答 Stack。
          animation: "slide_from_right",
        }}
      >
        {/* 根四栏是 Expo Router Tabs；自定义 tabBar 保留各 Tab 状态。 */}
        <Stack.Screen name="(tabs)" options={{ animation: "none" }} />
        <Stack.Screen
          name="settings/ai-service"
          options={{ presentation: "modal", animation: "slide_from_bottom" }}
        />
        <Stack.Screen
          name="reader/index"
          options={{ animation: "slide_from_right" }}
        />
        <Stack.Screen
          name="reader/[id]"
          options={{
            presentation: "fullScreenModal",
            animation: "default",
            gestureEnabled: false,
          }}
        />
        {/* Navigation owns route lifetime; Gorhom owns sheet gestures and sizing. */}
        <Stack.Screen
          name="book-chat"
          options={{
            presentation: "transparentModal",
            animation: "fade",
            gestureEnabled: false,
            contentStyle: { backgroundColor: "transparent" },
          }}
        />
      </Stack>
      <MCPToolConsentHost />
    </SafeAreaProvider>
  );
}
