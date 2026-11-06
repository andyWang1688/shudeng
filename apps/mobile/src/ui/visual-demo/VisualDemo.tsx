import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  BookOpen,
  Bookmark,
  ChevronLeft,
  MessageCircle,
  UserRound,
} from "lucide-react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { DemoAssistant } from "./DemoAssistant";
import { DemoShelf } from "./DemoShelf";
import { DemoNotes, DemoConversations } from "./DemoCollections";
import { DemoProfile } from "./DemoProfile";
import { demoColors as c } from "./demoTheme";

type DemoTab = "shelf" | "notes" | "chat" | "profile";

export function VisualDemo() {
  const initialPage = process.env.EXPO_PUBLIC_UI_DEMO_PAGE;
  const [tab, setTab] = useState<DemoTab>(
    initialPage === "notes"
      ? "notes"
      : initialPage === "conversations"
        ? "chat"
        : initialPage === "profile"
          ? "profile"
          : "shelf",
  );
  const [book, setBook] = useState<string | null>(
    initialPage === "reader" || initialPage === "assistant" ? "瓦尔登湖" : null,
  );
  const [assistant, setAssistant] = useState(initialPage === "assistant");

  const openBook = (title?: string) => setBook(title ?? "瓦尔登湖");
  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        {book ? (
          <DemoReader
            title={book}
            onBack={() => setBook(null)}
            onAsk={() => setAssistant(true)}
          />
        ) : (
          <>
            <View style={styles.page}>
              {tab === "shelf" ? (
                <DemoShelf onOpenBook={openBook} />
              ) : tab === "notes" ? (
                <DemoNotes onOpenBook={openBook} />
              ) : tab === "chat" ? (
                <DemoConversations onOpenChat={() => setAssistant(true)} />
              ) : (
                <DemoProfile />
              )}
            </View>
            <DemoTabs active={tab} onChange={setTab} />
          </>
        )}
      </SafeAreaView>
      {assistant ? <DemoAssistant onClose={() => setAssistant(false)} /> : null}
    </View>
  );
}

