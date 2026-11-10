import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BookOpen, MessageCircle, UserRound } from "lucide-react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { DemoReader } from "./DemoReader";
import {
  defaultReadingPreferences,
  defaultReadingState,
  initialReadingState,
  readerSamples,
  type DemoReadingPreferences,
  type DemoReadingState,
} from "./readerSamples";
import { DemoAssistant } from "./DemoAssistant";
import { DemoShelf } from "./DemoShelf";
import { DemoNotes } from "./DemoCollections";
import { DemoConversations } from "./DemoConversationList";
import { DemoProfile } from "./DemoProfile";
import { demoBooks, findDemoBook, type DemoBook } from "./demoBooks";
import { demoNotes, type DemoNote } from "./collectionFixtures";
import { demoColors as c } from "./demoTheme";

type DemoTab = "shelf" | "notes" | "chat" | "profile";
export function VisualDemo() {
  const initial = process.env.EXPO_PUBLIC_UI_DEMO_PAGE;
  const [tab, setTab] = useState<DemoTab>(
    initial === "notes"
      ? "notes"
      : initial === "conversations"
        ? "chat"
        : initial === "profile"
          ? "profile"
          : "shelf",
  );
  const [book, setBook] = useState<DemoBook | null>(
    initial === "reader" || initial === "assistant" ? findDemoBook() : null,
  );
  const [reading, setReading] = useState<Record<string, DemoReadingState>>(() =>
    Object.fromEntries(
      demoBooks.map((item) => [item.id, initialReadingState(item)]),
    ),
  );
  const [readingPreferences, setReadingPreferences] =
    useState<DemoReadingPreferences>(defaultReadingPreferences);
  const [assistant, setAssistant] = useState(initial === "assistant");
  const [conversation, setConversation] = useState<{
    book: DemoBook;
    question: string;
    selection: string | undefined;
  }>({
    book: findDemoBook(),
    question: findDemoBook().question,
    selection: undefined,
  });
  const openBook = (title: string, position?: number) => {
    const selected = findDemoBook(title);
    if (position !== undefined)
      setReading((old) => ({
        ...old,
        [selected.id]: {
          ...(old[selected.id] ?? defaultReadingState),
          position,
        },
      }));
    setBook(selected);
  };
  const notes: DemoNote[] = [
    ...demoBooks.flatMap((item) =>
      (reading[item.id]?.annotations ?? []).map((annotation) => ({
        id: annotation.id,
        bookId: item.id,
        quote: annotation.quote,
        thought: annotation.body,
        date: "今天",
        location:
          (annotation.pdf
            ? "第 " + annotation.pdf.page + " 页"
            : readerSamples(item)[annotation.ranges[0]?.position ?? 0]
                ?.chapter) ?? item.chapter,
        position: annotation.ranges[0]?.position ?? 0,
        personal: annotation.kind === "note",
      })),
    ),
    ...demoNotes,
  ];
  const ask = (selected: DemoBook, question?: string, selection?: string) => {
    setConversation({
      book: selected,
      question: question ?? selected.question,
      selection,
    });
    setAssistant(true);
  };
  return (
    <View style={s.root}>
      <SafeAreaView style={[s.safe, book && s.hidden]} edges={["top"]}>
        <View style={s.page}>
          <View style={[s.page, tab !== "shelf" && s.hidden]}>
            <DemoShelf onOpenBook={openBook} />
          </View>
          <View style={[s.page, tab !== "notes" && s.hidden]}>
            <DemoNotes onOpenBook={openBook} items={notes} />
          </View>
          <View style={[s.page, tab !== "chat" && s.hidden]}>
            <DemoConversations
              onOpenChat={ask}
              active={tab === "chat" && !book}
            />
          </View>
          <View style={[s.page, tab !== "profile" && s.hidden]}>
            <DemoProfile />
          </View>
        </View>
        <DemoTabs active={tab} onChange={setTab} />
      </SafeAreaView>
      {book && (
        <DemoReader
          key={book.id}
          book={book}
          reading={reading[book.id] ?? defaultReadingState}
          preferences={readingPreferences}
          onReadingChange={(state) =>
            setReading((old) => ({ ...old, [book.id]: state }))
          }
          onPreferencesChange={setReadingPreferences}
          onBack={() => setBook(null)}
          onAsk={(selection) => ask(book, undefined, selection)}
        />
      )}
      <DemoAssistant
        key={conversation.book.id + (conversation.question ?? "")}
        book={conversation.book}
        initialQuestion={conversation.question}
        initialSelection={conversation.selection}
        open={assistant}
        onClose={() => setAssistant(false)}
      />
    </View>
  );
}
function DemoTabs({
  active,
  onChange,
}: {
  active: DemoTab;
  onChange: (tab: DemoTab) => void;
}) {
  const insets = useSafeAreaInsets();
  const tabs: { id: DemoTab; label: string; icon: typeof BookOpen }[] = [
    { id: "shelf", label: "书架", icon: BookOpen },
    { id: "chat", label: "对话", icon: MessageCircle },
    { id: "profile", label: "我的", icon: UserRound },
  ];
  return (
    <View style={[s.tabs, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {tabs.map(({ id, label, icon: Icon }) => (
        <Pressable
          key={id}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ selected: active === id }}
          onPress={() => onChange(id)}
          style={({ pressed }) => [s.tab, pressed && s.pressed]}
        >
          <Icon
            size={23}
            color={active === id ? c.accent : c.muted}
            strokeWidth={active === id ? 2 : 1.5}
          />
          <Text style={[s.tabLabel, active === id && s.selected]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.paper },
  safe: { flex: 1 },
  page: { flex: 1 },
  hidden: { display: "none" },
  pressed: { opacity: 0.6 },
  tabs: {
    minHeight: 63,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.line,
    backgroundColor: c.paper,
    flexDirection: "row",
    paddingTop: 9,
  },
  tab: {
    flex: 1,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  tabLabel: { fontSize: 11, lineHeight: 16, color: c.muted },
  selected: { color: c.accent, fontWeight: "600" },
});
