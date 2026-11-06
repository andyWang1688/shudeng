import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { ArrowUpRight, ChevronDown, ChevronRight } from "lucide-react-native";
import Swipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { DemoEmpty, DemoHeading, DemoSearch } from "./DemoChrome";
import { DemoBookCover } from "./DemoShelf";
import { demoBooks, type DemoBook } from "./demoBooks";
import {
  demoConversations,
  demoNotes,
  type DemoConversation,
  type DemoNote,
} from "./collectionFixtures";
import { demoColors as c } from "./demoTheme";

const DISCLOSURE_MOTION = {
  duration: 220,
  easing: Easing.bezier(0.22, 1, 0.36, 1),
  reduceMotion: ReduceMotion.System,
};

export function DemoNotes({
  onOpenBook,
  items = demoNotes,
}: {
  onOpenBook: (title: string, position?: number) => void;
  items?: readonly DemoNote[];
}) {
  const [expandedNote, setExpandedNote] = useState<string | null>(null);
  return (
    <CollectionBrowser
      title="笔记"
      unit="条笔记"
      placeholder="搜索摘录、想法或书名"
      items={items}
      searchText={(note) => note.quote + note.thought + note.location}
      renderItem={(note) => {
        const open = expandedNote === note.id;
        const book = demoBooks.find((book) => book.id === note.bookId)!;
        return (
          <View style={s.note}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={"查看笔记：" + note.quote}
              accessibilityState={{ expanded: open }}
              onPress={() => setExpandedNote(open ? null : note.id)}
              style={({ pressed }) => pressed && s.pressed}
            >
              <View style={[s.quoteBlock, note.personal && s.personalBlock]}>
                <Text numberOfLines={open ? undefined : 2} style={s.quote}>
                  {note.quote}
                </Text>
              </View>
              {!!note.thought && (
                <Text style={s.thought} numberOfLines={open ? undefined : 1}>
                  {note.thought}
                </Text>
              )}
              <Text style={s.meta}>
                {note.location} · {note.date}
              </Text>
            </Pressable>
            {open && (
              <Pressable
                accessibilityRole="button"
                onPress={() => onOpenBook(book.title, note.position)}
                style={s.source}
              >
                <Text style={s.sourceText}>回到原文</Text>
                <ArrowUpRight size={16} color={c.accent} />
              </Pressable>
            )}
          </View>
        );
      }}
    />
  );
}

export function DemoConversations({
  onOpenChat,
}: {
  onOpenChat: (book: DemoBook, question: string, selection?: string) => void;
}) {
  // Renaming changes the list label, while the original question stays intact.
  const [chats, setChats] = useState(() =>
    demoConversations.map((chat) => ({ ...chat, question: chat.title })),
  );
  const activeSwipe = useRef<SwipeableMethods | null>(null);
  const [revealedChat, setRevealedChat] = useState<string | null>(null);
  const swipes = useRef(new Map<string, SwipeableMethods>());
  const closeSwipe = () => {
    activeSwipe.current?.close();
    activeSwipe.current = null;
    setRevealedChat(null);
  };
  const rename = (chat: DemoConversation) => {
    closeSwipe();
    Alert.prompt(
      "重新命名",
      undefined,
      [
        { text: "取消", style: "cancel" },
        {
          text: "保存",
          onPress: (value) => {
            const title = value?.trim();
            if (title)
              setChats((old) =>
                old.map((item) =>
                  item.id === chat.id ? { ...item, title } : item,
                ),
              );
          },
        },
      ],
      "plain-text",
      chat.title,
    );
  };
  const remove = (chat: DemoConversation) => {
    closeSwipe();
    Alert.alert("删除这条对话？", undefined, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () =>
          setChats((old) => old.filter((item) => item.id !== chat.id)),
      },
    ]);
  };
  const actions = (chat: DemoConversation) => {
    closeSwipe();
    Alert.alert(chat.title, undefined, [
      { text: "重新命名", onPress: () => rename(chat) },
      { text: "删除", style: "destructive", onPress: () => remove(chat) },
      { text: "取消", style: "cancel" },
    ]);
  };
  return (
    <CollectionBrowser
      title="对话"
      unit="条对话"
      placeholder="搜索问题或书名"
      items={chats}
      onInteract={closeSwipe}
      searchText={(chat) => chat.title + (chat.selection ?? "")}
      renderItem={(chat) => (
        <Swipeable
          ref={(swipe) => {
            if (swipe) swipes.current.set(chat.id, swipe);
            else swipes.current.delete(chat.id);
          }}
          overshootRight={false}
          onSwipeableWillOpen={() => {
            const swipe = swipes.current.get(chat.id) ?? null;
            if (activeSwipe.current !== swipe) activeSwipe.current?.close();
            activeSwipe.current = swipe;
            setRevealedChat(chat.id);
          }}
          onSwipeableClose={() =>
            setRevealedChat((id) => (id === chat.id ? null : id))
          }
          renderRightActions={() => (
            <View
              style={s.swipeActions}
              accessibilityElementsHidden={revealedChat !== chat.id}
              importantForAccessibility={
                revealedChat === chat.id ? "auto" : "no-hide-descendants"
              }
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={"重新命名：" + chat.title}
                onPress={() => rename(chat)}
                style={[s.swipeAction, s.renameAction]}
              >
                <Text style={s.actionText}>重命名</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={"删除：" + chat.title}
                onPress={() => remove(chat)}
                style={[s.swipeAction, s.deleteAction]}
              >
                <Text style={s.actionText}>删除</Text>
              </Pressable>
            </View>
          )}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={"打开对话：" + chat.title}
            accessibilityHint="左滑或长按可重新命名和删除"
            accessibilityActions={[
              { name: "rename", label: "重新命名" },
              { name: "delete", label: "删除" },
            ]}
            onAccessibilityAction={({ nativeEvent }) => {
              if (nativeEvent.actionName === "rename") rename(chat);
              else if (nativeEvent.actionName === "delete") remove(chat);
            }}
            onLongPress={() => actions(chat)}
            onPress={() => {
              closeSwipe();
              onOpenChat(
                demoBooks.find((book) => book.id === chat.bookId)!,
                chat.question,
                chat.selection,
              );
            }}
            style={({ pressed }) => [s.chat, pressed && s.pressed]}
          >
            <View style={s.chatBody}>
              <Text style={s.chatTitle} numberOfLines={2}>
                {chat.title}
              </Text>
            </View>
            <ChevronRight size={15} color={c.muted} />
          </Pressable>
        </Swipeable>
      )}
    />
  );
}

