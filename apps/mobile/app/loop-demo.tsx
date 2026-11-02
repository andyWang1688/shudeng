import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  runBookAgent,
  type AgentEvent,
} from '@shudeng/core/agent';
import { createScriptedModel } from '@shudeng/core/agent/testing';
import type { BookIdentity } from '@shudeng/core/domain';
import { ParagraphTextChunker, SqliteBookSource, SqliteSearchIndex, indexRagBook } from '@shudeng/core/rag';
import { getDataLayer } from '../src/platform/db';
import { createExpoEmbeddingProvider } from '../src/platform/embedding';
import { colors, radius, spacing } from '../src/ui/theme';

const book: BookIdentity = {
  id: 'v5-loop-lamp',
  title: 'V5 闭环演示',
  format: 'epub',
  sourceHash: 'v5-loop-source',
};

const chapters = [
  {
    ordinal: 1,
    title: '第一章 · 灯',
    paragraphs: [
      '灯把书页照亮，也把问题留在纸上。',
      '阅读不是把答案抄下来，而是把原文读慢一点。',
    ],
  },
];

function createLoopModel() {
  return createScriptedModel([
  {
    chunks: [
      { reasoning: '先用书内检索找和「灯」有关的原文。', delayMs: 80 },
      { toolCalls: [{ id: 'call-search', name: 'search_book', args: { query: '灯' } }], delayMs: 80 },
    ],
  },
  {
    chunks: [
      { reasoning: '找到原文，引用并回答。', delayMs: 80 },
      {
        text: JSON.stringify({
          answer: '## 灯的含义\n\n灯把书页照亮，也提醒读者停下来想。',
          citations: [{ id: 'E1', quote: '灯把书页照亮，也把问题留在纸上。' }],
        }),
        delayMs: 80,
      },
    ],
  },
]);
}

type Entry = { id: number; kind: string; text: string };
let sequence = 0;

export default function LoopDemoRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ autorun?: string | string[] }>();
  const autorunParam = Array.isArray(params.autorun) ? params.autorun[0] : params.autorun;
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [citationLocator, setCitationLocator] = useState<string | null>(null);
  const autorunStarted = useRef(false);

  const append = useCallback((kind: string, text: string) => {
    sequence += 1;
    setEntries((current) => [...current, { id: sequence, kind, text }]);
  }, []);

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setEntries([]);
    setSummary(null);
    setCitationLocator(null);
    setDone(false);
    const model = createLoopModel();
    try {
      append('STEP', '初始化 SQLite / Drizzle');
      const layer = await getDataLayer();
      append('PASS', `数据库就绪；迁移 ${layer.migration.applied.length} 个`);
      const embedding = createExpoEmbeddingProvider();
      const index = new SqliteSearchIndex(layer.driver, embedding);
      await index.deleteBook(book.id).catch(() => undefined);
      append('STEP', '切块 + 真实 ONNX embedding + FTS/vector 索引');
      const indexed = await indexRagBook({
        index,
        chunker: new ParagraphTextChunker(),
        embedding,
        book: { book, chapters },
      });
      append('PASS', `索引 ${indexed.chunks.length} 块，${embedding.dimension} 维`);
      const source = new SqliteBookSource(index, book);
      append('STEP', 'LangChain Agent：search_book → 引用核对 → 回答');
      const session = runBookAgent({ model, source, book, question: '灯在书里是什么意思？' });
      let lastCitation: string | null = null;
      for await (const event of session.events) {
        if (event.type === 'citation') lastCitation = event.citation.locator;
        handle(event, append);
      }
      setCitationLocator(lastCitation);
      const result = await session.result;
      if (result) {
        append('PASS', `闭环完成：${result.citations.length} 条引用，${result.steps} 步`);
        setSummary(`PASS · ${result.citations.length} 条引用 · ${result.steps} 步 · ${result.answer.replace(/^#+\s*/gm, '').slice(0, 80)}`);
      }
      else append('FAIL', 'Agent 没有返回结果');
      setDone(result !== null);
    } catch (error) {
      append('FAIL', error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  }, [append, running]);

  useEffect(() => {
    if (autorunParam !== '1' || autorunStarted.current) return;
    autorunStarted.current = true;
    const timer = setTimeout(() => void run(), 600);
    return () => clearTimeout(timer);
  }, [autorunParam]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹ 书架</Text>
        </Pressable>
        <Text style={styles.title}>V5 闭环（Hermes）</Text>
        <View style={styles.chip}><Text style={styles.chipText}>{done ? 'done' : 'core'}</Text></View>
      </View>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={() => void run()} style={[styles.actionButton, running && styles.disabled]}>
          <Text style={styles.actionText}>{running ? '运行中…' : '运行闭环'}</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {summary ? (
          <>
            <View style={styles.summary}><Text style={styles.summaryText}>{summary}</Text></View>
            {citationLocator ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/reader/[id]', params: { id: 'epub-hongloumeng', locator: 'epubcfi(/6/2!/4/2/2)' } })}
                style={styles.openReader}
              >
                <Text style={styles.openReaderText}>回原文查看引用（示例 EPUB 定位）</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
        {entries.length === 0 ? <Text style={styles.empty}>旧库/迁移 → SQLite → 真实 ONNX 索引 → Agent → 引用核对。</Text> : null}
        {entries.map((entry) => (
          <View key={entry.id} style={[styles.entry, entry.kind === 'PASS' && styles.pass, entry.kind === 'FAIL' && styles.fail]}>
            <Text style={styles.kind}>{entry.kind}</Text>
            <Text style={styles.text}>{entry.text}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function handle(event: AgentEvent, append: (kind: string, text: string) => void): void {
  switch (event.type) {
    case 'started': append('STATE', `启动 ${event.started.question}`); break;
    case 'reasoningDelta': append('REASONING', event.delta); break;
    case 'textDelta': append('TEXT', event.delta); break;
    case 'toolStarted': append('TOOL', `调用 ${event.name}`); break;
    case 'toolFinished': append('TOOL', `${event.name} 完成`); break;
    case 'citation': append('CITATION', `引用 ${event.citation.id}：${event.citation.quote}`); break;
    case 'completed': append('PASS', `回答：${event.result.answer}`); break;
    case 'failed': append('FAIL', event.message); break;
    case 'cancelled': append('STATE', '已取消'); break;
  }
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
  entry: { borderRadius: radius.field, padding: spacing.sm, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  pass: { backgroundColor: colors.lampWash },
  fail: { backgroundColor: '#f6e3df' },
  summary: { backgroundColor: '#dcead8', borderRadius: radius.field, padding: spacing.sm },
  summaryText: { fontSize: 12, lineHeight: 18, color: colors.ink },
  openReader: { alignSelf: 'flex-start', backgroundColor: colors.lampWash, borderRadius: radius.field, paddingHorizontal: spacing.sm, paddingVertical: 8 },
  openReaderText: { fontSize: 12, color: colors.ink, fontWeight: '600' },
  kind: { fontSize: 10, textTransform: 'uppercase', color: colors.ink3, marginBottom: 4 },
  text: { fontSize: 13, lineHeight: 20, color: colors.ink },
});
