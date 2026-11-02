import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { loadConversationSummaries, loadShelfBooks, type ConversationSummary, type ShelfBookRecord } from '../src/platform/library';
import { BottomBar } from '../src/ui/BottomBar';
import { colors, radius, spacing, type } from '../src/ui/theme';

export default function ConversationsRoute() {
  const [items, setItems] = useState<readonly ConversationSummary[]>([]);
  const [books, setBooks] = useState<readonly ShelfBookRecord[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  useFocusEffect(useCallback(() => {
    let mounted = true;
    void Promise.all([loadConversationSummaries(), loadShelfBooks()]).then(([conversations, shelf]) => {
      if (mounted) { setItems(conversations); setBooks(shelf); }
    }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []));
  const titleOf = (bookId: string) => books.find((book) => book.id === bookId)?.title ?? '书内问答';
  const needle = query.trim().toLowerCase();
  const filtered = needle ? items.filter((item) => (item.question + item.answer).toLowerCase().includes(needle)) : items;
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.title}>对话</Text>
        <Text style={styles.subtitle}>读过的疑问，留在这本书里。</Text>
        <View style={styles.search}><Text style={styles.searchIcon}>⌕</Text><TextInput value={query} onChangeText={setQuery} placeholder="搜索你的问题" placeholderTextColor={colors.ink3} style={styles.searchInput} /></View>
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator color={colors.lamp} /></View> : (
        <ScrollView contentContainerStyle={styles.content}>
          {filtered.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>还没有对话</Text><Text style={styles.hint}>打开一本书，点「问书灯」开始提问。</Text></View> : filtered.map((item) => (
            <View key={item.conversationId} style={styles.card}>
              <Text style={styles.book}>{titleOf(item.bookId)}</Text>
              <Text style={styles.question}>{item.question}</Text>
              <Text style={styles.answer} numberOfLines={2}>{item.answer.replace(/[#*]/g, '').replace(/\s+/g, ' ')}</Text>
              <Text style={styles.meta}>{new Date(item.updatedAt).toLocaleDateString('zh-CN')} · {Math.max(1, Math.round(item.turns / 2))} 次提问</Text>
            </View>
          ))}
          <View style={{ height: 80 }} />
        </ScrollView>
      )}
      <BottomBar active="conversations" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  header: { paddingHorizontal: spacing.lg },
  title: { marginTop: spacing.xs, fontSize: type.title, fontWeight: '700', color: colors.ink },
  subtitle: { marginTop: spacing.xxs, fontSize: type.caption, color: colors.ink3 },
  search: { height: 44, borderRadius: radius.field, backgroundColor: colors.paperDeep, marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, gap: spacing.xs },
  searchIcon: { fontSize: 22, color: colors.ink2 },
  searchInput: { flex: 1, padding: 0, fontSize: type.body, color: colors.ink },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  empty: { alignItems: 'center', paddingVertical: 80, gap: spacing.xs },
  emptyTitle: { fontSize: type.section, fontWeight: '600', color: colors.ink },
  hint: { fontSize: type.caption, color: colors.ink2, textAlign: 'center' },
  card: { paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  book: { fontSize: type.caption, color: colors.ink2 },
  question: { marginTop: spacing.xs, fontSize: 18, fontWeight: '600', color: colors.ink, fontFamily: 'Songti SC' },
  answer: { marginTop: spacing.xs, fontSize: type.body, lineHeight: 24, color: colors.ink2 },
  meta: { marginTop: spacing.xs, fontSize: type.tiny, color: colors.ink3 },
});
