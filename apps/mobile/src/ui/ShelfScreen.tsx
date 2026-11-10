import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ListRenderItemInfo,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { MenuView } from "@expo/ui/community/menu";
import { initializeDatabase } from "../platform/db";
import {
  deleteShelfBook,
  importBookFromPicker,
  loadShelfBooks,
  migrateLegacyLibraryIfNeeded,
  removeShelfBook,
  type BookImportProgress,
  type ShelfBookRecord,
} from "../platform/library";
import { BookCover } from "./components/BookCover";
import {
  importFailureNotice,
  requestPdfImportConfirmation,
  type PdfImportConfirmation,
  type PdfImportPresentation,
} from "../platform/library/pdfImport";
import { BookNotice } from "./components/BookNotice";
import { BookActionSheet } from "./components/BookActionSheet";
import { EmptyState } from "./components/EmptyState";
import { PageHeading, PageSearch } from "./components/PageChrome";
import { useHaptics } from "./components/useHaptics";
import { useTabInteractionLock } from "./tabInteraction";
import { spacing, type as typeScale, usePalette, type Palette } from "./theme";

interface RemovalRequest {
  readonly bookId: string;
  readonly title: string;
  readonly permanent: boolean;
}

export function ShelfScreen() {
  const router = useRouter();
  const haptics = useHaptics();
  const { width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const availableWidth = width - insets.left - insets.right;
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [books, setBooks] = useState<readonly ShelfBookRecord[]>([]);
  const list = useRef<FlatList<ShelfBookRecord>>(null);
  const [query, setQuery] = useState("");
  const scrollOffset = useRef(0);
  const changeQuery = (value: string) => {
    scrollOffset.current = 0;
    list.current?.scrollToOffset({ offset: 0, animated: false });
    setQuery(value);
  };
  const clearSearch = () => changeQuery("");
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  useTabInteractionLock(importing);
  const [importProgress, setImportProgress] =
    useState<BookImportProgress | null>(null);
  const importController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const focused = useRef(false);
  const loadGeneration = useRef(0);
  const activeShelfScope = useRef(false);
  const [order, setOrder] = useState<"recent" | "title">("recent");
  const [showingRemoved, setShowingRemoved] = useState(false);
  const [bookMenu, setBookMenu] = useState<ShelfBookRecord | null>(null);
  const menuOwner = useRef<ShelfBookRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const [removalRequest, setRemovalRequest] = useState<RemovalRequest | null>(
    null,
  );
  const [pdfConfirmation, setPdfConfirmation] = useState<{
    readonly notice: PdfImportConfirmation;
    readonly decide: (accepted: boolean) => void;
    readonly presentation: PdfImportPresentation;
  } | null>(null);
  const [removalFailure, setRemovalFailure] = useState<{
    id: number;
    request: RemovalRequest;
    message: string;
  } | null>(null);
  const removalFailureId = useRef(0);
  const removalInFlight = useRef(false);

  const load = useCallback(async (onlyRemoved = activeShelfScope.current) => {
    if (
      !mounted.current ||
      !focused.current ||
      onlyRemoved !== activeShelfScope.current
    )
      return;
    const generation = ++loadGeneration.current;
    const current = () =>
      mounted.current &&
      focused.current &&
      loadGeneration.current === generation &&
      activeShelfScope.current === onlyRemoved;
    setLoading(true);
    setError(null);
    try {
      const database = await initializeDatabase();
      if (!current()) return;
      if (!database.ok) {
        setError(`本地数据库不可用：${database.detail}`);
        return;
      }
      const migration = await migrateLegacyLibraryIfNeeded();
      if (!current()) return;
      if (migration.failures > 0)
        setNotice(`旧版书库有 ${migration.failures} 条记录未能迁移`);
      const next = await loadShelfBooks({ onlyRemoved });
      if (current()) setBooks(next);
    } catch (cause) {
      if (!current()) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(
        message.startsWith("旧书库") ? message : `书架加载失败：${message}`,
      );
    } finally {
      if (current()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++loadGeneration.current;
      importController.current?.abort();
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      activeShelfScope.current = showingRemoved;
      void load(showingRemoved);
      return () => {
        focused.current = false;
        menuOwner.current = null;
        setBookMenu(null);
        ++loadGeneration.current;
      };
    }, [load, showingRemoved]),
  );

  const needle = query.trim().toLowerCase();
  const matches =
    needle.length === 0
      ? books
      : books.filter(
          (book) =>
            book.title.toLowerCase().includes(needle) ||
            (book.author ?? "").toLowerCase().includes(needle),
        );
  // "最近阅读" preserves the library's catalog order.
  const filtered =
    order === "title"
      ? [...matches].sort(
          (a, b) =>
            a.title.localeCompare(b.title, "zh-Hans-CN", { numeric: true }) ||
            a.id.localeCompare(b.id),
        )
      : matches;
  const columns =
    fontScale > 1.4 || availableWidth < 340 ? 1 : availableWidth > 680 ? 3 : 2;
  const cardWidth =
    (Math.min(availableWidth, 900) - spacing.screen * 2 - (columns - 1) * 26) /
    columns;

  const handleImport = async () => {
    if (
      !mounted.current ||
      !focused.current ||
      importController.current ||
      importing ||
      removalInFlight.current
    )
      return;
    setImporting(true);
    try {
      const controller = new AbortController();
      importController.current = controller;
      const result = await importBookFromPicker({
        signal: controller.signal,
        onProgress: setImportProgress,
        confirmScannedPdf: (info) =>
          requestPdfImportConfirmation(
            info,
            controller.signal,
            (notice, decide, presentation) =>
              setPdfConfirmation({ notice, decide, presentation }),
            () => {
              if (mounted.current) setPdfConfirmation(null);
            },
          ),
      });
      if (result.status === "imported") {
        haptics("success");
        setShowingRemoved(false);
        await load(false);
        setImportNotice({
          title: result.isDuplicate ? "书籍已在书架" : "已加入书架",
          message: result.isDuplicate
            ? "相同文件复用已有书籍、进度和记录；不同字节的同名文件按另一本书处理。"
            : result.book.title,
        });
      }
    } catch (cause) {
      if (!importController.current?.signal.aborted)
        setImportNotice(importFailureNotice(cause));
    } finally {
      importController.current = null;
      setImportProgress(null);
      setImporting(false);
    }
  };

  const openBook = (book: ShelfBookRecord) => {
    if (removalInFlight.current) return;
    if (book.removed) {
      openAnnotations(book);
      return;
    }
    haptics();
    router.push({ pathname: "/reader/[id]", params: { id: book.id } });
  };
  const openAnnotations = (book: ShelfBookRecord) => {
    if (!focused.current || removalInFlight.current) return;
    router.push({
      pathname: "/book-annotations/[id]",
      params: { id: book.id },
    });
  };
  const showBookMenu = (book: ShelfBookRecord) => {
    if (
      !focused.current ||
      importing ||
      removalInFlight.current ||
      removalRequest ||
      importNotice
    )
      return;
    menuOwner.current = book;
    setBookMenu(book);
  };
  const chooseBookAction = (book: ShelfBookRecord, action: () => void) => {
    if (!focused.current || menuOwner.current !== book) return;
    menuOwner.current = null;
    setBookMenu(null);
    action();
  };

  const askDelete = (book: ShelfBookRecord) => {
    if (
      importing ||
      importNotice ||
      removalRequest ||
      removalFailure ||
      removalInFlight.current
    )
      return;
    setRemovalRequest({
      bookId: book.id,
      title: book.title,
      permanent: Boolean(book.removed),
    });
  };

  const confirmRemoval = (request: RemovalRequest) => {
    setRemovalRequest(null);
    setRemovalFailure(null);
    if (removalInFlight.current) return;
    removalInFlight.current = true;
    void Promise.resolve()
      .then(() =>
        request.permanent
          ? deleteShelfBook(request.bookId)
          : removeShelfBook(request.bookId),
      )
      .catch((cause: unknown) => {
        if (mounted.current)
          setRemovalFailure({
            id: ++removalFailureId.current,
            request,
            message: cause instanceof Error ? cause.message : String(cause),
          });
      })
      .finally(() => {
        removalInFlight.current = false;
        if (mounted.current) void load();
      });
  };

  const renderBook = useCallback(
    ({ item: book }: ListRenderItemInfo<ShelfBookRecord>) => (
      <View style={[styles.bookCard, { width: cardWidth }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`打开${book.title}`}
          onPress={() => openBook(book)}
          onLongPress={() => showBookMenu(book)}
          android_ripple={{ color: palette.line }}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <BookCover
            title={book.title}
            author={book.author}
            format={book.format}
            coverUri={book.coverUri}
            width={cardWidth}
            height={cardWidth * 1.4}
          />
          <Text
            style={[styles.bookTitle, { paddingRight: 36 }]}
            numberOfLines={2}
          >
            {book.title}
          </Text>
          <View style={styles.bookMeta}>
            <Text style={styles.bookAuthor} numberOfLines={1}>
              {book.author ?? "作者未知"}
            </Text>
            {!book.removed && (
              <Text style={styles.bookProgress}>
                {book.progressPercent === null
                  ? "未读"
                  : `${book.progressPercent}%`}
              </Text>
            )}
          </View>
          {book.removed ? (
            <Text style={styles.removed}>原书已移除，记录仍保留</Text>
          ) : book.progressPercent !== null && book.progressPercent > 0 ? (
            <View
              style={styles.track}
              accessible
              accessibilityLabel={`阅读进度 ${book.progressPercent}%`}
            >
              <View
                style={[
                  styles.fill,
                  {
                    width: `${Math.min(100, Math.max(0, book.progressPercent))}%`,
                  },
                ]}
              />
            </View>
          ) : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={book.title + "的更多操作"}
          onPress={() => showBookMenu(book)}
          style={[styles.bookMenu, { top: cardWidth * 1.4 + 2 }]}
        >
          <SymbolView name="ellipsis" size={18} tintColor={palette.ink2} />
        </Pressable>
      </View>
    ),
    [cardWidth, palette.line, styles, openBook, askDelete],
  );

  const listHeader = (
    <View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error && books.length > 0 ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {importing ? (
        <View style={styles.importStatus}>
          <Text style={styles.notice}>
            {importProgress
              ? `${importProgress.stage === "reading" ? "正在读取书籍" : importProgress.stage === "indexing" ? "正在准备问答资料" : "正在准备语义资料"}${importProgress.total > 0 ? ` · ${importProgress.completed}/${importProgress.total}` : ""}`
              : "请选择要导入的书籍"}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="取消导入"
            onPress={() => importController.current?.abort()}
          >
            <Text style={styles.sortText}>取消</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.section}>
        <Text style={styles.count}>
          {loading ? "" : `${filtered.length} 本`}
        </Text>
        <MenuView
          style={{ width: 100, height: 44 }}
          actions={[
            {
              id: "recent",
              title: "最近阅读",
              state: order === "recent" ? "on" : "off",
            },
            {
              id: "title",
              title: "书名排序",
              state: order === "title" ? "on" : "off",
            },
            {
              id: "removed",
              title: showingRemoved ? "返回书架" : "已移除的书籍",
            },
          ]}
          onPressAction={({ nativeEvent: { event } }) => {
            if (event === "recent" || event === "title") setOrder(event);
            else if (event === "removed") setShowingRemoved((value) => !value);
          }}
        >
          <View
            accessibilityLabel="书籍排序与已移除书籍"
            style={styles.sortControl}
          >
            <Text style={styles.sortText}>
              {order === "recent" ? "最近阅读" : "书名排序"}
            </Text>
            <SymbolView
              name="arrow.up.arrow.down"
              size={14}
              tintColor={palette.ink2}
            />
          </View>
        </MenuView>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeading
        title={showingRemoved ? "已移除的书籍" : "书架"}
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="导入书籍"
            disabled={importing}
            accessibilityState={{ disabled: importing }}
            onPress={() => void handleImport()}
            style={({ pressed }) => [
              styles.add,
              (pressed || importing) && styles.pressed,
            ]}
          >
            <SymbolView name="plus" size={25} tintColor={palette.ink} />
          </Pressable>
        }
      />
      <PageSearch
        value={query}
        onChange={changeQuery}
        placeholder="搜索书名或作者"
        testID="shelf-search"
      />
      <FlatList
        key={columns}
        ref={list}
        contentInsetAdjustmentBehavior="never"
        contentOffset={{ x: 0, y: scrollOffset.current }}
        scrollEventThrottle={16}
        onScroll={({ nativeEvent }) => {
          scrollOffset.current = nativeEvent.contentOffset.y;
        }}
        data={loading ? [] : filtered}
        keyExtractor={(book) => book.id}
        renderItem={renderBook}
        numColumns={columns}
        columnWrapperStyle={columns > 1 ? styles.gridRow : undefined}
        contentContainerStyle={styles.content}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            {loading ? (
              <ActivityIndicator color={palette.lamp} />
            ) : error ? (
              <EmptyState
                title="书架读取失败"
                description={error}
                symbol="exclamationmark.triangle"
                actionLabel="重试"
                onAction={() => void load()}
              />
            ) : books.length === 0 ? (
              <EmptyState
                variant="shelf"
                symbol="lightbulb"
                title={showingRemoved ? "没有已移除的书籍" : "从一本书开始"}
                description={
                  showingRemoved
                    ? "移除原书后，笔记与对话仍会保留。"
                    : "导入 EPUB 或 PDF。"
                }
                actionLabel={showingRemoved ? "返回书架" : "导入书籍"}
                onAction={() =>
                  showingRemoved
                    ? setShowingRemoved(false)
                    : void handleImport()
                }
              />
            ) : (
              <EmptyState
                variant="shelf"
                title="没有找到这本书"
                description="试试书名中的其他字，或作者名字。"
                actionLabel="清除搜索"
                onAction={clearSearch}
              />
            )}
          </View>
        }
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      />
      {bookMenu ? (
        <BookActionSheet
          title={bookMenu.title}
          message=""
          actions={[
            {
              key: "annotations",
              title: "查看标注",
              onPress: () =>
                chooseBookAction(bookMenu, () => openAnnotations(bookMenu)),
            },
            {
              key: "remove",
              title: bookMenu.removed ? "彻底删除书籍及记录" : "移除原书",
              onPress: () =>
                chooseBookAction(bookMenu, () => askDelete(bookMenu)),
            },
          ]}
          onCancel={() => chooseBookAction(bookMenu, () => {})}
        />
      ) : null}
      {pdfConfirmation ? (
        <BookNotice
          title={pdfConfirmation.notice.title}
          message={pdfConfirmation.notice.message}
          onShow={pdfConfirmation.presentation.onShow}
          onCloseStart={pdfConfirmation.presentation.onCloseStart}
          onDismiss={pdfConfirmation.presentation.onDismiss}
          actions={[
            {
              title: "取消",
              style: "cancel",
              onPress: () => pdfConfirmation.decide(false),
            },
            { title: "继续导入", onPress: () => pdfConfirmation.decide(true) },
          ]}
        />
      ) : null}
      {importNotice ? (
        <BookNotice
          title={importNotice.title}
          message={importNotice.message}
          onAcknowledge={() => setImportNotice(null)}
        />
      ) : null}
      {removalRequest ? (
        <BookNotice
          title={
            removalRequest.permanent ? "彻底删除这本书及记录？" : "移除原书？"
          }
          message={
            removalRequest.permanent
              ? `将删除《${removalRequest.title}》的原书、笔记、草稿、对话与引用记录，无法撤销。其他书籍不受影响。`
              : "保留笔记、草稿、对话与引用文字；正在进行的准备和回答将取消。重新导入相同文件后可返回原文并继续问答。"
          }
          actions={[
            {
              title: "取消",
              style: "cancel",
              onPress: () => setRemovalRequest(null),
            },
            {
              title: removalRequest.permanent
                ? "确认彻底删除"
                : "移除原书，保留记录",
              style: removalRequest.permanent ? "destructive" : "default",
              onPress: () => confirmRemoval(removalRequest),
            },
          ]}
        />
      ) : null}
      {removalFailure ? (
        <BookNotice
          key={removalFailure.id}
          title="移除尚未完成"
          message={
            removalFailure.message +
            " 已完成的清理不会撤销，请重试完成本次操作。"
          }
          actions={[
            {
              title: "稍后重试",
              style: "cancel",
              onPress: () => setRemovalFailure(null),
            },
            {
              title: "重试",
              style: "default",
              onPress: () => confirmRemoval(removalFailure.request),
            },
          ]}
        />
      ) : null}
    </SafeAreaView>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: palette.paper },
    content: {
      paddingHorizontal: spacing.screen,
      paddingTop: 6,
      paddingBottom: 32,
      width: "100%",
      maxWidth: 900,
      alignSelf: "center",
      flexGrow: 1,
    },
    add: {
      minWidth: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    section: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    count: { fontSize: 13, lineHeight: 20, color: palette.ink3 },
    notice: { marginTop: 8, fontSize: typeScale.caption, color: palette.ink2 },
    error: { marginTop: 8, fontSize: typeScale.caption, color: palette.error },
    importStatus: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      marginTop: 8,
    },
    emptyWrap: { alignItems: "center" },
    gridRow: { gap: 26 },
    bookCard: { marginBottom: 30 },
    bookMenu: {
      position: "absolute",
      right: -6,
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    bookTitle: {
      marginTop: 15,
      fontSize: 17,
      lineHeight: 24,
      fontWeight: "500",
      color: palette.ink,
    },
    bookMeta: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: 5,
      marginTop: 5,
    },
    bookAuthor: {
      flexShrink: 1,
      fontSize: 13,
      lineHeight: 19,
      color: palette.ink2,
    },
    bookProgress: {
      fontSize: 12,
      lineHeight: 19,
      fontVariant: ["tabular-nums"],
      color: palette.ink3,
    },
    removed: {
      marginTop: 5,
      fontSize: 12,
      lineHeight: 19,
      color: palette.ink3,
    },
    track: {
      height: 2,
      borderRadius: 1,
      backgroundColor: palette.line,
      marginTop: 10,
    },
    fill: { height: 2, borderRadius: 1, backgroundColor: palette.lamp },
    pressed: { opacity: 0.72 },
    sortControl: {
      minWidth: 100,
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: 7,
    },
    sortText: { fontSize: typeScale.footnote, color: palette.ink2 },
  });
}
