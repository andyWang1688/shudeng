import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { loadAllAnnotations, type ShelfAnnotation, type ShelfBookRecord } from '../src/platform/library';
import { BottomBar } from '../src/ui/BottomBar';
import { colors, font, radius, spacing, type } from '../src/ui/theme';

type Item = { book: ShelfBookRecord; annotation: ShelfAnnotation };
const FILTERS = ['全部', '高亮', '笔记', '书签'] as const;

export default function NotesRoute() {
  const router = useRouter();
  const [items, setItems] = useState<readonly Item[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('全部');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  useFocusEffect(useCallback(() => {
    let mounted = true;
    void loadAllAnnotations().then((next) => { if (mounted) setItems(next); }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []));
  const kind = filter === '高亮' ? 'highlight' : filter === '笔记' ? 'note' : filter === '书签' ? 'bookmark' : null;
  const needle = query.trim().toLowerCase();
  const filtered = items.filter(({ book, annotation }) => {
    if (kind && annotation.kind !== kind) return false;
    return !needle || (annotation.quote + (annotation.body ?? '') + book.title).toLowerCase().includes(needle);
  });
  const groups = new Map<string, { book: ShelfBookRecord; entries: Item[] }>();
  for (const item of filtered) {
    const group = groups.get(item.book.id) ?? { book: item.book, entries: [] };
    group.entries.push(item);
    groups.set(item.book.id, group);
  }
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View style={styles.titleRow}><Text style={styles.title}>笔记</Text><Pressable accessibilityRole="button" accessibilityLabel="导出笔记" style={styles.shareButton}><SymbolView name="square.and.arrow.up" size={19} tintColor={colors.ink} /></Pressable></View>
        <Text style={styles.subtitle}>留下读过的痕迹，也留下自己的想法。</Text>
        <View style={styles.filters}>{FILTERS.map((item) => (
          <Pressable key={item} onPress={() => setFilter(item)} style={styles.filterItem}>
            <Text style={[styles.filterText, filter === item && styles.filterOn]}>{item}</Text>
            {filter === item ? <View style={styles.filterLine} /> : null}
          </Pressable>
        ))}</View>
        <View style={styles.search}><Text style={styles.searchIcon}>⌕</Text><TextInput value={query} onChangeText={setQuery} placeholder="搜索阅读痕迹" placeholderTextColor={colors.ink3} style={styles.searchInput} /></View>
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator color={colors.lamp} /></View> : (
        <ScrollView contentContainerStyle={styles.content}>
          {filtered.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>还没有笔记</Text><Text style={styles.hint}>阅读时选中文字即可高亮、写笔记或加书签。</Text></View> : [...groups.values()].map(({ book, entries }) => {
            const isCollapsed = collapsed[book.id] ?? false;
            return (
              <View key={book.id}>
                <Pressable accessibilityRole="button" accessibilityLabel={`${book.title} ${entries.length} 条`} onPress={() => setCollapsed((current) => ({ ...current, [book.id]: !isCollapsed }))} style={styles.groupHeader}>
                  <View style={[styles.groupSwatch, { backgroundColor: '#E8E5D8' }]}><Text style={styles.groupSwatchText}>{book.title.slice(0, 1)}</Text></View>
                  <View style={styles.groupBody}><Text style={styles.groupTitle}>{book.title}</Text><Text style={styles.groupCount}>{entries.length} 条记录</Text></View>
                  <SymbolView name={isCollapsed ? 'chevron.down' : 'chevron.up'} size={13} tintColor={colors.ink2} />
                </Pressable>
                {!isCollapsed ? entries.map(({ book: rowBook, annotation }) => (
                  <View key={annotation.id} style={styles.card}>
                    {annotation.quote ? <View style={styles.quoteBlock}><Text style={styles.quote} numberOfLines={5}>“{annotation.quote}”</Text></View> : null}
                    {annotation.body ? <Text style={styles.body}>{annotation.body}</Text> : null}
                    <View style={styles.metaRow}>
                      <Text style={styles.meta}>{(annotation.chapter && !annotation.chapter.includes('页') ? annotation.chapter : rowBook.title)}{annotation.page ? ` · 第 ${annotation.page} 页` : ''} · {annotation.kind === 'highlight' ? '高亮' : annotation.kind === 'note' ? '笔记' : '书签'} · {new Date(annotation.createdAt).toLocaleDateString('zh-CN')}</Text>
                      <Pressable accessibilityRole="button" onPress={() => {
                        const locator = annotation.locator ? JSON.stringify(annotation.locator) : undefined;
                        router.push({ pathname: '/reader/[id]', params: locator ? { id: rowBook.id, locator } : { id: rowBook.id } });
                      }}><Text style={styles.jump}>回到原文 ↗</Text></Pressable>
                    </View>
                  </View>
                )) : null}
              </View>
            );
          })}
          <View style={{ height: 80 }} />
        </ScrollView>
      )}
      <BottomBar active="notes" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  header: { paddingHorizontal: spacing.lg },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { marginTop: spacing.xs, fontSize: type.title, fontWeight: '700', color: colors.ink },
  shareButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.paperDeep },
  subtitle: { marginTop: spacing.xxs, fontSize: type.caption, color: colors.ink3 },
  filters: { flexDirection: 'row', gap: 32, marginTop: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  filterItem: { paddingBottom: 8, alignItems: 'center' },
  filterText: { fontSize: 14, color: colors.ink2 },
  filterOn: { color: colors.ink, fontWeight: '600' },
  filterLine: { position: 'absolute', bottom: 0, height: 2, width: 22, borderRadius: 1, backgroundColor: colors.ink },
  search: { height: 36, borderRadius: 10, backgroundColor: colors.paperDeep, marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, gap: spacing.xs },
  searchIcon: { fontSize: 22, color: colors.ink2 },
  searchInput: { flex: 1, padding: 0, fontSize: type.body, color: colors.ink },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  empty: { alignItems: 'center', paddingVertical: 80, gap: spacing.xs },
  emptyTitle: { fontSize: type.section, fontWeight: '600', color: colors.ink },
  hint: { fontSize: type.caption, color: colors.ink2, textAlign: 'center' },
  card: { paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  bookLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  bookName: { fontSize: type.caption, color: colors.ink2, fontWeight: '600' },
  kind: { fontSize: type.tiny, color: colors.ink3 },
  quoteBlock: { borderLeftWidth: 2, borderLeftColor: colors.lamp, paddingLeft: 12 },
  quote: { fontFamily: font.serif, fontSize: 17, lineHeight: 30, color: colors.ink },
  body: { marginTop: spacing.xs, fontSize: type.body, lineHeight: 24, color: colors.ink2 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  groupSwatch: { width: 20, height: 24, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  groupSwatchText: { fontSize: 11, color: colors.ink2 },
  groupBody: { flex: 1 },
  groupTitle: { fontSize: 13, fontWeight: '600', color: colors.ink2 },
  groupCount: { fontSize: 10, color: colors.ink3, marginTop: 1 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
  meta: { flex: 1, fontSize: type.tiny, color: colors.ink3 },
  jump: { fontSize: type.caption, color: colors.ink2 },
});
