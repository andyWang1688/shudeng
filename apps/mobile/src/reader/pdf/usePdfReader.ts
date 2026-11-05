import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useAppearance } from '../../ui/appearance';
import { useReaderQuestions } from '../../ui/reader-question/ReaderQuestionProvider';
import type { NavigationReceipt, ReferenceCommand } from '../../ui/reader-question/session';
import { deleteReaderAnnotation, loadBookAnnotations, saveBookProgress, saveReaderAnnotation, updateReaderAnnotation, type ShelfAnnotation, type StoredReaderLocator } from '../../platform/library';
import { loadReaderPreferences, saveReaderPreferences, type ReaderPreferences } from '../../platform/library/readerPreferences';
import { parseLegacyJSON } from '../../platform/library/legacyMigration';
import { cancelPdfSearch, getLegacyHighlightColor, startPdfInspection, readPdfPageText, releasePdf, searchPdf, trimPdfSearchQuery, type PdfOutlineItem, type PdfSearchHit } from '../../platform/pdfNative';
import type { PdfViewEvent } from './NativePdfSurface';
import type { HighlightColor, PdfContentsTab, PdfPanel } from './PdfReaderPanels';
import { resolvePdfReaderPageInfo } from './pdfReaderMetadata';
import { pdfBookmarkSummary } from './pdfBookmarkSummary';

const HIGHLIGHT_COLOR_KEY = 'shudeng.reader-highlight-color';
function highlightColor(value: string | null): HighlightColor | null {
  if (value === 'pink') return 'rose';
  return value === 'yellow' || value === 'green' || value === 'blue' || value === 'rose' ? value : null;
}

export type PdfSelection = { readonly quote: string; readonly locator: Extract<StoredReaderLocator, { type: 'pdf' }> };
type NoteDraft = PdfSelection & { readonly annotation: ShelfAnnotation | null };
type PaletteTarget = PdfSelection & { readonly annotation: ShelfAnnotation | null };
type ReaderOwner = { active: boolean; readonly bookId: string; readonly fileUri: string };

export type PdfReaderOptions = {
  readonly bookId: string; readonly title: string; readonly fileUri: string; readonly initialPage?: number;
  readonly initialLocator?: Extract<StoredReaderLocator, { type: 'pdf' }>;
  readonly initialAnnotations?: readonly ShelfAnnotation[];
  readonly onAnnotationsChanged?: (annotations: readonly ShelfAnnotation[]) => void;
  readonly onPageChanged?: (page: number, total: number) => void;
  readonly onLoadComplete?: (total: number) => void;
};

