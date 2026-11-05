import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { decodeEpubAnchor } from '@shudeng/core/domain';
import { getLocalBookIndexStatus, rebuildBookIndex, type BookIndexStatus } from '../platform/ai/bookIndex';
import { searchBookText } from '../platform/ai/searchBookText';
import type { ShelfAnnotation } from '../platform/library';
import type { EpubNavigationAction } from './NativeEpubNavigation';
import type { ReaderContentsItem } from './readerProtocol';

type SearchResult = { readonly id: string; readonly chapter: string; readonly context: string; readonly locator: string; readonly selectionKey: string };
type SelectableSearchSnapshot = { readonly bookId: string; readonly rows: readonly SearchResult[] };
type SearchNavigationSelection = { readonly status: 'pending' | 'consumed'; readonly bookId: string; readonly id: string; readonly selectionKey: string; readonly locator: string };
type Options = {
  readonly bookId: string;
  readonly visible: boolean;
  readonly contents: readonly ReaderContentsItem[];
  readonly contentsLoaded: boolean;
  readonly annotations: readonly ShelfAnnotation[];
  readonly onClose: () => void;
  readonly onNavigate: (locator: string) => void;
  readonly onAddBookmark: () => Promise<boolean>;
  readonly onRemoveBookmark: (annotation: ShelfAnnotation) => Promise<boolean>;
};

