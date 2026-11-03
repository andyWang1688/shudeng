import { useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, StyleSheet, View, type ListRenderItemInfo } from 'react-native';
import type { Palette } from '../theme';
import { AssistantTurn } from './AssistantTurn';
import { ChatEmptyState, ChatErrorBanner } from './ChatStates';
import { UserTurn } from './UserTurn';
import type { ChatTurn } from './types';
import { useReduceMotion } from './useReduceMotion';

/**
 * 时间正序数据 → inverted FlatList 显示为“最新在底部”。
 * inverted 让流式内容增长时停留在 offset 0，不需要每个 delta scrollToEnd。
 */
export function ChatList({
  turns,
  bookId,
  bookTitle,
  format,
  indexMissing,
  loadError,
  indexDetail,
  onRetry,
  palette,
}: {
  readonly turns: ChatTurn[];
  readonly bookId: string;
  readonly bookTitle: string;
  readonly format: 'epub' | 'pdf';
  readonly indexMissing: boolean;
  readonly loadError: string | null;
  readonly indexDetail: string;
  readonly onRetry: (turn: ChatTurn) => void;
  readonly palette: Palette;
}) {
  const styles = useMemo(() => createStyles(), []);
  const reduceMotion = useReduceMotion();
  const listRef = useRef<FlatList<ChatTurn> | null>(null);
  const data = useMemo(() => [...turns].reverse(), [turns]);
  const hasError = indexMissing || loadError;

  // 只在新增 turn（发送/重试）时回到底部；流式 delta 只更新行内容，不再滚底。
  useEffect(() => {
    const timer = setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: !reduceMotion }), 80);
    return () => clearTimeout(timer);
  }, [reduceMotion, turns.length]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ChatTurn>) =>
      item.role === 'user' ? (
        <UserTurn turn={item} title={bookTitle} palette={palette} />
      ) : (
        <AssistantTurn
          turn={item}
          bookId={bookId}
          bookTitle={bookTitle}
          format={format}
          palette={palette}
          onRetry={onRetry}
        />
      ),
    [bookId, bookTitle, format, onRetry, palette],
  );
  const keyExtractor = useCallback((item: ChatTurn) => item.id, []);
  const separator = useCallback(() => <View style={styles.separator} />, [styles.separator]);

  const banner = useMemo(
    () =>
      hasError ? (
        <ChatErrorBanner indexMissing={indexMissing} loadError={loadError} indexDetail={indexDetail} palette={palette} />
      ) : null,
    [hasError, indexDetail, indexMissing, loadError, palette],
  );
  const empty = useMemo(
    () => (turns.length === 0 ? banner ?? <ChatEmptyState /> : null),
    [banner, turns.length],
  );

  return (
    <FlatList
      ref={listRef}
      inverted
      style={styles.list}
      contentContainerStyle={styles.content}
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      ItemSeparatorComponent={separator}
      // inverted 的 footer 出现在视觉顶部：错误条放到旧消息上方。
      ListFooterComponent={turns.length > 0 && banner ? banner : undefined}
      ListEmptyComponent={empty ?? undefined}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      scrollEventThrottle={16}
    />
  );
}

function createStyles() {
  return StyleSheet.create({
    list: { flex: 1 },
    content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16 },
    separator: { height: 24 },
  });
}
