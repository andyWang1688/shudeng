import { Stack } from "expo-router";
import { usePalette } from "../../src/ui/theme";
import { mcpToolConsentScreenLayout } from "../../src/ui/settings/MCPToolConsentScreenHost";

export const unstable_settings = { anchor: "index" };

export default function BookChatLayout() {
  const palette = usePalette();
  return (
    <Stack
      screenLayout={mcpToolConsentScreenLayout}
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
        contentStyle: { backgroundColor: palette.paper },
      }}
    >
      <Stack.Screen name="index" options={{ contentStyle: { backgroundColor: "transparent" } }} />
    </Stack>
  );
}
