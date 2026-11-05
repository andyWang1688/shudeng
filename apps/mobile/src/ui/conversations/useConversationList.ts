import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  deleteBookConversation, renameBookConversation, loadConversationSummaries,
  loadShelfBooks, loadAppPreference, saveAppPreference, type ShelfBookRecord,
} from '../../platform/library';
import { discardConversationRun, getConversationRuntimeSnapshots, subscribeConversationRuntime } from '../chat/conversationRuntime';
import { initialCollapsed, mergeRuntimeConversations, type ConversationItem } from './model';

type Dialog = { readonly id: number } & (
  | { readonly kind: 'rename' | 'delete'; readonly item: ConversationItem }
  | { readonly kind: 'notice'; readonly message: string }
);

export function useConversationList() {
  const [items, setItems] = useState<readonly ConversationItem[]>([]);
  const [books, setBooks] = useState<readonly ShelfBookRecord[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const mounted = useRef(true);
  const request = useRef(0);
  const sequence = useRef(0);
  const dialogId = useRef<number | null>(null);
  const mutation = useRef(false);
  const initializedGroups = useRef(false);
  const runtime = useSyncExternalStore(subscribeConversationRuntime, getConversationRuntimeSnapshots, getConversationRuntimeSnapshots);
  const previousRuntime = useRef(runtime);
  const visibleItems = useMemo(() => mergeRuntimeConversations(items, runtime), [items, runtime]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; ++request.current; dialogId.current = null; };
  }, []);
  const notice = useCallback((message: string) => {
    if (!mounted.current) return;
    const id = ++sequence.current; dialogId.current = id;
    setDialog({ id, kind: 'notice', message });
  }, []);
  const reload = useCallback(async (showLoading = true) => {
    const id = ++request.current;
    if (showLoading) setLoading(true);
    try {
      const [next, shelf, saved] = await Promise.all([
        loadConversationSummaries(), loadShelfBooks({ includeRemoved: true }), loadAppPreference('conversations.collapsed'),
      ]);
      if (!mounted.current || id !== request.current) return;
      const all = mergeRuntimeConversations(next, getConversationRuntimeSnapshots());
      const groups = initialCollapsed(all, saved);
      initializedGroups.current = all.length > 0 || (saved !== null && typeof saved === 'object' && !Array.isArray(saved));
      setItems(next); setBooks(shelf); setCollapsed(groups); setLoadError(false);
      if ((saved === null || saved === undefined) && next.length > 0) {
        void saveAppPreference('conversations.collapsed', groups).catch(() => {
          if (mounted.current && id === request.current && dialogId.current === null && !mutation.current) notice('分组状态尚未保存，请重试展开或收起。');
        });
      }
    } catch {
      if (mounted.current && id === request.current) setLoadError(true);
    } finally {
      if (mounted.current && id === request.current) setLoading(false);
    }
  }, [notice]);
  useEffect(() => {
    const before = previousRuntime.current;
    previousRuntime.current = runtime;
    if (before.some(record => !runtime.some(next => next.conversationId === record.conversationId))) void reload(false);
  }, [runtime, reload]);
  useEffect(() => {
    if (loading || initializedGroups.current || visibleItems.length === 0) return;
    initializedGroups.current = true;
    const groups = initialCollapsed(visibleItems, null);
    setCollapsed(groups);
    void saveAppPreference('conversations.collapsed', groups).catch(() => {
      if (dialogId.current === null && !mutation.current) notice('分组状态尚未保存，请重试展开或收起。');
    });
  }, [loading, visibleItems, notice]);
  useFocusEffect(useCallback(() => {
    void reload();
    return () => { ++request.current; };
  }, [reload]));

  const toggleGroup = (bookId: string) => {
    const next = { ...collapsed, [bookId]: !(collapsed[bookId] ?? true) };
    setCollapsed(next);
    void saveAppPreference('conversations.collapsed', next).catch(() => {
      if (dialogId.current === null && !mutation.current) notice('分组状态尚未保存，请重试展开或收起。');
    });
  };
  const openDialog = (kind: 'rename' | 'delete', item: ConversationItem) => {
    if (mutation.current || dialogId.current !== null) return;
    const id = ++sequence.current; dialogId.current = id;
    setDialog({ id, kind, item });
  };
  const dismiss = (id: number) => {
    if (dialogId.current !== id) return;
    dialogId.current = null;
    if (mounted.current) setDialog(null);
  };
  const confirm = async (id: number, item: ConversationItem, title?: string) => {
    if (!mounted.current || dialogId.current !== id || mutation.current) return;
    mutation.current = true;
    ++request.current;
    setLoading(false);
    dismiss(id);
    try {
      const current = getConversationRuntimeSnapshots().find(record => record.conversationId === item.conversationId);
      if (title !== undefined && (current?.running || current?.turn.saveError)) throw new Error('conversation has unsaved work');
      if (title === undefined) await deleteBookConversation(item.conversationId);
      else await renameBookConversation(item.conversationId, title);
      if (!mounted.current) return;
      if (title === undefined) {
        ++request.current;
        setLoading(false);
        setItems(current => current.filter(entry => entry.conversationId !== item.conversationId));
        discardConversationRun(item.conversationId);
      } else await reload(false);
    } catch {
      notice(title === undefined
        ? '删除失败，对话仍保留；生成已取消，请重试删除。'
        : '改名尚未保存，原名称未变；请检查名称、生成及保存状态后重试。');
    } finally { mutation.current = false; }
  };
  return { items: visibleItems, books, collapsed, loading, loadError, reload, toggleGroup, dialog, openDialog, dismiss, confirm };
}