function DemoReader({
  title,
  onBack,
  onAsk,
}: {
  title: string;
  onBack: () => void;
  onAsk: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [saved, setSaved] = useState(false);
  const author =
    title === "额尔古纳河右岸"
      ? "迟子建"
      : title === "月亮与六便士"
        ? "威廉·萨默塞特·毛姆"
        : title === "悉达多"
          ? "赫尔曼·黑塞"
          : "亨利·戴维·梭罗";
  return (
    <View style={styles.reader}>
      <View style={styles.readerHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回书架"
          onPress={onBack}
          style={styles.headerButton}
        >
          <ChevronLeft size={23} color={c.ink} />
        </Pressable>
        <Text style={styles.readerLabel}>{title}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={saved ? "取消书签" : "添加书签"}
          onPress={() => setSaved(!saved)}
          style={styles.headerButton}
        >
          <Bookmark
            size={20}
            color={saved ? c.accent : c.ink}
            fill={saved ? c.accent : "none"}
          />
        </Pressable>
      </View>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        contentContainerStyle={styles.readerContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.readerMeta}>
          <Text style={styles.readerKicker}>第 1 章 · 经济篇</Text>
          <Text style={styles.readerProgress}>12% 已读</Text>
        </View>
        <Text style={styles.readerTitle}>{title}</Text>
        <Text style={styles.readerAuthor}>{author} · 书页排版示例</Text>
        <View style={styles.rule} />
        <Text style={styles.chapterTitle}>
          我到树林里去，是因为我希望有目的地生活
        </Text>
        <Text style={styles.body}>
          我到树林里去，是因为我希望有目的地生活，只面对生活中最基本的事实，看看我是否能学到生活所要教给我的东西。
        </Text>
        <Text style={styles.body}>
          我不愿意过一种不真实的生活，因为生活是如此宝贵；我也不愿意屈从于必然，除非万不得已。
        </Text>
        <View style={styles.highlight}>
          <View style={styles.highlightMark} />
          <Text style={styles.highlightText}>
            我想深入地生活，吸取生活的精髓。
          </Text>
        </View>
        <Text style={styles.body}>
          当我们学会简化生活，时间才会重新回到自己手中。阅读、观察和独处，都需要一点没有被安排的空白。
        </Text>
      </ScrollView>
      <View
        style={{
          paddingHorizontal: 24,
          paddingTop: 12,
          paddingBottom: Math.max(insets.bottom, 16),
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: c.line,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text style={styles.readerLabel}>第 1 章 · 12%</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="问问这本书"
          onPress={onAsk}
          style={({ pressed }) => [
            styles.askButton,
            pressed && { opacity: 0.7 },
          ]}
        >
          <MessageCircle size={18} color={c.surface} />
          <Text style={styles.askButtonText}>问问这本书</Text>
        </Pressable>
      </View>
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
    { id: "notes", label: "笔记", icon: Bookmark },
    { id: "chat", label: "对话", icon: MessageCircle },
    { id: "profile", label: "我的", icon: UserRound },
  ];
  return (
    <View style={[styles.tabs, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {tabs.map((item) => {
        const Icon = item.icon;
        const selected = item.id === active;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={item.label}
            onPress={() => onChange(item.id)}
            style={styles.tab}
          >
            <Icon
              size={21}
              color={selected ? c.accent : c.muted}
              strokeWidth={selected ? 2.3 : 1.8}
            />
            <Text style={[styles.tabLabel, selected && styles.tabLabelActive]}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.paper },
  safe: { flex: 1 },
  page: { flex: 1 },
  tabs: {
    minHeight: 61,
    borderTopWidth: 1,
    borderTopColor: c.line,
    backgroundColor: c.paper,
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: 8,
  },
  tab: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 60,
    minHeight: 44,
    gap: 2,
  },
  tabLabel: { color: c.muted, fontSize: 11, lineHeight: 15 },
  tabLabelActive: { color: c.accent, fontWeight: "600" },
  reader: { flex: 1, backgroundColor: c.paper },
  readerHeader: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  readerLabel: { color: c.muted, fontSize: 12, lineHeight: 18 },
  readerContent: { paddingHorizontal: 27, paddingTop: 25, paddingBottom: 48 },
  readerMeta: { flexDirection: "row", justifyContent: "space-between" },
  readerKicker: {
    color: c.accent,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },
  readerProgress: { color: c.muted, fontSize: 11, lineHeight: 18 },
  readerTitle: {
    color: c.ink,
    fontFamily: "Songti SC",
    fontSize: 29,
    lineHeight: 38,
    marginTop: 22,
  },
  readerAuthor: {
    color: c.secondary,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 7,
  },
  rule: { height: 1, backgroundColor: c.line, marginVertical: 25 },
  chapterTitle: {
    color: c.ink,
    fontFamily: "Songti SC",
    fontSize: 21,
    lineHeight: 31,
    marginBottom: 19,
  },
  body: {
    color: c.ink,
    fontFamily: "Songti SC",
    fontSize: 17,
    lineHeight: 31,
    marginBottom: 20,
  },
  highlight: { flexDirection: "row", marginVertical: 5, marginBottom: 23 },
  highlightMark: {
    width: 3,
    borderRadius: 2,
    backgroundColor: c.gold,
    marginRight: 13,
  },
  highlightText: {
    flex: 1,
    color: c.ink,
    fontFamily: "Songti SC",
    fontSize: 19,
    lineHeight: 31,
  },
  askButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: c.accent,
    borderRadius: 20,
    paddingHorizontal: 17,
    minHeight: 44,
    marginTop: 11,
  },
  askButtonText: { color: c.surface, fontSize: 14, fontWeight: "600" },
});
