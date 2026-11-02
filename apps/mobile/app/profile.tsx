import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { loadAIConfig, type AIConfig } from '../src/platform/aiConfig';
import { BottomBar } from '../src/ui/BottomBar';
import { colors, spacing, type } from '../src/ui/theme';

export default function ProfileRoute() {
  const router = useRouter();
  const [config, setConfig] = useState<AIConfig | null>(null);
  useEffect(() => { void loadAIConfig().then(setConfig); }, []);
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>我的</Text>
        <View style={styles.identity}>
          <View style={styles.bulb}><SymbolView name="lightbulb" size={34} tintColor={colors.ink} /></View>
          <Text style={styles.name}>书灯</Text>
          <Text style={styles.tagline}>一盏照书的灯</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => router.push('/ai-settings')} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <Text style={styles.rowIcon}>💡</Text>
          <View style={styles.rowBody}><Text style={styles.rowTitle}>AI 服务</Text><Text style={styles.rowDetail}>{config ? `${config.provider} · ${config.model}` : '未配置'}</Text></View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
        <View style={styles.row}><Text style={styles.rowIcon}>☀️</Text><View style={styles.rowBody}><Text style={styles.rowTitle}>外观</Text></View><Text style={styles.rowValue}>跟随系统</Text><Text style={styles.chevron}>›</Text></View>
        <View style={styles.row}><Text style={styles.rowIcon}>📄</Text><View style={styles.rowBody}><Text style={styles.rowTitle}>关于书灯</Text></View><Text style={styles.rowValue}>0.1.0</Text><Text style={styles.chevron}>›</Text></View>
      </ScrollView>
      <BottomBar active="profile" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 16 },
  title: { marginTop: spacing.xs, fontSize: type.title, fontWeight: '700', color: colors.ink },
  identity: { alignItems: 'center', marginTop: spacing.xl },
  bulb: { width: 70, height: 70, borderRadius: 20, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  name: { marginTop: spacing.sm, fontSize: 20, fontWeight: '600', color: colors.ink },
  tagline: { marginTop: 4, fontSize: type.body, color: colors.ink2 },
  row: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  pressed: { opacity: 0.7 },
  rowIcon: { fontSize: 20, width: 26, textAlign: 'center' },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: type.body, color: colors.ink },
  rowDetail: { marginTop: 3, fontSize: type.caption, color: colors.ink2 },
  rowValue: { fontSize: type.caption, color: colors.ink2 },
  chevron: { fontSize: 22, color: colors.ink3 },
});
