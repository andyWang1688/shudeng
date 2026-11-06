import { useState, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SymbolView } from "expo-symbols";
import { demoColors as c } from "./demoTheme";

const BOOKS = [
  {
    id: "river",
    title: "额尔古纳河右岸",
    author: "迟子建",
    cover: "#334D40",
    coverInk: "#F3EBD7",
  },
  {
    id: "moon",
    title: "月亮与六便士",
    author: "威廉·萨默塞特·毛姆",
    cover: "#A65F46",
    coverInk: "#F7EADB",
  },
] as const;
const NOTES = [
  {
    id: "n1",
    bookId: "river",
    quote: "我是雨和雪的老熟人了，我有九十岁了。",
    location: "清晨 · 第 1 章",
    date: "今天",
    thought:
      "开篇用天气来介绍自己，而不是名字和身份。人与自然之间的关系，从第一句就已经开始了。",
  },
  {
    id: "n2",
    bookId: "river",
    quote: "人的心在痛的时候，泪水才会流下来。",
    location: "正午 · 第 2 章",
    date: "昨天",
    thought:
      "那些没有直接说出口的感情，常常藏在最简单的叙述里。再读时留意她如何描写失去。",
  },
  {
    id: "n3",
    bookId: "river",
    quote: "这片森林，记得每一个离开它的人。",
    location: "黄昏 · 第 3 章",
    date: "11 月 3 日",
    thought:
      "阅读随记：森林既是生活的地方，也是记忆的容器。想把“地方与记忆”这个线索继续读下去。",
    personal: true,
  },
  {
    id: "n4",
    bookId: "moon",
    quote: "满地都是六便士，他却抬头看见了月亮。",
    location: "第 21 章",
    date: "11 月 2 日",
    thought:
      "关于理想与生活的取舍，还没有一个简单的答案。让我在意的是：追逐月亮时，身边的人承担了什么。",
  },
  {
    id: "n5",
    bookId: "moon",
    quote: "艺术为什么会成为一个人无法放下的事？",
    location: "第 35 章",
    date: "10 月 31 日",
    thought: "阅读随记：不急着赞同或反对主人公，先看看他每一次选择付出的代价。",
    personal: true,
  },
] as const;
const CONVERSATIONS = [
  {
    id: "c1",
    bookId: "river",
    title: "为什么从一场雨开始讲故事？",
    preview: "从开篇的天气、叙述者的年龄与森林的关系，重新理解这段文字。",
    date: "今天 09:42",
    count: 8,
  },
  {
    id: "c2",
    bookId: "river",
    title: "森林在这本书里意味着什么",
    preview: "它既是族人生活的家园，也承载着一代代人的记忆。",
    date: "昨天",
    count: 6,
  },
  {
    id: "c3",
    bookId: "moon",
    title: "“月亮”与“六便士”分别指什么？",
    preview: "从理想、世俗生活和主人公的选择，梳理书名中的两种力量。",
    date: "11 月 2 日",
    count: 4,
  },
  {
    id: "c4",
    bookId: "moon",
    title: "如何看待斯特里克兰的选择",
    preview: "先回到几段具体情节，看看他的自由与他人的代价。",
    date: "10 月 31 日",
    count: 10,
  },
] as const;

type Book = (typeof BOOKS)[number];

