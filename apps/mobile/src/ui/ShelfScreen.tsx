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
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { MenuView } from "@expo/ui/community/menu";
import { initializeDatabase } from "../platform";
import {
  deleteShelfBook,
  importBookFromPicker,
  loadShelfBooks,
  loadAppPreference,
  migrateLegacyLibraryIfNeeded,
  removeShelfBook,
  saveAppPreference,
  type BookImportProgress,
  type ShelfBookRecord,
} from "../platform/library";
import { BookCover } from "./components/BookCover";
import { importFailureNotice, requestPdfImportConfirmation, type PdfImportConfirmation, type PdfImportPresentation } from "../platform/library/pdfImport";
import { BookNotice } from "./components/BookNotice";
import { EmptyState } from "./components/EmptyState";
import { PageHeader } from "./components/PageHeader";
import { SearchField } from "./components/SearchField";
import { SectionHeader } from "./components/SectionHeader";
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
  const { width } = useWindowDimensions();
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [books, setBooks] = useState<readonly ShelfBookRecord[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  useTabInteractionLock(importing);
  const [importProgress, setImportProgress] =
    useState<BookImportProgress | null>(null);
  const importController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const [order, setOrder] = useState<"recent" | "title">("recent");
  const [preferredBookId, setPreferredBookId] = useState<string | null>(null);
  const [showingRemoved, setShowingRemoved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<{ title: string; message: string } | null>(null);
  const [removalRequest, setRemovalRequest] = useState<RemovalRequest | null>(null);
  const [pdfConfirmation, setPdfConfirmation] = useState<{ readonly notice: PdfImportConfirmation; readonly decide: (accepted: boolean) => void; readonly presentation: PdfImportPresentation } | null>(null);
  const [removalFailure, setRemovalFailure] = useState<{ id: number; request: RemovalRequest; message: string } | null>(null);
  const removalFailureId = useRef(0);
  const removalInFlight = useRef(false);

  const load = useCallback(async (onlyRemoved = showingRemoved) => {
    setError(null);
    const database = await initializeDatabase();
    if (!database.ok) {
      setError(`本地数据库不可用：${database.detail}`);
      setLoading(false);
      return;
    }
    try {
      const migration = await migrateLegacyLibraryIfNeeded();
      if (migration.failures > 0)
        setNotice(`旧版书库有 ${migration.failures} 条记录未能迁移`);
      const [loadedBooks, preferred] = await Promise.all([
        loadShelfBooks({ onlyRemoved }),
        loadAppPreference("library:last-read"),
      ]);
      setBooks(loadedBooks);
      setPreferredBookId(typeof preferred === "string" ? preferred : null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(
        message.startsWith("旧书库") ? message : `书架加载失败：${message}`,
      );
    } finally {
      setLoading(false);
    }
  }, [showingRemoved]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; importController.current?.abort(); };
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
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
  // The native "最近阅读" option preserves the library's catalog order.
  const filtered =
    order === "title"
      ? [...matches].sort(
          (a, b) =>
            a.title.localeCompare(b.title, "zh-Hans-CN", { numeric: true }) ||
            a.id.localeCompare(b.id),
        )
      : matches;
  const continueBook =
    showingRemoved || needle.length > 0
      ? null
      : (filtered.find((book) => book.id === preferredBookId) ??
        filtered.find((book) => book.progressPercent !== null) ??
        null);
  const cardWidth = (width - spacing.screen * 2 - 21) / 2;

  const handleImport = async () => {
    if (importing || removalInFlight.current) return;
    setImporting(true);
    try {
      const controller = new AbortController();
      importController.current = controller;
      const result = await importBookFromPicker({
        signal: controller.signal,
        onProgress: setImportProgress,
        confirmScannedPdf: (info) => requestPdfImportConfirmation(
          info,
          controller.signal,
          (notice, decide, presentation) => setPdfConfirmation({ notice, decide, presentation }),
          () => { if (mounted.current) setPdfConfirmation(null); },
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
      askDelete(book);
      return;
    }
    haptics();
    setPreferredBookId(book.id);
    void saveAppPreference("library:last-read", book.id).catch(
      (cause: unknown) => {
        setError(
          `无法保存最近阅读：${cause instanceof Error ? cause.message : String(cause)}`,
        );
      },
    );
    router.push({ pathname: "/reader/[id]", params: { id: book.id } });
  };

  const askDelete = (book: ShelfBookRecord) => {
    if (importing || importNotice || removalRequest || removalFailure || removalInFlight.current) return;
    setRemovalRequest({ bookId: book.id, title: book.title, permanent: Boolean(book.removed) });
  };

  const confirmRemoval = (request: RemovalRequest) => {
    setRemovalRequest(null);
    setRemovalFailure(null);
    if (removalInFlight.current) return;
    removalInFlight.current = true;
    void Promise.resolve()
      .then(() => request.permanent ? deleteShelfBook(request.bookId) : removeShelfBook(request.bookId))
      .catch((cause: unknown) => {
        if (mounted.current) setRemovalFailure({ id: ++removalFailureId.current, request, message: cause instanceof Error ? cause.message : String(cause) });
      })
      .finally(() => { removalInFlight.current = false; if (mounted.current) void load(); });
  };

  const continueDetail = continueBook
    ? `${continueBook.progressChapter?.split(" · ")[0] || (continueBook.format === "PDF" ? continueBook.progressLabel : "继续上次阅读")} · ${continueBook.progressPercent ?? 0}%`
    : "";

  const renderBook = useCallback(
    ({ item: book }: ListRenderItemInfo<ShelfBookRecord>) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`打开${book.title}`}
        onPress={() => openBook(book)}
        onLongPress={() => askDelete(book)}
        android_ripple={{ color: palette.line }}
        style={({ pressed }) => [
          styles.bookCard,
          { width: cardWidth },
          pressed && styles.pressed,
        ]}
      >
        <BookCover
          title={book.title}
          author={book.author}
          format={book.format}
          coverUri={book.coverUri}
          width={cardWidth}
          height={cardWidth * 1.4}
          showDot
        />
        <Text style={styles.bookTitle} numberOfLines={2}>
          {book.title}
        </Text>
        <Text style={styles.bookAuthor} numberOfLines={1}>
          {book.author ?? "作者未知"}
        </Text>
        <Text
          style={[
            styles.bookProgress,
            book.progressPercent !== null && styles.bookProgressOn,
          ]}
        >
          {book.removed
            ? "原书已移除，记录仍保留"
            : book.progressPercent === null
              ? "未开始"
              : `已读 ${book.progressPercent}%`}
        </Text>
      </Pressable>
    ),
    [cardWidth, palette.line, styles, openBook, askDelete],
  );

  const listHeader = (
    <View>
      <PageHeader
        title={showingRemoved ? "已移除的书籍" : "书架"}
        action={{
          symbol: "plus",
          label: "导入书籍",
          onPress: () => void handleImport(),
          busy: importing,
          variant: "solid",
        }}
      />
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder="书名或作者"
        style={styles.search}
      />
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
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
      {!showingRemoved && continueBook ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`继续阅读${continueBook.title}`}
          onPress={() => openBook(continueBook)}
          android_ripple={{ color: palette.line }}
          style={({ pressed }) => [
            styles.continueCard,
            pressed && styles.pressed,
          ]}
        >
          <BookCover
            title={continueBook.title}
            author={continueBook.author}
            format={continueBook.format}
            coverUri={continueBook.coverUri}
            width={64}
            height={90}
            compact
            showDot
          />
          <View style={styles.continueMeta}>
            <View>
              <Text style={styles.continueEyebrow}>继续阅读</Text>
              <Text style={styles.continueTitle} numberOfLines={1}>
                {continueBook.title}
              </Text>
              <Text style={styles.continueAuthor} numberOfLines={1}>
                {continueBook.author ?? "作者未知"}
              </Text>
            </View>
            <View>
              <View style={styles.progressLine}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.max(0, continueBook.progressPercent ?? 0)}%`,
                    },
                  ]}
                />
              </View>
              <View style={styles.continueFooter}>
                <View style={styles.continueAction}>
                  <Text style={styles.continueLabel}>接着读</Text>
                  <SymbolView
                    name="arrow.right"
                    size={13}
                    tintColor={palette.lampInk}
                  />
                </View>
                <Text style={styles.continueDetail} numberOfLines={1}>
                  {continueDetail}
                </Text>
              </View>
            </View>
          </View>
        </Pressable>
      ) : null}
      {books.length > 0 || showingRemoved ? (
        <SectionHeader
          title={
            showingRemoved
              ? "已移除的书籍"
              : needle.length > 0
                ? "搜索结果"
                : "我的书籍"
          }
          style={styles.section}
          count={String(filtered.length)}
          trailing={
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
                else if (event === "removed")
                  setShowingRemoved((value) => !value);
              }}
            >
              <View accessibilityLabel="排序" style={styles.sortControl}>
                <Text style={styles.sortText}>
                  {order === "recent" ? "最近阅读" : "书名排序"}
                </Text>
                <SymbolView
                  name="chevron.down"
                  size={10}
                  tintColor={palette.ink2}
                />
              </View>
            </MenuView>
          }
        />
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <FlatList
        data={loading ? [] : filtered}
        keyExtractor={(book) => book.id}
        renderItem={renderBook}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.content}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            {loading ? (
              <ActivityIndicator color={palette.lamp} />
            ) : books.length === 0 ? (
              <EmptyState
                variant="shelf"
                symbol="lightbulb"
                title={showingRemoved ? "没有已移除的书籍" : "从一本书开始"}
                description={
                  showingRemoved
                    ? "移除原书后，笔记与对话仍会保留在这里。"
                    : "导入你的 EPUB 或 PDF，\n让阅读与理解一起发生。"
                }
                actionLabel="导入书籍"
                onAction={() => void handleImport()}
              />
            ) : (
              <EmptyState
                variant="shelf"
                title="没有找到这本书"
                description="试试书名中的其他字，或作者名字。"
              />
            )}
          </View>
        }
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      />
      {pdfConfirmation ? (
        <BookNotice
          title={pdfConfirmation.notice.title}
          message={pdfConfirmation.notice.message}
          onShow={pdfConfirmation.presentation.onShow}
          onCloseStart={pdfConfirmation.presentation.onCloseStart}
          onDismiss={pdfConfirmation.presentation.onDismiss}
          actions={[
            { title: "取消", style: "cancel", onPress: () => pdfConfirmation.decide(false) },
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
          title={removalRequest.permanent ? "彻底删除这本书及记录？" : "移除原书？"}
          message={removalRequest.permanent
            ? `将删除《${removalRequest.title}》的原书、笔记、草稿、对话与引用记录，无法撤销。其他书籍不受影响。`
            : "保留笔记、草稿、对话与引用文字；正在进行的准备和回答将取消。重新导入相同文件后可返回原文并继续问答。"}
          actions={[
            { title: "取消", style: "cancel", onPress: () => setRemovalRequest(null) },
            {
              title: removalRequest.permanent ? "确认彻底删除" : "移除原书，保留记录",
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
          message={removalFailure.message + " 已完成的清理不会撤销，请重试完成本次操作。"}
          actions={[
            { title: "稍后重试", style: "cancel", onPress: () => setRemovalFailure(null) },
            { title: "重试", style: "default", onPress: () => confirmRemoval(removalFailure.request) },
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
    },
    section: { marginTop: 24 },
    search: { marginTop: 22, marginHorizontal: 8 },
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
    gridRow: { justifyContent: "space-between" },
    bookCard: { marginBottom: 24 },
    bookTitle: {
      marginTop: 8,
      fontFamily: "Songti SC",
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "600",
      color: palette.ink,
    },
    bookAuthor: {
      marginTop: 2,
      fontSize: typeScale.captionSmall,
      color: palette.ink3,
    },
    bookProgress: {
      marginTop: 3,
      fontSize: typeScale.captionSmall,
      color: palette.ink3,
    },
    bookProgressOn: { color: palette.lampInk },
    pressed: { opacity: 0.72 },
    continueCard: {
      flexDirection: "row",
      marginTop: 26,
      padding: 12,
      minHeight: 114,
      borderRadius: 14,
      backgroundColor: palette.paperDeep,
    },
    continueMeta: { flex: 1, marginLeft: 12, justifyContent: "space-between" },
    continueEyebrow: {
      fontSize: 10.5,
      fontWeight: "500",
      color: palette.lampInk,
    },
    continueTitle: {
      marginTop: 5,
      fontFamily: "Songti SC",
      fontSize: 22,
      fontWeight: "600",
      color: palette.ink,
    },
    continueAuthor: {
      marginTop: 2,
      fontSize: typeScale.caption,
      color: palette.ink3,
    },
    progressLine: {
      height: 2,
      backgroundColor: palette.line,
      marginTop: 8,
      overflow: "hidden",
    },
    progressFill: { height: 2, backgroundColor: palette.lamp },
    continueFooter: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 6,
    },
    continueAction: { flexDirection: "row", alignItems: "center", gap: 4 },
    continueLabel: { fontSize: 13, fontWeight: "500", color: palette.lampInk },
    continueDetail: {
      marginLeft: 8,
      fontSize: typeScale.captionSmall,
      color: palette.ink3,
    },
    sortControl: {
      width: 100,
      height: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: 3,
    },
    sortText: { fontSize: typeScale.footnote, color: palette.ink2 },
  });
}
