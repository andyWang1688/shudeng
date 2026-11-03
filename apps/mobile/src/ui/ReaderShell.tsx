import { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ReaderChrome } from '../reader/ReaderChrome';
import { ReaderWebView } from '../reader/ReaderWebView';
import { useReaderState } from '../reader/useReaderState';
import type { ShelfAnnotation, StoredReaderLocator } from '../platform/library';
import { AnnotationSheet } from './reader/AnnotationSheet';
import { NoteSheet } from './reader/NoteSheet';
import {
  ReaderErrorBanner,
  ReaderLoadingOverlay,
  ReaderNoticeToast,
  ReaderOpenErrorOverlay,
} from './reader/ReaderOverlays';
import { SelectionBar } from './reader/SelectionBar';
import { usePalette, type Palette } from './theme';

type ReaderShellProps = {
  readonly bookId: string;
  readonly initialLocation: string | undefined;
  readonly title?: string;
  readonly openOverride:
    | undefined
    | {
        readonly format: 'epub' | 'pdf';
        readonly title: string;
        readonly dataBase64: string;
        readonly mimeType: string;
      };
  readonly initialAnnotations?: readonly ShelfAnnotation[];
  readonly onJumpToLocator?: (locator: StoredReaderLocator) => void;
  readonly onAnnotationsChanged?: (annotations: readonly ShelfAnnotation[]) => void;
  /** 从 AI 引用进入：左上角显示「返回问答」。 */
  readonly referenceMode?: boolean;
};

/**
 * 阅读器壳层：只编排 WebView / chrome / 覆盖层与路由跳转；
 * 进度、标注、选区与持久化在 useReaderState，UI 细节在 ui/reader/*。
 */
export function ReaderShell({
  bookId,
  initialLocation,
  title,
  openOverride,
  initialAnnotations,
  onJumpToLocator,
  onAnnotationsChanged,
  referenceMode = false,
}: ReaderShellProps) {
  const router = useRouter();
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const insets = useSafeAreaInsets();
  const [chromeVisible, setChromeVisible] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const reader = useReaderState({
    bookId,
    ...(title !== undefined ? { title } : {}),
    ...(initialLocation !== undefined ? { initialLocation } : {}),
    ...(initialAnnotations !== undefined ? { initialAnnotations } : {}),
    ...(onAnnotationsChanged !== undefined ? { onAnnotationsChanged } : {}),
  });

  const jumpTo = (annotation: ShelfAnnotation) => {
    if (!annotation.locator || !onJumpToLocator) return;
    setPanelOpen(false);
    onJumpToLocator(annotation.locator);
  };

  const askAboutSelection = () => {
    const locator = reader.selection?.locator ?? reader.getLatestLocator();
    router.push({
      pathname: '/book-chat',
      params: {
        bookId,
        theme: reader.readerTheme,
        ...(title ? { bookTitle: title } : {}),
        ...(reader.selection ? { selectionQuote: reader.selection.quote } : {}),
        ...(locator ? { locator: JSON.stringify(locator) } : {}),
      },
    });
  };

  const askAboutBook = () => {
    const locator = reader.getLatestLocator();
    router.push({
      pathname: '/book-chat',
      params: {
        bookId,
        theme: reader.readerTheme,
        ...(title ? { bookTitle: title } : {}),
        ...(locator ? { locator: JSON.stringify(locator) } : {}),
      },
    });
  };

  const showMoreMenu = () => {
    Alert.alert('阅读选项', undefined, [
      { text: '添加书签', onPress: () => void reader.saveBookmark() },
      { text: '标注与书签', onPress: () => setPanelOpen(true) },
      { text: '取消', style: 'cancel' },
    ]);
  };

  const saveNote = async () => {
    if (await reader.saveNote()) setNoteOpen(false);
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.content, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <ReaderWebView
          key={`${bookId}-${reader.readerReload}`}
          ref={reader.readerRef}
          bookId={bookId}
          initialLocation={initialLocation}
          openOverride={openOverride}
          initialAnnotations={reader.seedAnnotations}
          selectionBar={false}
          theme={reader.readerTheme}
          onTap={() => setChromeVisible((value) => !value)}
          onEvent={reader.onReaderEvent}
        />
        {!reader.readerReady && !reader.readerError ? <ReaderLoadingOverlay /> : null}
        {reader.readerError ? <ReaderOpenErrorOverlay message={reader.readerError} onRetry={reader.retryReader} /> : null}
      </View>

      <ReaderChrome
        title={title ?? '阅读'}
        chapter={reader.chapter}
        progressText={`${Math.round(reader.progress * 100)}%`}
        referenceMode={referenceMode}
        visible={chromeVisible}
        annotationCount={reader.annotations.length}
        onBack={() => router.back()}
        onAnnotations={() => setPanelOpen(true)}
        onMore={showMoreMenu}
        onAsk={askAboutBook}
      />

      {reader.error ? (
        <ReaderErrorBanner message={reader.error} top={insets.top + 58} onDismiss={() => reader.setError(null)} />
      ) : null}
      {reader.notice ? <ReaderNoticeToast message={reader.notice} top={insets.top + 58} /> : null}

      {reader.selection ? (
        <SelectionBar
          quote={reader.selection.quote}
          onHighlight={reader.highlightSelection}
          onNote={() => {
            reader.setNoteBody('');
            setNoteOpen(true);
          }}
          onAsk={askAboutSelection}
          onCancel={reader.cancelSelection}
        />
      ) : null}

      <AnnotationSheet
        visible={panelOpen}
        annotations={reader.annotations}
        onClose={() => setPanelOpen(false)}
        onJump={jumpTo}
        onDelete={(annotation) => void reader.removeAnnotation(annotation)}
      />
      <NoteSheet
        visible={noteOpen}
        quote={reader.selection?.quote ?? ''}
        body={reader.noteBody}
        saving={reader.savingNote}
        onChangeBody={reader.setNoteBody}
        onClose={() => setNoteOpen(false)}
        onSave={() => void saveNote()}
      />
    </View>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.paper },
    content: { flex: 1, backgroundColor: palette.paper },
  });
}
