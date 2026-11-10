import { useState, type ReactNode } from "react";
import { Alert, Keyboard, View, useWindowDimensions } from "react-native";
import {
  Button,
  DisclosureGroup,
  Group,
  Host,
  HStack,
  Image,
  List,
  Rectangle,
  RoundedRectangle,
  Spacer,
  SwipeActions,
  Text,
  VStack,
  ZStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  background,
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  listRowSeparatorTint,
  listStyle,
  padding,
  scrollContentBackground,
  scrollDismissesKeyboard,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { DemoEmpty, DemoHeading, DemoSearch } from "./DemoChrome";
import { demoConversations } from "./collectionFixtures";
import { demoBooks, type DemoBook } from "./demoBooks";
import { demoColors as c } from "./demoTheme";

type Chat = (typeof demoConversations)[number] & { question: string };

/** iOS owns scrolling, disclosure, row hit testing and swipe transitions together. */
export function DemoConversations({
  onOpenChat,
  active = true,
}: {
  onOpenChat: (book: DemoBook, question: string, selection?: string) => void;
  active?: boolean;
}) {
  const [chats, setChats] = useState<Chat[]>(() =>
    demoConversations.map((chat) => ({ ...chat, question: chat.title })),
  );
  const [query, setQuery] = useState("");
  const [expandedBook, setExpandedBook] = useState<string | null>(
    demoConversations[0]?.bookId ?? null,
  );
  const [allBooks, setAllBooks] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const { height, fontScale } = useWindowDimensions();
  const previewLimit = height < 740 || fontScale > 1.2 ? 2 : 3;
  const needle = query.trim().toLocaleLowerCase();
  const groups = demoBooks.flatMap((book) => {
    const rows = chats.filter(
      (chat) =>
        chat.bookId === book.id &&
        (book.title + chat.title + (chat.selection ?? ""))
          .toLocaleLowerCase()
          .includes(needle),
    );
    return rows.length ? [{ book, rows }] : [];
  });
  const rename = (chat: Chat) => {
    if (!active) return;
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
  const remove = (chat: Chat) => {
    if (!active) return;
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
  return (
    <View style={{ flex: 1 }}>
      <DemoHeading title="对话" />
      <DemoSearch
        value={query}
        onChange={setQuery}
        placeholder="搜索问题或书名"
      />
      {!groups.length ? (
        <DemoEmpty query={query} />
      ) : (
        <Host
          style={{ flex: 1 }}
          colorScheme="light"
          seedColor={c.accent}
          ignoreSafeArea="container"
          pointerEvents={active ? "auto" : "none"}
        >
          <List
            modifiers={[
              listStyle("plain"),
              scrollContentBackground("hidden"),
              background(c.paper),
              scrollDismissesKeyboard("interactively"),
              disabled(!active),
            ]}
          >
            <List.ForEach
              data={groups}
              keyExtractor={({ book }) => book.id}
              recycling={false}
            >
              {({ item: { book, rows } }) => {
                const all = !!needle || allBooks.has(book.id);
                const rowModifiers = [
                  listRowBackground(c.paper),
                  listRowInsets({
                    // DisclosureGroup already indents its children; search rows are flat.
                    leading: needle ? 64 : 44,
                    trailing: 24,
                    top: 0,
                    bottom: 0,
                  }),
                  listRowSeparatorTint(c.line),
                ];
                return (
                  <BookGroup
                    book={book}
                    count={rows.length}
                    searching={!!needle}
                    expanded={expandedBook === book.id}
                    onExpandedChange={(expanded) => {
                      if (!active) return;
                      Keyboard.dismiss();
                      setExpandedBook((old) =>
                        expanded ? book.id : old === book.id ? null : old,
                      );
                    }}
                  >
                    <List.ForEach
                      data={all ? rows : rows.slice(0, previewLimit)}
                      keyExtractor={(chat) => chat.id}
                      recycling={false}
                    >
                      {({ item: chat }) => (
                        <SwipeActions modifiers={rowModifiers}>
                          <Button
                            onPress={() => {
                              if (!active) return;
                              Keyboard.dismiss();
                              onOpenChat(book, chat.question, chat.selection);
                            }}
                            modifiers={[
                              buttonStyle("plain"),
                              accessibilityLabel("打开对话：" + chat.title),
                            ]}
                          >
                            <HStack
                              spacing={12}
                              modifiers={[
                                padding({ vertical: 16 }),
                                frame({ minHeight: 62 }),
                              ]}
                            >
                              <Text
                                modifiers={[
                                  font({ textStyle: "body" }),
                                  foregroundStyle(c.ink),
                                  lineLimit(2),
                                  frame({
                                    maxWidth: Infinity,
                                    alignment: "leading",
                                  }),
                                ]}
                              >
                                {chat.title}
                              </Text>
                              <Image
                                systemName="chevron.right"
                                size={12}
                                color={c.muted}
                              />
                            </HStack>
                          </Button>
                          <SwipeActions.Actions allowsFullSwipe={false}>
                            <Button
                              label="删除"
                              systemImage="trash"
                              onPress={() => remove(chat)}
                              modifiers={[
                                tint("#A63A2B"),
                                accessibilityLabel("删除：" + chat.title),
                              ]}
                            />
                            <Button
                              label="重命名"
                              systemImage="pencil"
                              onPress={() => rename(chat)}
                              modifiers={[
                                tint(c.secondary),
                                accessibilityLabel("重新命名：" + chat.title),
                              ]}
                            />
                          </SwipeActions.Actions>
                        </SwipeActions>
                      )}
                    </List.ForEach>
                    {!needle && rows.length > previewLimit && (
                      <Button
                        label={
                          all ? "收起" : "查看全部 " + rows.length + " 条对话"
                        }
                        systemImage={all ? "chevron.up" : "chevron.down"}
                        onPress={() => {
                          if (!active) return;
                          Keyboard.dismiss();
                          setAllBooks((old) => {
                            const next = new Set(old);
                            if (next.has(book.id)) next.delete(book.id);
                            else next.add(book.id);
                            return next;
                          });
                        }}
                        modifiers={[
                          ...rowModifiers,
                          foregroundStyle(c.accent),
                          font({ textStyle: "subheadline" }),
                          padding({ vertical: 12 }),
                        ]}
                      />
                    )}
                  </BookGroup>
                );
              }}
            </List.ForEach>
          </List>
        </Host>
      )}
    </View>
  );
}

function BookGroup({
  book,
  count,
  searching,
  expanded,
  onExpandedChange,
  children,
}: {
  book: DemoBook;
  count: number;
  searching: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  children: ReactNode;
}) {
  const modifiers = [
    tint(c.secondary),
    listRowBackground(c.paper),
    listRowSeparator("hidden"),
    listRowInsets({ leading: 24, trailing: 24, top: 14, bottom: 14 }),
  ];
  const label = (
    <HStack spacing={12}>
      <ZStack modifiers={[frame({ width: 28, height: 38 })]}>
        <RoundedRectangle
          cornerRadius={2}
          modifiers={[foregroundStyle(book.color)]}
        />
        <Rectangle
          modifiers={[
            frame({ width: 18, height: 1 }),
            foregroundStyle(book.ink),
          ]}
        />
      </ZStack>
      <VStack alignment="leading" spacing={5}>
        <Text
          modifiers={[
            font({ size: 23, weight: "bold", textStyle: "title2" }),
            foregroundStyle(c.ink),
          ]}
        >
          {book.title}
        </Text>
        <Text
          modifiers={[font({ textStyle: "caption" }), foregroundStyle(c.muted)]}
        >
          {count} 条对话
        </Text>
      </VStack>
      <Spacer minLength={0} />
    </HStack>
  );
  // A search result is always exposed; there is no disclosure control to hide matches.
  if (searching)
    return (
      <Group>
        <VStack modifiers={modifiers}>{label}</VStack>
        {children}
      </Group>
    );
  return (
    <DisclosureGroup
      isExpanded={expanded}
      onIsExpandedChange={onExpandedChange}
      modifiers={modifiers}
    >
      <DisclosureGroup.Label>{label}</DisclosureGroup.Label>
      {children}
    </DisclosureGroup>
  );
}