/** Keep book context and expand the sample rows in place. */
function CollectionBrowser<T extends DemoNote | DemoConversation>({
  title,
  unit,
  placeholder,
  items,
  searchText,
  renderItem,
  onInteract,
}: {
  title: string;
  unit: string;
  placeholder: string;
  items: readonly T[];
  searchText: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  onInteract?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [expandedBook, setExpandedBook] = useState<string | null>(
    items[0]?.bookId ?? null,
  );
  const [allBooks, setAllBooks] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const { height, fontScale } = useWindowDimensions();
  const previewLimit = height < 740 || fontScale > 1.2 ? 2 : 3;
  const overview = useRef<FlatList<{ book: DemoBook; rows: T[] }>>(null);
  const filter = (item: T, term: string) => {
    const book = demoBooks.find((book) => book.id === item.bookId)!;
    return (book.title + searchText(item))
      .toLocaleLowerCase()
      .includes(term.trim().toLocaleLowerCase());
  };
  const groups = demoBooks.flatMap((book) => {
    const rows = items.filter(
      (item) => item.bookId === book.id && filter(item, query),
    );
    return rows.length ? [{ book, rows }] : [];
  });
  const toggleAll = (bookId: string) => {
    Keyboard.dismiss();
    onInteract?.();
    setAllBooks((old) => {
      const next = new Set(old);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  };
  return (
    <View style={s.screen}>
      <DemoHeading title={title} />
      <DemoSearch
        value={query}
        onChange={(text) => {
          onInteract?.();
          overview.current?.scrollToOffset({ offset: 0, animated: false });
          setQuery(text);
        }}
        placeholder={placeholder}
      />
      <FlatList
        ref={overview}
        data={groups}
        keyExtractor={(group) => group.book.id}
        bounces
        alwaysBounceVertical
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={onInteract}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.content}
        ListEmptyComponent={<DemoEmpty query={query} />}
        renderItem={({ item: group }) => {
          const open =
            query.trim().length > 0 || expandedBook === group.book.id;
          const all = !!query.trim() || allBooks.has(group.book.id);
          return (
            <View style={s.group}>
              <BookGroup
                book={group.book}
                count={group.rows.length}
                unit={unit}
                expanded={open}
                searching={!!query.trim()}
                onPress={() => {
                  onInteract?.();
                  setExpandedBook((id) =>
                    id === group.book.id ? null : group.book.id,
                  );
                }}
              />
              <DisclosureBody expanded={open}>
                {(all ? group.rows : group.rows.slice(0, previewLimit)).map(
                  (item) => (
                    <View key={item.id}>{renderItem(item)}</View>
                  ),
                )}
                {!query.trim() && group.rows.length > previewLimit && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: all }}
                    accessibilityLabel={
                      all
                        ? "收起" + group.book.title + "的列表"
                        : "查看" +
                          group.book.title +
                          "的全部" +
                          group.rows.length +
                          unit
                    }
                    onPress={() => toggleAll(group.book.id)}
                    style={({ pressed }) => [s.more, pressed && s.pressed]}
                  >
                    <Text style={s.moreText}>
                      {all
                        ? "收起"
                        : "查看全部 " + group.rows.length + " " + unit}
                    </Text>
                    <ChevronDown
                      size={15}
                      color={c.accent}
                      style={
                        all ? { transform: [{ rotate: "180deg" }] } : undefined
                      }
                    />
                  </Pressable>
                )}
              </DisclosureBody>
            </View>
          );
        }}
      />
    </View>
  );
}

