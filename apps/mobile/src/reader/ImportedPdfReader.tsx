import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppearance } from "../ui/appearance";
import { usePalette, type Palette } from "../ui/theme";
import { NoteSheet } from "../ui/reader/NoteSheet";
import {
  ReaderErrorBanner,
  ReaderLoadingOverlay,
  ReaderOpenErrorOverlay,
} from "../ui/reader/ReaderOverlays";
import { BookNotice } from "../ui/components/BookNotice";
import { NativePdfSurface } from "./pdf/NativePdfSurface";
import { ReaderChrome } from "./ReaderChrome";
import { PdfColorPalette, PdfReaderPanels } from "./pdf/PdfReaderPanels";
import { usePdfReader, type PdfReaderOptions } from "./pdf/usePdfReader";
import { pdfScannedPagesMessage } from "./pdf/pdfReaderMetadata";
import { useReaderExit } from "./useReaderExit";

type Props = PdfReaderOptions & {
  readonly referenceMode?: boolean;
  readonly onBack?: () => void;
};

/** RN owns the shared reading interface; PDFKit retains document rendering and selection. */
export function ImportedPdfReader(props: Props) {
  const reader = usePdfReader(props);
  return <PdfReadingView {...props} reader={reader} />;
}

function PdfReadingView({
  bookId,
  title,
  fileUri,
  referenceMode = false,
  onBack,
  reader,
}: Props & { readonly reader: ReturnType<typeof usePdfReader> }) {
  const router = useRouter();
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const insets = useSafeAreaInsets();
  const { resolvedMode } = useAppearance();
  const [helpVisible, setHelpVisible] = useState(false);
  const exitReader = useReaderExit({
    bookId,
    flushProgress: reader.flushProgress,
    onExit: onBack ?? (() => router.back()),
  });
  const bookmarked = reader.annotations.some(
    (item) =>
      item.kind === "bookmark" &&
      item.locator?.type === "pdf" &&
      item.locator.page === reader.page,
  );
  const annotationJson = useMemo(
    () =>
      JSON.stringify(
        reader.annotations.flatMap((item) => {
          if (
            item.locator?.type !== "pdf" ||
            !Number.isSafeInteger(item.locator.page) ||
            item.locator.page < 1
          )
            return [];
          const rects =
            item.locator.rects?.filter(
              (rect) =>
                [rect.x, rect.y, rect.width, rect.height].every(
                  Number.isFinite,
                ) &&
                rect.width > 0 &&
                rect.height > 0,
            ) ?? [];
          if (!rects.length) return [];
          return [
            {
              id: item.id,
              kind: item.kind,
              color: item.color,
              body: item.body,
              page: item.locator.page,
              rects,
            },
          ];
        }),
      ),
    [reader.annotations],
  );
  const onChromeAction = (
    action: "back" | "bookmark" | "contents" | "settings" | "ask" | "help",
  ) => {
    switch (action) {
      case "back":
        if (reader.questions.referenceMode)
          void reader.questions.returnToQuestion();
        else void exitReader();
        break;
      case "bookmark":
        void reader.toggleBookmark();
        break;
      case "contents":
        reader.setPanel("contents");
        break;
      case "settings":
        reader.setPanel("settings");
        break;
      case "ask":
        reader.ask();
        break;
      case "help":
        setHelpVisible(true);
        break;
    }
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{ statusBarHidden: true, autoHideHomeIndicator: true }}
      />
      <StatusBar hidden style={resolvedMode === "dark" ? "light" : "dark"} />
      {NativePdfSurface ? (
        <NativePdfSurface
          key={bookId + "-" + reader.retry}
          style={styles.pdf}
          uri={fileUri}
          page={reader.page}
          mode={
            reader.preferences?.flow === "scrolled"
              ? "scrolled"
              : reader.preferences
                ? "paginated"
                : "auto"
          }
          dark={resolvedMode === "dark"}
          annotations={annotationJson}
          command={reader.command}
          onPdfEvent={({ nativeEvent }) => {
            if (nativeEvent.type === "selectionAction")
              reader.onSelectionAction(nativeEvent);
            else reader.onEvent(nativeEvent);
          }}
        />
      ) : (
        <ReaderOpenErrorOverlay
          message="当前版本无法打开 PDF，请安装完整版本后重试"
          onRetry={reader.retryOpen}
        />
      )}
      <ReaderChrome
        format="pdf"
        title={title}
        bookmarked={bookmarked}
        referenceMode={reader.questions.referenceMode || referenceMode}
        visible={reader.chromeVisible}
        controlsEnabled={
          !reader.loading && !reader.openError && !reader.questions.busy
        }
        onToggleChrome={() => reader.setChromeVisible((value) => !value)}
        onBack={() => onChromeAction("back")}
        onBookmark={() => onChromeAction("bookmark")}
        onAnnotations={() => onChromeAction("contents")}
        onSettings={() => onChromeAction("settings")}
        onAsk={() => onChromeAction("ask")}
        {...(reader.scannedPageCount > 0
          ? { onHelp: () => onChromeAction("help") }
          : {})}
      />
      {reader.loading && NativePdfSurface ? <ReaderLoadingOverlay /> : null}
      {reader.openError ? (
        <ReaderOpenErrorOverlay
          message={reader.openError}
          onRetry={reader.retryOpen}
        />
      ) : null}
      {reader.error ? (
        <ReaderErrorBanner
          message={reader.error}
          top={insets.top + 58}
          onDismiss={() => reader.setError(null)}
        />
      ) : null}
      <PdfColorPalette
        visible={reader.paletteTarget !== null}
        selected={reader.paletteTarget?.annotation?.color ?? null}
        editing={Boolean(reader.paletteTarget?.annotation)}
        quote={reader.paletteTarget?.quote ?? ""}
        saving={reader.savingAnnotation}
        onPick={(color) => void reader.pickColor(color)}
        onClose={() => {
          if (!reader.savingAnnotation) {
            reader.setPaletteTarget(null);
            reader.clearSelection();
          }
        }}
      />
      <NoteSheet
        visible={reader.noteDraft !== null}
        title={reader.noteDraft?.annotation ? "编辑笔记" : "写笔记"}
        quote={reader.noteDraft?.quote ?? ""}
        body={reader.noteBody}
        saving={reader.savingNote || reader.savingAnnotation}
        onChangeBody={reader.setNoteBody}
        onClose={() => {
          if (!reader.savingNote && !reader.savingAnnotation) {
            reader.setNoteDraft(null);
            reader.setNoteBody("");
          }
        }}
        onSave={() => void reader.saveNote()}
        {...(reader.noteDraft?.annotation
          ? {
              onDelete: () => {
                const annotation = reader.noteDraft?.annotation;
                if (annotation) void reader.removeAnnotation(annotation);
              },
            }
          : {})}
      />
      <PdfReaderPanels
        bookId={bookId}
        title={title}
        panel={reader.panel}
        tab={reader.contentsTab}
        onTab={reader.setContentsTab}
        outline={reader.outline}
        totalPages={reader.total}
        currentPage={reader.page}
        annotations={reader.annotations}
        query={reader.query}
        queryEventCount={reader.queryEventCount}
        onQuery={reader.setQuery}
        searching={reader.searching}
        searchError={reader.searchError}
        searchAvailable={
          reader.textPageCount !== null && reader.textPageCount > 0
        }
        hits={reader.hits}
        preferences={reader.preferences}
        onPreferences={reader.updatePreferences}
        onJump={reader.jumpTo}
        onDeleteBookmark={(annotation) =>
          void reader.removeAnnotation(annotation)
        }
        onAnnotationsChanged={reader.replaceAnnotations}
        onClose={() => reader.setPanel(null)}
      />
      {helpVisible ? (
        <BookNotice
          title="关于这份 PDF"
          message={pdfScannedPagesMessage({
            pageCount: reader.total,
            textPageCount: reader.textPageCount,
            scannedPageCount: reader.scannedPageCount,
          })}
          onAcknowledge={() => setHelpVisible(false)}
        />
      ) : null}
    </View>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.paper },
    pdf: { flex: 1, width: "100%" },
  });
}
