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
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { initializeDatabase } from '../platform';
import { SymbolView } from 'expo-symbols';
import {
  deleteShelfBook,
  importBookFromPicker,
  loadShelfBooks,
  migrateLegacyLibraryIfNeeded,
  type ShelfBookRecord,
} from '../platform/library';
import { colors, font, radius, spacing, type } from './theme';
import { BottomBar } from './BottomBar';

const COVER_COLORS = [colors.olive, colors.green, '#DFE3D5', '#E7E1D6', '#D9D2C2'];

function coverColor(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return COVER_COLORS[hash % COVER_COLORS.length] ?? colors.olive;
}

export function ShelfScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
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
      setBooks(await loadShelfBooks());
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message.startsWith('旧书库') ? message : `书架加载失败：${message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const needle = query.trim().toLowerCase();
  const filtered = needle.length === 0
    ? books
    : books.filter((book) => book.title.toLowerCase().includes(needle) || (book.author ?? '').toLowerCase().includes(needle));
  const continueBook = filtered.find((book) => (book.progressPercent ?? 0) > 0) ?? filtered[0] ?? null;
  const library = filtered;
  const cardWidth = (width - spacing.lg * 2 - spacing.md) / 2;

  const handleImport = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const result = await importBookFromPicker();
      if (result.status === 'imported') {
        setNotice(`已导入《${result.book.title}》`);
        await load();
      }
    } catch (cause) {
      Alert.alert('导入失败', cause instanceof Error ? cause.message : String(cause));
    } finally {
      setImporting(false);
    }
  };

  const openBook = (book: ShelfBookRecord) => {
    router.push({ pathname: '/reader/[id]', params: { id: book.id } });
  };

  const askDelete = (book: ShelfBookRecord) => {
    Alert.alert('删除书籍', `删除《${book.title}》以及它的阅读进度、标注和书签？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => { void deleteShelfBook(book.id).then(load); } },
    ]);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <SymbolView name="lightbulb" size={21} tintColor={colors.ink} />
          <Text style={styles.brand}>书灯</Text>
          <Text style={styles.brandTag}>一盏照书的灯</Text>
        </View>
        <View style={styles.titleRow}>
          <Text style={styles.title}>书架</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="导入书籍" onPress={() => void handleImport()} style={styles.importButton} disabled={importing}>
            <SymbolView name={importing ? 'ellipsis' : 'plus'} size={21} tintColor={colors.paper} />
          </Pressable>
        </View>
        <View style={styles.search}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="书名或作者"
            placeholderTextColor={colors.ink3}
            style={styles.searchInput}
            returnKeyType="search"
          />
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.lamp} /><Text style={styles.hint}>正在打开书库…</Text></View>
        ) : books.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>书库还是空的</Text>
            <Text style={styles.hint}>导入 EPUB 或 PDF，开始阅读。</Text>
            <Pressable accessibilityRole="button" onPress={() => void handleImport()} style={styles.primaryButton}>
              <Text style={styles.primaryText}>导入书籍</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {continueBook ? (
              <View style={styles.sectionBlock}>
                <Text style={styles.sectionTitle}>继续阅读</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`继续阅读${continueBook.title}`} onPress={() => openBook(continueBook)} style={({ pressed }) => [styles.continueCard, pressed && styles.pressed]}>
                  <View style={[styles.continueCover, { backgroundColor: coverColor(continueBook.id) }]}>
                    <Text style={styles.coverLargeTitle} numberOfLines={2}>{continueBook.title}</Text>
                    <Text style={styles.coverAuthor}>{continueBook.author ?? '书灯 · 藏书'}</Text>
                  </View>
                  <View style={styles.continueMeta}>
                    <Text style={styles.continueTitle} numberOfLines={2}>{continueBook.title}</Text>
                    <Text style={styles.continueAuthor}>{continueBook.author ?? '未知作者'}</Text>
                    <View style={styles.progressLine}>
                      <View style={[styles.progressFill, { width: `${Math.max(3, continueBook.progressPercent ?? 0)}%` }]} />
                    </View>
                    <View style={styles.continueFooter}>
                      <Text style={styles.continueLabel}>{continueBook.progressLabel}</Text>
                      <View style={styles.arrowCircle}><Text style={styles.arrow}>→</Text></View>
                    </View>
                  </View>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>我的书籍</Text>
              <Text style={styles.count}>{books.length}</Text>
            </View>
            <View style={styles.grid}>
              {library.map((book) => (
                <Pressable
                  key={book.id}
                  accessibilityRole="button"
                  accessibilityLabel={`打开${book.title}`}
                  onPress={() => openBook(book)}
                  onLongPress={() => askDelete(book)}
                  style={({ pressed }) => [styles.gridCard, { width: cardWidth }, pressed && styles.pressed]}
                >
                  <View style={[styles.gridCover, { height: cardWidth * 1.4, backgroundColor: coverColor(book.id) }]}>
                    <Text style={styles.coverLargeTitle} numberOfLines={3}>{book.title}</Text>
                    <Text style={styles.coverAuthor}>{book.author ?? '书灯 · 藏书'}</Text>
                  </View>
                  <Text style={styles.gridTitle} numberOfLines={1}>{book.title}</Text>
                  <Text style={styles.gridAuthor} numberOfLines={1}>{book.author ?? ' '}</Text>
                  <Text style={styles.gridProgress}>{book.progressPercent === null ? '未开始' : `已读 ${book.progressPercent}%`}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
        <View style={{ height: 100 }} />
      </ScrollView>
      <BottomBar active="shelf" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 25 },
  brandIcon: { fontSize: 20 },
  brand: { fontSize: type.brand, fontWeight: '600', color: colors.ink },
  brandTag: { marginLeft: 'auto', fontSize: type.caption, color: colors.ink2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  title: { fontSize: type.title, fontWeight: '700', color: colors.ink },
  importButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  importText: { color: colors.paper, fontSize: 28, lineHeight: 30, fontWeight: '300' },
  search: { flexDirection: 'row', alignItems: 'center', height: 44, borderRadius: radius.field, backgroundColor: colors.paperDeep, paddingHorizontal: spacing.sm, marginTop: spacing.xs, gap: spacing.xs },
  searchIcon: { fontSize: 22, color: colors.ink2 },
  searchInput: { flex: 1, fontSize: type.body, color: colors.ink, padding: 0 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  notice: { fontSize: type.caption, color: colors.ink2, marginBottom: spacing.xs },
  error: { fontSize: type.caption, color: colors.danger, marginBottom: spacing.xs },
  center: { paddingVertical: 80, alignItems: 'center', gap: spacing.sm },
  hint: { fontSize: type.caption, color: colors.ink2, textAlign: 'center' },
  emptyTitle: { fontSize: type.section, fontWeight: '600', color: colors.ink },
  primaryButton: { marginTop: spacing.xs, borderRadius: radius.field, backgroundColor: colors.ink, paddingHorizontal: spacing.lg, paddingVertical: 12 },
  primaryText: { color: colors.paper, fontSize: type.body, fontWeight: '600' },
  sectionBlock: { marginTop: spacing.md },
  sectionTitle: { fontSize: type.section, fontWeight: '600', color: colors.ink },
  continueCard: { flexDirection: 'row', marginTop: spacing.sm, padding: 17, borderRadius: radius.card, backgroundColor: colors.paperDeep },
  pressed: { opacity: 0.72 },
  continueCover: { width: 82, height: 116, borderRadius: 5, padding: 10, justifyContent: 'space-between' },
  coverLargeTitle: { fontFamily: font.serif, fontSize: 18, lineHeight: 23, color: colors.ink },
  coverAuthor: { fontSize: 9, color: colors.ink2 },
  continueMeta: { flex: 1, marginLeft: 17, justifyContent: 'space-between' },
  continueTitle: { fontSize: type.bookTitle, fontWeight: '600', color: colors.ink },
  continueAuthor: { fontSize: type.caption, color: colors.ink2, marginTop: 4 },
  progressLine: { height: 3, borderRadius: 2, backgroundColor: colors.line, marginTop: 8, overflow: 'hidden' },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: colors.lamp },
  continueFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  continueLabel: { fontSize: type.caption, color: colors.ink2 },
  arrowCircle: { width: 27, height: 27, borderRadius: 14, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  arrow: { color: colors.paper, fontSize: 15 },
  sectionRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: spacing.lg, marginBottom: spacing.sm },
  count: { fontSize: type.caption, color: colors.ink3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.lg },
  gridCard: { gap: 5 },
  gridCover: { borderRadius: radius.coverRight, borderTopLeftRadius: radius.coverLeft, borderBottomLeftRadius: radius.coverLeft, padding: 12, justifyContent: 'space-between' },
  gridTitle: { fontFamily: font.serif, fontSize: 16, lineHeight: 21, color: colors.ink, marginTop: 3 },
  gridAuthor: { fontSize: type.caption, color: colors.ink2 },
  gridProgress: { fontSize: type.caption, color: colors.ink3 },
});
