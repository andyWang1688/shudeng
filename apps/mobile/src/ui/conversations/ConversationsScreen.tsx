import { useMemo, useRef } from 'react';
import { ActivityIndicator, PlatformColor, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { SymbolView } from 'expo-symbols';
import { EmptyState } from '../components/EmptyState';
import { BookNotice } from '../components/BookNotice';
import { SectionHeader } from '../components/SectionHeader';
import { conversationTime } from '../format';
import { SERIF_BOLD } from '../chat/format';
import { usePalette, type Palette } from '../theme';
import { ConversationRenamePrompt } from './ConversationRenamePrompt';
import { conversationSections, conversationTitle, type ConversationItem, type ConversationSection } from './model';
import { useConversationList } from './useConversationList';
import { useNativeListSearch } from '../navigation/useNativeListSearch';

export default function ConversationsScreen() {
  const router = useRouter();
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const state = useConversationList();
  const list = useRef<SectionList<ConversationItem, ConversationSection>>(null);
  const { query, clear: clearSearch, headerSearchBarOptions, onScroll } = useNativeListSearch({
    placeholder: '搜索你的问题', palette,
    restoreOffset: y => list.current?.getScrollResponder()?.scrollTo({ y, animated: false }),
  });
  const needle = query.trim();
  const sections = state.loadError ? [] : conversationSections(state.items, state.books, query, state.collapsed);
  const dialog = state.dialog;
  return (
    <SafeAreaView style={styles.safeArea} edges={['left', 'right']} testID="conversations-surface">
      <Stack.Screen options={{ headerSearchBarOptions }} />
      <SectionList ref={list} testID="question-history" sections={sections}
        contentInsetAdjustmentBehavior="automatic" scrollEventThrottle={16}
        onScroll={onScroll}
        keyExtractor={item => item.conversationId}
        renderItem={({ item, index, section }) => <ConversationRow item={item} first={index === 0} last={index === section.data.length - 1}
          palette={palette} styles={styles} onRename={() => state.openDialog('rename', item)} onDelete={() => state.openDialog('delete', item)}
          onOpen={() => router.push({ pathname: '/book-chat', params: { bookId: item.bookId, conversationId: item.conversationId, bookTitle: section.title } })} />}
        renderSectionHeader={({ section }) => <View testID={'conversations-book-' + section.bookId}>
          <SectionHeader style={styles.groupHeader} variant="group" title={section.title} count={String(section.count)} countSuffix=" 段对话"
            swatch={{ title: section.title, format: section.book?.format, coverUri: section.book?.coverUri }}
            expanded={!section.collapsed} onPress={() => { if (!needle) state.toggleGroup(section.bookId); }} />
        </View>}
        stickySectionHeadersEnabled={false} contentContainerStyle={styles.content}
        ListEmptyComponent={state.loading ? <View style={styles.center}><ActivityIndicator color={palette.lamp} /></View>
          : state.loadError ? <View testID="conversations-load-failed"><EmptyState symbol="exclamationmark.triangle" title="对话读取失败"
            description="原记录未被覆盖。检查储存空间后重试。" actionLabel="重试" onAction={() => void state.reload()} /></View>
          : needle ? <View testID="conversations-search-empty"><EmptyState symbol="magnifyingglass" title="没有找到相关对话"
            description="换一个关键词，或清除搜索查看全部记录。" actionLabel="清除搜索" onAction={clearSearch} /></View>
          : <View testID="conversations-empty"><EmptyState symbol="bubble.left.and.bubble.right" title="还没有对话"
            description="阅读时选中原文提问，问题与回答会留在这里。" actionLabel="去书架读书" onAction={() => router.navigate('/(tabs)')} /></View>}
        ListFooterComponent={<View style={styles.footer} />} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false} />
      {dialog?.kind === 'rename' ? <ConversationRenamePrompt key={dialog.id} initialName={conversationTitle(dialog.item)}
        onCancel={() => state.dismiss(dialog.id)} onSave={title => void state.confirm(dialog.id, dialog.item, title)} /> : null}
      {dialog?.kind === 'delete' ? <BookNotice key={dialog.id} title="删除对话？"
        message="删除本对话的所有轮次及引用快照；生成中的请求将取消。" actions={[
          { title: '取消', style: 'cancel', onPress: () => state.dismiss(dialog.id) },
          { title: '删除', style: 'destructive', onPress: () => void state.confirm(dialog.id, dialog.item) },
        ]} /> : null}
      {dialog?.kind === 'notice' ? <BookNotice key={dialog.id} title="操作未保存" message={dialog.message} onAcknowledge={() => state.dismiss(dialog.id)} /> : null}
    </SafeAreaView>
  );
}

