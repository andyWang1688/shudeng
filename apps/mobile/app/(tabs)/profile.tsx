import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { loadAIConfig, type AIConfig } from '../../src/platform/aiConfig';
import { useAppearance, type AppearanceMode } from '../../src/ui/appearance';
import { spacing, type, usePalette, type Palette } from '../../src/ui/theme';

const PROVIDER_LABEL: Record<AIConfig['provider'], string> = {
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

const APP_VERSION = '0.4.8';

const APPEARANCE_LABEL: Record<AppearanceMode, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
};

export default function ProfileRoute() {
  const router = useRouter();
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const { mode } = useAppearance();
  const [config, setConfig] = useState<AIConfig | null>(null);

  useEffect(() => {
    void loadAIConfig().then(setConfig);
  }, []);

  const aiDetail = config ? `${PROVIDER_LABEL[config.provider] ?? config.provider} · ${config.model}` : '未配置';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionHeader}>设置</Text>
        <View style={styles.card}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="AI 服务"
            onPress={() => router.push('/ai-settings')}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.iconSlot}>
              <SymbolView name="lightbulb" size={20} tintColor={palette.lamp} />
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>AI 服务</Text>
              <Text style={styles.rowDetail} numberOfLines={1}>{aiDetail}</Text>
            </View>
            <SymbolView name="chevron.right" size={17} tintColor={palette.ink3} />
          </Pressable>
          <View style={styles.separator} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="外观"
            accessibilityValue={{ text: APPEARANCE_LABEL[mode] }}
            onPress={() => router.push('/appearance')}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.iconSlot}>
              <SymbolView name="sun.max" size={20} tintColor={palette.ink2} />
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>外观</Text>
            </View>
            <Text style={styles.rowValue}>{APPEARANCE_LABEL[mode]}</Text>
            <SymbolView name="chevron.right" size={17} tintColor={palette.ink3} />
          </Pressable>
        </View>

        <Text style={styles.sectionHeader}>关于</Text>
        <View style={styles.card}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关于书灯"
            onPress={() => router.push('/about')}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.iconSlot}>
              <SymbolView name="doc.text" size={20} tintColor={palette.ink2} />
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>关于书灯</Text>
            </View>
            <Text style={styles.rowValue}>{APP_VERSION}</Text>
            <SymbolView name="chevron.right" size={17} tintColor={palette.ink3} />
          </Pressable>
        </View>
        <Text style={styles.footer}>书灯 {APP_VERSION} · 读得慢一点，也想得明白一点</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: palette.paper },
    content: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: 24 },
    sectionHeader: {
      marginTop: spacing.lg,
      marginBottom: spacing.xs,
      paddingHorizontal: spacing.xxs,
      fontSize: type.subhead,
      color: palette.ink3,
    },
    card: {
      backgroundColor: palette.surface,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.line,
      overflow: 'hidden',
    },
    row: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    pressed: { opacity: 0.7 },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: palette.line,
      marginLeft: spacing.md + 26 + spacing.sm,
    },
    iconSlot: { width: 26 },
    rowBody: { flex: 1 },
    rowTitle: { fontSize: type.body, color: palette.ink },
    rowDetail: { marginTop: 2, fontSize: type.caption, color: palette.ink2 },
    rowValue: { fontSize: type.caption, color: palette.ink2 },
    footer: {
      marginTop: spacing.xs,
      paddingHorizontal: spacing.xxs,
      fontSize: type.footnote,
      lineHeight: 18,
      color: palette.ink3,
    },
  });
}
