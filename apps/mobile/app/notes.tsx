import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { loadAllAnnotations, type ShelfAnnotation, type ShelfBookRecord } from '../src/platform/library';
import { BottomBar } from '../src/ui/BottomBar';
import { recordTime } from '../src/ui/format';
import { bookSwatchTone, font, searchFieldChrome, searchFieldIconColor, searchFieldPlaceholderColor, searchFieldTextColor, spacing, type, usePalette, type Palette } from '../src/ui/theme';

type Item = { book: ShelfBookRecord; annotation: ShelfAnnotation };
const KIND_LABEL: Record<ShelfAnnotation['kind'], string> = { highlight: '高亮', note: '笔记', bookmark: '书签' };

export default function NotesRoute() {
  const router = useRouter();
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [items, setItems] = useState<readonly Item[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useFocusEffect(useCallback(() => {
    let mounted = true;
    void loadAllAnnotations()
      .then((next) => { if (mounted) setItems(next); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []));

  // 与原版一致：笔记页只展示高亮/笔记，书签留在阅读器。
  const visibleItems = items.filter(({ annotation }) => annotation.kind !== 'bookmark');
  const needle = query.trim().toLowerCase();
  const filtered = visibleItems.filter(({ book, annotation }) => !needle
    || (`${annotation.quote} ${annotation.body ?? ''} ${book.title} ${annotation.chapter ?? ''}`).toLowerCase().includes(needle));

  const groups: Array<{ book: ShelfBookRecord; entries: Item[] }> = [];
  const byBook = new Map<string, { book: ShelfBookRecord; entries: Item[] }>();
  for (const item of filtered) {
    let group = byBook.get(item.book.id);
    if (!group) {
      group = { book: item.book, entries: [] };
      byBook.set(item.book.id, group);
      groups.push(group);
    }
    group.entries.push(item);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>笔记</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="导出笔记" style={styles.shareButton}>
            <SymbolView name="square.and.arrow.up" size={20} tintColor={palette.lampInk} />
          </Pressable>
        </View>
        <View style={styles.search}>
          <SymbolView name="magnifyingglass" size={24} tintColor={searchFieldIconColor(palette)} />
          <TextInput value={query} onChangeText={setQuery} placeholder="搜索笔记" placeholderTextColor={searchFieldPlaceholderColor(palette)} style={styles.searchInput} />
        </View>
      </View>

      {loading ? <View style={styles.center}><ActivityIndicator color={palette.lamp} /></View> : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {filtered.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>还没有笔记</Text>
              <Text style={styles.hint}>阅读时选中文字即可高亮、写笔记或加书签。</Text>
            </View>
          ) : groups.map(({ book, entries }) => {
            const isCollapsed = collapsed[book.id] ?? false;
            const swatch = bookSwatchTone(book.title, book.format);
            return (
              <View key={book.id}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${book.title} ${entries.length} 条`}
                  onPress={() => setCollapsed((current) => ({ ...current, [book.id]: !isCollapsed }))}
                  style={styles.groupHeader}
                >
                  <View style={[styles.groupSwatch, { backgroundColor: swatch.background }]}>
                    <Text style={[styles.groupSwatchText, { color: swatch.ink }]}>{book.title.slice(0, 1)}</Text>
                  </View>
                  <View style={styles.groupBody}>
                    <Text style={styles.groupTitle} numberOfLines={1}>{book.title}</Text>
                    <Text style={styles.groupCount}>{entries.length} 条笔记</Text>
                  </View>
                  <SymbolView name={isCollapsed ? 'chevron.right' : 'chevron.down'} size={15} tintColor={palette.lamp} />
                </Pressable>
                {!isCollapsed ? (
                  <View style={styles.entriesCard}>
                    {entries.map(({ book: rowBook, annotation }, index) => {
                  const chapter = annotation.chapter && !annotation.chapter.includes('页') ? annotation.chapter : rowBook.title;
                  return (
                    <View key={annotation.id} style={[styles.entry, index === entries.length - 1 && styles.lastEntry]}>
                      {annotation.quote ? (
                        <View style={styles.quoteBlock}>
                          <Text style={styles.quote} numberOfLines={5}>“{annotation.quote}”</Text>
                        </View>
                      ) : null}
                      {annotation.body ? <Text style={styles.body}>{annotation.body}</Text> : null}
                      <View style={styles.metaRow}>
                        <Text style={styles.meta} numberOfLines={1}>
                          {chapter}{annotation.page ? ` · 第 ${annotation.page} 页` : ''} · {KIND_LABEL[annotation.kind]} · {recordTime(annotation.createdAt)}
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => {
                            const locator = annotation.locator ? JSON.stringify(annotation.locator) : undefined;
                            router.push({ pathname: '/reader/[id]', params: locator ? { id: rowBook.id, locator } : { id: rowBook.id } });
                          }}
                        >
                          <Text style={styles.jump}>回到原文 ↗</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
                  </View>
                ) : null}
              </View>
            );
          })}
          <View style={{ height: 24 }} />
        </ScrollView>
      )}
      <BottomBar active="notes" />
    </SafeAreaView>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: palette.paper },
    header: { paddingHorizontal: spacing.screen },
    titleRow: { marginTop: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { fontSize: type.title, fontWeight: '700', color: palette.ink },
    shareButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
    search: { ...searchFieldChrome(palette), height: 56, marginTop: 18, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, gap: 10 },
    searchInput: { flex: 1, padding: 0, fontSize: 17, color: searchFieldTextColor(palette) },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    content: { paddingHorizontal: spacing.screen, paddingTop: 12 },
    empty: { alignItems: 'center', paddingVertical: 80, gap: 8 },
    emptyTitle: { fontSize: type.section, fontWeight: '600', color: palette.ink },
    hint: { fontSize: type.caption, color: palette.ink2, textAlign: 'center' },
    groupHeader: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10 },
    groupSwatch: { width: 26, height: 28, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
    groupSwatchText: { fontSize: 10, fontWeight: '600' },
    groupBody: { flex: 1 },
    groupTitle: { fontSize: 17, fontWeight: '600', color: palette.ink },
    groupCount: { marginTop: 3, fontSize: type.subhead, color: palette.ink3 },
    entriesCard: { backgroundColor: palette.surface, borderRadius: 16, paddingHorizontal: 16, marginTop: 4, marginBottom: 8 },
    entry: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: palette.line },
    lastEntry: { borderBottomWidth: 0 },
    quoteBlock: { borderLeftWidth: 2, borderLeftColor: palette.lamp, paddingLeft: 12 },
    quote: { fontFamily: font.serif, fontSize: 17, lineHeight: 30, color: palette.ink },
    body: { marginTop: 8, fontSize: type.body, lineHeight: 24, color: palette.ink2 },
    metaRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    meta: { flex: 1, fontSize: type.captionSmall, color: palette.ink3 },
    jump: { fontSize: type.caption, color: palette.ink2 },
  });
}
