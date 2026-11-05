import "../src/shims/installGlobals";
import { useEffect, useMemo, useState } from "react";
import { Dimensions, type DimensionsPayload } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AppearanceProvider, useAppearance } from "../src/ui/appearance";
import { usePalette } from "../src/ui/theme";
import { MCPToolConsentHost } from "../src/ui/settings/MCPToolConsentHost";
import { mcpToolConsentScreenLayout } from "../src/ui/settings/MCPToolConsentScreenHost";
import { ReaderQuestionProvider, questionPresentationIdFromRoute, useQuestionTransitionEnd, useReaderQuestionRegistry } from "../src/ui/reader-question/ReaderQuestionProvider";

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
  const [sheetDetentReferenceHeight, setSheetDetentReferenceHeight] = useState(
    () => Dimensions.get("screen").height,
  );
  useEffect(() => {
    const subscription = Dimensions.addEventListener("change", ({ screen }: DimensionsPayload) => {
      if (screen) setSheetDetentReferenceHeight(screen.height);
    });
    return () => subscription.remove();
  }, []);
  const transitionEnd = useQuestionTransitionEnd();
  const questions = useReaderQuestionRegistry();
  const palette = usePalette();
  const { resolvedMode } = useAppearance();
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
        {/* 书内问答是浮层：底部上滑，透出下层阅读页。 */}
        <Stack.Screen
          name="book-chat"
          listeners={({ route }) => ({ sheetDetentChange: event => {
            const presentation = questions.get(questionPresentationIdFromRoute(route));
            if (presentation && event.data.stable) presentation.update({ sheetDetent: event.data.index }, false);
          } })}
          options={({ route }) => ({
            presentation: "formSheet",
            animation: "slide_from_bottom",
            sheetAllowedDetents: [0.76, 1],
            sheetDetentReferenceHeight,
            sheetInitialDetentIndex: questions.get(questionPresentationIdFromRoute(route))?.getSnapshot().sheetDetent ?? 0,
            sheetGrabberVisible: false,
            sheetCornerRadius: 22,
            sheetExpandsWhenScrolledToEdge: true,
            contentStyle,
          })}
        />
      </Stack>
      <MCPToolConsentHost />
    </SafeAreaProvider>
  );
}
