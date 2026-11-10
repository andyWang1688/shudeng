import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import type { BookRow } from "@shudeng/core/db";
import { ReaderShell } from "../../src/ui/ReaderShell";
import { ImportedPdfReader } from "../../src/reader/ImportedPdfReader";
import { getDataLayer } from "../../src/platform/db";
import { findBookFile } from "../../src/platform/bookFiles";
import {
  loadBookAnnotations,
  loadBookProgress,
  type BookProgress,
  type ShelfAnnotation,
  type StoredReaderLocator,
} from "../../src/platform/library";
import {
  readerLocatorFromLegacy,
  storedLocatorFromUnknown,
} from "../../src/platform/library/pure";
import { radius, spacing, usePalette, type Palette } from "../../src/ui/theme";

function parseReaderLocator(
  raw: string | string[] | undefined,
): StoredReaderLocator | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    const current = storedLocatorFromUnknown(parsed);
    if (current) return current;
    const pdf = readerLocatorFromLegacy(value, "PDF");
    if (pdf) return pdf;
  } catch {
    // Raw CFI, href and legacy JSON are resolved by the EPUB engine.
  }
  return { type: "epub", cfi: value };
}

export default function ReaderRoute() {
  const params = useLocalSearchParams<{
    id?: string | string[];
    locator?: string | string[];
    quote?: string | string[];
    questionPresentationId?: string | string[];
  }>();
  const router = useRouter();
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const bookId = (Array.isArray(params.id) ? params.id[0] : params.id) ?? "";
  const [book, setBook] = useState<BookRow | null>(null);
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [progress, setProgress] = useState<BookProgress | null>(null);
  const [annotations, setAnnotations] = useState<readonly ShelfAnnotation[]>(
    [],
  );
  const [jump, setJump] = useState<StoredReaderLocator | null>(() =>
    parseReaderLocator(params.locator),
  );
  const [jumpVersion, setJumpVersion] = useState(0);
  const [checked, setChecked] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [openAttempt, setOpenAttempt] = useState(0);
  const loadedAttempt = useRef<string | null>(null);
  const annotationsVersion = useRef(0);
  const currentBookId = useRef(bookId);
  currentBookId.current = bookId;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++annotationsVersion.current;
    };
  }, []);
  const acceptAnnotations = useCallback(
    (rows: readonly ShelfAnnotation[]) => {
      if (!mounted.current || currentBookId.current !== bookId) return;
      ++annotationsVersion.current;
      setAnnotations(rows);
    },
    [bookId],
  );
  const referenceMode = Boolean(params.questionPresentationId);
  const referenceQuote = Array.isArray(params.quote)
    ? params.quote[0]
    : params.quote;

  useEffect(() => {
    setJump(parseReaderLocator(params.locator));
  }, [params.locator]);

  useEffect(() => {
    const attempt = bookId + ":" + openAttempt;
    if (loadedAttempt.current === attempt) return;
    let active = true;
    setChecked(false);
    setFailure(null);
    setBook(null);
    setFileUri(null);
    void (async () => {
      try {
        if (!bookId) throw new Error("缺少书籍标识");
        const layer = await getDataLayer();
        const row = await layer.store.getBook(bookId);
        if (!row) throw new Error("这本书不在书架上，可能已被移除");
        const file = findBookFile(row);
        if (!file) throw new Error("书籍文件缺失，请重新导入");
        const [savedProgress, loadedAnnotations] = await Promise.all([
          loadBookProgress(bookId),
          loadBookAnnotations(bookId),
        ]);
        if (!active) return;
        loadedAttempt.current = attempt;
        setBook(row);
        setFileUri(file.uri);
        setProgress(savedProgress);
        setAnnotations(loadedAnnotations);
      } catch (cause) {
        if (active)
          setFailure(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (active) setChecked(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [bookId, openAttempt]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const version = ++annotationsVersion.current;
      void loadBookAnnotations(bookId)
        .then((rows) => {
          if (
            active &&
            mounted.current &&
            currentBookId.current === bookId &&
            annotationsVersion.current === version
          )
            setAnnotations(rows);
        })
        .catch(() => {
          /* Initial open reports failures. Returning from a sheet must keep the current document. */
        });
      return () => {
        active = false;
        ++annotationsVersion.current;
      };
    }, [bookId]),
  );

  const jumpToLocator = (locator: StoredReaderLocator) => {
    setJump(locator);
    setJumpVersion((value) => value + 1);
  };

  if (!checked)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={palette.lamp} />
        <Text style={styles.hint}>打开书籍…</Text>
      </View>
    );
  if (failure || !book || !fileUri)
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <View style={styles.errorToolbar}>
          <Pressable accessibilityRole="button" onPress={() => router.back()}>
            <Text style={styles.back}>‹ 书架</Text>
          </Pressable>
          <Text style={styles.errorTitle}>无法打开书籍</Text>
        </View>
        <View style={styles.center}>
          <Text style={styles.errorDetail}>{failure ?? "书籍文件不可用"}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setOpenAttempt((value) => value + 1)}
            style={styles.errorButton}
          >
            <Text style={styles.errorButtonText}>重试</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={styles.errorButton}
          >
            <Text style={styles.errorButtonText}>返回书架</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );

  if (book.format === "pdf") {
    const locator =
      jump?.type === "pdf"
        ? jump
        : progress?.locator.type === "pdf"
          ? progress.locator
          : undefined;
    return (
      <ImportedPdfReader
        key={bookId}
        bookId={bookId}
        title={book.title}
        fileUri={fileUri}
        referenceMode={referenceMode}
        initialAnnotations={annotations}
        onAnnotationsChanged={acceptAnnotations}
        {...(locator
          ? { initialPage: locator.page, initialLocator: locator }
          : {})}
        onBack={() => router.back()}
      />
    );
  }
  const initialLocation =
    jump?.type === "epub"
      ? jump.cfi
      : progress?.locator.type === "epub"
        ? progress.locator.cfi
        : undefined;
  return (
    <ReaderShell
      key={`${bookId}-epub-${jumpVersion}`}
      bookId={bookId}
      initialLocation={initialLocation}
      title={book.title}
      openOverride={{
        format: "epub",
        title: book.title,
        fileUri,
        mimeType: "application/epub+zip",
      }}
      initialAnnotations={annotations}
      referenceMode={referenceMode}
      {...(referenceQuote ? { referenceQuote } : {})}
      onJumpToLocator={jumpToLocator}
      onAnnotationsChanged={acceptAnnotations}
    />
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      backgroundColor: palette.paper,
      padding: spacing.lg,
    },
    hint: { fontSize: 13, color: palette.ink3 },
    safeArea: { flex: 1, backgroundColor: palette.paper },
    errorToolbar: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      padding: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.line,
    },
    back: { fontSize: 15, color: palette.lamp },
    errorTitle: { fontSize: 16, fontWeight: "600", color: palette.ink },
    errorDetail: {
      fontSize: 13,
      lineHeight: 20,
      color: palette.ink2,
      textAlign: "center",
    },
    errorButton: {
      marginTop: spacing.sm,
      borderRadius: radius.field,
      backgroundColor: palette.paperDeep,
      paddingHorizontal: spacing.lg,
      paddingVertical: 10,
    },
    errorButtonText: { fontSize: 13, fontWeight: "600", color: palette.ink },
  });
}
