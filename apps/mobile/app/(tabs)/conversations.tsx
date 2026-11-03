import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  SectionList,
  StyleSheet,
  Text,
  View,
  type SectionListRenderItem,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { loadConversationSummaries, loadShelfBooks, type ConversationSummary, type ShelfBookRecord } from '../../src/platform/library';
import { EmptyState } from '../../src/ui/components/EmptyState';
import { PageHeader } from '../../src/ui/components/PageHeader';
import { SearchField } from '../../src/ui/components/SearchField';
import { SectionHeader } from '../../src/ui/components/SectionHeader';
import { groupByKey } from '../../src/ui/components/groupBy';
import { conversationTime } from '../../src/ui/format';
import { spacing, type as typeScale, usePalette, type Palette } from '../../src/ui/theme';

type ConversationSection = {
  bookId: string;
  book: ShelfBookRecord | null;
  count: number;
  collapsed: boolean;
  data: ConversationSummary[];
};

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
  const sections: ConversationSection[] = groupByKey(filtered, (item) => item.bookId).map(({ key, items: entries }) => {
    const isCollapsed = collapsed[key] ?? true;
    return {
      bookId: key,
      book: bookById.get(key) ?? null,
      count: entries.length,
      collapsed: isCollapsed,
      data: isCollapsed ? [] : entries,
    };
  });

  const renderConversation: SectionListRenderItem<ConversationSummary, ConversationSection> = ({ item, index, section }) => {
    const last = index === section.data.length - 1;
    return (
      <View style={[styles.entry, index === 0 && styles.entryFirst, last && styles.entryLast]}>
        <Text style={styles.question} numberOfLines={2}>{previewText(item.question)}</Text>
        <Text style={styles.answer} numberOfLines={2}>{previewText(item.answer)}</Text>
        <Text style={styles.meta}>{conversationTime(item.updatedAt)} · {Math.max(1, Math.round(item.turns / 2))} 次提问</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <PageHeader title="对话" topSpacing={21} />
        <SearchField value={query} onChangeText={setQuery} placeholder="搜索你的问题" style={styles.search} />
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={palette.lamp} /></View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.conversationId}
          renderItem={renderConversation}
          renderSectionHeader={({ section }) => {
            const title = section.book?.title ?? '书内问答';
            return (
              <SectionHeader
                variant="group"
                title={title}
                count={String(section.count)}
                countSuffix=" 段对话"
                swatch={{ title, format: section.book?.format }}
                expanded={!section.collapsed}
                onPress={() => setCollapsed((current) => ({ ...current, [section.bookId]: !section.collapsed }))}
              />
            );
          }}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.content}
          ListEmptyComponent={<EmptyState title="还没有对话" description="打开一本书，点「问书灯」开始提问。" />}
          ListFooterComponent={<View style={styles.footer} />}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: palette.paper },
    header: { paddingHorizontal: spacing.screen },
    search: { marginTop: 24 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    content: { paddingHorizontal: spacing.screen, paddingTop: 12 },
    footer: { height: 24 },
    entry: { paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: palette.line, backgroundColor: palette.surface },
    entryFirst: { marginTop: 4, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
    entryLast: { marginBottom: 8, borderBottomWidth: 0, borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
    question: { fontSize: 17, lineHeight: 24, fontWeight: '600', color: palette.ink },
    answer: { marginTop: 8, fontSize: typeScale.body, lineHeight: 24, color: palette.ink2 },
    meta: { marginTop: 10, fontSize: typeScale.captionSmall, color: palette.ink3 },
  });
}
