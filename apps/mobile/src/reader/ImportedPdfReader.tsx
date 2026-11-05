import { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppearance } from '../ui/appearance';
import { usePalette, type Palette } from '../ui/theme';
import { NoteSheet } from '../ui/reader/NoteSheet';
import { ReaderErrorBanner, ReaderLoadingOverlay, ReaderOpenErrorOverlay } from '../ui/reader/ReaderOverlays';
import { BookNotice } from '../ui/components/BookNotice';
import { NativePdfSurface } from './pdf/NativePdfSurface';
import { NativePdfChrome, type PdfChromeAction } from './pdf/NativePdfChrome';
import { PdfColorPalette, PdfReaderPanels } from './pdf/PdfReaderPanels';
import { usePdfReader, type PdfReaderOptions } from './pdf/usePdfReader';
import { pdfScannedPagesMessage } from './pdf/pdfReaderMetadata';

type Props = PdfReaderOptions & {
  readonly referenceMode?: boolean;
  readonly onBack?: () => void;
};

/** RN owns state, navigation and data. UIKit supplies PDF rendering and platform controls. */
export function ImportedPdfReader(props: Props) {
  const reader = usePdfReader(props);
  return <PdfReadingView {...props} reader={reader} />;
}

function PdfReadingView({
  bookId, title, fileUri, initialPage, referenceMode = false, onBack, reader,
}: Props & { readonly reader: ReturnType<typeof usePdfReader> }) {
  const router = useRouter();
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const insets = useSafeAreaInsets();
  const { resolvedMode } = useAppearance();
  const [helpVisible, setHelpVisible] = useState(false);
  const bookmarked = reader.annotations.some(
    (item) => item.kind === 'bookmark' && item.locator?.type === 'pdf' && item.locator.page === reader.page,
  );
  const annotationJson = useMemo(() => JSON.stringify(reader.annotations.flatMap((item) => {
    if (item.locator?.type !== 'pdf' || !Number.isSafeInteger(item.locator.page) || item.locator.page < 1) return [];
    const rects = item.locator.rects?.filter((rect) =>
      [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0,
    ) ?? [];
    if (!rects.length) return [];
    return [{ id: item.id, kind: item.kind, color: item.color, body: item.body, page: item.locator.page, rects }];
  })), [reader.annotations]);
  const onChromeAction = (action: PdfChromeAction) => {
    switch (action) {
      case 'back':
        if (reader.questions.referenceMode) void reader.questions.returnToQuestion();
        else void reader.flushProgress().then(saved => {
          if (saved) (onBack ?? (() => router.back()))();
          else Alert.alert('位置与设置尚未保存', '返回后，未保存的阅读位置可能丢失。', [
            { text: '留在阅读页', style: 'cancel' },
            { text: '仍然返回', style: 'destructive', onPress: () => (onBack ?? (() => router.back()))() },
          ]);
        });
        break;
      case 'bookmark': void reader.toggleBookmark(); break;
      case 'contents': reader.setContentsTab('contents'); reader.setPanel('contents'); break;
      case 'settings': reader.setPanel('settings'); break;
      case 'ask': reader.ask(); break;
      case 'help': setHelpVisible(true); break;
    }
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ statusBarHidden: true, autoHideHomeIndicator: true }} />
      <StatusBar hidden style={resolvedMode === 'dark' ? 'light' : 'dark'} />
      {NativePdfSurface ? (
        <NativePdfSurface
          key={bookId + '-' + reader.retry}
          style={styles.pdf}
          uri={fileUri}
          page={initialPage ?? 1}
          mode={reader.preferences?.flow === 'scrolled' ? 'scrolled' : reader.preferences ? 'paginated' : 'auto'}
          dark={resolvedMode === 'dark'}
          annotations={annotationJson}
          command={reader.command}
          onPdfEvent={({ nativeEvent }) => {
            if (nativeEvent.type === 'selectionAction') reader.onSelectionAction(nativeEvent);
            else reader.onEvent(nativeEvent);
          }}
        />
      ) : <ReaderOpenErrorOverlay message="当前版本无法打开 PDF，请安装完整版本后重试" onRetry={reader.retryOpen} />}
      {NativePdfChrome ? (
        <NativePdfChrome
          style={styles.chrome}
          title={title}
          pagePosition={[reader.page, reader.total]}
          bookmarked={bookmarked}
          hasScannedPages={reader.scannedPageCount > 0}
          referenceMode={reader.questions.referenceMode || referenceMode}
          dark={resolvedMode === 'dark'}
          chromeVisible={reader.chromeVisible}
          onChromeAction={(event) => onChromeAction(event.nativeEvent.action)}
        />
      ) : null}
      {reader.loading && NativePdfSurface ? <ReaderLoadingOverlay /> : null}
      {reader.openError ? <ReaderOpenErrorOverlay message={reader.openError} onRetry={reader.retryOpen} /> : null}
      {reader.error ? <ReaderErrorBanner message={reader.error} top={insets.top + 58} onDismiss={() => reader.setError(null)} /> : null}
      <PdfColorPalette
        visible={reader.paletteTarget !== null}
        selected={reader.paletteTarget?.annotation?.color ?? null}
        editing={Boolean(reader.paletteTarget?.annotation)}
        onPick={(color) => void reader.pickColor(color)}
        onDelete={() => reader.paletteTarget?.annotation && void reader.removeAnnotation(reader.paletteTarget.annotation)}
        onClose={() => { reader.setPaletteTarget(null); reader.clearSelection(); }}
      />
      <NoteSheet
        visible={reader.noteDraft !== null}
        title={reader.noteDraft?.annotation ? '编辑笔记' : '写笔记'}
        quote={reader.noteDraft?.quote ?? ''}
        body={reader.noteBody}
        saving={reader.savingNote}
        onChangeBody={reader.setNoteBody}
        onClose={() => { if (!reader.savingNote) reader.setNoteDraft(null); }}
        onSave={() => void reader.saveNote()}
        {...(reader.noteDraft?.annotation ? {
          onDelete: () => {
            const annotation = reader.noteDraft?.annotation;
            if (annotation) void reader.removeAnnotation(annotation);
          },
        } : {})}
      />
      <PdfReaderPanels
        panel={reader.panel}
        tab={reader.contentsTab}
        onTab={reader.setContentsTab}
        outline={reader.outline}
        totalPages={reader.total}
        annotations={reader.annotations}
        query={reader.query}
        queryEventCount={reader.queryEventCount}
        onQuery={reader.setQuery}
        searching={reader.searching}
        searchError={reader.searchError}
        searchAvailable={reader.textPageCount !== null && reader.textPageCount > 0}
        hits={reader.hits}
        preferences={reader.preferences}
        onPreferences={(change) => void reader.updatePreferences(change)}
        onJump={reader.jumpTo}
        onDeleteBookmark={(annotation) => void reader.removeAnnotation(annotation)}
        onClose={() => reader.setPanel(null)}
      />
      {helpVisible ? (
        <BookNotice
          title="关于这份 PDF"
          message={pdfScannedPagesMessage({ pageCount: reader.total, textPageCount: reader.textPageCount, scannedPageCount: reader.scannedPageCount })}
          onAcknowledge={() => setHelpVisible(false)}
        />
      ) : null}
    </View>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.paper },
    pdf: { flex: 1, width: '100%' },
    chrome: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 20 },
  });
}
