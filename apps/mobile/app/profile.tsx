import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { loadAIConfig, type AIConfig } from '../src/platform/aiConfig';
import { BottomBar } from '../src/ui/BottomBar';
import { spacing, type, usePalette, type Palette } from '../src/ui/theme';

const PROVIDER_LABEL: Record<AIConfig['provider'], string> = {
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

const APP_VERSION = '0.4.8';

export default function ProfileRoute() {
  const router = useRouter();
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [config, setConfig] = useState<AIConfig | null>(null);

  useEffect(() => {
    void loadAIConfig().then(setConfig);
  }, []);

  const aiDetail = config ? `${PROVIDER_LABEL[config.provider] ?? config.provider} · ${config.model}` : '未配置';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>我的</Text>
        <View style={styles.identity}>
          <View style={styles.bulb}>
            <SymbolView name="lightbulb" size={34} tintColor={palette.ink} />
          </View>
          <Text style={styles.name}>书灯</Text>
          <Text style={styles.tagline}>一盏照书的灯</Text>
        </View>

        <Pressable accessibilityRole="button" onPress={() => router.push('/ai-settings')} style={({ pressed }) => [styles.row, styles.firstRow, pressed && styles.pressed]}>
          <View style={styles.rowIconSlot}><SymbolView name="lightbulb" size={20} tintColor={palette.lamp} /></View>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>AI 服务</Text>
            <Text style={styles.rowDetail} numberOfLines={1}>{aiDetail}</Text>
          </View>
          <SymbolView name="chevron.right" size={17} tintColor={palette.ink3} />
        </Pressable>

        <View style={styles.row}>
          <View style={styles.rowIconSlot}><SymbolView name="sun.max" size={20} tintColor={palette.lamp} /></View>
          <View style={styles.rowBody}><Text style={styles.rowTitle}>外观</Text></View>
          <Text style={styles.rowValue}>跟随系统</Text>
          <SymbolView name="chevron.right" size={17} tintColor={palette.ink3} />
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => Alert.alert('关于书灯', '书灯 · 本地阅读与 AI 助手\n版本 ' + APP_VERSION)}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <View style={styles.rowIconSlot}><SymbolView name="doc.text" size={20} tintColor={palette.lamp} /></View>
          <View style={styles.rowBody}><Text style={styles.rowTitle}>关于书灯</Text></View>
          <Text style={styles.rowValue}>{APP_VERSION}</Text>
          <SymbolView name="chevron.right" size={17} tintColor={palette.ink3} />
        </Pressable>
      </ScrollView>
      <BottomBar active="profile" />
    </SafeAreaView>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: palette.paper },
    content: { paddingHorizontal: spacing.screen, paddingBottom: 16 },
    title: { marginTop: 11, fontSize: type.title, fontWeight: '700', color: palette.ink },
    identity: { alignItems: 'center', marginTop: 27, marginBottom: 0 },
    bulb: {
      width: 70,
      height: 70,
      borderRadius: 16,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    name: { marginTop: 19, fontSize: 20, fontWeight: '600', color: palette.ink },
    tagline: { marginTop: 14, fontSize: type.body, color: palette.ink2 },
    firstRow: { marginTop: 38, borderTopWidth: 1, borderTopColor: palette.line },
    row: {
      minHeight: 66,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderBottomWidth: 1,
      borderBottomColor: palette.line,
    },
    pressed: { opacity: 0.7 },
    rowIconSlot: { width: 26, alignItems: 'flex-start' },
    rowBody: { flex: 1 },
    rowTitle: { fontSize: type.body, color: palette.ink },
    rowDetail: { marginTop: 3, fontSize: type.caption, color: palette.ink2 },
    rowValue: { fontSize: type.caption, color: palette.ink2 },
  });
}
