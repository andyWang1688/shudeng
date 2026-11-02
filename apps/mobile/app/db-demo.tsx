import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { runDatabaseDevCheck } from '../src/platform/db';
import { colors, radius, spacing } from '../src/ui/theme';

type Entry = {
  readonly id: number;
  readonly kind: 'init' | 'pass' | 'fail';
  readonly text: string;
};

let entrySequence = 0;

/** 最小 DB dev 验证入口：建表/insert/select + LangGraph checkpoint write/read。 */
export default function DatabaseDemoRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ autorun?: string | string[] }>();
  const autorunParam = Array.isArray(params.autorun) ? params.autorun[0] : params.autorun;
  const autorun = autorunParam === '1';
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [running, setRunning] = useState(false);

  const append = useCallback((kind: Entry['kind'], text: string) => {
    entrySequence += 1;
    setEntries((current) => [...current, { id: entrySequence, kind, text }]);
  }, []);

  const run = useCallback(async () => {
    setRunning(true);
    setEntries([]);
    append('init', '初始化：openDatabaseAsync → PRAGMA → driver → migrate → store/saver');
    try {
      const checked = await runDatabaseDevCheck();
      append(checked.init.ok ? 'pass' : 'fail', `初始化 ${checked.init.engine}：${checked.init.detail}`);
      if (checked.report) {
        for (const step of checked.report.steps) {
          append(step.ok ? 'pass' : 'fail', `${step.name}：${step.detail}`);
        }
        append(
          checked.report.ok ? 'pass' : 'fail',
          `DB dev check ${checked.report.ok ? 'PASS' : 'FAIL'}（${checked.report.steps.length} 项）`,
        );
      } else {
        append('fail', 'Web stub：本地数据库不在 Web 预览中运行，iOS/Android 才验证。');
      }
    } catch (error) {
      append('fail', `异常：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRunning(false);
    }
  }, [append]);

  useEffect(() => {
    if (!autorun) return;
    const timer = setTimeout(() => void run(), 500);
    return () => clearTimeout(timer);
  }, [autorun, run]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回书架" onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹ 书架</Text>
        </Pressable>
        <Text style={styles.title}>数据库验证（spike）</Text>
        <View style={styles.chip}><Text style={styles.chipText}>core/db</Text></View>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="运行数据库验证"
          onPress={() => void run()}
          style={[styles.actionButton, running && styles.actionDisabled]}
        >
          <Text style={styles.actionText}>{running ? '运行中…' : '运行数据库验证'}</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {entries.length === 0 ? (
          <Text style={styles.empty}>
            点按「运行数据库验证」：建表/迁移、books/messages/citations/checkpoint 读写、LangGraph checkpoint
            write/read（不接真实 AI，不需要 Key）。
          </Text>
        ) : null}
        {entries.map((entry) => (
          <View
            key={entry.id}
            style={[
              styles.entry,
              entry.kind === 'fail' ? styles.failEntry : entry.kind === 'pass' ? styles.passEntry : styles.initEntry,
            ]}
          >
            <Text style={styles.entryKind}>{entry.kind}</Text>
            <Text style={styles.entryText}>{entry.text}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  backButton: { paddingVertical: 6, paddingRight: spacing.sm },
  backText: { fontSize: 15, color: colors.lamp },
  title: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.ink },
  chip: { borderRadius: radius.field, backgroundColor: colors.paperDeep, paddingHorizontal: spacing.xs, paddingVertical: 3 },
  chipText: { fontSize: 11, color: colors.ink2 },
  actions: { flexDirection: 'row', gap: spacing.xs, padding: spacing.sm },
  actionButton: { flex: 1, borderRadius: radius.field, backgroundColor: colors.lamp, paddingVertical: 11, alignItems: 'center' },
  actionDisabled: { opacity: 0.6 },
  actionText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.sm, paddingBottom: spacing.lg, gap: spacing.xs },
  empty: { fontSize: 13, lineHeight: 20, color: colors.ink3, padding: spacing.sm },
  entry: { borderRadius: radius.field, padding: spacing.sm, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  initEntry: { backgroundColor: colors.paperDeep },
  passEntry: { backgroundColor: colors.lampWash },
  failEntry: { backgroundColor: colors.paperDeep, borderColor: colors.danger },
  entryKind: { fontSize: 10, textTransform: 'uppercase', color: colors.ink3, marginBottom: 4 },
  entryText: { fontSize: 13, lineHeight: 20, color: colors.ink },
});
