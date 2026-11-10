import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Keyboard, StyleSheet, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { BookNotice } from "../components/BookNotice";
import { EmptyState } from "../components/EmptyState";
import { PageHeading, PageSearch } from "../components/PageChrome";
import { usePalette } from "../theme";
import { ConversationRenamePrompt } from "./ConversationRenamePrompt";
import { ConversationsList } from "./ConversationsList.ios";
import { conversationSections, conversationTitle, type ConversationItem } from "./model";
import { useConversationList } from "./useConversationList";

/** iOS presentation uses the same persisted history, runtime snapshots and mutation owner. */
export default function ConversationsScreen() {
  const router = useRouter();
  const p = usePalette();
  const state = useConversationList();
  const mounted = useRef(false);
  const focused = useRef(false);
  const focusLease = useRef(0);
  const [active, setActive] = useState(true);
  const [query, setQuery] = useState("");
  const currentQuery = useRef("");
  const [allBooks, setAllBooks] = useState<ReadonlySet<string>>(() => new Set());
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; focused.current = false; ++focusLease.current; };
  }, []);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    setActive(true);
    return () => { focused.current = false; ++focusLease.current; setActive(false); };
  }, []));
  useEffect(() => {
    let alive = true, changed = false;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      changed = true;
      if (alive) setReduceMotion(enabled);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (alive && !changed) setReduceMotion(enabled);
    }).catch(() => {});
    return () => { alive = false; subscription.remove(); };
  }, []);
  const lease = focusLease.current;
  const current = () => mounted.current && focused.current && lease === focusLease.current;
  const currentList = () => current() && currentQuery.current === query;
  const { height, fontScale } = useWindowDimensions();
  const previewLimit = height < 740 || fontScale > 1.2 ? 2 : 3;
  const searching = query.trim().length > 0;
  const sections = useMemo(() => state.loadError ? [] : conversationSections(state.items, state.books, query, state.collapsed), [state.items, state.books, query, state.collapsed, state.loadError]);
  const changeQuery = (value: string) => { if (current()) { currentQuery.current = value; setQuery(value); } };
  const toggleAll = (bookId: string) => {
    if (!currentList()) return;
    Keyboard.dismiss();
    setAllBooks((old) => { const next = new Set(old); if (next.has(bookId)) next.delete(bookId); else next.add(bookId); return next; });
  };
  const open = (item: ConversationItem) => {
    if (!currentList()) return;
    Keyboard.dismiss();
    router.push({ pathname: "/book-chat", params: {
      bookId: item.bookId, conversationId: item.conversationId,
      bookTitle: item.bookTitle ?? state.books.find((book) => book.id === item.bookId)?.title ?? "书内问答",
    } });
  };
  const openDialog = (kind: "rename" | "delete", item: ConversationItem) => {
    if (!currentList()) return;
    Keyboard.dismiss();
    state.openDialog(kind, item);
  };
  const dialog = state.dialog;
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: p.paper }]} edges={["top", "left", "right"]} testID="conversations-surface">
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeading title="对话" />
      <PageSearch value={query} onChange={changeQuery} placeholder="搜索问题或书名" testID="conversations-search" />
      {sections.length ? <ConversationsList key={query} sections={sections} searching={searching} previewLimit={previewLimit} allBooks={allBooks} active={active} reduceMotion={reduceMotion}
        onExpandedChange={(bookId, expanded) => { if (currentList() && !searching) { Keyboard.dismiss(); state.setGroupExpanded(bookId, expanded); } }}
        onToggleAll={toggleAll} onOpen={open} onRename={(item) => openDialog("rename", item)} onDelete={(item) => openDialog("delete", item)} />
        : state.loading ? <View style={styles.center}><ActivityIndicator accessibilityLabel="正在读取对话" color={p.lampInk} /></View>
        : state.loadError ? <View testID="conversations-load-failed"><EmptyState symbol="exclamationmark.triangle" title="对话读取失败" description="原记录未被覆盖。检查储存空间后重试。" actionLabel="重试" onAction={() => { if (current()) void state.reload(); }} /></View>
        : searching ? <View testID="conversations-search-empty"><EmptyState symbol="magnifyingglass" title="没有找到相关对话" description="换一个关键词，或清除搜索查看全部记录。" actionLabel="清除搜索" onAction={() => changeQuery("")} /></View>
        : <View testID="conversations-empty"><EmptyState symbol="bubble.left.and.bubble.right" title="还没有对话" description="阅读时选中原文提问，问题与回答会留在这里。" actionLabel="去书架读书" onAction={() => { if (current()) router.navigate("/(tabs)"); }} /></View>}
      {dialog?.kind === "rename" ? <ConversationRenamePrompt key={dialog.id} initialName={conversationTitle(dialog.item)}
        onCancel={() => { if (current()) state.dismiss(dialog.id); }} onSave={(title) => { if (current()) void state.confirm(dialog.id, dialog.item, title); }} /> : null}
      {dialog?.kind === "delete" ? <BookNotice key={dialog.id} title="删除对话？" message="删除本对话的所有轮次及引用快照；生成中的请求将取消。" actions={[
        { title: "取消", style: "cancel", onPress: () => { if (current()) state.dismiss(dialog.id); } },
        { title: "删除", style: "destructive", onPress: () => { if (current()) void state.confirm(dialog.id, dialog.item); } },
      ]} /> : null}
      {dialog?.kind === "notice" ? <BookNotice key={dialog.id} title="操作未保存" message={dialog.message} onAcknowledge={() => { if (current()) state.dismiss(dialog.id); }} /> : null}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({ screen: { flex: 1 }, center: { minHeight: 160, alignItems: "center", justifyContent: "center" } });
