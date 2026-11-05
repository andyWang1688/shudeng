import { sameEpubSelection } from '@shudeng/core/domain';
/** Owns persisted EPUB state. SQLite annotation IDs are also the renderer IDs. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { getLegacyHighlightColor } from '../platform/pdfNative';
import {
  deleteReaderAnnotation, deleteReaderBookmarks, loadBookAnnotations, saveBookProgress, saveReaderAnnotation,
  updateReaderAnnotation, loadReaderPreferences, saveReaderPreferences,
  type ReaderPreferences, type ShelfAnnotation, type StoredReaderLocator,
} from '../platform/library';
import type { ReaderEvent, ReaderWebViewHandle } from './ReaderWebView';
import { annotationSeedFromShelfAnnotation, storedLocatorFromReaderLocator, readerLocatorFromStoredLocator } from './readerMapping';
import type { ReaderAnnotationSeed, ReaderBookmarkContext, ReaderContentsItem, ReaderNavigationReceipt, ReaderSearchResult, SelectionRect } from './readerProtocol';

export type ReaderSelection = { readonly quote: string; readonly locator: StoredReaderLocator; readonly rects?: readonly SelectionRect[] };
type Options = {
  readonly bookId: string;
  readonly title?: string | undefined;
  readonly initialLocation?: string | undefined;
  readonly initialAnnotations?: readonly ShelfAnnotation[] | undefined;
  readonly onAnnotationsChanged?: ((annotations: readonly ShelfAnnotation[]) => void) | undefined;
};

export function useReaderState({ bookId, title, initialLocation, initialAnnotations, onAnnotationsChanged }: Options) {
  const readerRef = useRef<ReaderWebViewHandle>(null);
  const [annotations, setAnnotations] = useState<readonly ShelfAnnotation[]>(initialAnnotations ?? []);
  const [progress, setProgress] = useState(0);
  const [chapter, setChapter] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const selectionActionsEnabled = useRef(true);
  const [noteSelection, setNoteSelection] = useState<ReaderSelection | null>(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState<ShelfAnnotation | null>(null);
  const [newHighlightId, setNewHighlightId] = useState<string | null>(null);
  const preferredColor = useRef('yellow');
  const [editingAnnotation, setEditingAnnotation] = useState<ShelfAnnotation | null>(null);
  const [readerReady, setReaderReady] = useState(false);
  const [readerError, setReaderError] = useState<string | null>(null);
  const [readerReload, setReaderReload] = useState(0);
  const [noteBody, setNoteBody] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const savingNoteRef = useRef(false);
  const [contents, setContents] = useState<readonly ReaderContentsItem[]>([]);
  const [contentsLoaded, setContentsLoaded] = useState(false);
  const [viewportRevision, setViewportRevision] = useState(0);
  const [visibleBookmarkIds, setVisibleBookmarkIds] = useState<readonly string[]>([]);
  const bookmarkRequest = useRef(0);
  const bookmarkRequests = useRef(new Map<number, { resolve: (context: ReaderBookmarkContext) => void; reject: (cause: Error) => void; timeout: ReturnType<typeof setTimeout> }>());
  const bookmarkSavingRef = useRef(false);
  const navigationRequests = useRef(new Map<string, (receipt: ReaderNavigationReceipt) => void>());
  const [searchResults, setSearchResults] = useState<readonly ReaderSearchResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchRequest = useRef(0);
  const [preferences, setPreferences] = useState<ReaderPreferences>({ format: 'epub', theme: 'light', fontScale: 1, flow: 'paginated' });
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const latestProgress = useRef<{ locator: StoredReaderLocator; percent: number; chapter: string | null } | null>(null);
  const openingProgress = useRef<typeof latestProgress.current>(null);
  const lastSavedAt = useRef(0);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyRef = useRef(false);
  const loadedPreferencesBook = useRef<string | null>(null);
  const initializedReader = useRef<string | null>(null);

  useEffect(() => { void SecureStore.getItemAsync('shudeng.reader-highlight-color').then(color => {
    color ??= getLegacyHighlightColor();
    if (color === 'pink') color = 'rose';
    if (color && ['yellow', 'green', 'blue', 'rose'].includes(color)) preferredColor.current = color;
  }).catch(() => {}); }, []);

  useEffect(() => {
    if (loadedPreferencesBook.current === bookId) return;
    let active = true;
    setPreferencesLoaded(false);
    void loadReaderPreferences(bookId, { format: 'epub', theme: 'light' }).then(next => {
      if (active) setPreferences(next);
    }).catch(cause => {
      if (active) setError('阅读设置读取失败：' + message(cause));
    }).finally(() => { if (active) { loadedPreferencesBook.current = bookId; setPreferencesLoaded(true); } });
    return () => { active = false; };
    // EPUB defaults to light and keeps its saved theme independently of app appearance.
  }, [bookId]);

  useEffect(() => {
    const identity = bookId + ':' + readerReload;
    if (initializedReader.current !== identity) {
      initializedReader.current = identity;
      readyRef.current = false;
      setReaderReady(false);
      setReaderError(null);
      setContentsLoaded(false);
      setVisibleBookmarkIds([]);
      for (const pending of bookmarkRequests.current.values()) { clearTimeout(pending.timeout); pending.reject(new Error('阅读器已关闭')); }
      bookmarkRequests.current.clear();
    }
    return () => {
      for (const pending of bookmarkRequests.current.values()) { clearTimeout(pending.timeout); pending.reject(new Error('阅读器已关闭')); }
      bookmarkRequests.current.clear();
      for (const [operationId, resolve] of navigationRequests.current) resolve({ operationId, status: 'failed', message: '阅读器已关闭' });
      navigationRequests.current.clear();
    };
  }, [bookId, readerReload]);

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2400);
  }, []);

  const refreshAnnotations = useCallback(async () => {
    const next = await loadBookAnnotations(bookId);
    setAnnotations(next);
    onAnnotationsChanged?.(next);
    return next;
  }, [bookId, onAnnotationsChanged]);

  useEffect(() => { setAnnotations(initialAnnotations ?? []); }, [initialAnnotations]);

  const flushProgress = useCallback(async () => {
    const latest = latestProgress.current;
    if (!latest) return true;
    try { await saveBookProgress(bookId, latest); return true; }
    catch (cause) { setError('阅读位置尚未保存：' + message(cause)); return false; }
  }, [bookId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') void flushProgress(); });
    return () => {
      subscription.remove();
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      void flushProgress();
    };
  }, [flushProgress]);

  const persistProgress = useCallback((locator: StoredReaderLocator, percent: number, nextChapter: string | null) => {
    latestProgress.current = { locator, percent, chapter: nextChapter };
    const now = Date.now();
    if (now - lastSavedAt.current < 1200) return;
    lastSavedAt.current = now;
    void flushProgress();
  }, [flushProgress]);

  const saveHighlight = useCallback(async (locator: StoredReaderLocator, quote: string, color = preferredColor.current) => {
    if (!selectionActionsEnabled.current) return;
    try {
      const saved = await saveReaderAnnotation(bookId, { kind: 'highlight', color, quote, format: 'EPUB', locator, chapter });
      const next = await refreshAnnotations();
      setSelectedAnnotation(next.find(annotation => annotation.id === saved.annotationId) ?? null);
      setNewHighlightId(saved.annotationId);
      readerRef.current?.clearSelection();
      setSelection(null);
      showNotice('已保存高亮');
    } catch (cause) { setError('高亮保存失败：' + message(cause)); }
  }, [bookId, chapter, refreshAnnotations, showNotice]);

  const onReaderEvent = useCallback((event: ReaderEvent) => {
    switch (event.type) {
      case 'navigated': {
        const pending = navigationRequests.current.get(event.receipt.operationId);
        if (!pending) break;
        const arrived = event.receipt.progress;
        const locator = arrived && storedLocatorFromReaderLocator(arrived.locator);
        if (event.receipt.status === 'arrived' && arrived && locator) {
          const percent = Math.min(1, Math.max(0, arrived.fraction));
          persistProgress(locator, percent, arrived.chapter ?? null);
          setProgress(percent); setChapter(arrived.chapter ?? null); setViewportRevision(value => value + 1);
        }
        navigationRequests.current.delete(event.receipt.operationId);
        pending(event.receipt);
        break;
      }
      case 'bookmarkContext': {
        const pending = bookmarkRequests.current.get(event.context.requestId);
        if (!pending) break;
        clearTimeout(pending.timeout); bookmarkRequests.current.delete(event.context.requestId);
        setVisibleBookmarkIds(event.context.visibleIds); pending.resolve(event.context);
        break;
      }
      case 'ready':
        readyRef.current = true;
        latestProgress.current = openingProgress.current;
        setReaderReady(true);
        setReaderError(null);
        readerRef.current?.requestContents();
        break;
      case 'selection': {
        if (!selectionActionsEnabled.current) { setSelection(null); break; }
        const locator = storedLocatorFromReaderLocator(event.locator);
        setSelection(locator ? { quote: event.quote, locator, ...(event.rects ? { rects: event.rects } : {}) } : null);
        break;
      }
      case 'selectionCleared': setSelection(null); break;
      case 'progress': {
        const locator = storedLocatorFromReaderLocator(event.locator);
        if (!locator) break;
        const percent = Math.min(1, Math.max(0, event.percent));
        const label = event.locator?.type === 'epub' ? event.locator.chapter ?? null : null;
        setProgress(percent);
        setViewportRevision(value => value + 1);
        setChapter(label);
        if (readyRef.current) persistProgress(locator, percent, label);
        else openingProgress.current = { locator, percent, chapter: label };
        break;
      }
      case 'annotationAdded': {
        if (!selectionActionsEnabled.current) break;
        const locator = storedLocatorFromReaderLocator(event.locator);
        if (locator) void saveHighlight(locator, event.quote);
        break;
      }
      case 'annotationSelected':
        setNewHighlightId(null);
        setSelectedAnnotation(annotations.find(annotation => annotation.id === event.annotation.id) ?? null);
        break;
      case 'contents': setContents(event.items); setContentsLoaded(true); break;
      case 'searchResults':
        if (event.requestId !== searchRequest.current) break;
        setSearchResults(event.items);
        setSearchBusy(!event.done);
        setSearchError(event.error ?? null);
        break;
      case 'error':
        for (const [operationId, resolve] of navigationRequests.current) resolve({ operationId, status: 'failed', message: event.message });
        navigationRequests.current.clear();
        if (!readyRef.current) { setReaderError(event.message); openingProgress.current = null; }
        else setError('阅读器错误：' + event.message);
        break;
    }
  }, [annotations, persistProgress, saveHighlight]);

  const navigateReference = useCallback((command: { readonly operationId: string; readonly locator: StoredReaderLocator; readonly quote: string; readonly ordinal: number; readonly id: string; readonly citation: boolean }): Promise<ReaderNavigationReceipt> => {
    if (!readyRef.current || !readerRef.current) return Promise.resolve({ operationId: command.operationId, status: 'failed', message: '阅读器尚未准备好' });
    if (navigationRequests.current.has(command.operationId)) return Promise.resolve({ operationId: command.operationId, status: 'failed', message: '重复的定位操作' });
    return new Promise(resolve => {
      navigationRequests.current.set(command.operationId, resolve);
      readerRef.current?.navigate({ operationId: command.operationId, locator: JSON.stringify(command.locator), citation: command.citation ? { quote: command.quote, ordinal: command.ordinal, id: command.id } : null });
    });
  }, []);

  const captureBookmarkContext = useCallback((): Promise<ReaderBookmarkContext> => {
    if (!readyRef.current || !readerRef.current) return Promise.reject(new Error('还没有可保存的阅读位置'));
    const requestId = ++bookmarkRequest.current;
    const bookmarks = annotations.flatMap(annotation => {
      if (annotation.kind !== 'bookmark' || !annotation.locator) return [];
      const locator = readerLocatorFromStoredLocator(annotation.locator);
      return locator ? [{ id: annotation.id, locator }] : [];
    });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { bookmarkRequests.current.delete(requestId); reject(new Error('当前阅读位置未能确认，请重试')); }, 3000);
      bookmarkRequests.current.set(requestId, { resolve, reject, timeout });
      readerRef.current?.captureBookmarkContext(bookmarks, requestId);
    });
  }, [annotations]);

  useEffect(() => {
    if (readerReady) void captureBookmarkContext().catch(() => {});
  }, [captureBookmarkContext, readerReady, viewportRevision]);

  const saveBookmark = useCallback(async (mode: 'toggle' | 'add' = 'toggle'): Promise<boolean> => {
    if (bookmarkSavingRef.current) return false;
    bookmarkSavingRef.current = true;
    try {
      const context = await captureBookmarkContext();
      const locator = context.locator ? storedLocatorFromReaderLocator(context.locator) : null;
      if (!locator) throw new Error('当前没有可确认的原文位置，请返回正文后重试');
      const remove = mode === 'toggle' ? context.visibleIds : [];
      if (remove.length > 0) {
        await deleteReaderBookmarks(bookId, remove);
      } else {
        await saveReaderAnnotation(bookId, { kind: 'bookmark', quote: context.quote, format: 'EPUB', locator, chapter });
      }
      await refreshAnnotations();
      showNotice(remove.length > 0 ? '已移除书签' : '已加入书签');
      return true;
    } catch (cause) { setError('书签保存失败：' + message(cause)); return false; }
    finally { bookmarkSavingRef.current = false; }
  }, [bookId, captureBookmarkContext, chapter, refreshAnnotations, showNotice]);

  const beginNoteSelection = useCallback((): boolean => {
    if (!selectionActionsEnabled.current || !selection) return false;
    const existing = annotations.find(annotation => annotation.kind !== 'bookmark' && sameEpubSelection(annotation.locator, selection.locator));
    setNoteSelection(selection);
    setEditingAnnotation(existing?.kind === 'note' ? existing : null);
    setNoteBody(existing?.body ?? '');
    return true;
  }, [annotations, selection]);

  const saveNote = useCallback(async (): Promise<boolean> => {
    if (!selectionActionsEnabled.current && !editingAnnotation) return false;
    const capturedSelection = noteSelection ?? selection;
    if ((!capturedSelection && !editingAnnotation) || !noteBody.trim() || savingNoteRef.current) return false;
    savingNoteRef.current = true;
    setSavingNote(true);
    try {
      if (editingAnnotation) await updateReaderAnnotation(editingAnnotation.id, { body: noteBody });
      else if (capturedSelection) await saveReaderAnnotation(bookId, { kind: 'note', body: noteBody, quote: capturedSelection.quote, format: 'EPUB', locator: capturedSelection.locator, chapter });
      await refreshAnnotations();
      setNoteBody('');
      setSelection(null);
      setNoteSelection(null);
      setEditingAnnotation(null);
      readerRef.current?.clearSelection();
      showNotice('笔记已保存');
      return true;
    } catch (cause) { Alert.alert('保存失败', message(cause)); return false; }
    finally { savingNoteRef.current = false; setSavingNote(false); }
  }, [bookId, chapter, editingAnnotation, noteBody, noteSelection, refreshAnnotations, selection, showNotice]);

  const removeAnnotation = useCallback(async (annotation: ShelfAnnotation) => {
    try {
      await deleteReaderAnnotation(annotation.id);
      await refreshAnnotations();
      setSelectedAnnotation(null);
      if (editingAnnotation?.id === annotation.id) setEditingAnnotation(null);
      showNotice('已删除标注');
      return true;
    } catch (cause) { Alert.alert('删除失败', message(cause)); return false; }
  }, [editingAnnotation, refreshAnnotations, showNotice]);

  const changeHighlightColor = useCallback(async (annotation: ShelfAnnotation, color: string, keepOpen = false) => {
    try {
      await updateReaderAnnotation(annotation.id, { color });
      const next = await refreshAnnotations();
      preferredColor.current = color;
      void SecureStore.setItemAsync('shudeng.reader-highlight-color', color).catch(() => {});
      setSelectedAnnotation(keepOpen ? next.find(item => item.id === annotation.id) ?? null : null);
    } catch (cause) { Alert.alert('改色失败', message(cause)); }
  }, [refreshAnnotations]);

  const applyPreferences = useCallback(async (next: ReaderPreferences) => {
    try { await saveReaderPreferences(bookId, next); setPreferences(next); return true; }
    catch (cause) { Alert.alert('设置尚未保存', message(cause)); return false; }
  }, [bookId]);

  const search = useCallback((query: string) => {
    const requestId = ++searchRequest.current;
    setSearchResults([]); setSearchError(null); setSearchBusy(Boolean(query.trim()));
    readerRef.current?.search(query, requestId);
  }, []);

  const cancelSelection = useCallback(() => { readerRef.current?.clearSelection(); setSelection(null); }, []);
  const setSelectionActionsEnabled = useCallback((enabled: boolean) => {
    selectionActionsEnabled.current = enabled;
    if (!enabled) { readerRef.current?.clearSelection(); setSelection(null); setNoteSelection(null); }
  }, []);
  const highlightSelection = useCallback((color = preferredColor.current) => { if (selectionActionsEnabled.current && selection) void saveHighlight(selection.locator, selection.quote, color); }, [saveHighlight, selection]);
  const retryReader = useCallback(() => { readyRef.current = false; setReaderReady(false); setReaderError(null); setReaderReload(value => value + 1); }, []);
  const getLatestLocator = useCallback(() => latestProgress.current?.locator ?? null, []);
  const seedAnnotations = useMemo<readonly ReaderAnnotationSeed[]>(() => annotations.flatMap(annotation => {
    const seed = annotationSeedFromShelfAnnotation(annotation, 'EPUB');
    return seed ? [seed] : [];
  }), [annotations]);
  const bookmarked = visibleBookmarkIds.length > 0;

  return {
    readerRef, readerTheme: preferences.theme, preferences, preferencesLoaded, applyPreferences,
    annotations, progress, chapter, notice, error, setError, selection, readerReady, readerError, readerReload,
    noteBody, setNoteBody, savingNote, saveBookmark, saveNote, beginNoteSelection, removeAnnotation, changeHighlightColor,
    highlightSelection, cancelSelection, setSelectionActionsEnabled, retryReader, getLatestLocator, seedAnnotations, onReaderEvent,
    selectedAnnotation, setSelectedAnnotation, editingAnnotation, setEditingAnnotation,
    newHighlightId,
    noteSelection, setNoteSelection,
    contents, contentsLoaded, searchResults, searchBusy, searchError, search, bookmarked, flushProgress, navigateReference,
  };
}
function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