export function usePdfReader(options: PdfReaderOptions) {
  const { bookId, title, fileUri, initialPage, initialLocator, onAnnotationsChanged, onPageChanged, onLoadComplete } = options;
  const { resolvedMode } = useAppearance();
  const [annotations, setAnnotations] = useState<readonly ShelfAnnotation[]>(options.initialAnnotations ?? []);
  const [page, setPage] = useState(initialPage && initialPage > 0 ? initialPage : 1);
  const [total, setTotal] = useState(0);
  const [outline, setOutline] = useState<readonly PdfOutlineItem[]>([]);
  const [preferences, setPreferences] = useState<ReaderPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [openError, setOpenError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [command, setCommand] = useState('');
  const [chromeVisible, setChromeVisible] = useState(true);
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  const [paletteTarget, setPaletteTarget] = useState<PaletteTarget | null>(null);
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null);
  const [noteBody, setNoteBody] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [panel, setPanel] = useState<PdfPanel>(null);
  const [contentsTab, setContentsTab] = useState<PdfContentsTab>('contents');
  const [{ query, queryEventCount }, setQueryState] = useState({ query: '', queryEventCount: 0 });
  const setQuery = useCallback((text: string, eventCount: number) => {
    setQueryState(previous => eventCount >= previous.queryEventCount
      ? { query: text, queryEventCount: eventCount } : previous);
  }, []);
  const [hits, setHits] = useState<readonly PdfSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [textPageCount, setTextPageCount] = useState<number | null>(null);
  const [scannedPageCount, setScannedPageCount] = useState(0);
  const [pageHasText, setPageHasText] = useState(true);
  const commandSequence = useRef(0);
  const saveInFlight = useRef(false);
  const saveOperation = useRef<object | null>(null);
  const committedNoteDrafts = useRef(new WeakSet<NoteDraft>());
  const annotationOwner = useRef<ReaderOwner>({ active: true, bookId, fileUri });
  const preferenceSaving = useRef(false);
  const initialized = useRef(false);
  const preferredColor = useRef<HighlightColor>('yellow');
  const latestProgress = useRef<{ locator: StoredReaderLocator; percent: number } | null>(null);
  const progressWrite = useRef<Promise<void>>(Promise.resolve());
  const navigationRequests = useRef(new Map<string, { locator: Extract<StoredReaderLocator, { type: 'pdf' }>; resolve: (receipt: NavigationReceipt) => void }>());
  useEffect(() => {
    const owner = { active: true, bookId, fileUri };
    annotationOwner.current = owner;
    // A reused reader starts a fresh editor. Retire its previous operation so
    // a late completion cannot release a newer owner's save lock.
    saveOperation.current = null; saveInFlight.current = false;
    setSavingNote(false); setNoteDraft(null); setNoteBody('');
    setSelection(null); setPaletteTarget(null);
    return () => { owner.active = false; };
  }, [bookId, fileUri]);
  const ownsAnnotationUI = useCallback((owner: ReaderOwner) => owner.active && annotationOwner.current === owner, []);
  const queueProgress = useCallback((progress: { locator: StoredReaderLocator; percent: number }) => {
    const write = progressWrite.current.catch(() => {}).then(() => saveBookProgress(bookId, progress));
    progressWrite.current = write;
    return write;
  }, [bookId]);
  const flushProgress = useCallback(async () => {
    const progress = latestProgress.current;
    try { if (progress) await queueProgress(progress); else await progressWrite.current; return true; }
    catch (cause) { setError('阅读进度保存失败：' + (cause instanceof Error ? cause.message : String(cause))); return false; }
  }, [queueProgress]);

  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(HIGHLIGHT_COLOR_KEY).then(async (stored) => {
      const color = highlightColor(stored) ?? highlightColor(getLegacyHighlightColor());
      if (!color || !active) return;
      preferredColor.current = color;
      if (!stored) await SecureStore.setItemAsync(HIGHLIGHT_COLOR_KEY, color);
    }).catch((cause: unknown) => {
      if (active) setError(`高亮颜色读取失败：${cause instanceof Error ? cause.message : String(cause)}`);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => { setAnnotations(options.initialAnnotations ?? []); }, [options.initialAnnotations]);

  const sendCommand = useCallback((payload: { readonly type: string; readonly page?: number; readonly rects?: Extract<StoredReaderLocator, { type: 'pdf' }>['rects']; readonly operationId?: string; readonly citation?: boolean }) => {
    setCommand(JSON.stringify({ ...payload, sequence: ++commandSequence.current }));
  }, []);
  const clearSelection = useCallback(() => {
    setSelection(null);
    sendCommand({ type: 'clearSelection' });
  }, [sendCommand]);

  useEffect(() => {
    if (initialLocator) sendCommand({ type: 'goTo', page: initialLocator.page, ...(initialLocator.rects ? { rects: initialLocator.rects } : {}) });
    else if (initialPage) sendCommand({ type: 'goTo', page: initialPage });
  }, [initialLocator, initialPage, sendCommand]);

  useEffect(() => {
    let active = true;
    const inspection = startPdfInspection(fileUri);
    void inspection.promise.then((info) => {
      if (!active) return;
      const counts = resolvePdfReaderPageInfo(bookId, info, parseLegacyJSON('library.json'));
      setTextPageCount(counts.textPageCount);
      setScannedPageCount(counts.scannedPageCount);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      active = false;
      inspection.cancel();
      void releasePdf(fileUri).catch(() => { /* Releasing an extraction cache must not hide a reading error. */ });
    };
  }, [bookId, fileUri]);

  useEffect(() => {
    cancelPdfSearch();
    if (panel !== 'contents' || contentsTab !== 'search') return;
    const text = trimPdfSearchQuery(query);
    setSearchError(null);
    if (!text) { setHits([]); setSearching(false); return; }
    setSearching(true);
    setHits([]);
    let active = true;
    const timer = setTimeout(() => {
      void searchPdf(fileUri, text).then((results) => { if (active) setHits(results); }).catch((cause: unknown) => {
        if (active) { setSearchError(cause instanceof Error ? cause.message : String(cause)); setHits([]); }
      }).finally(() => { if (active) setSearching(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); cancelPdfSearch(); };
  }, [contentsTab, fileUri, panel, query]);

  const refreshAnnotations = useCallback(async (owner?: ReaderOwner) => {
    const rows = await loadBookAnnotations(bookId);
    if (owner && !ownsAnnotationUI(owner)) return;
    setAnnotations(rows);
    onAnnotationsChanged?.(rows);
  }, [bookId, onAnnotationsChanged, ownsAnnotationUI]);

  const onEvent = useCallback((event: PdfViewEvent) => {
    switch (event.type) {
      case 'ready':
        setLoading(false); setOpenError(null); setTotal(event.pageCount); setOutline(event.outline);
        onLoadComplete?.(event.pageCount);
        if (!initialized.current) {
          initialized.current = true;
          void loadReaderPreferences(bookId, { format: 'pdf', theme: resolvedMode, flow: event.pageCount >= 200 ? 'paginated' : 'scrolled' }).then(setPreferences).catch((cause: unknown) => setError(`阅读设置读取失败：${cause instanceof Error ? cause.message : String(cause)}`));
          // Native detach/attach reopens at its last requested page. Do not replay the
          // original entry locator when returning from a question or another screen.
          if (initialLocator) sendCommand({ type: 'goTo', page: initialLocator.page, ...(initialLocator.rects ? { rects: initialLocator.rects } : {}) });
        }
        break;
      case 'page':
        setPage(event.page); setTotal(event.pageCount); setPageHasText(event.pageHasText);
        onPageChanged?.(event.page, event.pageCount);
        latestProgress.current = { locator: { type: 'pdf', page: event.page }, percent: event.pageCount > 1 ? (event.page - 1) / (event.pageCount - 1) : 1 };
        void queueProgress(latestProgress.current).catch((cause: unknown) => setError('阅读进度保存失败：' + (cause instanceof Error ? cause.message : String(cause))));
        break;
      case 'selection':
        setSelection({ quote: event.text, locator: { type: 'pdf', page: event.page, rects: event.rects, text: event.text } });
        break;
      case 'selectionCleared': setSelection(null); break;
      case 'tap': setChromeVisible((visible) => !visible); break;
      case 'navigation': {
        const request = navigationRequests.current.get(event.operationId);
        if (!request) break;
        navigationRequests.current.delete(event.operationId);
        if (event.status === 'arrived') latestProgress.current = { locator: request.locator, percent: total > 1 ? (request.locator.page - 1) / (total - 1) : 1 };
        request.resolve(event);
        break;
      }
      case 'error':
        setLoading(false); setOpenError(event.message);
        for (const [operationId, request] of navigationRequests.current) request.resolve({ operationId, status: 'failed', message: event.message });
        navigationRequests.current.clear();
        break;
      case 'annotation': {
        const annotation = annotations.find((item) => item.id === event.id);
        if (!annotation || annotation.locator?.type !== 'pdf') break;
        const target = { quote: annotation.quote, locator: annotation.locator, annotation };
        clearSelection();
        if (annotation.kind === 'note') { setNoteDraft(target); setNoteBody(annotation.body ?? ''); }
        else setPaletteTarget(target);
        break;
      }
    }
  }, [annotations, clearSelection, initialLocator, onLoadComplete, onPageChanged, queueProgress, resolvedMode, sendCommand, total]);

  const persistError = useCallback((prefix: string, cause: unknown) => {
    Alert.alert(prefix, cause instanceof Error ? cause.message : String(cause));
  }, []);

  const pickColor = useCallback(async (color: HighlightColor) => {
    const owner = annotationOwner.current;
    const target = paletteTarget;
    if (!target || saveInFlight.current || !owner.active || owner.bookId !== bookId || owner.fileUri !== fileUri) return;
    const operation = {}; saveOperation.current = operation; saveInFlight.current = true;
    try {
      if (target.annotation) await updateReaderAnnotation(target.annotation.id, { color });
      else await saveReaderAnnotation(bookId, { kind: 'highlight', color, quote: target.quote, format: 'PDF', locator: target.locator, page: target.locator.page });
      preferredColor.current = color;
      if (ownsAnnotationUI(owner)) await refreshAnnotations(owner);
      await SecureStore.setItemAsync(HIGHLIGHT_COLOR_KEY, color);
    } catch (cause) { if (ownsAnnotationUI(owner)) persistError('高亮保存失败', cause); }
    finally { if (saveOperation.current === operation) { saveOperation.current = null; saveInFlight.current = false; } }
  }, [bookId, fileUri, ownsAnnotationUI, paletteTarget, persistError, refreshAnnotations]);

  const removeAnnotation = useCallback(async (annotation: ShelfAnnotation) => {
    const owner = annotationOwner.current;
    if (!owner.active || owner.bookId !== bookId || owner.fileUri !== fileUri) return;
    try {
      await deleteReaderAnnotation(annotation.id);
      if (ownsAnnotationUI(owner)) {
        await refreshAnnotations(owner);
        if (ownsAnnotationUI(owner)) { setNoteDraft(null); clearSelection(); }
      }
    } catch (cause) { if (ownsAnnotationUI(owner)) persistError('删除失败', cause); }
  }, [bookId, clearSelection, fileUri, ownsAnnotationUI, persistError, refreshAnnotations]);

  const saveNote = useCallback(async () => {
    const owner = annotationOwner.current;
    if (!noteDraft || committedNoteDrafts.current.has(noteDraft) || !noteBody.trim() || saveInFlight.current || !owner.active || owner.bookId !== bookId || owner.fileUri !== fileUri) return;
    const operation = {}; saveOperation.current = operation;
    saveInFlight.current = true; setSavingNote(true);
    try {
      if (noteDraft.annotation) await updateReaderAnnotation(noteDraft.annotation.id, { body: noteBody });
      else await saveReaderAnnotation(bookId, { kind: 'note', color: preferredColor.current, body: noteBody, quote: noteDraft.quote, format: 'PDF', locator: noteDraft.locator, page: noteDraft.locator.page });
      // Retire this draft before state commits or display reloads. A callback
      // from the previous render must not insert the durable note twice.
      committedNoteDrafts.current.add(noteDraft);
      if (!ownsAnnotationUI(owner)) return;
      setNoteDraft(null); setNoteBody(''); clearSelection();
      try { await refreshAnnotations(owner); }
      catch { if (ownsAnnotationUI(owner)) setError('笔记已保存，显示更新失败；请重新打开阅读器查看。'); }
    } catch (cause) { if (ownsAnnotationUI(owner)) persistError('笔记保存失败', cause); }
    finally {
      if (saveOperation.current === operation) {
        saveOperation.current = null; saveInFlight.current = false;
        if (ownsAnnotationUI(owner)) setSavingNote(false);
      }
    }
  }, [bookId, clearSelection, fileUri, noteBody, noteDraft, ownsAnnotationUI, persistError, refreshAnnotations]);

  const toggleBookmark = useCallback(async () => {
    if (loading || saveInFlight.current) return;
    const existing = annotations.find((item) => item.kind === 'bookmark' && item.locator?.type === 'pdf' && item.locator.page === page);
    if (existing) { await removeAnnotation(existing); return; }
    const owner = annotationOwner.current;
    const operation = {}; saveOperation.current = operation; saveInFlight.current = true;
    try {
      const quote = pdfBookmarkSummary(await readPdfPageText(fileUri, page));
      await saveReaderAnnotation(bookId, { kind: 'bookmark', quote, format: 'PDF', locator: { type: 'pdf', page }, page });
      if (ownsAnnotationUI(owner)) await refreshAnnotations(owner);
    } catch (cause) { if (ownsAnnotationUI(owner)) persistError('书签保存失败', cause); }
    finally { if (saveOperation.current === operation) { saveOperation.current = null; saveInFlight.current = false; } }
  }, [annotations, bookId, fileUri, loading, ownsAnnotationUI, page, persistError, refreshAnnotations, removeAnnotation]);

  const updatePreferences = useCallback(async (change: Partial<Pick<ReaderPreferences, 'flow' | 'theme'>>) => {
    if (!preferences || preferenceSaving.current) return;
    preferenceSaving.current = true;
    const next = { ...preferences, ...change };
    try { await saveReaderPreferences(bookId, next); setPreferences(next); }
    catch (cause) { persistError('阅读设置保存失败', cause); }
    finally { preferenceSaving.current = false; }
  }, [bookId, persistError, preferences]);

  const jumpTo = useCallback((locator: StoredReaderLocator) => {
    if (locator.type !== 'pdf') return;
    if (!Number.isSafeInteger(locator.page) || locator.page < 1 || locator.page > total) { setError('此位置不在当前 PDF 中'); return; }
    setPanel(null); clearSelection();
    sendCommand({ type: 'goTo', page: locator.page, ...(locator.rects ? { rects: locator.rects } : {}) });
  }, [clearSelection, sendCommand, total]);

  const navigateReference = useCallback((command: ReferenceCommand): Promise<NavigationReceipt> => {
    if (command.locator.type !== 'pdf' || !Number.isSafeInteger(command.locator.page) || command.locator.page < 1 || command.locator.page > total || loading || openError) return Promise.resolve({ operationId: command.operationId, status: 'failed', message: '此位置不在当前 PDF 中' });
    if (navigationRequests.current.has(command.operationId)) return Promise.resolve({ operationId: command.operationId, status: 'failed', message: '重复的定位操作' });
    const locator = command.locator;
    clearSelection(); setPanel(null);
    return new Promise(resolve => {
      navigationRequests.current.set(command.operationId, { resolve, locator });
      sendCommand({ type: 'goTo', page: locator.page, operationId: command.operationId, citation: command.citation, ...(locator.rects ? { rects: locator.rects } : {}) });
    });
  }, [clearSelection, loading, openError, sendCommand, total]);
  const questions = useReaderQuestions({ bookId, format: 'pdf', title, theme: resolvedMode,
    getLocator: () => latestProgress.current?.locator ?? { type: 'pdf', page },
    navigate: navigateReference, flushProgress, documentFailed: openError !== null });

  const ask = useCallback((selected?: PdfSelection) => {
    if (textPageCount === null) { Alert.alert('问问书灯', '正在检查书中文字，请稍后重试。'); return; }
    if (textPageCount === 0) { Alert.alert('问问书灯', '没有可搜索的文字；阅读、缩放和加书签都可以正常使用。'); return; }
    clearSelection();
    questions.ask(selected);
  }, [clearSelection, questions.ask, textPageCount]);

  const onSelectionAction = useCallback((event: Extract<PdfViewEvent, { type: 'selectionAction' }>) => {
    // Use the latest PDFKit selection carried by the action, even if React has
    // not committed the preceding selection event after a handle adjustment.
    const selected: PdfSelection = { quote: event.text, locator: { type: 'pdf', page: event.page, rects: event.rects, text: event.text } };
    switch (event.action) {
      case 'highlight': setPaletteTarget({ ...selected, annotation: null }); break;
      case 'note': setNoteDraft({ ...selected, annotation: null }); setNoteBody(''); clearSelection(); break;
      case 'ask': ask(selected); break;
      case 'cancel': clearSelection(); break;
    }
  }, [ask, clearSelection]);

  return { annotations, page, total, outline, preferences, loading, openError, error, setError, retry, command, chromeVisible, selection, paletteTarget, setPaletteTarget, noteDraft, setNoteDraft, noteBody, setNoteBody, savingNote, panel, setPanel, contentsTab, setContentsTab, query, queryEventCount, setQuery, hits, searching, searchError, textPageCount, scannedPageCount, pageHasText, onEvent, onSelectionAction, clearSelection, pickColor, removeAnnotation, saveNote, toggleBookmark, updatePreferences, jumpTo, ask, questions, flushProgress,
    retryOpen: () => { setOpenError(null); setLoading(true); setRetry((value) => value + 1); },
  };
}
