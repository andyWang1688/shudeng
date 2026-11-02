import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { initializeDatabase } from '../platform';
import {
  deleteShelfBook,
  importBookFromPicker,
  loadShelfBooks,
  migrateLegacyLibraryIfNeeded,
  type ShelfBookRecord,
} from '../platform/library';
import { colors, radius, spacing } from './theme';

const COVER_TONES = [colors.lampWash, colors.paperDeep, '#DCE6DA', '#E3DCE8'];

function coverTone(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return COVER_TONES[hash % COVER_TONES.length] ?? colors.paperDeep;
}

export function ShelfScreen() {
  const router = useRouter();
  const [books, setBooks] = useState<readonly ShelfBookRecord[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const database = await initializeDatabase();
    if (!database.ok) {
      setError(`本地数据库不可用：${database.detail}`);
      setLoading(false);
      return;
    }
    try {
      const migration = await migrateLegacyLibraryIfNeeded();
      if (migration.failures > 0) setNotice(`旧版书库有 ${migration.failures} 条记录未能迁移`);
      const records = await loadShelfBooks();
      setBooks(records);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message.startsWith('旧书库') ? message : `书架加载失败：${message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const filtered = query.trim().length === 0
    ? books
    : books.filter((book) => {
        const needle = query.trim().toLowerCase();
        return book.title.toLowerCase().includes(needle) || (book.author ?? '').toLowerCase().includes(needle);
      });

  const handleImport = async () => {
    if (importing) return;
    setImporting(true);
    setNotice(null);
    try {
      const result = await importBookFromPicker();
      if (result.status === 'imported') {
        setNotice(`已导入《${result.book.title}》`);
        await load();
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      Alert.alert('导入失败', message);
    } finally {
      setImporting(false);
    }
  };

  const removeBook = async (book: ShelfBookRecord) => {
    try {
      await deleteShelfBook(book.id);
      setNotice(`已删除《${book.title}》`);
      await load();
    } catch (cause) {
      Alert.alert('删除失败', cause instanceof Error ? cause.message : String(cause));
    }
  };

  const confirmDelete = (book: ShelfBookRecord) => {
    Alert.alert(
      '删除书籍',
      `删除《${book.title}》以及它的阅读进度、标注和书签？`,
      [
        { text: '取消', style: 'cancel' },
        { text: '删除', style: 'destructive', onPress: () => void removeBook(book) },
      ],
    );
  };

  const openBook = (book: ShelfBookRecord) => {
    router.push({ pathname: '/reader/[id]', params: { id: book.id } });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.title}>书架</Text>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="导入书籍"
            disabled={importing}
            onPress={() => void handleImport()}
            style={({ pressed }) => [styles.importButton, (pressed || importing) && styles.pressed]}
          >
            {importing ? <ActivityIndicator size="small" color={colors.ink} /> : <Text style={styles.importText}>＋ 导入</Text>}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="我的"
            onPress={() => router.push('/profile')}
            style={({ pressed }) => [styles.profileChip, pressed && styles.pressed]}
          >
            <Text style={styles.profileText}>我的</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          accessibilityLabel="搜索书架"
          value={query}
          onChangeText={setQuery}
          placeholder="搜索书名或作者"
          placeholderTextColor={colors.ink3}
          returnKeyType="search"
          style={styles.searchInput}
        />
        {query.length > 0 ? (
          <Pressable accessibilityRole="button" accessibilityLabel="清除搜索" onPress={() => setQuery('')} hitSlop={8}>
            <Text style={styles.clearSearch}>×</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>书架暂时不可用</Text>
            <Text style={styles.errorDetail}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retryButton}>
              <Text style={styles.retryText}>重试</Text>
            </Pressable>
          </View>
        ) : loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.lamp} />
            <Text style={styles.loadingText}>正在整理书架…</Text>
          </View>
        ) : books.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyCover}><Text style={styles.emptyCoverText}>书</Text></View>
            <Text style={styles.emptyTitle}>书架还是空的</Text>
            <Text style={styles.emptyDetail}>从「文件」中导入 EPUB 或 PDF，开始阅读并和书灯讨论。</Text>
            <Pressable accessibilityRole="button" onPress={() => void handleImport()} disabled={importing} style={styles.emptyButton}>
              <Text style={styles.emptyButtonText}>{importing ? '正在导入…' : '导入第一本书'}</Text>
            </Pressable>
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.noResult}>
            <Text style={styles.noResultTitle}>没有找到相关书籍</Text>
            <Text style={styles.emptyDetail}>换个书名或作者关键词试试。</Text>
          </View>
        ) : (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{query.trim() ? '搜索结果' : '我的书籍'}</Text>
              <Text style={styles.sectionCount}>{filtered.length} 本</Text>
            </View>
            {filtered.map((book) => (
              <Pressable
                key={book.id}
                accessibilityRole="button"
                accessibilityLabel={`打开${book.title}`}
                onPress={() => openBook(book)}
                onLongPress={() => confirmDelete(book)}
                delayLongPress={450}
                style={({ pressed }) => [styles.bookCard, pressed && styles.pressed]}
              >
                <View style={[styles.cover, { backgroundColor: coverTone(book.id) }]}>
                  <Text style={styles.coverText}>{book.title.slice(0, 2)}</Text>
                </View>
                <View style={styles.bookMeta}>
                  <Text style={styles.bookTitle} numberOfLines={2}>{book.title}</Text>
                  <Text style={styles.bookDetail}>
                    {book.format}{book.author ? ` · ${book.author}` : ''} · {book.progressLabel}
                  </Text>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${Math.max(1, Math.round((book.progressPercent ?? 0) * 1))}%` }]} />
                  </View>
                  <Text style={styles.bookAction}>继续阅读 ›</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`管理${book.title}`}
                  hitSlop={8}
                  onPress={() => confirmDelete(book)}
                  style={styles.moreButton}
                >
                  <Text style={styles.moreText}>⋯</Text>
                </Pressable>
              </Pressable>
            ))}
            <Text style={styles.hint}>长按书籍或点「⋯」可删除。</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  title: { fontSize: 32, fontWeight: '600', color: colors.ink, letterSpacing: 0.2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  importButton: {
    borderRadius: radius.field,
    backgroundColor: colors.lamp,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    minWidth: 64,
    alignItems: 'center',
  },
  importText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  profileChip: { borderRadius: radius.field, backgroundColor: colors.paperDeep, paddingHorizontal: spacing.sm, paddingVertical: 7 },
  profileText: { fontSize: 13, color: colors.ink2 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.field,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  searchIcon: { fontSize: 17, color: colors.ink3 },
  searchInput: { flex: 1, paddingVertical: 9, fontSize: 14, color: colors.ink },
  clearSearch: { fontSize: 20, lineHeight: 22, color: colors.ink3, paddingHorizontal: 2 },
  scroll: { flex: 1 },
  content: { width: '100%', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 48 },
  notice: { marginTop: spacing.sm, fontSize: 12, color: colors.ink2, backgroundColor: colors.lampWash, borderRadius: radius.field, padding: spacing.sm },
  sectionHeader: { marginTop: spacing.md, marginBottom: spacing.sm, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
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
  cover: { width: 66, height: 92, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center' },
  coverText: { fontSize: 18, fontWeight: '600', color: colors.ink2 },
  bookMeta: { flex: 1, marginLeft: spacing.sm, justifyContent: 'center', paddingRight: 20 },
  bookTitle: { fontSize: 16, fontWeight: '600', color: colors.ink },
  bookDetail: { marginTop: 4, fontSize: 12, color: colors.ink3 },
  progressTrack: { marginTop: 7, height: 3, borderRadius: 2, backgroundColor: colors.paperDeep, overflow: 'hidden' },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: colors.lamp },
  bookAction: { marginTop: 7, fontSize: 12, color: colors.lamp },
  moreButton: { position: 'absolute', top: 4, right: 4, padding: 6 },
  moreText: { fontSize: 18, color: colors.ink3, lineHeight: 18 },
  hint: { marginTop: spacing.sm, fontSize: 11, color: colors.ink3, textAlign: 'center' },
  loading: { paddingTop: 72, alignItems: 'center', gap: spacing.sm },
  loadingText: { fontSize: 13, color: colors.ink3 },
  empty: { paddingTop: 56, alignItems: 'center', paddingHorizontal: spacing.lg },
  emptyCover: {
    width: 78,
    height: 104,
    borderRadius: radius.card,
    backgroundColor: colors.paperDeep,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyCoverText: { fontSize: 30, color: colors.ink2, fontWeight: '600' },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: colors.ink },
  emptyDetail: { marginTop: 8, fontSize: 13, lineHeight: 20, color: colors.ink3, textAlign: 'center' },
  emptyButton: { marginTop: spacing.md, borderRadius: radius.field, backgroundColor: colors.lamp, paddingHorizontal: spacing.lg, paddingVertical: 11 },
  emptyButtonText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  noResult: { paddingTop: 64, alignItems: 'center' },
  noResultTitle: { fontSize: 16, fontWeight: '600', color: colors.ink },
  errorCard: { marginTop: spacing.lg, borderRadius: radius.card, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: spacing.md },
  errorTitle: { fontSize: 16, fontWeight: '600', color: colors.ink },
  errorDetail: { marginTop: 6, fontSize: 12, lineHeight: 18, color: colors.ink2 },
  retryButton: { marginTop: spacing.sm, alignSelf: 'flex-start', borderRadius: radius.field, backgroundColor: colors.paperDeep, paddingHorizontal: spacing.md, paddingVertical: 8 },
  retryText: { fontSize: 13, fontWeight: '600', color: colors.ink },
});
