import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import {
  loadAIServiceCatalog,
  type AIService,
} from "../../../src/platform/aiConfig";
import { useAppearance, type AppearanceMode } from "../../../src/ui/appearance";
import { BookActionSheet } from "../../../src/ui/components/BookActionSheet";
import { spacing, type, usePalette, type Palette } from "../../../src/ui/theme";

const PROVIDER_LABEL: Record<AIService["provider"], string> = {
  deepseek: "DeepSeek",
  openai: "OpenAI",
  anthropic: "Anthropic",
};

const APP_VERSION = "0.4.8";

const APPEARANCE_LABEL: Record<AppearanceMode, string> = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色",
};

export default function ProfileRoute() {
  const router = useRouter();
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const { mode, setMode } = useAppearance();
  const [aiDetail, setAIDetail] = useState("尚未配置，阅读仍可使用");
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const choosingAppearance = useRef(false);
  const showAppearance = () => {
    if (choosingAppearance.current) return;
    choosingAppearance.current = true;
    setAppearanceOpen(true);
  };
  const closeAppearance = () => {
    choosingAppearance.current = false;
    setAppearanceOpen(false);
  };

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void loadAIServiceCatalog()
        .then((catalog) => {
          if (!active) return;
          const config = catalog.services.find(
            (service) => service.id === catalog.selectedId,
          );
          setAIDetail(
            config
              ? `${config.name || PROVIDER_LABEL[config.provider]} · ${config.model}`
              : "尚未配置，阅读仍可使用",
          );
        })
        .catch(() => {
          if (active) setAIDetail("配置读取失败，点按重试");
        });
      return () => {
        active = false;
      };
    }, []),
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.sectionHeader, styles.firstSectionHeader]}>
          设置
        </Text>
        <View style={styles.card}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="AI 服务"
            onPress={() => router.push("/ai-settings")}
            style={({ pressed }) => [
              styles.row,
              styles.serviceRow,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.iconSlot}>
              <SymbolView name="lightbulb" size={28} tintColor={palette.lamp} />
            </View>
            <View style={styles.rowBody}>
              <Text style={[styles.rowTitle, { fontWeight: "500" }]}>
                AI 服务
              </Text>
              <Text style={styles.rowDetail} numberOfLines={1}>
                {aiDetail}
              </Text>
            </View>
            <SymbolView
              name="chevron.right"
              size={14}
              tintColor={palette.ink3 + "66"}
            />
          </Pressable>
          <View style={styles.separator} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="外观"
            accessibilityValue={{ text: APPEARANCE_LABEL[mode] }}
            onPress={showAppearance}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.iconSlot}>
              <SymbolView name="sun.max" size={28} tintColor={palette.ink2} />
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>外观</Text>
            </View>
            <Text style={styles.rowValue}>{APPEARANCE_LABEL[mode]}</Text>
            <SymbolView
              name="chevron.right"
              size={14}
              tintColor={palette.ink3 + "66"}
            />
          </Pressable>
        </View>

        <Text style={styles.sectionHeader}>关于</Text>
        <View style={styles.card}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关于书灯"
            onPress={() => router.push("/about")}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.iconSlot}>
              <SymbolView name="doc.text" size={28} tintColor={palette.ink2} />
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>关于书灯</Text>
            </View>
            <Text style={styles.rowValue}>{APP_VERSION}</Text>
            <SymbolView
              name="chevron.right"
              size={14}
              tintColor={palette.ink3 + "66"}
            />
          </Pressable>
        </View>
        <Text style={styles.footer}>
          书灯 {APP_VERSION} · 读得慢一点，也想得明白一点
        </Text>
      </ScrollView>
      {appearanceOpen ? (
        <BookActionSheet
          title="外观"
          message="选择适合此刻阅读的界面外观。"
          actions={(["system", "light", "dark"] as const).map(value => ({
            key: value,
            title: (mode === value ? "✓ " : "") + APPEARANCE_LABEL[value],
            onPress: () => {
              closeAppearance();
              setMode(value);
            },
          }))}
          onCancel={closeAppearance}
        />
      ) : null}
    </SafeAreaView>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: palette.paper },
    content: {
      paddingHorizontal: spacing.md,
      paddingTop: 0,
      paddingBottom: 24,
    },
    sectionHeader: {
      marginTop: 28,
      marginBottom: 11,
      paddingHorizontal: 16,
      fontSize: 10.5,
      lineHeight: 13,
      fontWeight: "500",
      color: palette.ink3,
    },
    firstSectionHeader: { marginTop: 10 },
    card: {
      backgroundColor: palette.surface,
      borderRadius: 26,
      overflow: "hidden",
    },
    serviceRow: { minHeight: 62 },
    row: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    pressed: { opacity: 0.7 },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: palette.line,
      marginLeft: 56,
      marginRight: 16,
    },
    iconSlot: { width: 28 },
    rowBody: { flex: 1 },
    rowTitle: { fontSize: type.body, color: palette.ink },
    rowDetail: { marginTop: 2, fontSize: type.caption, color: palette.ink3 },
    rowValue: { fontSize: type.caption, color: palette.ink3 },
    footer: {
      marginTop: spacing.xs,
      paddingHorizontal: 16,
      fontSize: 10.5,
      lineHeight: 14,
      fontWeight: "500",
      color: palette.ink3,
    },
  });
}
