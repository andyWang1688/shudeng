import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { colors, radius, spacing } from '../src/ui/theme';
import { hasAIConfig } from '../src/platform/aiConfig';

export default function ProfileRoute() {
  const router = useRouter();
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const version = Constants.expoConfig?.version ?? '1.0.0';

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      void hasAIConfig().then((configured) => {
        if (mounted) setAiConfigured(configured);
      });
      return () => {
        mounted = false;
      };
    }, []),
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回书架" onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.back}>‹ 书架</Text>
        </Pressable>
        <Text style={styles.title}>我的</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.avatar}><Text style={styles.avatarText}>灯</Text></View>
          <View style={styles.heroText}>
            <Text style={styles.heroTitle}>书灯</Text>
            <Text style={styles.heroDetail}>读原文，问书灯；引用可回原文核对。</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>服务</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="AI 服务" onPress={() => router.push('/ai-settings')} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle}>AI 服务</Text>
            <Text style={styles.rowDetail}>配置 DeepSeek / OpenAI / Anthropic，用于书内问答</Text>
          </View>
          <View style={styles.rowTrailing}>
            <Text style={[styles.status, aiConfigured ? styles.statusOn : styles.statusOff]}>
              {aiConfigured === null ? '' : aiConfigured ? '已配置' : '未配置'}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </View>
        </Pressable>

        <Text style={styles.sectionLabel}>关于</Text>
        <View style={styles.row}>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle}>书灯 · 本地阅读与 AI 助手</Text>
            <Text style={styles.rowDetail}>书籍、进度、标注与问答数据仅保存在本机；AI 请求直连你配置的服务商。</Text>
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle}>版本</Text>
            <Text style={styles.rowDetail}>{version}</Text>
          </View>
        </View>
        <Text style={styles.privacy}>API Key 保存在本机 SecureStore，不会上传到书灯服务器。</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  backButton: { paddingVertical: 6, paddingRight: spacing.sm },
  back: { fontSize: 15, color: colors.lamp },
  title: { fontSize: 20, fontWeight: '600', color: colors.ink },
  content: { padding: spacing.lg, gap: spacing.sm },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.xs },
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.lampWash, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 24, fontWeight: '600', color: colors.lamp },
  heroText: { flex: 1 },
  heroTitle: { fontSize: 22, fontWeight: '600', color: colors.ink },
  heroDetail: { marginTop: 4, fontSize: 12, lineHeight: 18, color: colors.ink3 },
  sectionLabel: { marginTop: spacing.md, marginBottom: 2, fontSize: 12, fontWeight: '600', color: colors.ink3 },
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.card, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  pressed: { opacity: 0.72 },
  rowMain: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.ink },
  rowDetail: { marginTop: 5, fontSize: 12, lineHeight: 18, color: colors.ink2 },
  rowTrailing: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: spacing.sm },
  status: { fontSize: 12, fontWeight: '600' },
  statusOn: { color: colors.lamp },
  statusOff: { color: colors.ink3 },
  chevron: { fontSize: 20, color: colors.ink3 },
  privacy: { marginTop: spacing.sm, fontSize: 11, lineHeight: 17, color: colors.ink3, textAlign: 'center' },
});
