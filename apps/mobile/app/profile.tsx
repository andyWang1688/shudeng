import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, radius, spacing } from '../src/ui/theme';

export default function ProfileRoute() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回书架" onPress={() => router.back()} style={styles.backButton}><Text style={styles.back}>‹ 书架</Text></Pressable>
        <Text style={styles.title}>我的</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityRole="button" onPress={() => router.push('/ai-settings')} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
          <Text style={styles.cardTitle}>AI 服务</Text>
          <Text style={styles.cardDetail}>配置 DeepSeek / Anthropic / OpenAI，用于书内问答</Text>
        </Pressable>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>书灯</Text>
          <Text style={styles.cardDetail}>轻量阅读与书内 AI 助手</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  backButton: { paddingVertical: 6, paddingRight: spacing.sm },
  back: { fontSize: 15, color: colors.lamp },
  title: { fontSize: 17, fontWeight: '600', color: colors.ink },
  content: { padding: spacing.lg, gap: spacing.sm },
  card: { padding: spacing.md, borderRadius: radius.card, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  pressed: { opacity: 0.72 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.ink },
  cardDetail: { marginTop: 6, fontSize: 12, lineHeight: 18, color: colors.ink2 },
});
