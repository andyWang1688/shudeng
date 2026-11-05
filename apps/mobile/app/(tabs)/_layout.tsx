import { Tabs } from "expo-router";
import { BottomBar } from "../../src/ui/BottomBar";
import { TabInteractionProvider } from "../../src/ui/tabInteraction";

export default function TabsLayout() {
  return (
    <TabInteractionProvider>
      <Tabs
        screenOptions={{ headerShown: false, popToTopOnBlur: false }}
        tabBar={({ state, emitter, navigateToTab }) => (
          <BottomBar
            state={state}
            navigateToTab={(routeKey) => {
              const route = state.routes.find((item) => item.key === routeKey);
              if (!route) return;
              const event = emitter.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!event.defaultPrevented) navigateToTab(route.key);
            }}
          />
        )}
      >
        <Tabs.Screen name="index" options={{ title: "书架" }} />
        <Tabs.Screen name="notes" options={{ title: "笔记" }} />
        <Tabs.Screen name="conversations" options={{ title: "对话" }} />
        <Tabs.Screen name="(profile)" options={{ title: "我的" }} />
      </Tabs>
    </TabInteractionProvider>
  );
}
