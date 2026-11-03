import { useCallback, useMemo, useState } from 'react';
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
import { SymbolView } from 'expo-symbols';
import { initializeDatabase } from '../platform';
import {
  deleteShelfBook,
  importBookFromPicker,
  loadShelfBooks,
  migrateLegacyLibraryIfNeeded,
  type ShelfBookRecord,
} from '../platform/library';
import { font, radius, spacing, type, usePalette, type Palette } from './theme';
import { BottomBar } from './BottomBar';

const COVER_COLORS = ['#E8E5D8', '#4F5A4A', '#DFE3D5', '#E7E1D6', '#D9D2C2', '#6B6257'];

function coverColor(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return COVER_COLORS[hash % COVER_COLORS.length] ?? COVER_COLORS[0]!;
}

export function ShelfScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
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
  const continueBook = filtered.reduce<ShelfBookRecord | null>((best, book) => {
    if ((book.progressPercent ?? 0) <= 0) return best;
    if (!best) return book;
    return (book.progressUpdatedAt ?? 0) > (best.progressUpdatedAt ?? 0) ? book : best;
  }, null) ?? filtered[0] ?? null;
  const cardWidth = (width - spacing.screen * 2 - 21) / 2;

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

  const continueDetail = continueBook
    ? `${continueBook.progressChapter ? `${continueBook.progressChapter.split(' · ')[0]} · ` : ''}${continueBook.progressLabel}`
    : '';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.titleRow}>
          <Text style={styles.title}>书架</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="导入书籍"
            onPress={() => void handleImport()}
            disabled={importing}
            style={({ pressed }) => [styles.importButton, (pressed || importing) && styles.pressed]}
          >
            {importing ? <ActivityIndicator color={palette.paper} size="small" /> : <SymbolView name="plus" size={22} tintColor={palette.paper} />}
          </Pressable>
        </View>
        <View style={styles.search}>
          <SymbolView name="magnifyingglass" size={21} tintColor={palette.ink2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="书名或作者"
            placeholderTextColor={palette.ink3}
            style={styles.searchInput}
            returnKeyType="search"
          />
        </View>

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={palette.lamp} /><Text style={styles.hint}>正在打开书库…</Text></View>
        ) : books.length === 0 ? (
          <View style={styles.empty}>
            <SymbolView name="lightbulb" size={44} tintColor={palette.lamp} />
            <Text style={styles.emptyTitle}>书库还是空的</Text>
            <Text style={styles.hint}>导入 EPUB 或 PDF，开始阅读。</Text>
            <Pressable accessibilityRole="button" onPress={() => void handleImport()} style={styles.primaryButton}>
              <SymbolView name="plus" size={15} tintColor={palette.paper} />
              <Text style={styles.primaryText}>导入书籍</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {continueBook ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`继续阅读${continueBook.title}`}
                onPress={() => openBook(continueBook)}
                style={({ pressed }) => [styles.continueCard, pressed && styles.pressed]}
              >
                <View style={[styles.continueCover, { backgroundColor: coverColor(continueBook.id) }]}>
                  <View style={styles.coverInset} />
                  <Text style={styles.continueCoverTitle} numberOfLines={2}>{continueBook.title}</Text>
                  <View style={styles.coverRule} />
                  <Text style={styles.continueCoverAuthor} numberOfLines={1}>{continueBook.author ?? '作者未知'}</Text>
                </View>
                <View style={styles.continueMeta}>
                  <View>
                    <Text style={styles.continueEyebrow}>继续阅读</Text>
                    <Text style={styles.continueTitle} numberOfLines={2}>{continueBook.title}</Text>
                    <Text style={styles.continueAuthor} numberOfLines={1}>{continueBook.author ?? '作者未知'}</Text>
                  </View>
                  <View>
                    <View style={styles.progressLine}>
                      <View style={[styles.progressFill, { width: `${Math.max(3, continueBook.progressPercent ?? 0)}%` }]} />
                    </View>
                    <View style={styles.continueFooter}>
                      <View style={styles.continueAction}>
                        <Text style={styles.continueLabel}>接着读</Text>
                        <SymbolView name="arrow.right" size={13} tintColor={palette.lampInk} />
                      </View>
                      <Text style={styles.continueDetail} numberOfLines={1}>{continueDetail}</Text>
                    </View>
                  </View>
                </View>
              </Pressable>
            ) : null}

            <View style={styles.sectionRow}>
              <View style={styles.sectionIdentity}>
                <Text style={styles.sectionTitle}>我的书籍</Text>
                <Text style={styles.count}>{filtered.length}</Text>
              </View>
              <View style={styles.sortControl}>
                <Text style={styles.sortText}>最近阅读</Text>
                <SymbolView name="chevron.down" size={10} tintColor={palette.ink2} />
              </View>
            </View>
            {filtered.length === 0 ? (
              <View style={styles.center}><Text style={styles.emptyTitle}>没有找到相关书籍</Text><Text style={styles.hint}>换个书名或作者试试。</Text></View>
            ) : (
              <View style={styles.grid}>
                {filtered.map((book) => (
                  <Pressable
                    key={book.id}
                    accessibilityRole="button"
                    accessibilityLabel={`打开${book.title}`}
                    onPress={() => openBook(book)}
                    onLongPress={() => askDelete(book)}
                    style={({ pressed }) => [styles.gridCard, { width: cardWidth }, pressed && styles.pressed]}
                  >
                    <View style={[styles.gridCover, { height: cardWidth * 1.4, backgroundColor: coverColor(book.id) }]}>
                      <View style={styles.coverInset} />
                      <Text style={styles.gridCoverTitle} numberOfLines={3}>{book.title}</Text>
                      <View style={styles.coverRule} />
                      <Text style={styles.gridCoverAuthor} numberOfLines={1}>{book.author ?? '作者未知'}</Text>
                      <View style={styles.coverDot} />
                    </View>
                    <Text style={styles.gridTitle} numberOfLines={1}>{book.title}</Text>
                    <Text style={styles.gridAuthor} numberOfLines={1}>{book.author ?? '作者未知'}</Text>
                    <Text style={[styles.gridProgress, (book.progressPercent ?? 0) > 0 && styles.gridProgressOn]}>
                      {book.progressPercent === null ? '未开始' : `已读 ${book.progressPercent}%`}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
      <BottomBar active="shelf" />
    </SafeAreaView>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: palette.paper },
    scroll: { flex: 1 },
    content: { paddingHorizontal: spacing.screen, paddingTop: 4 },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 0 },
    title: { fontSize: type.title, fontWeight: '700', color: palette.ink },
    importButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
    pressed: { opacity: 0.72 },
    search: { flexDirection: 'row', alignItems: 'center', height: 56, borderRadius: 28, borderWidth: 1, borderColor: palette.line, backgroundColor: 'transparent', paddingHorizontal: 18, marginTop: 22, marginHorizontal: 8, gap: 10 },
    searchInput: { flex: 1, fontSize: 17, color: palette.ink, padding: 0 },
    notice: { fontSize: type.caption, color: palette.ink2, marginTop: 8 },
    error: { fontSize: type.caption, color: palette.error, marginTop: 8 },
    center: { paddingVertical: 80, alignItems: 'center', gap: 8 },
    hint: { fontSize: type.caption, color: palette.ink2, textAlign: 'center' },
    empty: { alignItems: 'center', paddingTop: 64, gap: 0 },
    emptyTitle: { marginTop: 20, fontSize: 24, fontFamily: font.serif, fontWeight: '600', color: palette.ink },
    primaryButton: { marginTop: 24, width: 168, height: 44, borderRadius: 12, backgroundColor: palette.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    primaryText: { color: palette.paper, fontSize: 14, fontWeight: '500' },
    sectionTitle: { fontSize: type.section, fontWeight: '600', color: palette.ink },
    continueCard: { flexDirection: 'row', marginTop: 28, padding: 12, minHeight: 124, borderRadius: radius.card, backgroundColor: palette.paperDeep },
    continueCover: { width: 64, height: 90, borderRadius: radius.cover, padding: 7, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
    coverInset: { position: 'absolute', top: 5, left: 5, right: 5, bottom: 5, borderWidth: 1, borderColor: 'rgba(40,43,38,0.18)', borderRadius: 2 },
    coverDot: { position: 'absolute', bottom: 9, width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(40,43,38,0.32)' },
    coverRule: { width: 14, height: 1, marginTop: 7, backgroundColor: 'rgba(40,43,38,0.4)' },
    continueCoverTitle: { fontFamily: font.serif, fontSize: 11, lineHeight: 15, fontWeight: '600', color: '#282B26', textAlign: 'center' },
    continueCoverAuthor: { marginTop: 5, fontSize: 6.5, fontWeight: '500', color: 'rgba(40,43,38,0.78)' },
    continueMeta: { flex: 1, marginLeft: 12, justifyContent: 'space-between' },
    continueEyebrow: { fontSize: type.caption, fontWeight: '600', color: palette.lampInk },
    continueTitle: { marginTop: 2, fontFamily: font.serif, fontSize: type.bookTitle, fontWeight: '600', color: palette.ink },
    continueAuthor: { marginTop: 2, fontSize: type.caption, color: palette.ink3 },
    continueDetail: { marginLeft: 8, fontSize: type.captionSmall, color: palette.ink3 },
    progressLine: { height: 1, backgroundColor: palette.line, marginTop: 8, overflow: 'hidden' },
    progressFill: { height: 1, backgroundColor: palette.lampInk },
    continueFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
    continueAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    continueLabel: { fontSize: 15, fontWeight: '500', color: palette.lampInk },
    sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 0, minHeight: 44 },
    sectionIdentity: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
    sortControl: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    sortText: { fontSize: type.footnote, color: palette.ink2 },
    count: { fontSize: type.captionSmall, color: palette.ink3 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 24 },
    gridCard: { gap: 0 },
    gridCover: { borderRadius: radius.cover, padding: 12, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
    gridCoverTitle: { fontFamily: font.serif, fontSize: 19, lineHeight: 25, fontWeight: '600', color: '#282B26', textAlign: 'center' },
    gridCoverAuthor: { marginTop: 7, fontSize: 8, fontWeight: '500', color: 'rgba(40,43,38,0.78)' },
    gridTitle: { fontFamily: font.serif, fontSize: 17, lineHeight: 23, fontWeight: '600', color: palette.ink, marginTop: 8 },
    gridAuthor: { fontSize: type.captionSmall, color: palette.ink3, marginTop: 2 },
    gridProgress: { fontSize: type.captionSmall, color: palette.ink3, marginTop: 3 },
    gridProgressOn: { color: palette.lampInk },
  });
}
