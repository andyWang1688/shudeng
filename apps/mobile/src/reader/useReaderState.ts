/**
 * ReaderShell 的阅读状态与持久化：进度节流保存、标注读取/增删、选区、提示与错误、
 * WebView 重开。只负责数据与副作用，UI 由 ReaderShell/子组件编排。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useAppearance } from '../ui/appearance';
import {
  deleteReaderAnnotation,
  loadBookAnnotations,
  saveBookProgress,
  saveReaderAnnotation,
  type ShelfAnnotation,
  type StoredReaderLocator,
} from '../platform/library';
import type { ReaderEvent, ReaderWebViewHandle } from './ReaderWebView';
import { annotationSeedFromShelfAnnotation, storedLocatorFromReaderLocator } from './readerMapping';
import type { ReaderAnnotationSeed } from './readerProtocol';

export type ReaderSelection = {
  readonly quote: string;
  readonly locator: StoredReaderLocator;
};

type ReaderStateOptions = {
  readonly bookId: string;
  readonly title?: string | undefined;
  readonly initialLocation?: string | undefined;
  readonly initialAnnotations?: readonly ShelfAnnotation[] | undefined;
  readonly onAnnotationsChanged?: ((annotations: readonly ShelfAnnotation[]) => void) | undefined;
};

export function useReaderState({
  bookId,
  title,
  initialLocation,
  initialAnnotations,
  onAnnotationsChanged,
}: ReaderStateOptions) {
  const { resolvedMode } = useAppearance();
  const readerTheme: 'light' | 'dark' = resolvedMode;
  const readerRef = useRef<ReaderWebViewHandle>(null);
  const [annotations, setAnnotations] = useState<readonly ShelfAnnotation[]>(initialAnnotations ?? []);
  const [progress, setProgress] = useState(0);
  const [chapter, setChapter] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [readerReady, setReaderReady] = useState(false);
  const [readerError, setReaderError] = useState<string | null>(null);
  const [readerReload, setReaderReload] = useState(0);
  const [noteBody, setNoteBody] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const latestProgress = useRef<{ locator: StoredReaderLocator; percent: number; chapter: string | null } | null>(null);
  const lastSavedAt = useRef(0);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setReaderReady(false);
    setReaderError(null);
  }, [bookId, readerReload]);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2400);
  }, []);

  const refreshAnnotations = useCallback(async () => {
    try {
      const next = await loadBookAnnotations(bookId);
      setAnnotations(next);
      onAnnotationsChanged?.(next);
    } catch {
      // 标注读取失败不阻塞阅读。
    }
  }, [bookId, onAnnotationsChanged]);

  useEffect(() => {
    setAnnotations(initialAnnotations ?? []);
  }, [initialAnnotations]);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      const latest = latestProgress.current;
      if (latest) void saveBookProgress(bookId, latest);
    };
  }, [bookId]);

  const persistProgress = useCallback(
    (locator: StoredReaderLocator, percent: number, nextChapter: string | null, force = false) => {
      latestProgress.current = { locator, percent, chapter: nextChapter };
      const now = Date.now();
      if (!force && now - lastSavedAt.current < 1200) return;
      lastSavedAt.current = now;
      void saveBookProgress(bookId, { locator, percent, chapter: nextChapter });
    },
    [bookId],
  );

  const persistHighlight = useCallback(
    async (event: Extract<ReaderEvent, { type: 'annotationAdded' }>) => {
      const locator = storedLocatorFromReaderLocator(event.locator);
      if (!locator) return;
      try {
        await saveReaderAnnotation(bookId, {
          kind: 'highlight',
          color: 'yellow',
          quote: event.quote,
          format: 'EPUB',
          locator,
          chapter,
        });
        await refreshAnnotations();
        showNotice('已保存高亮');
      } catch (cause) {
        setError(`高亮保存失败：${cause instanceof Error ? cause.message : String(cause)}`);
      }
    },
    [bookId, chapter, refreshAnnotations, showNotice],
  );

  const onReaderEvent = useCallback(
    (event: ReaderEvent) => {
      switch (event.type) {
        case 'ready':
          setError(null);
          setReaderReady(true);
          break;
        case 'selection': {
          const locator = storedLocatorFromReaderLocator(event.locator);
          setSelection(locator ? { quote: event.quote, locator } : null);
          break;
        }
        case 'progress': {
          const locator = storedLocatorFromReaderLocator(event.locator);
          if (!locator) break;
          const percent = Math.min(1, Math.max(0, event.percent));
          const chapterLabel = event.locator?.type === 'epub' ? event.locator.chapter ?? null : null;
          setProgress(percent);
          setChapter(chapterLabel);
          persistProgress(locator, percent, chapterLabel);
          break;
        }
        case 'annotationAdded':
          void persistHighlight(event);
          break;
        case 'error':
          setError(`阅读器错误：${event.message}`);
          break;
      }
    },
    [persistHighlight, persistProgress],
  );

  const saveBookmark = useCallback(async () => {
    const fallbackLocator: StoredReaderLocator | null = latestProgress.current?.locator
      ?? (initialLocation ? { type: 'epub', cfi: initialLocation } : null);
    if (!fallbackLocator) {
      showNotice('还没有可保存的阅读位置');
      return;
    }
    try {
      await saveReaderAnnotation(bookId, {
        kind: 'bookmark',
        quote: chapter ?? title ?? '书签',
        format: 'EPUB',
        locator: fallbackLocator,
        chapter,
      });
      await refreshAnnotations();
      showNotice('已加入书签');
    } catch (cause) {
      setError(`书签保存失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }, [bookId, chapter, initialLocation, refreshAnnotations, showNotice, title]);

  const saveNote = useCallback(async (): Promise<boolean> => {
    if (!selection || noteBody.trim().length === 0 || savingNote) return false;
    setSavingNote(true);
    try {
      await saveReaderAnnotation(bookId, {
        kind: 'note',
        color: 'yellow',
        body: noteBody.trim(),
        quote: selection.quote,
        format: 'EPUB',
        locator: selection.locator,
        chapter,
      });
      setNoteBody('');
      setSelection(null);
      await refreshAnnotations();
      showNotice('笔记已保存');
      return true;
    } catch (cause) {
      Alert.alert('保存失败', cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setSavingNote(false);
    }
  }, [bookId, chapter, noteBody, refreshAnnotations, savingNote, selection, showNotice]);

  const removeAnnotation = useCallback(
    async (annotation: ShelfAnnotation) => {
      try {
        await deleteReaderAnnotation(annotation.id);
        await refreshAnnotations();
        showNotice('已删除标注');
      } catch (cause) {
        Alert.alert('删除失败', cause instanceof Error ? cause.message : String(cause));
      }
    },
    [refreshAnnotations, showNotice],
  );

  const highlightSelection = useCallback(() => {
    if (!selection) return;
    readerRef.current?.highlightSelection(selection.locator, selection.quote);
    onReaderEvent({ type: 'annotationAdded', locator: selection.locator, quote: selection.quote });
    setSelection(null);
  }, [onReaderEvent, selection]);

  const cancelSelection = useCallback(() => {
    readerRef.current?.clearSelection();
    setSelection(null);
  }, []);

  const retryReader = useCallback(() => {
    setReaderReady(false);
    setReaderError(null);
    setReaderReload((value) => value + 1);
  }, []);

  const getLatestLocator = useCallback((): StoredReaderLocator | null => latestProgress.current?.locator ?? null, []);

  const seedAnnotations = useMemo<readonly ReaderAnnotationSeed[]>(
    () => (initialAnnotations ?? []).flatMap((annotation) => {
      const seed = annotationSeedFromShelfAnnotation(annotation, 'EPUB');
      return seed ? [seed] : [];
    }),
    [initialAnnotations],
  );

  return {
    readerRef,
    readerTheme,
    annotations,
    progress,
    chapter,
    notice,
    error,
    setError,
    selection,
    readerReady,
    readerError,
    readerReload,
    noteBody,
    setNoteBody,
    savingNote,
    saveBookmark,
    saveNote,
    removeAnnotation,
    highlightSelection,
    cancelSelection,
    retryReader,
    getLatestLocator,
    seedAnnotations,
    onReaderEvent,
  };
}
