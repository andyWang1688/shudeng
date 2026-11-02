import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { startDemoAgent, type DemoEvent } from '../src/agent/agentDemo';
import { colors, radius, spacing } from '../src/ui/theme';

type Entry = {
  readonly id: number;
  readonly kind: 'reasoning' | 'text' | 'tool' | 'citation' | 'state';
  readonly text: string;
};

let entrySequence = 0;

export default function AgentDemoRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ autorun?: string | string[] }>();
  const autorunParam = Array.isArray(params.autorun) ? params.autorun[0] : params.autorun;
  const autorun = autorunParam === '1';
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [running, setRunning] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => cancelRef.current?.();
  }, []);

  // 开发/CI：deep link 带 ?autorun=1 时自动运行，便于在 Hermes 设备环境取证据。
  useEffect(() => {
    if (!autorun) return;
    const timer = setTimeout(() => {
      void run();
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autorun]);

  const append = useCallback((kind: Entry['kind'], text: string) => {
    entrySequence += 1;
    setEntries((current) => [...current, { id: entrySequence, kind, text }]);
  }, []);

  const handleEvent = useCallback(
    (event: DemoEvent) => {
      switch (event.type) {
        case 'started':
          append('state', `开始运行：${event.started.question}`);
          break;
        case 'reasoningDelta':
          append('reasoning', event.delta);
          break;
        case 'textDelta':
          append('text', event.delta);
          break;
        case 'toolStarted':
          append('tool', `调用 ${event.name}`);
          break;
        case 'toolFinished':
          append('tool', `${event.name} ${event.isError ? '失败' : '完成'}（${Math.round(event.durationMs)}ms）`);
          break;
        case 'citation':
          append('citation', `引用 ${event.citation.id}：${event.citation.quote}`);
          break;
        case 'completed':
          append('state', `完成：${event.result.answer}（引用 ${event.result.citations.length} 条，${event.result.steps} 步）`);
          break;
        case 'failed':
          append('state', `失败 ${event.code}：${event.message}`);
          break;
        case 'cancelled':
          append('state', '已取消');
          break;
      }
    },
    [append],
  );

  const run = async () => {
    if (running) return;
    setRunning(true);
    append('state', '启动 @shudeng/core Agent（脚本模型，无网络）');
    const session = startDemoAgent();
    cancelRef.current = () => session.cancel();
    try {
      for await (const event of session.events) handleEvent(event);
      await session.result;
    } catch (error) {
      append('state', `异常：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      cancelRef.current = null;
      setRunning(false);
    }
  };

  const cancel = () => {
    cancelRef.current?.();
    append('state', '请求取消…');
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回书架" onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹ 书架</Text>
        </Pressable>
        <Text style={styles.title}>Agent 演示（Hermes）</Text>
        <View style={styles.chip}><Text style={styles.chipText}>core</Text></View>
      </View>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="运行 Agent" onPress={run} style={[styles.actionButton, running && styles.actionDisabled]}>
          <Text style={styles.actionText}>{running ? '运行中…' : '运行 Agent'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="取消 Agent" onPress={cancel} style={[styles.actionButton, styles.cancelButton]}>
          <Text style={styles.actionText}>取消</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {entries.length === 0 ? (
          <Text style={styles.empty}>点按「运行 Agent」：使用 @shudeng/core 的 InMemoryBookSource + 脚本模型，无真实 Key、无网络。</Text>
        ) : null}
        {entries.map((entry) => (
          <View key={entry.id} style={[styles.entry, styles[`${entry.kind}Entry`]]}>
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
  cancelButton: { backgroundColor: colors.paperDeep },
  actionDisabled: { opacity: 0.6 },
  actionText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.sm, paddingBottom: spacing.lg, gap: spacing.xs },
  empty: { fontSize: 13, lineHeight: 20, color: colors.ink3, padding: spacing.sm },
  entry: { borderRadius: radius.field, padding: spacing.sm, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  reasoningEntry: { backgroundColor: colors.paperDeep },
  textEntry: { backgroundColor: colors.surface },
  toolEntry: { backgroundColor: colors.lampWash },
  citationEntry: { backgroundColor: colors.lampWash },
  stateEntry: { backgroundColor: colors.paperDeep },
  entryKind: { fontSize: 10, textTransform: 'uppercase', color: colors.ink3, marginBottom: 4 },
  entryText: { fontSize: 13, lineHeight: 20, color: colors.ink },
});
