import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useAppearance, type AppearanceMode } from "../../../src/ui/appearance";
import {
  radius,
  spacing,
  type,
  usePalette,
  type Palette,
} from "../../../src/ui/theme";

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
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回我的"
          onPress={() => router.back()}
        >
          <Text style={styles.back}>‹ 我的</Text>
        </Pressable>
        <Text style={styles.title}>外观</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionHeader}>外观</Text>
        <View style={styles.card}>
          {OPTIONS.map((option, index) => (
            <View key={option.mode}>
              <Pressable
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
                    tintColor={palette.lamp}
                  />
                ) : null}
              </Pressable>
              {index < OPTIONS.length - 1 ? (
                <View style={styles.separator} />
              ) : null}
            </View>
          ))}
        </View>
        <Text style={styles.footer}>
          外观会立即应用，并保存在本机。选择「跟随系统」时随系统深色模式切换。
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: palette.paper },
    toolbar: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.line,
    },
    back: { fontSize: 15, color: palette.lamp },
    title: { fontSize: 17, fontWeight: "600", color: palette.ink },
    content: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      paddingBottom: 24,
    },
    sectionHeader: {
      marginTop: spacing.lg,
      marginBottom: spacing.xs,
      paddingHorizontal: spacing.xxs,
      fontSize: type.subhead,
      color: palette.ink3,
    },
    card: {
      backgroundColor: palette.surface,
      borderRadius: radius.field,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.line,
      overflow: "hidden",
    },
    row: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    pressed: { opacity: 0.7 },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: palette.line,
      marginLeft: spacing.md,
    },
    rowTitle: { fontSize: type.body, color: palette.ink },
    footer: {
      marginTop: spacing.xs,
      paddingHorizontal: spacing.xxs,
      fontSize: type.footnote,
      lineHeight: 18,
      color: palette.ink3,
    },
  });
}
