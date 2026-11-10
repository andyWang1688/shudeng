import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useFocusEffect } from "expo-router";
import {
  deleteBookConversation,
  renameBookConversation,
  loadConversationSummaries,
  loadShelfBooks,
  loadAppPreference,
  saveAppPreference,
  type ShelfBookRecord,
} from "../../platform/library";
import {
  discardConversationRun,
  getConversationRuntimeSnapshots,
  subscribeConversationRuntime,
} from "../chat/conversationRuntime";
import {
  initialCollapsed,
  mergeRuntimeConversations,
  type ConversationItem,
} from "./model";

type Dialog = { readonly id: number } & (
  | { readonly kind: "rename" | "delete"; readonly item: ConversationItem }
  | { readonly kind: "notice"; readonly message: string }
);

// Keep accepted snapshots ordered even when a screen unmounts before its write finishes.
let groupPreferenceWrite: Promise<void> = Promise.resolve();

export function useConversationList() {
  const [items, setItems] = useState<readonly ConversationItem[]>([]);
  const [books, setBooks] = useState<readonly ShelfBookRecord[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const mounted = useRef(true);
  const focused = useRef(false);
  const request = useRef(0);
  const sequence = useRef(0);
  const dialogId = useRef<number | null>(null);
  const mutation = useRef(false);
  const initializedGroups = useRef(false);
  const groupSnapshot = useRef<Record<string, boolean>>({});
  const groupVersion = useRef(0);
  const runtime = useSyncExternalStore(
    subscribeConversationRuntime,
    getConversationRuntimeSnapshots,
    getConversationRuntimeSnapshots,
  );
  const previousRuntime = useRef(runtime);
  const visibleItems = useMemo(
    () => mergeRuntimeConversations(items, runtime),
    [items, runtime],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++request.current;
      dialogId.current = null;
    };
  }, []);
  const notice = useCallback((message: string) => {
    if (!mounted.current || !focused.current) return;
    const id = ++sequence.current;
    dialogId.current = id;
    setDialog({ id, kind: "notice", message });
  }, []);
  const updateGroups = useCallback(
    (groups: Record<string, boolean>, persist = false) => {
      groupSnapshot.current = groups;
      setCollapsed(groups);
      if (!persist) return;
      const version = ++groupVersion.current;
      const write = groupPreferenceWrite.then(() =>
        saveAppPreference("conversations.collapsed", groups),
      );
      groupPreferenceWrite = write.catch(() => {});
      void write.catch(() => {
        if (
          mounted.current &&
          focused.current &&
          version === groupVersion.current &&
          dialogId.current === null &&
          !mutation.current
        )
          notice("分组状态尚未保存，请重试展开或收起。");
      });
    },
    [notice],
  );
  const reload = useCallback(
    async (showLoading = true) => {
      if (!mounted.current || !focused.current) return;
      const id = ++request.current;
      if (showLoading) setLoading(true);
      try {
        const [next, shelf, saved] = await Promise.all([
          loadConversationSummaries(),
          loadShelfBooks({ includeRemoved: true }),
          loadAppPreference("conversations.collapsed"),
        ]);
        if (!mounted.current || !focused.current || id !== request.current)
          return;
        const all = mergeRuntimeConversations(
          next,
          getConversationRuntimeSnapshots(),
        );
        const defaultGroups =
          !initializedGroups.current &&
          (saved === null || saved === undefined) &&
          all.length > 0;
        const groups = initialCollapsed(
          all,
          initializedGroups.current ? groupSnapshot.current : saved,
        );
        initializedGroups.current =
          all.length > 0 ||
          (saved !== null &&
            typeof saved === "object" &&
            !Array.isArray(saved));
        setItems(next);
        setBooks(shelf);
        updateGroups(groups, defaultGroups);
        setLoadError(false);
      } catch {
        if (mounted.current && focused.current && id === request.current)
          setLoadError(true);
      } finally {
        if (mounted.current && focused.current && id === request.current)
          setLoading(false);
      }
    },
    [updateGroups],
  );
  useEffect(() => {
    const before = previousRuntime.current;
    previousRuntime.current = runtime;
    if (
      before.some(
        (record) =>
          !runtime.some(
            (next) => next.conversationId === record.conversationId,
          ),
      )
    )
      void reload(false);
  }, [runtime, reload]);
  useEffect(() => {
    if (loading || initializedGroups.current || visibleItems.length === 0)
      return;
    initializedGroups.current = true;
    const groups = initialCollapsed(visibleItems, null);
    updateGroups(groups, true);
  }, [loading, visibleItems, updateGroups]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void reload();
      return () => {
        focused.current = false;
        ++request.current;
        dialogId.current = null;
        setDialog(null);
      };
    }, [reload]),
  );

  const toggleGroup = (bookId: string) => {
    if (!mounted.current || !focused.current) return;
    const previous = groupSnapshot.current;
    const next = { ...previous, [bookId]: !(previous[bookId] ?? true) };
    initializedGroups.current = true;
    updateGroups(next, true);
  };
  const setGroupExpanded = (bookId: string, expanded: boolean) => {
    if (!mounted.current || !focused.current) return;
    const previous = groupSnapshot.current;
    if ((previous[bookId] ?? true) === !expanded) return;
    initializedGroups.current = true;
    updateGroups({ ...previous, [bookId]: !expanded }, true);
  };
  const openDialog = (kind: "rename" | "delete", item: ConversationItem) => {
    if (!mounted.current || !focused.current || mutation.current || dialogId.current !== null) return;
    const id = ++sequence.current;
    dialogId.current = id;
    setDialog({ id, kind, item });
  };
  const dismiss = (id: number) => {
    if (dialogId.current !== id) return;
    dialogId.current = null;
    if (mounted.current) setDialog(null);
  };
  const confirm = async (
    id: number,
    item: ConversationItem,
    title?: string,
  ) => {
    if (!mounted.current || dialogId.current !== id || mutation.current) return;
    mutation.current = true;
    ++request.current;
    setLoading(false);
    dismiss(id);
    try {
      const current = getConversationRuntimeSnapshots().find(
        (record) => record.conversationId === item.conversationId,
      );
      if (title !== undefined && (current?.running || current?.turn.saveError))
        throw new Error("conversation has unsaved work");
      if (title === undefined)
        await deleteBookConversation(item.conversationId);
      else await renameBookConversation(item.conversationId, title);
      if (!mounted.current) return;
      if (title === undefined) {
        ++request.current;
        setLoading(false);
        setItems((current) =>
          current.filter(
            (entry) => entry.conversationId !== item.conversationId,
          ),
        );
        discardConversationRun(item.conversationId);
      } else await reload(false);
    } catch {
      notice(
        title === undefined
          ? "删除失败，对话仍保留；生成已取消，请重试删除。"
          : "改名尚未保存，原名称未变；请检查名称、生成及保存状态后重试。",
      );
    } finally {
      mutation.current = false;
    }
  };
  return {
    items: visibleItems,
    books,
    collapsed,
    loading,
    loadError,
    reload,
    toggleGroup,
    setGroupExpanded,
    dialog,
    openDialog,
    dismiss,
    confirm,
  };
}
