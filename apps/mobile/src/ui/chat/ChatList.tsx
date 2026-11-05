import { useCallback, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type ListRenderItemInfo } from 'react-native';
import type { Palette } from '../theme';
import type { CitationTarget, QuestionPresentation } from '../reader-question/session';
import { AssistantTurn } from './AssistantTurn';
import { ChatEmptyState, ChatErrorBanner, ChatLoadingState } from './ChatStates';
import { UserTurn } from './UserTurn';
import { plainUserTextKey } from './plainUserTextLayout';
import { useChatListScroll } from './useChatListScroll';
import { usePreparedChatTurns } from './usePreparedChatTurns';
import type { ChatTurn } from './types';

/** Only complete text layouts enter the list; reference and reflow share one anchor. */
export function ChatList({ turns, bookId, bookTitle, format, sourceAvailable, indexMissing, loadError, indexDetail, onRetry, palette, presentation, onOpenCitation }: {
  readonly turns: ChatTurn[]; readonly bookId: string; readonly bookTitle: string; readonly format: 'epub' | 'pdf';
  readonly sourceAvailable: boolean; readonly indexMissing: boolean; readonly loadError: string | null;
  readonly indexDetail: string; readonly onRetry: (turn: ChatTurn) => void; readonly palette: Palette;
  readonly presentation: QuestionPresentation; readonly onOpenCitation: (target: CitationTarget) => void;
}) {
  const view = useSyncExternalStore(presentation.subscribe, presentation.getSnapshot, presentation.getSnapshot);
  const [rowWidth, setRowWidth] = useState(0);
  const scroll = useChatListScroll(presentation, onOpenCitation);
  const prepared = usePreparedChatTurns(turns, rowWidth, scroll.captureLayout);
  const { data } = prepared;
  useLayoutEffect(() => { scroll.update(data, prepared.finalLayoutReady); }, [data, prepared.finalLayoutReady, scroll.update]);
  const anchorIndex = scroll.saved.current.anchorId ? data.findIndex(turn => turn.id === scroll.saved.current.anchorId) : -1;
  const renderItem = useCallback(({ item }: ListRenderItemInfo<ChatTurn>) => (
    <View collapsable={false} ref={node => { if (node) scroll.rows.current.set(item.id, node); else scroll.rows.current.delete(item.id); }} onLayout={scroll.restore}>
      {item.role === 'user' ? <UserTurn turn={item} title={bookTitle} palette={palette}
        plainLayout={prepared.layouts.get(plainUserTextKey(item.text, prepared.rowWidth))}
        expanded={view.expandedSelection.includes(item.id)} onToggleExpanded={() => presentation.toggle('expandedSelection', item.id)} />
        : <AssistantTurn turn={item} bookId={bookId} bookTitle={bookTitle} format={format} sourceAvailable={sourceAvailable}
          palette={palette} onRetry={onRetry} presentation={presentation} onOpenCitation={scroll.openCitation} onCitationElement={scroll.registerCitation}
          reasoningExpanded={view.expandedReasoning.includes(item.id)} toolsExpanded={view.expandedTools.includes(item.id)} />}
    </View>
  ), [bookId, bookTitle, format, onRetry, palette, presentation, prepared.layouts, prepared.rowWidth,
    scroll.rows, scroll.restore, scroll.openCitation, scroll.registerCitation, sourceAvailable, view.expandedReasoning, view.expandedSelection, view.expandedTools]);
  const banner = indexMissing || loadError ? <ChatErrorBanner indexMissing={indexMissing} loadError={loadError} indexDetail={indexDetail} palette={palette} /> : null;

  return <View ref={scroll.viewport} style={styles.list} onLayout={({ nativeEvent }) => {
    const width = Math.max(0, nativeEvent.layout.width - 40);
    setRowWidth(current => Math.abs(current - width) < 0.0001 ? current : width); scroll.restore();
  }}>
    {prepared.probe}
    {prepared.failure ? <View accessibilityRole="alert" style={styles.failure}>
      <Text style={{ color: palette.error }}>暂时无法显示完整对话，请重试。</Text>
      <Pressable accessibilityRole="button" onPress={prepared.retry}><Text style={{ color: palette.lamp }}>重试</Text></Pressable>
    </View> : null}
    {prepared.loading ? <View style={styles.loading}><ChatLoadingState palette={palette} /></View> : null}
    {prepared.hasCommitted || data.length || (!prepared.loading && !prepared.failure) ? <FlatList ref={scroll.list} testID="question-scroll" alwaysBounceVertical
      style={[styles.list, prepared.hidden && styles.awaitingAnchor]}
      accessibilityElementsHidden={prepared.hidden} importantForAccessibility={prepared.hidden ? 'no-hide-descendants' : 'auto'}
      pointerEvents={prepared.hidden ? 'none' : 'auto'} contentContainerStyle={styles.content} data={data} renderItem={renderItem}
      keyExtractor={item => item.id} ItemSeparatorComponent={() => <View style={styles.separator} />}
      initialScrollIndex={anchorIndex >= 0 ? anchorIndex : undefined}
      onScrollToIndexFailed={info => {
        scroll.list.current?.scrollToOffset({ offset: Math.max(0, info.averageItemLength * info.index), animated: false });
      }}
      onScroll={event => scroll.onScroll(event.nativeEvent.contentOffset.y)} onScrollBeginDrag={scroll.beginDrag}
      onScrollEndDrag={scroll.endDrag} onMomentumScrollEnd={scroll.endDrag}
      onViewableItemsChanged={scroll.onViewableItemsChanged} onContentSizeChange={scroll.onContentSizeChange}
      ListHeaderComponent={data.length > 0 ? banner ?? undefined : undefined}
      ListEmptyComponent={data.length === 0 ? banner ?? <ChatEmptyState /> : undefined}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" scrollEventThrottle={16}
    /> : null}
  </View>;
}
const styles = StyleSheet.create({
  list: { flex: 1 }, content: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 34 }, separator: { height: 24 },
  awaitingAnchor: { opacity: 0 }, loading: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  failure: { paddingHorizontal: 20, paddingVertical: 12, gap: 8 },
});
