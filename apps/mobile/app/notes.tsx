import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { loadAllAnnotations, type ShelfAnnotation, type ShelfBookRecord } from '../src/platform/library';
import { BottomBar } from '../src/ui/BottomBar';
import { recordTime } from '../src/ui/format';
import { font, radius, spacing, type, usePalette, type Palette } from '../src/ui/theme';

type Item = { book: ShelfBookRecord; annotation: ShelfAnnotation };
const FILTERS = ['全部', '高亮', '笔记', '书签'] as const;
const COVER_COLORS = ['#E8E5D8', '#4F5A4A', '#DFE3D5', '#E7E1D6', '#D9D2C2', '#6B6257'];
const KIND_LABEL: Record<ShelfAnnotation['kind'], string> = { highlight: '高亮', note: '笔记', bookmark: '书签' };

function coverColor(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return COVER_COLORS[hash % COVER_COLORS.length] ?? COVER_COLORS[0]!;
}

export default function NotesRoute() {
  const router = useRouter();
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [items, setItems] = useState<readonly Item[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('全部');
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

  const kind = filter === '高亮' ? 'highlight' : filter === '笔记' ? 'note' : filter === '书签' ? 'bookmark' : null;
  const needle = query.trim().toLowerCase();
  const filtered = items.filter(({ book, annotation }) => {
    if (kind && annotation.kind !== kind) return false;
    if (!needle) return true;
    return (`${annotation.quote} ${annotation.body ?? ''} ${book.title} ${annotation.chapter ?? ''}`).toLowerCase().includes(needle);
  });

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
            <SymbolView name="square.and.arrow.up" size={19} tintColor={palette.ink} />
          </Pressable>
        </View>
        <Text style={styles.subtitle}>留下读过的痕迹，也留下自己的想法。</Text>
        <View style={styles.filters}>
          {FILTERS.map((item) => (
            <Pressable key={item} accessibilityRole="button" onPress={() => setFilter(item)} style={styles.filterItem}>
              <Text style={[styles.filterText, filter === item && styles.filterOn]}>{item}</Text>
              {filter === item ? <View style={styles.filterLine} /> : null}
            </Pressable>
          ))}
        </View>
        <View style={styles.search}>
          <SymbolView name="magnifyingglass" size={17} tintColor={palette.ink3} />
          <TextInput value={query} onChangeText={setQuery} placeholder="搜索阅读痕迹" placeholderTextColor={palette.ink3} style={styles.searchInput} />
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
            return (
              <View key={book.id}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${book.title} ${entries.length} 条`}
                  onPress={() => setCollapsed((current) => ({ ...current, [book.id]: !isCollapsed }))}
                  style={styles.groupHeader}
                >
                  <View style={[styles.groupSwatch, { backgroundColor: coverColor(book.id) }]}>
                    <Text style={styles.groupSwatchText}>{book.title.slice(0, 1)}</Text>
                  </View>
                  <View style={styles.groupBody}>
                    <Text style={styles.groupTitle} numberOfLines={1}>{book.title}</Text>
                    <Text style={styles.groupCount}>{entries.length} 条记录</Text>
                  </View>
                  <SymbolView name={isCollapsed ? 'chevron.right' : 'chevron.down'} size={13} tintColor={palette.ink3} />
                </Pressable>
                {!isCollapsed ? entries.map(({ book: rowBook, annotation }) => {
                  const chapter = annotation.chapter && !annotation.chapter.includes('页') ? annotation.chapter : rowBook.title;
                  return (
                    <View key={annotation.id} style={styles.entry}>
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
                }) : null}
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
    titleRow: { marginTop: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { fontSize: type.title, fontWeight: '700', color: palette.ink },
    shareButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.paperDeep },
    subtitle: { marginTop: 4, fontSize: type.caption, color: palette.ink3 },
    filters: { flexDirection: 'row', marginTop: 12, borderBottomWidth: 1, borderBottomColor: palette.line },
    filterItem: { flex: 1, alignItems: 'center', paddingBottom: 8 },
    filterText: { fontSize: 14, color: palette.ink2 },
    filterOn: { color: palette.ink, fontWeight: '600' },
    filterLine: { position: 'absolute', bottom: -1, width: 22, height: 2, borderRadius: 1, backgroundColor: palette.ink },
    search: { height: 44, borderRadius: radius.field, backgroundColor: palette.paperDeep, marginTop: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 },
    searchInput: { flex: 1, padding: 0, fontSize: type.body, color: palette.ink },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    content: { paddingHorizontal: spacing.screen, paddingTop: 12 },
    empty: { alignItems: 'center', paddingVertical: 80, gap: 8 },
    emptyTitle: { fontSize: type.section, fontWeight: '600', color: palette.ink },
    hint: { fontSize: type.caption, color: palette.ink2, textAlign: 'center' },
    groupHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: palette.line },
    groupSwatch: { width: 22, height: 30, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
    groupSwatchText: { fontSize: 10, fontWeight: '600', color: 'rgba(40,43,38,0.78)' },
    groupBody: { flex: 1 },
    groupTitle: { fontSize: type.subhead, fontWeight: '600', color: palette.ink },
    groupCount: { marginTop: 2, fontSize: type.captionSmall, color: palette.ink3 },
    entry: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: palette.line },
    quoteBlock: { borderLeftWidth: 2, borderLeftColor: palette.lamp, paddingLeft: 12 },
    quote: { fontFamily: font.serif, fontSize: 17, lineHeight: 30, color: palette.ink },
    body: { marginTop: 8, fontSize: type.body, lineHeight: 24, color: palette.ink2 },
    metaRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    meta: { flex: 1, fontSize: type.captionSmall, color: palette.ink3 },
    jump: { fontSize: type.caption, color: palette.ink2 },
  });
}
