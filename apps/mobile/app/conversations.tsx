import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { loadConversationSummaries, loadShelfBooks, type ConversationSummary, type ShelfBookRecord } from '../src/platform/library';
import { BottomBar } from '../src/ui/BottomBar';
import { conversationTime } from '../src/ui/format';
import { font, radius, spacing, type, usePalette, type Palette } from '../src/ui/theme';

const COVER_COLORS = ['#E8E5D8', '#4F5A4A', '#DFE3D5', '#E7E1D6', '#D9D2C2', '#6B6257'];

function coverColor(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return COVER_COLORS[hash % COVER_COLORS.length] ?? COVER_COLORS[0]!;
}

export default function ConversationsRoute() {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [items, setItems] = useState<readonly ConversationSummary[]>([]);
  const [books, setBooks] = useState<readonly ShelfBookRecord[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useFocusEffect(useCallback(() => {
    let mounted = true;
    void Promise.all([loadConversationSummaries(), loadShelfBooks()])
      .then(([conversations, shelf]) => {
        if (mounted) { setItems(conversations); setBooks(shelf); }
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []));

  const bookById = new Map(books.map((book) => [book.id, book]));
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? items.filter((item) => `${item.question} ${item.answer}`.toLowerCase().includes(needle))
    : items;
  const groups: Array<{ book: ShelfBookRecord | null; bookId: string; entries: ConversationSummary[] }> = [];
  const byBook = new Map<string, { book: ShelfBookRecord | null; bookId: string; entries: ConversationSummary[] }>();
  for (const item of filtered) {
    let group = byBook.get(item.bookId);
    if (!group) {
      group = { book: bookById.get(item.bookId) ?? null, bookId: item.bookId, entries: [] };
      byBook.set(item.bookId, group);
      groups.push(group);
    }
    group.entries.push(item);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.title}>对话</Text>
        <Text style={styles.subtitle}>读过的疑问，留在这本书里。</Text>
        <View style={styles.search}>
          <SymbolView name="magnifyingglass" size={17} tintColor={palette.ink3} />
          <TextInput value={query} onChangeText={setQuery} placeholder="搜索你的问题" placeholderTextColor={palette.ink3} style={styles.searchInput} />
        </View>
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator color={palette.lamp} /></View> : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {filtered.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>还没有对话</Text>
              <Text style={styles.hint}>打开一本书，点「问书灯」开始提问。</Text>
            </View>
          ) : groups.map(({ book, bookId, entries }) => {
            const isCollapsed = collapsed[bookId] ?? false;
            const title = book?.title ?? '书内问答';
            return (
              <View key={bookId}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${title} ${entries.length} 段对话`}
                  onPress={() => setCollapsed((current) => ({ ...current, [bookId]: !isCollapsed }))}
                  style={styles.groupHeader}
                >
                  <View style={[styles.groupSwatch, { backgroundColor: coverColor(bookId) }]}>
                    <Text style={styles.groupSwatchText}>{title.slice(0, 1)}</Text>
                  </View>
                  <View style={styles.groupBody}>
                    <Text style={styles.groupTitle} numberOfLines={1}>{title}</Text>
                    <Text style={styles.groupCount}>{entries.length} 段对话</Text>
                  </View>
                  <SymbolView name={isCollapsed ? 'chevron.right' : 'chevron.down'} size={13} tintColor={palette.ink3} />
                </Pressable>
                {!isCollapsed ? entries.map((item) => (
                  <View key={item.conversationId} style={styles.entry}>
                    <Text style={styles.question} numberOfLines={2}>{item.question}</Text>
                    <Text style={styles.answer} numberOfLines={2}>{item.answer.replace(/[#*]/g, '').replace(/\s+/g, ' ')}</Text>
                    <Text style={styles.meta}>{conversationTime(item.updatedAt)} · {Math.max(1, Math.round(item.turns / 2))} 次提问</Text>
                  </View>
                )) : null}
              </View>
            );
          })}
          <View style={{ height: 24 }} />
        </ScrollView>
      )}
      <BottomBar active="conversations" />
    </SafeAreaView>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: palette.paper },
    header: { paddingHorizontal: spacing.screen },
    title: { marginTop: 6, fontSize: type.title, fontWeight: '700', color: palette.ink },
    subtitle: { marginTop: 4, fontSize: type.caption, color: palette.ink3 },
    search: { height: 44, borderRadius: radius.field, backgroundColor: palette.paperDeep, marginTop: 16, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 },
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
    entry: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: palette.line },
    question: { fontFamily: font.serif, fontSize: 18, lineHeight: 26, fontWeight: '600', color: palette.ink },
    answer: { marginTop: 8, fontSize: type.body, lineHeight: 24, color: palette.ink2 },
    meta: { marginTop: 10, fontSize: type.captionSmall, color: palette.ink3 },
  });
}
