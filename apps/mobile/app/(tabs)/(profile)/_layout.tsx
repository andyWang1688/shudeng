import { Stack } from "expo-router";
import { usePalette } from "../../../src/ui/theme";

export const unstable_settings = { anchor: "profile" };

export default function ProfileLayout() {
  const palette = usePalette();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
        contentStyle: { backgroundColor: palette.paper },
      }}
    />
  );
}
