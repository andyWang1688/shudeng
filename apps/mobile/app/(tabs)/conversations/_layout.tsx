import { Stack } from "expo-router";
import { usePalette } from "../../../src/ui/theme";
import { nativeListNavigationOptions } from "../../../src/ui/navigation/nativeListNavigationOptions";

export default function ConversationsLayout() {
  const palette = usePalette();
  return (
    <Stack
      screenOptions={{
        title: "对话",
        ...nativeListNavigationOptions(palette),
        headerShown: false,
      }}
    />
  );
}