/** Text stays anchored and opaque; only its clipped viewport opens or closes. */
function DisclosureBody({
  expanded,
  children,
}: {
  expanded: boolean;
  children: ReactNode;
}) {
  const progress = useSharedValue(expanded ? 1 : 0);
  const contentHeight = useSharedValue(0);
  const measured = useRef(false);
  useEffect(() => {
    progress.set(withTiming(expanded ? 1 : 0, DISCLOSURE_MOTION));
  }, [expanded, progress]);
  const viewport = useAnimatedStyle(() => ({
    height: contentHeight.get() * progress.get(),
  }));
  return (
    <Animated.View
      style={[s.disclosure, viewport]}
      pointerEvents={expanded ? "auto" : "none"}
      accessibilityElementsHidden={!expanded}
      importantForAccessibility={expanded ? "auto" : "no-hide-descendants"}
    >
      <View
        style={s.disclosureContent}
        onLayout={({ nativeEvent }) => {
          const height = nativeEvent.layout.height;
          contentHeight.set(
            measured.current ? withTiming(height, DISCLOSURE_MOTION) : height,
          );
          measured.current = true;
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
}

function BookGroup({
  book,
  count,
  unit,
  expanded,
  searching,
  onPress,
}: {
  book: DemoBook;
  count: number;
  unit: string;
  expanded: boolean;
  searching: boolean;
  onPress: () => void;
}) {
  const indicator = useAnimatedStyle(
    () => ({
      transform: [
        { rotate: withTiming(expanded ? "0deg" : "-90deg", DISCLOSURE_MOTION) },
      ],
    }),
    [expanded],
  );
  const content = (
    <>
      <DemoBookCover book={book} miniature />
      <View style={s.groupLabel}>
        <Text style={s.groupTitle}>{book.title}</Text>
        <Text style={s.groupCount}>
          {count} {unit}
        </Text>
      </View>
      {!searching && (
        <Animated.View style={indicator}>
          <ChevronDown size={18} color={c.secondary} />
        </Animated.View>
      )}
    </>
  );
  // Search exposes every matching group; a decorative chevron must not imply it can hide results.
  return searching ? (
    <View style={s.groupHeading}>{content}</View>
  ) : (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={book.title + "，" + count + unit}
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={({ pressed }) => [s.groupHeading, pressed && s.pressed]}
    >
      {content}
    </Pressable>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: 24,
    paddingTop: 6,
    paddingBottom: 32,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  group: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
  },
  groupHeading: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 76,
    gap: 12,
    paddingVertical: 8,
  },
  groupLabel: { flex: 1 },
  groupTitle: { fontSize: 23, lineHeight: 31, fontWeight: "700", color: c.ink },
  groupCount: { fontSize: 13, lineHeight: 20, color: c.muted, marginTop: 5 },
  disclosure: { overflow: "hidden" },
  disclosureContent: {
    position: "absolute",
    top: 0,
    left: 40,
    right: 0,
    paddingLeft: 8,
    paddingTop: 3,
  },
  note: {
    paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
  },
  quoteBlock: { borderLeftWidth: 2, borderLeftColor: c.gold, paddingLeft: 10 },
  personalBlock: { borderLeftWidth: 0, paddingLeft: 0 },
  quote: { fontSize: 17, lineHeight: 27, color: c.ink },
  thought: { fontSize: 14, lineHeight: 22, color: c.secondary, marginTop: 8 },
  meta: { fontSize: 12, lineHeight: 19, color: c.muted, marginTop: 7 },
  source: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    minHeight: 44,
    marginTop: 5,
  },
  sourceText: { fontSize: 14, color: c.accent },
  chat: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 16,
    backgroundColor: c.paper,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
  },
  chatBody: { flex: 1 },
  swipeActions: { flexDirection: "row" },
  swipeAction: { width: 76, justifyContent: "center", alignItems: "center" },
  renameAction: { backgroundColor: c.secondary },
  deleteAction: { backgroundColor: "#B94237" },
  actionText: { fontSize: 14, color: c.surface },
  chatTitle: { fontSize: 17, lineHeight: 26, color: c.ink },
  more: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 48,
    paddingVertical: 12,
  },
  moreText: { color: c.accent, fontSize: 14, lineHeight: 22 },
  pressed: { opacity: 0.6 },
});