/** Owns the session and business operations; UIKit displays the immutable snapshot. */
export function useEpubNavigation(options: Options) {
  const { bookId, visible, contents, contentsLoaded, annotations, onClose, onNavigate, onAddBookmark, onRemoveBookmark } = options;
  const [tab, setTab] = useState<'contents' | 'bookmarks'>('contents');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly SearchResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [preparation, setPreparation] = useState<(BookIndexStatus & { readonly state: string }) | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [bookmarkSaving, setBookmarkSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [searchRevision, setSearchRevision] = useState(0);
  const session = useRef(0);
  const searchSelectionSerial = useRef(0);
  const selectableSearchResults = useRef<SelectableSearchSnapshot | null>(null);
  // Freeze a validated selection before UIKit clears search and dismisses its panel.
  const searchNavigationSelection = useRef<SearchNavigationSelection | null>(null);
  const bookmarkSavingRef = useRef(false);
  const preparingRef = useRef(false);

  const refreshPreparation = useCallback(async (generation: number) => {
    try {
      const status = await getLocalBookIndexStatus(bookId);
      if (session.current === generation) setPreparation(status);
    } catch (cause) {
      if (session.current === generation) setPreparation({ available: false, semantic: false, state: 'failed', detail: message(cause) });
    }
  }, [bookId]);

  useEffect(() => {
    const generation = ++session.current;
    selectableSearchResults.current = null;
    if (visible || searchNavigationSelection.current?.bookId !== bookId) searchNavigationSelection.current = null;
    if (visible) {
      setTab('contents'); setSearchOpen(false); setQuery(''); setResults([]); setSearchError(null); setSearchBusy(false); setFeedback(null);
      setPreparation(null); void refreshPreparation(generation);
    }
    return () => { session.current++; };
  }, [bookId, refreshPreparation, visible]);

  useEffect(() => {
    if (!visible || preparation?.state !== 'building') return;
    const generation = session.current;
    const timer = setInterval(() => { void refreshPreparation(generation); }, 1000);
    return () => clearInterval(timer);
  }, [preparation?.state, refreshPreparation, visible]);

  useEffect(() => {
    selectableSearchResults.current = null;
    if (!visible || !searchOpen || !query) { setResults([]); setSearchBusy(false); setSearchError(null); return; }
    const signal = new AbortController();
    const generation = session.current;
    setResults([]); setSearchBusy(true); setSearchError(null);
    const timer = setTimeout(() => {
      void searchBookText(bookId, query, { signal: signal.signal }).then(hits => {
        if (!signal.signal.aborted && generation === session.current) {
          const published = Object.freeze(hits.map(hit => Object.freeze({ ...hit, selectionKey: 'search:' + generation + ':' + ++searchSelectionSerial.current })));
          selectableSearchResults.current = Object.freeze({ bookId, rows: published });
          setResults(published);
          setSearchBusy(false);
        }
      }).catch(cause => {
        if (!signal.signal.aborted && generation === session.current) { setSearchError(message(cause)); setSearchBusy(false); setResults([]); }
      });
    }, 200);
    return () => { clearTimeout(timer); signal.abort(); };
  }, [bookId, query, searchOpen, searchRevision, visible]);

  const prepare = async () => {
    if (preparingRef.current) return;
    preparingRef.current = true; setPreparing(true);
    const generation = session.current;
    try {
      await rebuildBookIndex(bookId, { onProgress: progress => {
        if (generation !== session.current) return;
        const detail = progress.stage === 'reading' ? '正在读取书内文字' : progress.stage === 'indexing' ? '正在准备书内文字' : '正在准备语义查找';
        setPreparation(current => ({ available: current?.available ?? false, semantic: false, state: 'building', detail }));
      } });
    } catch (cause) {
      if (generation === session.current) Alert.alert('资料准备失败', message(cause));
    } finally {
      preparingRef.current = false; setPreparing(false);
      if (generation === session.current) { await refreshPreparation(generation); setSearchRevision(value => value + 1); }
    }
  };

  const addBookmark = async () => {
    if (bookmarkSavingRef.current) return;
    bookmarkSavingRef.current = true; setBookmarkSaving(true);
    const generation = session.current;
    try {
      if (await onAddBookmark() && generation === session.current) { setTab('bookmarks'); setFeedback('书签已保存'); }
    } finally { bookmarkSavingRef.current = false; setBookmarkSaving(false); }
  };

  const bookmarkRows = annotations.filter(annotation => annotation.kind === 'bookmark').map(annotation => {
    const location = decodeEpubAnchor(annotation.locator);
    const progress = annotation.progression ?? location?.selection?.locations?.totalProgression ?? location?.selection?.locations?.progression;
    const position = annotation.position ?? location?.position;
    return { id: annotation.id, title: annotation.chapter ?? location?.chapter ?? '书签', detail: progress === undefined ? position === undefined ? annotation.quote : '位置 ' + position : '进度 ' + Math.round(Math.min(1, Math.max(0, progress)) * 100) + '%', excerpt: annotation.quote };
  });
  const state = JSON.stringify({
    tab, contents: contents.map((item, index) => ({ id: String(index), title: item.label || '未命名章节', depth: item.depth })),
    contentsStatus: contentsLoaded ? '本书没有目录' : '正在读取目录…', bookmarks: bookmarkRows, bookmarkSaving, feedback,
    searchOpen, query, results: results.map((item, index) => ({ id: item.id, selectionKey: item.selectionKey, title: item.chapter + ' · ' + (index + 1), detail: item.context })), searchBusy, searchError,
    preparationMessage: preparation?.detail ?? '正在读取资料状态…', preparationFailed: preparation?.state === 'failed',
    canPrepare: !preparing && preparation?.state !== 'building',
  });
  const onAction = (action: EpubNavigationAction) => {
    switch (action.action) {
      case 'close': onClose(); break;
      case 'tab': setTab(action.tab); break;
      case 'query': if (action.query !== query) selectableSearchResults.current = null; setQuery(action.query); break;
      case 'searchOpen': selectableSearchResults.current = null; searchNavigationSelection.current = null; setQuery(''); setResults([]); setSearchError(null); setSearchOpen(true); void refreshPreparation(session.current); break;
      case 'searchClose': selectableSearchResults.current = null; setSearchOpen(false); break;
      case 'prepare': void prepare(); break;
      case 'addBookmark': void addBookmark(); break;
      case 'deleteBookmark': {
        const annotation = annotations.find(item => item.id === action.id && item.kind === 'bookmark');
        if (annotation) { const generation = session.current; void onRemoveBookmark(annotation).then(removed => { if (removed && generation === session.current) setFeedback('书签已移除'); }); }
        break;
      }
      case 'selectSearchResult': {
        if (!visible || !searchOpen || searchNavigationSelection.current) break;
        const published = selectableSearchResults.current;
        if (published?.bookId !== bookId) break;
        const matches = published.rows.filter(item => item.id === action.id && item.selectionKey === action.selectionKey);
        const selected = matches.length === 1 ? matches[0] : undefined;
        if (selected?.locator) searchNavigationSelection.current = Object.freeze({ status: 'pending', bookId, id: selected.id, selectionKey: selected.selectionKey, locator: selected.locator });
        break;
      }
      case 'navigate': {
        if (action.source === 'search') {
          const selected = searchNavigationSelection.current;
          // Stale, duplicate and unissued events have no authority over the current panel.
          if (selected?.status !== 'pending' || selected.bookId !== bookId || selected.id !== action.id || selected.selectionKey !== action.selectionKey) break;
          searchNavigationSelection.current = Object.freeze({ ...selected, status: 'consumed' });
          onNavigate(selected.locator);
          break;
        }
        const locator = action.source === 'contents' ? contents[Number(action.id)]?.href : (() => { const annotation = annotations.find(item => item.id === action.id); return annotation?.locator ? JSON.stringify(annotation.locator) : undefined; })();
        if (locator) {
          const selected = searchNavigationSelection.current;
          if (selected) searchNavigationSelection.current = Object.freeze({ ...selected, status: 'consumed' });
          onNavigate(locator);
        } else { onClose(); Alert.alert('无法定位原文', '目标位置无效，请选择其他记录。'); }
        break;
      }
    }
  };
  return { state, onAction };
}
function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
