import { Stack } from "expo-router";
import { usePalette } from "../../../src/ui/theme";
import { nativeListNavigationOptions } from "../../../src/ui/navigation/nativeListNavigationOptions";

export const unstable_settings = { anchor: "index" };

export default function ShelfLayout() {
  const palette = usePalette();
  return (
    <Stack
      screenOptions={{
        title: "书架",
        ...nativeListNavigationOptions(palette),
        headerShown: false,
      }}
    />
  );
}
