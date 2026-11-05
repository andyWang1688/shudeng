import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ReaderChrome } from '../reader/ReaderChrome';
import { ReaderWebView, type ReaderOpenOverride } from '../reader/ReaderWebView';
import { NativeEpubSurface } from '../reader/NativeEpubSurface';
import { NativeEpubNavigation } from '../reader/NativeEpubNavigation';
import { EpubNavigationPanel } from '../reader/EpubNavigationPanel';
import { useReaderState } from '../reader/useReaderState';
import type { ShelfAnnotation, StoredReaderLocator } from '../platform/library';
import { NoteSheet } from './reader/NoteSheet';
import { HighlightPanel, ReaderNavigationPanel, ReaderSearchPanel, ReaderSettingsPanel } from './reader/ReaderPanels';
import { ReaderErrorBanner, ReaderLoadingOverlay, ReaderNoticeToast, ReaderOpenErrorOverlay } from './reader/ReaderOverlays';
import { SelectionBar } from './reader/SelectionBar';
import { usePalette, type Palette } from './theme';
import { AppearanceOverride } from './appearance';
import { useReaderQuestions } from './reader-question/ReaderQuestionProvider';

type ReaderShellProps = {
  readonly bookId: string;
  readonly initialLocation: string | undefined;
  readonly title?: string;
  readonly openOverride: ReaderOpenOverride | undefined;
  readonly initialAnnotations?: readonly ShelfAnnotation[];
  readonly onJumpToLocator?: (locator: StoredReaderLocator) => void;
  readonly onAnnotationsChanged?: (annotations: readonly ShelfAnnotation[]) => void;
  readonly referenceMode?: boolean;
  readonly referenceQuote?: string;
};

export function ReaderShell(props: ReaderShellProps) {
  const reader = useReaderState({
    bookId: props.bookId,
    ...(props.title === undefined ? {} : { title: props.title }),
    ...(props.initialLocation === undefined ? {} : { initialLocation: props.initialLocation }),
    ...(props.initialAnnotations === undefined ? {} : { initialAnnotations: props.initialAnnotations }),
    ...(props.onAnnotationsChanged === undefined ? {} : { onAnnotationsChanged: props.onAnnotationsChanged }),
  });
  return <AppearanceOverride mode={reader.readerTheme}><ReaderContent {...props} reader={reader} /></AppearanceOverride>;
}

