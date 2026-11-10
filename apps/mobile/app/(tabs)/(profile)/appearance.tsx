import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useAppearance, type AppearanceMode } from "../../../src/ui/appearance";
import { usePalette, type Palette } from "../../../src/ui/theme";
import {
  SettingsHeader,
  SettingsSection,
} from "../../../src/ui/settings/SettingsParts";

const OPTIONS: ReadonlyArray<{
  readonly mode: AppearanceMode;
  readonly label: string;
}> = [
  { mode: "system", label: "跟随系统" },
  { mode: "light", label: "浅色" },
  { mode: "dark", label: "深色" },
];

/** 外观设置：三选一，选中立即生效并保存到 SecureStore。 */
export default function AppearanceRoute() {
  const router = useRouter();
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const { mode, setMode } = useAppearance();

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <SettingsHeader title="外观" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <SettingsSection first footer="选择后立即生效，并保存在本机。">
          {OPTIONS.map((option) => (
            <Pressable
              key={option.mode}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected: mode === option.mode }}
              onPress={() => setMode(option.mode)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Text style={styles.rowTitle}>{option.label}</Text>
              {mode === option.mode ? (
                <SymbolView
                  name="checkmark"
                  size={18}
                  tintColor={palette.lampInk}
                />
              ) : null}
            </Pressable>
          ))}
        </SettingsSection>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: palette.paper },
    content: {
      paddingHorizontal: 24,
      paddingBottom: 40,
      width: "100%",
      maxWidth: 760,
      alignSelf: "center",
    },
    row: {
      minHeight: 62,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 13,
      paddingHorizontal: 17,
      paddingVertical: 16,
    },
    pressed: { opacity: 0.7 },
    rowTitle: { fontSize: 17, lineHeight: 25, color: palette.ink },
  });
}
