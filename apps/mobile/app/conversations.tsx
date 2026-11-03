import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { loadConversationSummaries, loadShelfBooks, type ConversationSummary, type ShelfBookRecord } from '../src/platform/library';
import { BottomBar } from '../src/ui/BottomBar';
import { conversationTime } from '../src/ui/format';
import { bookSwatchTone, searchFieldChrome, searchFieldIconColor, searchFieldPlaceholderColor, searchFieldTextColor, spacing, type, usePalette, type Palette } from '../src/ui/theme';

/**
 * 预览只显示纯文本：先解掉助手消息里 `{"answer":"..."}` 的 JSON 包装（原版不显示原始 JSON），
 * 再去代码块/链接/强调标记。
 */
function previewText(raw: string): string {
  let text = raw.trim();
  if (text.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        const candidate = record.answer ?? record.content ?? record.text;
        if (typeof candidate === 'string') text = candidate;
      }
    } catch {
      // 不是完整 JSON 时继续尝试提取 answer 字符串（旧消息可能被截断）。
    }
    const wrapped = /^\s*\{\s*"(?:answer|content|text)"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(text);
    if (wrapped?.[1]) {
      try {
        text = JSON.parse(`"${wrapped[1]}"`);
      } catch {
        text = wrapped[1];
      }
    }
  }
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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
        <View style={styles.search}>
          <SymbolView name="magnifyingglass" size={24} tintColor={searchFieldIconColor(palette)} />
          <TextInput value={query} onChangeText={setQuery} placeholder="搜索你的问题" placeholderTextColor={searchFieldPlaceholderColor(palette)} style={styles.searchInput} />
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
            const isCollapsed = collapsed[bookId] ?? true;
            const title = book?.title ?? '书内问答';
            const swatch = bookSwatchTone(title, book?.format);
            return (
              <View key={bookId}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${title} ${entries.length} 段对话`}
                  onPress={() => setCollapsed((current) => ({ ...current, [bookId]: !isCollapsed }))}
                  style={styles.groupHeader}
                >
                  <View style={[styles.groupSwatch, { backgroundColor: swatch.background }]}>
                    <Text style={[styles.groupSwatchText, { color: swatch.ink }]}>{title.slice(0, 1)}</Text>
                  </View>
                  <View style={styles.groupBody}>
                    <Text style={styles.groupTitle} numberOfLines={1}>{title}</Text>
                    <Text style={styles.groupCount}>{entries.length} 段对话</Text>
                  </View>
                  <SymbolView name={isCollapsed ? 'chevron.right' : 'chevron.down'} size={15} tintColor={palette.lamp} />
                </Pressable>
                {!isCollapsed ? (
                  <View style={styles.entryCard}>
                    {entries.map((item, index) => (
                      <View key={item.conversationId} style={[styles.entry, index === entries.length - 1 && styles.lastEntry]}>
                        <Text style={styles.question} numberOfLines={2}>{previewText(item.question)}</Text>
                        <Text style={styles.answer} numberOfLines={2}>{previewText(item.answer)}</Text>
                        <Text style={styles.meta}>{conversationTime(item.updatedAt)} · {Math.max(1, Math.round(item.turns / 2))} 次提问</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
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
    title: { marginTop: 21, fontSize: type.title, fontWeight: '700', color: palette.ink },
    search: { ...searchFieldChrome(palette), height: 56, marginTop: 24, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, gap: 10 },
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
    entryCard: { backgroundColor: palette.surface, borderRadius: 16, paddingHorizontal: 16, marginTop: 4, marginBottom: 8 },
    entry: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: palette.line },
    lastEntry: { borderBottomWidth: 0 },
    question: { fontSize: 17, lineHeight: 24, fontWeight: '600', color: palette.ink },
    answer: { marginTop: 8, fontSize: type.body, lineHeight: 24, color: palette.ink2 },
    meta: { marginTop: 10, fontSize: type.captionSmall, color: palette.ink3 },
  });
}
