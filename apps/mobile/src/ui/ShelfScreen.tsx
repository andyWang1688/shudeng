import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ListRenderItemInfo,
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
import { BookCover } from './components/BookCover';
import { EmptyState } from './components/EmptyState';
import { PageHeader } from './components/PageHeader';
import { SearchField } from './components/SearchField';
import { SectionHeader } from './components/SectionHeader';
import { useHaptics } from './components/useHaptics';
import { radius, spacing, type as typeScale, usePalette, type Palette } from './theme';

export function ShelfScreen() {
  const router = useRouter();
  const haptics = useHaptics();
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
        haptics('success');
        await load();
      }
    } catch (cause) {
      Alert.alert('导入失败', cause instanceof Error ? cause.message : String(cause));
    } finally {
      setImporting(false);
    }
  };

  const openBook = (book: ShelfBookRecord) => {
    haptics();
    router.push({ pathname: '/reader/[id]', params: { id: book.id } });
  };

  const askDelete = (book: ShelfBookRecord) => {
    Alert.alert('删除书籍', `删除《${book.title}》以及它的阅读进度、标注和书签？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => { void deleteShelfBook(book.id).then(load); } },
    ]);
  };

  const continueDetail = continueBook
    ? `${continueBook.progressChapter ? `${continueBook.progressChapter.split(' · ')[0]} · ` : ''}${continueBook.progressLabel}${continueBook.progressPercent !== null && continueBook.format === 'PDF' ? ` · ${continueBook.progressPercent}%` : ''}`
    : '';

  const renderBook = useCallback(({ item: book }: ListRenderItemInfo<ShelfBookRecord>) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`打开${book.title}`}
      onPress={() => openBook(book)}
      onLongPress={() => askDelete(book)}
      android_ripple={{ color: palette.line }}
      style={({ pressed }) => [styles.bookCard, { width: cardWidth }, pressed && styles.pressed]}
    >
      <BookCover title={book.title} author={book.author} format={book.format} width={cardWidth} height={cardWidth * 1.4} showDot />
      <Text style={styles.bookTitle} numberOfLines={1}>{book.title}</Text>
      <Text style={styles.bookAuthor} numberOfLines={1}>{book.author ?? '作者未知'}</Text>
      <Text style={[styles.bookProgress, (book.progressPercent ?? 0) > 0 && styles.bookProgressOn]}>
        {book.progressPercent === null ? '未开始' : `已读 ${book.progressPercent}%`}
      </Text>
    </Pressable>
  ), [cardWidth, palette.line, styles, openBook, askDelete]);

  const listHeader = (
    <View>
      <PageHeader
        title="书架"
        action={{ symbol: 'plus', label: '导入书籍', onPress: () => void handleImport(), busy: importing, variant: 'solid' }}
      />
      <SearchField value={query} onChangeText={setQuery} placeholder="书名或作者" style={styles.search} />
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {continueBook ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`继续阅读${continueBook.title}`}
          onPress={() => openBook(continueBook)}
          android_ripple={{ color: palette.line }}
          style={({ pressed }) => [styles.continueCard, pressed && styles.pressed]}
        >
          <BookCover title={continueBook.title} author={continueBook.author} format={continueBook.format} width={64} height={90} compact />
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
      {books.length > 0 ? (
        <SectionHeader
          title="我的书籍"
          count={String(filtered.length)}
          trailing={(
            <View style={styles.sortControl}>
              <Text style={styles.sortText}>最近阅读</Text>
              <SymbolView name="chevron.down" size={10} tintColor={palette.ink2} />
            </View>
          )}
        />
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <FlatList
        data={loading ? [] : filtered}
        keyExtractor={(book) => book.id}
        renderItem={renderBook}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.content}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={(
          <View style={styles.emptyWrap}>
            {loading ? (
              <ActivityIndicator color={palette.lamp} />
            ) : books.length === 0 ? (
              <EmptyState
                symbol="lightbulb"
                title="书库还是空的"
                description="导入 EPUB 或 PDF，开始阅读。"
                actionLabel="导入书籍"
                onAction={() => void handleImport()}
              />
            ) : (
              <EmptyState title="没有找到相关书籍" description="换个书名或作者试试。" />
            )}
          </View>
        )}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: palette.paper },
    content: { paddingHorizontal: spacing.screen, paddingTop: 4, paddingBottom: 24 },
    search: { marginTop: 22, marginHorizontal: 8 },
    notice: { marginTop: 8, fontSize: typeScale.caption, color: palette.ink2 },
    error: { marginTop: 8, fontSize: typeScale.caption, color: palette.error },
    emptyWrap: { paddingTop: 32, alignItems: 'center' },
    gridRow: { justifyContent: 'space-between' },
    bookCard: { marginBottom: 24 },
    bookTitle: { marginTop: 8, fontFamily: 'Songti SC', fontSize: 17, lineHeight: 23, fontWeight: '600', color: palette.ink },
    bookAuthor: { marginTop: 2, fontSize: typeScale.captionSmall, color: palette.ink3 },
    bookProgress: { marginTop: 3, fontSize: typeScale.captionSmall, color: palette.ink3 },
    bookProgressOn: { color: palette.lampInk },
    pressed: { opacity: 0.72 },
    continueCard: { flexDirection: 'row', marginTop: 28, padding: 12, minHeight: 124, borderRadius: radius.card, backgroundColor: palette.paperDeep },
    continueMeta: { flex: 1, marginLeft: 12, justifyContent: 'space-between' },
    continueEyebrow: { fontSize: typeScale.caption, fontWeight: '600', color: palette.lampInk },
    continueTitle: { marginTop: 2, fontFamily: 'Songti SC', fontSize: typeScale.bookTitle, fontWeight: '600', color: palette.ink },
    continueAuthor: { marginTop: 2, fontSize: typeScale.caption, color: palette.ink3 },
    progressLine: { height: 1, backgroundColor: palette.line, marginTop: 8, overflow: 'hidden' },
    progressFill: { height: 1, backgroundColor: palette.lampInk },
    continueFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
    continueAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    continueLabel: { fontSize: 15, fontWeight: '500', color: palette.lampInk },
    continueDetail: { marginLeft: 8, fontSize: typeScale.captionSmall, color: palette.ink3 },
    sortControl: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    sortText: { fontSize: typeScale.footnote, color: palette.ink2 },
  });
}
