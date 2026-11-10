import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type { BookRow } from "@shudeng/core/db";
import { getDataLayer } from "../platform/db";
import { findBookFile } from "../platform/bookFiles";
import {
  loadBookAnnotations,
  type ShelfAnnotation,
  type AnnotationUpdate,
} from "../platform/library";
import { BookAnnotationsContent } from "./annotations/BookAnnotationsContent";
import { BookNotice } from "./components/BookNotice";
import { EmptyState } from "./components/EmptyState";
import { ReaderPanel } from "./reader/ReaderPanel";
import { usePalette } from "./theme";

type Snapshot = {
  readonly book: BookRow;
  readonly annotations: readonly ShelfAnnotation[];
};

/** A book's retained annotations can be opened without its original file. */
export function BookAnnotationsScreen({ bookId }: { readonly bookId: string }) {
  const router = useRouter();
  const palette = usePalette();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);
  const focused = useRef(false);
  const generation = useRef(0);
  const currentBookId = useRef(bookId);
  currentBookId.current = bookId;
  const current = useRef(snapshot);
  current.current = snapshot;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++generation.current;
    };
  }, []);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      setActive(true);
      const request = ++generation.current;
      const ownsRequest = () =>
        mounted.current && focused.current && generation.current === request;
      setLoading(true);
      setFailure(null);
      void (async () => {
        try {
          if (!bookId) throw new Error("缺少书籍标识");
          const layer = await getDataLayer();
          const book = await layer.store.getBook(bookId);
          if (!book) throw new Error("这本书及其记录已不存在");
          const annotations = await loadBookAnnotations(bookId);
          if (ownsRequest()) {
            const next = { book, annotations };
            current.current = next;
            setSnapshot(next);
          }
        } catch (cause) {
          if (ownsRequest())
            setFailure(cause instanceof Error ? cause.message : String(cause));
        } finally {
          if (ownsRequest()) setLoading(false);
        }
      })();
      return () => {
        focused.current = false;
        setActive(false);
        setNotice(null);
        ++generation.current;
      };
    }, [bookId, attempt]),
  );

  const onChanged = (update: AnnotationUpdate) => {
    if (
      !mounted.current ||
      currentBookId.current !== bookId ||
      current.current?.book.id !== bookId
    )
      return;
    ++generation.current;
    const annotations =
      typeof update === "function"
        ? update(current.current.annotations)
        : update;
    const next = { book: current.current.book, annotations };
    current.current = next;
    setSnapshot(next);
    setLoading(false);
  };
  const onNavigate = (annotation: ShelfAnnotation) => {
    const book = current.current?.book;
    if (
      !focused.current ||
      currentBookId.current !== bookId ||
      !book ||
      book.id !== bookId
    )
      return;
    if (!current.current?.annotations.some((item) => item.id === annotation.id))
      return;
    if (!annotation.locator) {
      setNotice("这条旧记录缺少阅读位置，内容仍可查看和导出。");
      return;
    }
    if (book.removedAt !== null || !findBookFile(book)) {
      setNotice(
        "原书文件不可用，标注仍保留。重新导入同一个文件后即可回到原文。",
      );
      return;
    }
    router.replace({
      pathname: "/reader/[id]",
      params: { id: book.id, locator: JSON.stringify(annotation.locator) },
    });
  };
  return (
    <View style={styles.screen}>
      <ReaderPanel
        visible
        title={snapshot?.book.title ?? "标注"}
        onClose={() => router.back()}
        testID="book-annotations-panel"
      >
        {({ canInteract }) =>
          loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={palette.lamp} />
            </View>
          ) : failure ? (
            <EmptyState
              title="标注读取失败"
              description={failure}
              symbol="exclamationmark.triangle"
              actionLabel="重试"
              onAction={() => {
                if (canInteract()) setAttempt((value) => value + 1);
              }}
            />
          ) : snapshot ? (
            <BookAnnotationsContent
              bookId={bookId}
              title={snapshot.book.title}
              format={snapshot.book.format === "pdf" ? "PDF" : "EPUB"}
              annotations={snapshot.annotations}
              active={active}
              canInteract={canInteract}
              onNavigate={onNavigate}
              onChanged={onChanged}
            />
          ) : null
        }
      </ReaderPanel>
      {notice ? (
        <BookNotice
          title="无法回到原文"
          message={notice}
          onAcknowledge={() => setNotice(null)}
        />
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
