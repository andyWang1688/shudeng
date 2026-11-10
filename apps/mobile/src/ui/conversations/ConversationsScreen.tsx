import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Keyboard,
  LayoutAnimation,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import Swipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { SymbolView } from "expo-symbols";
import { EmptyState } from "../components/EmptyState";
import { BookNotice } from "../components/BookNotice";
import { SectionHeader } from "../components/SectionHeader";
import { PageHeading, PageSearch } from "../components/PageChrome";
import { usePalette, type Palette } from "../theme";
import { ConversationRenamePrompt } from "./ConversationRenamePrompt";
import {
  conversationSections,
  conversationTitle,
  type ConversationItem,
  type ConversationSection,
} from "./model";
import { useConversationList } from "./useConversationList";

export default function ConversationsScreen() {
  const router = useRouter();
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const state = useConversationList();
  const list = useRef<SectionList<ConversationItem, ConversationSection>>(null);
  const [query, setQuery] = useState("");
  const [allBooks, setAllBooks] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let active = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (enabled) => {
        changed = true;
        setReduceMotion(enabled);
      },
    );
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active && !changed) setReduceMotion(enabled);
      })
      .catch(() => {});
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  const transitionDuration = reduceMotion ? 0 : 220;
  const animateDisclosure = () => {
    if (transitionDuration)
      LayoutAnimation.configureNext({
        duration: transitionDuration,
        update: { type: "easeInEaseOut" },
      });
  };
  const { height, fontScale } = useWindowDimensions();
  const previewLimit = height < 740 || fontScale > 1.2 ? 2 : 3;
  const activeSwipe = useRef<SwipeableMethods | null>(null);
  const focused = useRef(false);
  const closeSwipe = useCallback(() => {
    activeSwipe.current?.close();
    activeSwipe.current = null;
  }, []);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
        closeSwipe();
      };
    }, [closeSwipe]),
  );
  const openDialog = (kind: "rename" | "delete", item: ConversationItem) => {
    if (focused.current) state.openDialog(kind, item);
  };
  const changeQuery = (value: string) => {
    closeSwipe();
    list.current?.getScrollResponder()?.scrollTo({ y: 0, animated: false });
    setQuery(value);
  };
  const clearSearch = () => changeQuery("");
  const needle = query.trim();
  const sections = state.loadError
    ? []
    : conversationSections(
        state.items,
        state.books,
        query,
        state.collapsed,
      ).map((section) => ({
        ...section,
        data:
          needle || allBooks.has(section.bookId)
            ? section.data
            : section.data.slice(0, previewLimit),
      }));
  const toggleAll = (bookId: string) => {
    Keyboard.dismiss();
    closeSwipe();
    if (allBooks.has(bookId)) {
      const sectionIndex = sections.findIndex(
        (section) => section.bookId === bookId,
      );
      if (sectionIndex >= 0)
        list.current?.scrollToLocation({
          sectionIndex,
          itemIndex: 0,
          animated: false,
        });
    }
    animateDisclosure();
    setAllBooks((old) => {
      const next = new Set(old);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  };
  const dialog = state.dialog;
  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={["top", "left", "right"]}
      testID="conversations-surface"
    >
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeading title="对话" />
      <PageSearch
        value={query}
        onChange={changeQuery}
        placeholder="搜索问题或书名"
        testID="conversations-search"
      />
      <SectionList
        ref={list}
        testID="question-history"
        sections={sections}
        contentInsetAdjustmentBehavior="never"
        onScrollBeginDrag={closeSwipe}
        keyExtractor={(item) => item.conversationId}
        renderItem={({ item }) => (
          <ConversationRow
            item={item}
            palette={palette}
            styles={styles}
            onRename={() => openDialog("rename", item)}
            onDelete={() => openDialog("delete", item)}
            onSwipeOpen={(swipe) => {
              if (!focused.current) {
                swipe?.close();
                return false;
              }
              if (activeSwipe.current !== swipe) activeSwipe.current?.close();
              activeSwipe.current = swipe;
              return true;
            }}
            onOpen={() => {
              if (!focused.current) return;
              closeSwipe();
              Keyboard.dismiss();
              router.push({
                pathname: "/book-chat",
                params: {
                  bookId: item.bookId,
                  conversationId: item.conversationId,
                  bookTitle:
                    item.bookTitle ??
                    state.books.find((book) => book.id === item.bookId)
                      ?.title ??
                    "书内问答",
                },
              });
            }}
          />
        )}
        renderSectionHeader={({ section }) => (
          <View testID={"conversations-book-" + section.bookId}>
            <SectionHeader
              style={styles.groupHeader}
              variant="group"
              title={section.title}
              count={String(section.count)}
              countSuffix=" 条对话"
              swatch={{
                title: section.title,
                format: section.book?.format,
                coverUri: section.book?.coverUri,
              }}
              expanded={!section.collapsed}
              transitionDuration={transitionDuration}
              onPress={() => {
                closeSwipe();
                if (!needle) {
                  animateDisclosure();
                  state.toggleGroup(section.bookId);
                }
              }}
            />
          </View>
        )}
        renderSectionFooter={({ section }) =>
          !needle && !section.collapsed && section.count > previewLimit ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: allBooks.has(section.bookId) }}
              accessibilityLabel={
                allBooks.has(section.bookId)
                  ? "收起" + section.title + "的对话列表"
                  : "查看" + section.title + "的全部" + section.count + "条对话"
              }
              onPress={() => toggleAll(section.bookId)}
              style={styles.more}
            >
              <Text style={styles.moreText}>
                {allBooks.has(section.bookId)
                  ? "收起"
                  : "查看全部 " + section.count + " 条对话"}
              </Text>
              <SymbolView
                name={
                  allBooks.has(section.bookId) ? "chevron.up" : "chevron.down"
                }
                size={12}
                tintColor={palette.lampInk}
              />
            </Pressable>
          ) : null
        }
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.content}
        ListEmptyComponent={
          state.loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={palette.lamp} />
            </View>
          ) : state.loadError ? (
            <View testID="conversations-load-failed">
              <EmptyState
                symbol="exclamationmark.triangle"
                title="对话读取失败"
                description="原记录未被覆盖。检查储存空间后重试。"
                actionLabel="重试"
                onAction={() => void state.reload()}
              />
            </View>
          ) : needle ? (
            <View testID="conversations-search-empty">
              <EmptyState
                symbol="magnifyingglass"
                title="没有找到相关对话"
                description="换一个关键词，或清除搜索查看全部记录。"
                actionLabel="清除搜索"
                onAction={clearSearch}
              />
            </View>
          ) : (
            <View testID="conversations-empty">
              <EmptyState
                symbol="bubble.left.and.bubble.right"
                title="还没有对话"
                description="阅读时选中原文提问，问题与回答会留在这里。"
                actionLabel="去书架读书"
                onAction={() => router.navigate("/(tabs)")}
              />
            </View>
          )
        }
        ListFooterComponent={<View style={styles.footer} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      />
      {dialog?.kind === "rename" ? (
        <ConversationRenamePrompt
          key={dialog.id}
          initialName={conversationTitle(dialog.item)}
          onCancel={() => state.dismiss(dialog.id)}
          onSave={(title) => void state.confirm(dialog.id, dialog.item, title)}
        />
      ) : null}
      {dialog?.kind === "delete" ? (
        <BookNotice
          key={dialog.id}
          title="删除对话？"
          message="删除本对话的所有轮次及引用快照；生成中的请求将取消。"
          actions={[
            {
              title: "取消",
              style: "cancel",
              onPress: () => state.dismiss(dialog.id),
            },
            {
              title: "删除",
              style: "destructive",
              onPress: () => void state.confirm(dialog.id, dialog.item),
            },
          ]}
        />
      ) : null}
      {dialog?.kind === "notice" ? (
        <BookNotice
          key={dialog.id}
          title="操作未保存"
          message={dialog.message}
          onAcknowledge={() => state.dismiss(dialog.id)}
        />
      ) : null}
    </SafeAreaView>
  );
}