function ConversationRow({ item, first, last, palette, styles, onRename, onDelete, onOpen }: {
  readonly item: ConversationItem; readonly first: boolean; readonly last: boolean; readonly palette: Palette;
  readonly styles: ReturnType<typeof createStyles>; readonly onRename: () => void; readonly onDelete: () => void; readonly onOpen: () => void;
}) {
  const swipe = useRef<SwipeableMethods>(null);
  const title = conversationTitle(item);
  const preview = Array.from(item.answer.trim()).slice(0, 180).join('');
  const meta = (item.submittedCount ?? Math.ceil(item.turns / 2)) + ' 次提问' + (item.unsaved ? ' · 尚未保存' : '');
  const date = conversationTime(item.updatedAt);
  const choose = (action: () => void) => { swipe.current?.close(); action(); };
  return (
    <Swipeable ref={swipe} containerStyle={[styles.swipeContainer, first && styles.entryFirst, last && styles.entryLast]}
      overshootLeft={false} overshootRight={false} renderRightActions={() => <View style={styles.swipeActions}>
        <Pressable accessibilityRole="button" accessibilityLabel="对话改名" onPress={() => choose(onRename)} style={[styles.swipeAction, styles.renameAction]}>
          <Text style={styles.swipeTitle}>改名</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="删除对话" onPress={() => choose(onDelete)} style={[styles.swipeAction, styles.deleteAction]}>
          <Text style={styles.swipeTitle}>删除</Text>
        </Pressable>
      </View>}>
      <Pressable testID={'question-' + item.conversationId} accessibilityRole="button" accessibilityLabel={[title, preview, date, meta].join('\n')}
        onPress={onOpen} style={({ pressed }) => [styles.entry, pressed && { backgroundColor: palette.paperDeep }]}>
        <View style={styles.entryMain}>
          <Text style={styles.question} dynamicTypeRamp="headline" numberOfLines={2}>{title}</Text>
          <Text style={styles.answer} dynamicTypeRamp="footnote" numberOfLines={preview ? 3 : 1}>
            {preview ? preview + '\n' : ''}<Text style={styles.meta} dynamicTypeRamp="caption1">{meta}</Text>
          </Text>
        </View>
        <Text style={styles.date} dynamicTypeRamp="caption1">{date}</Text>
        <SymbolView name="chevron.right" size={12} weight="semibold" tintColor={palette.paper === '#1B1A17' ? '#5C5B58' : '#C6C6C8'} />
        {!last ? <View style={styles.separator} /> : null}
      </Pressable>
    </Swipeable>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: palette.paper }, center: { minHeight: 160, alignItems: 'center', justifyContent: 'center' },
    content: { paddingHorizontal: 16, paddingTop: 28 }, groupHeader: { marginHorizontal: 16 }, footer: { height: 24 },
    swipeContainer: { overflow: 'hidden', backgroundColor: palette.surface }, swipeActions: { flexDirection: 'row' },
    swipeAction: { width: 72, alignItems: 'center', justifyContent: 'center' },
    renameAction: { backgroundColor: PlatformColor('systemGrayColor') }, deleteAction: { backgroundColor: PlatformColor('systemRedColor') },
    swipeTitle: { color: '#FFFFFF', fontSize: 15 },
    entry: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 20, paddingHorizontal: 16, backgroundColor: palette.surface },
    entryFirst: { marginTop: 3, borderTopLeftRadius: 30, borderTopRightRadius: 30 },
    entryLast: { marginBottom: 12, borderBottomLeftRadius: 30, borderBottomRightRadius: 30 }, entryMain: { flex: 1 },
    question: { fontFamily: SERIF_BOLD, fontSize: 16, fontWeight: '600', lineHeight: 27, color: palette.ink },
    answer: { fontSize: 12.5, lineHeight: 16, color: palette.ink2 }, meta: { fontSize: 10.5, fontWeight: '500', color: palette.ink3 },
    date: { fontSize: 10.5, fontWeight: '500', color: palette.ink3 },
    separator: { position: 'absolute', bottom: 0, left: 16, right: 16, height: StyleSheet.hairlineWidth, backgroundColor: palette.line },
  });
}