function ReaderContent({ bookId, initialLocation, title, openOverride, referenceMode = false, referenceQuote, reader }: ReaderShellProps & { readonly reader: ReturnType<typeof useReaderState> }) {
  const router = useRouter();
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const insets = useSafeAreaInsets();
  const [chromeVisible, setChromeVisible] = useState(true);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const questions = useReaderQuestions({ bookId, format: 'epub', title, theme: reader.readerTheme,
    getLocator: reader.getLatestLocator, navigate: reader.navigateReference, flushProgress: reader.flushProgress, documentFailed: reader.readerError !== null });
  const initialReference = useRef<string | null>(null);
  const viewingReference = questions.referenceMode || referenceMode;

  useLayoutEffect(() => {
    reader.setSelectionActionsEnabled(!viewingReference);
    if (viewingReference && !reader.editingAnnotation) { setNoteOpen(false); reader.setNoteBody(''); }
  }, [reader.editingAnnotation, reader.setNoteBody, reader.setSelectionActionsEnabled, viewingReference]);

  useEffect(() => {
    if (!referenceMode || !referenceQuote || !initialLocation || !reader.readerReady) return;
    const identity = bookId + ':' + initialLocation;
    if (initialReference.current === identity) return;
    initialReference.current = identity;
    void reader.navigateReference({ operationId: 'initial-reference:' + identity, locator: { type: 'epub', cfi: initialLocation }, quote: referenceQuote, ordinal: 0, id: '', citation: true }).then(receipt => {
      if (receipt.status === 'failed') reader.setError(receipt.message ?? '引用位置未能确认');
    });
  }, [bookId, initialLocation, reader.navigateReference, reader.readerReady, reader.setError, referenceMode, referenceQuote]);

  useEffect(() => {
    if (reader.selectedAnnotation?.kind !== 'note' || reader.newHighlightId === reader.selectedAnnotation.id) return;
    reader.setEditingAnnotation(reader.selectedAnnotation);
    reader.setNoteBody(reader.selectedAnnotation.body ?? '');
    reader.setSelectedAnnotation(null);
    setNoteOpen(true);
  }, [reader.selectedAnnotation, reader.newHighlightId, reader.setEditingAnnotation, reader.setNoteBody, reader.setSelectedAnnotation]);

  const closeNote = () => {
    setNoteOpen(false);
    reader.setNoteBody('');
    reader.setEditingAnnotation(null);
    reader.setNoteSelection(null);
  };
  const navigate = (locator: string) => {
    setNavigationOpen(false);
    setSearchOpen(false);
    reader.readerRef.current?.goTo(locator);
  };
  const ask = (includeSelection: boolean) => {
    if (questions.busy) return;
    if (includeSelection && viewingReference) { reader.cancelSelection(); return; }
    const selection = includeSelection ? reader.selection : null;
    questions.ask(selection ?? undefined);
    if (selection) reader.cancelSelection();
  };
  const closeReader = async () => {
    if (questions.referenceMode) { await questions.returnToQuestion(); return; }
    const saved = await reader.flushProgress();
    if (saved) router.back();
    else Alert.alert('位置与设置尚未保存', '返回书架后，未保存的变更可能丢失。', [{ text: '留在阅读页', style: 'cancel' }, { text: '仍然返回', style: 'destructive', onPress: () => router.back() }]);
  };

  return <View style={styles.screen}>
    <View style={[styles.content, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {reader.preferencesLoaded ? <ReaderWebView
        key={bookId + '-' + reader.readerReload}
        ref={reader.readerRef} bookId={bookId} initialLocation={initialLocation} openOverride={openOverride}
        initialAnnotations={reader.seedAnnotations} selectionBar={false} selectionActionsEnabled={!viewingReference} theme={reader.readerTheme}
        fontScale={reader.preferences.fontScale} flow={reader.preferences.flow}
        onTap={() => setChromeVisible(value => !value)} onEvent={reader.onReaderEvent}
      /> : null}
      {!reader.readerReady && !reader.readerError ? <ReaderLoadingOverlay /> : null}
      {reader.readerError ? <ReaderOpenErrorOverlay message={reader.readerError} onRetry={reader.retryReader} /> : null}
    </View>
    <ReaderChrome title={title ?? '阅读'} chapter={reader.chapter} progressText={Math.floor(reader.progress * 100) + '%'}
      referenceMode={viewingReference} visible={chromeVisible} onBack={() => void closeReader()}
      controlsEnabled={reader.readerReady && !questions.busy} onToggleChrome={() => setChromeVisible(value => !value)}
      onAnnotations={() => setNavigationOpen(true)} onSettings={() => setSettingsOpen(true)} onAsk={() => ask(false)}
      onBookmark={() => void reader.saveBookmark()} bookmarked={reader.bookmarked}
    />
    {reader.error ? <ReaderErrorBanner message={reader.error} top={insets.top + 58} onDismiss={() => reader.setError(null)} /> : null}
    {reader.notice ? <ReaderNoticeToast message={reader.notice} top={insets.top + 58} /> : null}
    {reader.selection && !noteOpen && !viewingReference ? <SelectionBar quote={reader.selection.quote} rects={reader.selection.rects} onHighlight={() => reader.highlightSelection()} onNote={() => { if (reader.beginNoteSelection()) setNoteOpen(true); }} onAsk={() => ask(true)} onCancel={reader.cancelSelection} /> : null}
    {NativeEpubNavigation ? <EpubNavigationPanel bookId={bookId} visible={navigationOpen} contents={reader.contents} contentsLoaded={reader.contentsLoaded}
      annotations={reader.annotations} onClose={() => setNavigationOpen(false)} onNavigate={navigate}
      onAddBookmark={() => reader.saveBookmark('add')} onRemoveBookmark={reader.removeAnnotation} /> : <ReaderNavigationPanel visible={navigationOpen} contents={reader.contents} bookmarks={reader.annotations.filter(value => value.kind === 'bookmark')}
      onClose={() => setNavigationOpen(false)} onNavigate={navigate} onDelete={annotation => void reader.removeAnnotation(annotation)}
      onBookmark={() => void reader.saveBookmark()} bookmarked={reader.bookmarked}
      onSearch={() => { setNavigationOpen(false); setSearchOpen(true); }} />}
    <ReaderSearchPanel visible={searchOpen} items={reader.searchResults} busy={reader.searchBusy} error={reader.searchError} onSearch={reader.search} onNavigate={navigate} onClose={() => { setSearchOpen(false); reader.search(''); }} />
    <ReaderSettingsPanel visible={settingsOpen} preferences={reader.preferences} curlAvailable={NativeEpubSurface !== null} onClose={() => setSettingsOpen(false)} onApply={reader.applyPreferences} />
    <HighlightPanel annotation={reader.selectedAnnotation} compact={reader.newHighlightId === reader.selectedAnnotation?.id} onClose={() => reader.setSelectedAnnotation(null)}
      onColor={color => { if (reader.selectedAnnotation) void reader.changeHighlightColor(reader.selectedAnnotation, color, reader.newHighlightId === reader.selectedAnnotation.id); }}
      onRemove={() => { if (reader.selectedAnnotation) void reader.removeAnnotation(reader.selectedAnnotation); }} />
    <NoteSheet visible={noteOpen} title={reader.editingAnnotation ? '编辑笔记' : '写笔记'}
      quote={reader.editingAnnotation?.quote ?? reader.noteSelection?.quote ?? reader.selection?.quote ?? ''} body={reader.noteBody} saving={reader.savingNote}
      onChangeBody={reader.setNoteBody} onClose={closeNote} onSave={() => { void reader.saveNote().then(saved => { if (saved) setNoteOpen(false); }); }}
      {...(reader.editingAnnotation ? { onDelete: () => { if (reader.editingAnnotation) void reader.removeAnnotation(reader.editingAnnotation).then(deleted => { if (deleted) closeNote(); }); } } : {})} />
  </View>;
}
function createStyles(palette: Palette) { return StyleSheet.create({ screen: { flex: 1, backgroundColor: palette.paper }, content: { flex: 1, backgroundColor: palette.paper } }); }