function ConversationRow({
  item,
  palette,
  styles,
  onRename,
  onDelete,
  onOpen,
  onSwipeOpen,
}: {
  readonly item: ConversationItem;
  readonly palette: Palette;
  readonly styles: ReturnType<typeof createStyles>;
  readonly onRename: () => void;
  readonly onDelete: () => void;
  readonly onOpen: () => void;
  readonly onSwipeOpen: (swipe: SwipeableMethods | null) => boolean;
}) {
  const swipe = useRef<SwipeableMethods>(null);
  const actionsOpen = useRef(false);
  const [actionsVisible, setActionsVisible] = useState(false);
  const title = conversationTitle(item);
  const hideActions = () => {
    actionsOpen.current = false;
    setActionsVisible(false);
  };
  const choose = (action: () => void, fromSwipe = false) => {
    if (fromSwipe && !actionsOpen.current) return;
    hideActions();
    swipe.current?.close();
    action();
  };
  return (
    <Swipeable
      ref={swipe}
      containerStyle={styles.swipeContainer}
      onSwipeableWillOpen={() => {
        if (!onSwipeOpen(swipe.current)) return;
        actionsOpen.current = true;
        setActionsVisible(true);
      }}
      onSwipeableWillClose={hideActions}
      onSwipeableClose={hideActions}
      overshootLeft={false}
      overshootRight={false}
      renderRightActions={() => (
        <View
          style={styles.swipeActions}
          accessibilityElementsHidden={!actionsVisible}
          importantForAccessibility={
            actionsVisible ? "auto" : "no-hide-descendants"
          }
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="对话改名"
            disabled={!actionsVisible}
            onPress={() => choose(onRename, true)}
            style={[styles.swipeAction, styles.renameAction]}
          >
            <SymbolView name="pencil" size={18} tintColor={palette.paper} />
            <Text style={styles.swipeTitle}>重命名</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="删除对话"
            disabled={!actionsVisible}
            onPress={() => choose(onDelete, true)}
            style={[styles.swipeAction, styles.deleteAction]}
          >
            <SymbolView name="trash" size={18} tintColor={palette.paper} />
            <Text style={styles.swipeTitle}>删除</Text>
          </Pressable>
        </View>
      )}
    >
      <Pressable
        testID={"question-" + item.conversationId}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint="左滑可重新命名和删除"
        accessibilityActions={[
          { name: "rename", label: "重新命名" },
          { name: "delete", label: "删除" },
        ]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === "rename") choose(onRename);
          else if (nativeEvent.actionName === "delete") choose(onDelete);
        }}
        onPress={() => {
          if (actionsOpen.current) {
            hideActions();
            swipe.current?.close();
            return;
          }
          onOpen();
        }}
        style={({ pressed }) => [
          styles.entry,
          pressed && { backgroundColor: palette.paperDeep },
        ]}
      >
        <View style={styles.entryMain}>
          <Text
            style={styles.question}
            dynamicTypeRamp="headline"
            numberOfLines={2}
          >
            {title}
          </Text>
        </View>
        <SymbolView
          name="chevron.right"
          size={12}
          weight="semibold"
          tintColor={palette.ink3}
        />
      </Pressable>
    </Swipeable>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: palette.paper },
    center: { minHeight: 160, alignItems: "center", justifyContent: "center" },
    content: { paddingHorizontal: 24, paddingTop: 6 },
    groupHeader: { marginTop: 12 },
    footer: { height: 32 },
    swipeContainer: {
      marginLeft: 48,
      overflow: "hidden",
      backgroundColor: palette.paper,
    },
    swipeActions: {
      flexDirection: "row",
      gap: 6,
      paddingLeft: 8,
      paddingVertical: 5,
    },
    swipeAction: {
      width: 68,
      minHeight: 52,
      borderRadius: 12,
      borderCurve: "continuous",
      gap: 4,
      paddingVertical: 8,
      alignItems: "center",
      justifyContent: "center",
    },
    renameAction: { backgroundColor: palette.ink2 },
    deleteAction: { backgroundColor: palette.error },
    swipeTitle: { color: palette.paper, fontSize: 13, lineHeight: 18 },
    entry: {
      minHeight: 62,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 16,
      backgroundColor: palette.paper,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.line,
    },
    entryMain: { flex: 1 },
    question: { fontSize: 17, lineHeight: 26, color: palette.ink },
    more: {
      marginLeft: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: 48,
      paddingVertical: 12,
    },
    moreText: { fontSize: 14, lineHeight: 22, color: palette.lampInk },
  });
}
