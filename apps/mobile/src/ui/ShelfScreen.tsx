import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { initializeDatabase, type DatabaseStatus } from '../platform';
import { colors, radius, spacing } from './theme';

type ShelfBook = {
  readonly id: string;
  readonly title: string;
  readonly format: 'EPUB' | 'PDF';
  readonly progress: string;
};

const books: readonly ShelfBook[] = [
  { id: 'epub-hongloumeng', title: '红楼梦', format: 'EPUB', progress: '已读 12%' },
  { id: 'pdf-shudeng-demo', title: '书灯 PDF 示例', format: 'PDF', progress: '第 1 / 2 页' },
];

export function ShelfScreen() {
  const router = useRouter();
  const [database, setDatabase] = useState<DatabaseStatus | null>(null);

  useEffect(() => {
    let mounted = true;
    void initializeDatabase().then((status) => {
      if (mounted) setDatabase(status);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>书架</Text>
          <View style={styles.profileChip}>
            <Text style={styles.profileText}>我的</Text>
          </View>
        </View>
        <Text style={styles.subtitle}>Expo 双端壳 · 只验证导航 / WebView / SQLite 基础，不复制 Swift UI</Text>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>我的书籍</Text>
          <Text style={styles.sectionCount}>{books.length} 本</Text>
        </View>

        {books.map((book) => (
          <Pressable
            key={book.id}
            accessibilityRole="button"
            accessibilityLabel={`打开${book.title}`}
            onPress={() => router.push({ pathname: '/reader/[id]', params: { id: book.id } })}
            style={({ pressed }) => [styles.bookCard, pressed && styles.pressed]}
          >
            <View style={styles.cover}>
              <Text style={styles.coverText}>{book.title.slice(0, 2)}</Text>
            </View>
            <View style={styles.bookMeta}>
              <Text style={styles.bookTitle} numberOfLines={2}>{book.title}</Text>
              <Text style={styles.bookDetail}>{book.format} · {book.progress}</Text>
              <Text style={styles.bookAction}>打开阅读器 ›</Text>
            </View>
          </Pressable>
        ))}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="打开问答面板"
          onPress={() => router.push('/ask')}
          style={({ pressed }) => [styles.askCard, pressed && styles.pressed]}
        >
          <Text style={styles.askTitle}>问问书灯</Text>
          <Text style={styles.askDetail}>问答面板占位：Agent 由 @shudeng/core 提供，本任务不实现第二套 Agent。</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="打开 Agent 演示"
          onPress={() => router.push('/agent-demo')}
          style={({ pressed }) => [styles.agentCard, pressed && styles.pressed]}
        >
          <Text style={styles.askTitle}>Agent 演示（Hermes）</Text>
          <Text style={styles.askDetail}>在设备内运行 @shudeng/core 的 LangChain Agent：脚本模型 + 内存书源，显示 reasoning / text / tool / citation 事件。</Text>
        </Pressable>

        <View style={styles.dbCard}>
          <Text style={styles.dbTitle}>平台能力自检</Text>
          <Text style={styles.dbDetail}>SQLite：{database === null ? '正在初始化…' : database.detail}</Text>
          <Text style={styles.dbDetail}>WebView / 导航：打开任一书籍进入阅读器壳验证</Text>
          <Text style={styles.dbHint}>真机/模拟器未在此任务验证时，报告中标记为未验证。</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  scroll: { flex: 1 },
  content: { width: '100%', padding: spacing.lg, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 32, fontWeight: '600', color: colors.ink },
  profileChip: { borderRadius: radius.field, backgroundColor: colors.paperDeep, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  profileText: { fontSize: 13, color: colors.ink2 },
  subtitle: { marginTop: spacing.xs, fontSize: 13, lineHeight: 20, color: colors.ink3 },
  sectionHeader: { marginTop: spacing.lg, marginBottom: spacing.sm, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: colors.ink },
  sectionCount: { fontSize: 12, color: colors.ink3 },
  bookCard: {
    flexDirection: 'row',
    padding: spacing.sm,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    marginBottom: spacing.sm,
  },
  pressed: { opacity: 0.72 },
  cover: {
    width: 66,
    height: 92,
    borderRadius: radius.field,
    backgroundColor: colors.paperDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverText: { fontSize: 18, fontWeight: '600', color: colors.ink2 },
  bookMeta: { flex: 1, marginLeft: spacing.sm, justifyContent: 'center' },
  bookTitle: { fontSize: 16, fontWeight: '600', color: colors.ink },
  bookDetail: { marginTop: 4, fontSize: 12, color: colors.ink3 },
  bookAction: { marginTop: 8, fontSize: 12, color: colors.lamp },
  askCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.card,
    backgroundColor: colors.lampWash,
  },
  agentCard: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  askTitle: { fontSize: 16, fontWeight: '600', color: colors.ink },
  askDetail: { marginTop: 6, fontSize: 12, lineHeight: 18, color: colors.ink2 },
  dbCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.card,
    backgroundColor: colors.paperDeep,
  },
  dbTitle: { fontSize: 14, fontWeight: '600', color: colors.ink },
  dbDetail: { marginTop: 6, fontSize: 12, lineHeight: 18, color: colors.ink2 },
  dbHint: { marginTop: 6, fontSize: 11, lineHeight: 16, color: colors.ink3 },
});
