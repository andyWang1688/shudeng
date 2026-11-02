import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { AgentEvent } from '@shudeng/core/agent';
import { startLiveAgent } from '../src/agent/liveAgent';
import { colors, radius, spacing } from '../src/ui/theme';

type Entry = { id: number; kind: string; text: string };
let sequence = 0;

export default function LiveAgentRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ autorun?: string | string[] }>();
  const autorun = (Array.isArray(params.autorun) ? params.autorun[0] : params.autorun) === '1';
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const started = useRef(false);

  const append = useCallback((kind: string, text: string) => {
    sequence += 1;
    setEntries((current) => [...current, { id: sequence, kind, text }]);
  }, []);

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setEntries([]);
    setSummary(null);
    try {
      append('STEP', '读取 live-agent.json（开发配置，不写入源码）');
      const session = startLiveAgent('灯在书里是什么意思？');
      let reasoning = 0;
      for await (const event of session.events as AsyncIterable<AgentEvent>) {
        if (event.type === 'started') append('STATE', `真实模型 ${event.started.provider}/${event.started.model}`);
        if (event.type === 'reasoningDelta') { reasoning += event.delta.length; append('REASONING', event.delta); }
        if (event.type === 'textDelta') append('TEXT', event.delta);
        if (event.type === 'toolStarted') append('TOOL', `调用 ${event.name}`);
        if (event.type === 'toolFinished') append('TOOL', `${event.name} 完成`);
        if (event.type === 'citation') append('CITATION', `${event.citation.id}：${event.citation.quote}`);
        if (event.type === 'completed') setSummary(`PASS · ${event.result.citations.length} 引用 · ${event.result.steps} 步 · reasoning ${reasoning} 字`);
        if (event.type === 'failed') append('FAIL', event.message);
        if (event.type === 'cancelled') append('STATE', '已取消');
      }
      const result = await session.result;
      if (!result) setSummary('FAIL · 无结果');
    } catch (error) {
      append('FAIL', error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  }, [append, running]);

  useEffect(() => {
    if (!autorun || started.current) return;
    started.current = true;
    const timer = setTimeout(() => void run(), 500);
    return () => clearTimeout(timer);
  }, [autorun]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}><Text style={styles.backText}>‹ 书架</Text></Pressable>
        <Text style={styles.title}>真实模型（开发）</Text>
        <View style={styles.chip}><Text style={styles.chipText}>{running ? 'run' : 'live'}</Text></View>
      </View>
      <View style={styles.actions}><Pressable accessibilityRole="button" onPress={() => void run()} style={[styles.actionButton, running && styles.disabled]}><Text style={styles.actionText}>{running ? '运行中…' : '运行真实模型'}</Text></Pressable></View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {summary ? <View style={styles.summary}><Text style={styles.summaryText}>{summary}</Text></View> : null}
        {entries.length === 0 ? <Text style={styles.empty}>在 App Documents 放 live-agent.json；不把 key 提交仓库。</Text> : null}
        {entries.map((entry) => <View key={entry.id} style={styles.entry}><Text style={styles.kind}>{entry.kind}</Text><Text style={styles.text}>{entry.text}</Text></View>)}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  toolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  backButton: { paddingVertical: 6, paddingRight: spacing.sm },
  backText: { fontSize: 15, color: colors.lamp },
  title: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.ink },
  chip: { borderRadius: radius.field, backgroundColor: colors.paperDeep, paddingHorizontal: spacing.xs, paddingVertical: 3 },
  chipText: { fontSize: 11, color: colors.ink2 },
  actions: { flexDirection: 'row', padding: spacing.sm },
  actionButton: { flex: 1, borderRadius: radius.field, backgroundColor: colors.lamp, paddingVertical: 11, alignItems: 'center' },
  disabled: { opacity: 0.6 },
  actionText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.sm, paddingBottom: spacing.lg, gap: spacing.xs },
  empty: { fontSize: 13, lineHeight: 20, color: colors.ink3, padding: spacing.sm },
  summary: { backgroundColor: '#dcead8', borderRadius: radius.field, padding: spacing.sm },
  summaryText: { fontSize: 12, lineHeight: 18, color: colors.ink },
  entry: { borderRadius: radius.field, padding: spacing.sm, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  kind: { fontSize: 10, textTransform: 'uppercase', color: colors.ink3, marginBottom: 4 },
  text: { fontSize: 13, lineHeight: 20, color: colors.ink },
});