export function DemoNotes({
  onOpenBook,
}: {
  readonly onOpenBook: (title?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [closedGroups, setClosedGroups] = useState<readonly string[]>([]);
  const matches = NOTES.filter((note) => {
    const book = BOOKS.find((book) => book.id === note.bookId)!;
    return (note.quote + note.thought + book.title).includes(query.trim());
  });
  return (
    <CollectionFrame
      title="笔记"
      query={query}
      onChangeQuery={setQuery}
      placeholder="搜索摘录、想法或书名"
    >
      <View style={styles.summary}>
        <Text style={styles.summaryCount}>{matches.length} 条笔记</Text>
      </View>
      {BOOKS.map((book) => {
        const notes = matches.filter((note) => note.bookId === book.id);
        if (notes.length === 0) return null;
        const closed = closedGroups.includes(book.id);
        return (
          <View key={book.id} style={styles.group}>
            <BookGroup
              book={book}
              count={notes.length + " 条笔记"}
              closed={closed}
              onPress={() =>
                setClosedGroups((value) =>
                  closed
                    ? value.filter((id) => id !== book.id)
                    : [...value, book.id],
                )
              }
            />
            {!closed
              ? notes.map((note) => {
                  const open = expanded === note.id;
                  return (
                    <View key={note.id} style={styles.note}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={"展开笔记：" + note.quote}
                        accessibilityState={{ expanded: open }}
                        onPress={() => setExpanded(open ? null : note.id)}
                        style={({ pressed }) => pressed && styles.pressed}
                      >
                        <View style={styles.noteBody}>
                          <View
                            style={[
                              styles.quoteRule,
                              "personal" in note && note.personal
                                ? styles.thoughtRule
                                : null,
                            ]}
                          />
                          <Text style={styles.quote}>{note.quote}</Text>
                        </View>
                        <View style={styles.noteMeta}>
                          <Text style={styles.meta}>
                            {"personal" in note && note.personal
                              ? "阅读随记"
                              : note.location}
                          </Text>
                          <Text style={styles.meta}>{note.date}</Text>
                        </View>
                        {!open ? (
                          <Text style={styles.thoughtPreview} numberOfLines={1}>
                            {note.thought}
                          </Text>
                        ) : null}
                      </Pressable>
                      {open ? (
                        <View style={styles.expandedNote}>
                          <Text style={styles.thoughtLabel}>我的想法</Text>
                          <Text style={styles.thought}>{note.thought}</Text>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => onOpenBook(book.title)}
                            style={styles.sourceAction}
                          >
                            <Text style={styles.sourceText}>回到原文</Text>
                            <SymbolView
                              name="arrow.up.right"
                              size={12}
                              tintColor={c.accent}
                            />
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                  );
                })
              : null}
          </View>
        );
      })}
      {matches.length === 0 ? (
        <Text style={styles.empty}>没有找到这条笔记，换个词试试。</Text>
      ) : null}
    </CollectionFrame>
  );
}

export function DemoConversations({
  onOpenChat,
}: {
  readonly onOpenChat: () => void;
}) {
  const [query, setQuery] = useState("");
  const [closedGroups, setClosedGroups] = useState<readonly string[]>([]);
  const matches = CONVERSATIONS.filter((chat) => {
    const book = BOOKS.find((book) => book.id === chat.bookId)!;
    return (chat.title + chat.preview + book.title).includes(query.trim());
  });
  return (
    <CollectionFrame
      title="对话"
      query={query}
      onChangeQuery={setQuery}
      placeholder="搜索对话或书名"
    >
      <View style={styles.summary}>
        <Text style={styles.summaryCount}>{matches.length} 段对话</Text>
      </View>
      {BOOKS.map((book) => {
        const chats = matches.filter((chat) => chat.bookId === book.id);
        if (chats.length === 0) return null;
        const closed = closedGroups.includes(book.id);
        return (
          <View key={book.id} style={styles.group}>
            <BookGroup
              book={book}
              count={chats.length + " 段对话"}
              closed={closed}
              onPress={() =>
                setClosedGroups((value) =>
                  closed
                    ? value.filter((id) => id !== book.id)
                    : [...value, book.id],
                )
              }
            />
            {!closed
              ? chats.map((chat) => (
                  <Pressable
                    accessibilityRole="button"
                    key={chat.id}
                    accessibilityLabel={chat.title}
                    onPress={onOpenChat}
                    style={({ pressed }) => [
                      styles.chat,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.chatTitleRow}>
                      <Text style={styles.chatTitle}>{chat.title}</Text>
                      <SymbolView
                        name="chevron.right"
                        size={11}
                        tintColor={c.muted}
                      />
                    </View>
                    <Text style={styles.chatPreview} numberOfLines={2}>
                      {chat.preview}
                    </Text>
                    <View style={styles.chatMeta}>
                      <Text style={styles.meta}>{chat.date}</Text>
                      <Text style={styles.meta}>{chat.count} 条消息</Text>
                    </View>
                  </Pressable>
                ))
              : null}
          </View>
        );
      })}
      {matches.length === 0 ? (
        <Text style={styles.empty}>没有找到这段对话，换个词试试。</Text>
      ) : null}
    </CollectionFrame>
  );
}

function CollectionFrame({
  title,
  query,
  onChangeQuery,
  placeholder,
  children,
}: {
  readonly title: string;
  readonly query: string;
  readonly onChangeQuery: (query: string) => void;
  readonly placeholder: string;
  readonly children: ReactNode;
}) {
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
      </View>
      <View style={styles.search}>
        <SymbolView name="magnifyingglass" size={17} tintColor={c.muted} />
        <TextInput
          accessibilityLabel={placeholder}
          placeholder={placeholder}
          placeholderTextColor={c.muted}
          value={query}
          onChangeText={onChangeQuery}
          style={styles.searchInput}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
      </View>
      {children}
    </ScrollView>
  );
}

function BookGroup({
  book,
  count,
  closed,
  onPress,
}: {
  readonly book: Book;
  readonly count: string;
  readonly closed: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={book.title + "，" + count}
      accessibilityState={{ expanded: !closed }}
      onPress={onPress}
      style={({ pressed }) => [styles.groupHeader, pressed && styles.pressed]}
    >
      <View style={[styles.swatch, { backgroundColor: book.cover }]}>
        <View style={styles.swatchSpine} />
        <Text style={[styles.swatchText, { color: book.coverInk }]}>
          {book.title.slice(0, 2)}
        </Text>
      </View>
      <View style={styles.groupIdentity}>
        <Text style={styles.groupTitle}>{book.title}</Text>
        <Text style={styles.groupCount}>{count}</Text>
      </View>
      <SymbolView
        name={closed ? "chevron.right" : "chevron.down"}
        size={11}
        weight="medium"
        tintColor={c.muted}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.paper },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 32 },
  heading: { marginBottom: 23 },
  title: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: "700",
    letterSpacing: -0.8,
    color: c.ink,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: c.tint,
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 46,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    minHeight: 46,
    color: c.ink,
    paddingVertical: 10,
  },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 30,
    marginBottom: 4,
  },
  summaryCount: { fontSize: 12, color: c.muted },
  group: { marginBottom: 17 },
  groupHeader: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
  },
  swatch: {
    width: 27,
    height: 38,
    borderRadius: 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  swatchSpine: {
    position: "absolute",
    left: 2,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: "#00000018",
  },
  swatchText: {
    fontFamily: "Songti SC",
    fontSize: 8,
    lineHeight: 12,
    fontWeight: "600",
  },
  groupIdentity: { flex: 1 },
  groupTitle: { fontSize: 15, lineHeight: 21, fontWeight: "600", color: c.ink },
  groupCount: { fontSize: 11, lineHeight: 17, color: c.muted, marginTop: 2 },
  note: {
    paddingTop: 14,
    paddingBottom: 17,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
  },
  noteBody: { flexDirection: "row", gap: 13 },
  quoteRule: {
    width: 2,
    borderRadius: 1,
    backgroundColor: c.gold,
    marginVertical: 3,
  },
  thoughtRule: { backgroundColor: c.accent },
  quote: {
    flex: 1,
    fontFamily: "Songti SC",
    fontSize: 18,
    lineHeight: 29,
    color: c.ink,
  },
  noteMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingLeft: 15,
    marginTop: 11,
  },
  meta: { fontSize: 11, lineHeight: 17, color: c.muted },
  thoughtPreview: {
    fontSize: 13,
    lineHeight: 21,
    color: c.secondary,
    paddingLeft: 15,
    marginTop: 8,
  },
  expandedNote: {
    marginLeft: 15,
    marginTop: 15,
    paddingLeft: 13,
    borderLeftWidth: 1,
    borderLeftColor: c.line,
  },
  thoughtLabel: {
    fontSize: 11,
    lineHeight: 17,
    color: c.accent,
    fontWeight: "500",
    marginBottom: 6,
  },
  thought: { fontSize: 14, lineHeight: 23, color: c.secondary },
  sourceAction: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    marginTop: 2,
  },
  sourceText: {
    fontSize: 12,
    lineHeight: 18,
    color: c.accent,
    fontWeight: "500",
  },
  chat: {
    paddingVertical: 17,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
  },
  chatTitleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  chatTitle: {
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
    color: c.ink,
  },
  chatPreview: {
    fontSize: 13,
    lineHeight: 22,
    color: c.secondary,
    marginTop: 7,
    paddingRight: 20,
  },
  chatMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 11,
  },
  pressed: { opacity: 0.65 },
  empty: {
    color: c.muted,
    fontSize: 14,
    lineHeight: 22,
    paddingVertical: 40,
    textAlign: "center",
  },
});
