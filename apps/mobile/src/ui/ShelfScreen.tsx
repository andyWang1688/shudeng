import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { embeddingStatus, initializeDatabase, type DatabaseStatus, type EmbeddingStatus } from '../platform';
import { loadShelfBooks, migrateLegacyLibraryIfNeeded, type ShelfBookRecord } from '../platform/library';
import { colors, radius, spacing } from './theme';

type ShelfBook = {
  readonly id: string;
  readonly title: string;
  readonly format: 'EPUB' | 'PDF';
  readonly progress: string;
};

const fallbackBooks: readonly ShelfBook[] = [
  { id: 'epub-hongloumeng', title: '红楼梦', format: 'EPUB', progress: '已读 12%' },
  { id: 'pdf-shudeng-demo', title: '书灯 PDF 示例', format: 'PDF', progress: '第 1 / 2 页' },
];

export function ShelfScreen() {
  const router = useRouter();
  const [database, setDatabase] = useState<DatabaseStatus | null>(null);
  const [embedding, setEmbedding] = useState<EmbeddingStatus | null>(null);
  const [migrated, setMigrated] = useState<readonly ShelfBookRecord[]>([]);
  const [libraryMessage, setLibraryMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void initializeDatabase()
      .then((status) => {
        if (mounted) setDatabase(status);
        if (!status.ok) return;
        return migrateLegacyLibraryIfNeeded()
          .then((result) => {
            if (mounted && result.imported) setLibraryMessage(`旧书库已迁移 ${result.books} 本`);
            if (mounted && result.failures > 0) setLibraryMessage(`旧书库已迁移，${result.failures} 条失败记录`);
            return loadShelfBooks();
          })
          .then((records) => { if (mounted) setMigrated(records); })
          .catch((error: unknown) => {
            if (mounted) setLibraryMessage(error instanceof Error ? error.message : String(error));
          });
      });
    void embeddingStatus().then((status) => {
      if (mounted) setEmbedding(status);
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
          <Pressable accessibilityRole="button" accessibilityLabel="我的" onPress={() => router.push('/profile')} style={styles.profileChip}>
            <Text style={styles.profileText}>我的</Text>
          </Pressable>
        </View>
        <Text style={styles.subtitle}>读原文，问书灯；引用可回原文核对。</Text>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>我的书籍</Text>
          <Text style={styles.sectionCount}>{migrated.length > 0 ? migrated.length : fallbackBooks.length} 本</Text>
        </View>

        {libraryMessage ? <Text style={styles.subtitle}>{libraryMessage}</Text> : null}
        {(migrated.length > 0 ? migrated : fallbackBooks).map((book) => (
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
              <Text style={styles.bookDetail}>{book.format} · {'progress' in book ? book.progress : (book as ShelfBookRecord).author ?? '旧书库已迁移'}</Text>
              <Text style={styles.bookAction}>打开阅读器 ›</Text>
            </View>
          </Pressable>
        ))}

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
