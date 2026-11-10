import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  PlatformColor,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  BottomSheetFlatList,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import Swipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { File, Paths } from "expo-file-system";
import { SymbolView } from "expo-symbols";
import {
  deleteReaderAnnotation,
  updateReaderAnnotation,
  type AnnotationUpdate,
  type ShelfAnnotation,
} from "../../platform/library";
import { NoteSheet } from "../reader/NoteSheet";
import { BookNotice } from "../components/BookNotice";
import { EmptyState } from "../components/EmptyState";
import { usePalette, type Palette } from "../theme";
import {
  annotationChapter,
  annotationOrder,
  bookAnnotationExport,
} from "./model";
export interface BookAnnotationsContentProps {
  readonly bookId: string;
  readonly title: string;
  readonly format: "EPUB" | "PDF";
  readonly annotations: readonly ShelfAnnotation[];
  readonly active: boolean;
  readonly canInteract: () => boolean;
  readonly onNavigate: (annotation: ShelfAnnotation) => void;
  readonly onChanged: (update: AnnotationUpdate) => void;
}
type Editor = {
  id: number;
  annotation: ShelfAnnotation;
  body: string;
};
type Deletion = {
  id: number;
  annotation: ShelfAnnotation;
};
type Notice = {
  title: string;
  message: string;
};
export function BookAnnotationsContent(props: BookAnnotationsContentProps) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const latest = useRef(props);
  latest.current = props;
  const mounted = useRef(true);
  const owner = useRef({ bookId: props.bookId, active: props.active });
  if (
    owner.current.bookId !== props.bookId ||
    owner.current.active !== props.active
  )
    owner.current = { bookId: props.bookId, active: props.active };
  const session = owner.current;
  const viewVersion = useRef(0);
  const renderedView = viewVersion.current;
  const sequence = useRef(0);
  const mutation = useRef(false);
  const exportingRef = useRef(false);
  const editorRef = useRef<Editor | null>(null);
  const deletionRef = useRef<Deletion | null>(null);
  const activeSwipe = useRef<SwipeableMethods | null>(null);
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deletion, setDeletion] = useState<Deletion | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const closeSwipe = useCallback(() => {
    activeSwipe.current?.close();
    activeSwipe.current = null;
  }, []);
  const current = () =>
    mounted.current &&
    owner.current === session &&
    latest.current.active &&
    latest.current.canInteract();
  const interactive = () => current() && !mutation.current;
  const resolve = (annotation: ShelfAnnotation) =>
    interactive() && renderedView === viewVersion.current
      ? latest.current.annotations.find(
          (entry) => entry.id === annotation.id && entry.kind !== "bookmark",
        )
      : undefined;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      closeSwipe();
      editorRef.current = null;
      deletionRef.current = null;
    };
  }, [closeSwipe]);
  useEffect(() => {
    closeSwipe();
    editorRef.current = null;
    deletionRef.current = null;
    setEditor(null);
    setDeletion(null);
    setNotice(null);
    setQuery("");
  }, [props.bookId, props.active, closeSwipe]);
  const showNotice = (value: Notice) => {
    if (current()) setNotice(value);
  };
  const openEditor = (annotation: ShelfAnnotation) => {
    const target = resolve(annotation);
    if (!target || target.kind !== "note") return;
    closeSwipe();
    deletionRef.current = null;
    setDeletion(null);
    setNotice(null);
    const next = {
      id: ++sequence.current,
      annotation: target,
      body: target.body ?? "",
    };
    editorRef.current = next;
    setEditor(next);
  };
  const requestDelete = (annotation: ShelfAnnotation) => {
    const target = resolve(annotation);
    if (!target || deletionRef.current) return;
    closeSwipe();
    const next = { id: ++sequence.current, annotation: target };
    deletionRef.current = next;
    setDeletion(next);
  };
  const publish = (
    bookId: string,
    captured: BookAnnotationsContentProps["onChanged"],
    id: string,
    body?: string,
  ) => {
    const update = (rows: readonly ShelfAnnotation[]) =>
      body === undefined
        ? rows.filter((entry) => entry.id !== id)
        : rows.map((entry) => (entry.id === id ? { ...entry, body } : entry));
    if (!mounted.current) captured(update);
    else if (latest.current.bookId === bookId) latest.current.onChanged(update);
  };
  const write = async (
    operation: "save" | "delete",
    annotation: ShelfAnnotation,
    editorId?: number,
  ) => {
    if (!interactive()) return;
    const editing = editorRef.current;
    if (editorId !== undefined && editing?.id !== editorId) return;
    const body = editing?.body ?? "";
    if (operation === "save" && !body.trim()) return;
    const { bookId, onChanged } = latest.current;
    mutation.current = true;
    setBusy(true);
    try {
      if (operation === "save")
        await updateReaderAnnotation(annotation.id, { body });
      else await deleteReaderAnnotation(annotation.id);
      publish(
        bookId,
        onChanged,
        annotation.id,
        operation === "save" ? body : undefined,
      );
      if (
        current() &&
        editorId !== undefined &&
        editorRef.current?.id === editorId
      ) {
        editorRef.current = null;
        setEditor(null);
        setNotice(null);
      }
    } catch {
      if (current())
        showNotice({
          title: operation === "save" ? "笔记保存失败" : "删除失败",
          message:
            operation === "save"
              ? "内容仍在此页，请重试保存。"
              : "标注仍保留，请重试。",
        });
    } finally {
      mutation.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const navigate = (annotation: ShelfAnnotation) => {
    const target = resolve(annotation);
    if (!target) return;
    closeSwipe();
    if (!target.locator) {
      showNotice({
        title: "无法返回原文",
        message: "这条旧记录缺少阅读位置，仍可查看、编辑和导出。",
      });
      return;
    }
    Keyboard.dismiss();
    latest.current.onNavigate(target);
  };
  const changeQuery = (value: string) => {
    if (!interactive()) return;
    ++viewVersion.current;
    closeSwipe();
    deletionRef.current = null;
    setDeletion(null);
    setQuery(value);
  };
  const all = props.annotations
    .filter((annotation) => annotation.kind !== "bookmark")
    .sort(annotationOrder);
  const needle = query.trim().toLocaleLowerCase();
  const data = needle
    ? all.filter((annotation) =>
        `${annotation.quote} ${annotation.body ?? ""} ${annotation.chapter ?? ""}`
          .toLocaleLowerCase()
          .includes(needle),
      )
    : all;
  const exportAnnotations = async () => {
    if (!interactive() || exportingRef.current) return;
    const source = latest.current;
    if (
      !source.annotations.some((annotation) => annotation.kind !== "bookmark")
    ) {
      showNotice({
        title: "还没有标注",
        message: "阅读时画下高亮或写下想法后再导出。",
      });
      return;
    }
    exportingRef.current = true;
    setExporting(true);
    let file: File | null = null;
    try {
      file = new File(
        Paths.cache,
        `书灯标注-${Date.now()}-${++sequence.current}.txt`,
      );
      file.write(
        bookAnnotationExport(source.title, source.format, source.annotations),
      );
      await Share.share({ url: file.uri, title: "导出标注" });
    } catch {
      showNotice({ title: "无法导出", message: "标注仍保存在本机，请重试。" });
    } finally {
      exportingRef.current = false;
      if (mounted.current) setExporting(false);
      try {
        if (file?.exists) file.delete();
      } catch {
        /* Cache cleanup does not invalidate the share. */
      }
    }
  };
  const editingId = editor?.id;
  return (
    <View style={styles.root} testID="book-annotations-content">
      <View style={styles.toolbar}>
        <View style={styles.search}>
          <SymbolView
            name="magnifyingglass"
            size={16}
            tintColor={palette.ink3}
          />
          <BottomSheetTextInput
            testID="book-annotations-search"
            value={query}
            onChangeText={changeQuery}
            accessibilityLabel="搜索标注"
            placeholder="搜索摘录或想法"
            placeholderTextColor={palette.ink3}
            style={styles.searchInput}
            autoCorrect={false}
            returnKeyType="search"
          />
          {!!query && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="清除搜索"
              onPress={() => changeQuery("")}
              style={styles.clear}
            >
              <Text style={styles.clearText}>×</Text>
            </Pressable>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="导出标注"
          disabled={exporting || busy || !props.active}
          accessibilityState={{
            disabled: exporting || busy || !props.active,
            busy: exporting,
          }}
          onPress={() => void exportAnnotations()}
          style={styles.export}
        >
          <SymbolView
            name="square.and.arrow.up"
            size={18}
            tintColor={palette.ink2}
          />
        </Pressable>
      </View>
      <BottomSheetFlatList<ShelfAnnotation>
        data={data}
        keyExtractor={(annotation) => props.bookId + ":" + annotation.id}
        onScrollBeginDrag={closeSwipe}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <AnnotationRow
            annotation={item}
            format={props.format}
            palette={palette}
            styles={styles}
            onOpen={() => navigate(item)}
            onEdit={() => openEditor(item)}
            onDelete={() => requestDelete(item)}
            canExpand={() => Boolean(resolve(item))}
            onSwipeOpen={(swipe) => {
              if (!resolve(item)) {
                swipe?.close();
                return false;
              }
              if (activeSwipe.current !== swipe) activeSwipe.current?.close();
              activeSwipe.current = swipe;
              return true;
            }}
          />
        )}
        ListEmptyComponent={
          <EmptyState
            symbol="square.and.pencil"
            title={needle ? "没有找到相关标注" : "还没有标注"}
            description={
              needle ? "换个关键词，或清除搜索。" : "阅读时画下高亮或写下想法。"
            }
            {...(needle
              ? { actionLabel: "清除搜索", onAction: () => changeQuery("") }
              : {})}
          />
        }
      />
      {editor && props.active ? (
        <NoteSheet
          key={editor.id}
          visible
          quote={editor.annotation.quote}
          body={editor.body}
          saving={busy}
          onChangeBody={(body) => {
            const editing = editorRef.current;
            if (!interactive() || !editing || editing.id !== editingId) return;
            const next = { ...editing, body };
            editorRef.current = next;
            setEditor(next);
          }}
          onClose={() => {
            if (!interactive() || editorRef.current?.id !== editingId) return;
            editorRef.current = null;
            setEditor(null);
            setNotice(null);
          }}
          onSave={() => {
            if (editorRef.current?.id === editingId)
              void write("save", editor.annotation, editingId);
          }}
          onDelete={() => {
            if (editorRef.current?.id === editingId)
              void write("delete", editor.annotation, editingId);
          }}
          notice={notice}
          onDismissNotice={() => {
            if (current() && editorRef.current?.id === editingId)
              setNotice(null);
          }}
        />
      ) : null}
      {deletion && props.active ? (
        <BookNotice
          key={deletion.id}
          title="删除标注？"
          message="删除后无法恢复，原文中的标注也会移除。"
          actions={[
            {
              title: "取消",
              style: "cancel",
              onPress: () => {
                if (deletionRef.current?.id !== deletion.id) return;
                deletionRef.current = null;
                setDeletion(null);
              },
            },
            {
              title: "删除",
              style: "destructive",
              onPress: () => {
                if (!interactive() || deletionRef.current?.id !== deletion.id)
                  return;
                deletionRef.current = null;
                setDeletion(null);
                void write("delete", deletion.annotation);
              },
            },
          ]}
        />
      ) : null}
      {!editor && notice && props.active ? (
        <BookNotice
          title={notice.title}
          message={notice.message}
          onAcknowledge={() => {
            if (current()) setNotice(null);
          }}
        />
      ) : null}
    </View>
  );
}
function AnnotationRow({
  annotation,
  format,
  palette,
  styles,
  onOpen,
  onEdit,
  onDelete,
  onSwipeOpen,
  canExpand,
}: {
  readonly annotation: ShelfAnnotation;
  readonly format: "EPUB" | "PDF";
  readonly palette: Palette;
  readonly styles: ReturnType<typeof createStyles>;
  readonly onOpen: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly canExpand: () => boolean;
  readonly onSwipeOpen: (swipe: SwipeableMethods | null) => boolean;
}) {
  const swipe = useRef<SwipeableMethods>(null);
  const open = useRef(false);
  const [actionsVisible, setActionsVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const isLong =
    overflows ||
    annotation.quote.length > 60 ||
    (annotation.body?.length ?? 0) > 40;
  const hide = () => {
    open.current = false;
    setActionsVisible(false);
  };
  const choose = (perform: () => void) => {
    if (!open.current) return;
    hide();
    swipe.current?.close();
    perform();
  };
  const highlightColors: Record<string, string> = {
    yellow: "#D0AB50",
    green: "#7D9A65",
    blue: "#789AAC",
    rose: "#BA857A",
  };
  const tint =
    annotation.kind === "note"
      ? palette.lamp
      : (highlightColors[annotation.color ?? "yellow"] ?? palette.selection);
  return (
    <Swipeable
      ref={swipe}
      overshootLeft={false}
      overshootRight={false}
      containerStyle={styles.swipe}
      onSwipeableWillOpen={() => {
        if (!onSwipeOpen(swipe.current)) return;
        open.current = true;
        setActionsVisible(true);
      }}
      onSwipeableWillClose={hide}
      onSwipeableClose={hide}
      renderRightActions={() => (
        <View
          style={styles.actions}
          accessibilityElementsHidden={!actionsVisible}
          importantForAccessibility={
            actionsVisible ? "auto" : "no-hide-descendants"
          }
        >
          {annotation.kind === "note" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="编辑笔记"
              disabled={!actionsVisible}
              onPress={() => choose(onEdit)}
              style={[styles.action, styles.edit]}
            >
              <Text style={styles.actionText}>编辑</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="删除标注"
            disabled={!actionsVisible}
            onPress={() => choose(onDelete)}
            style={[styles.action, styles.delete]}
          >
            <Text style={styles.actionText}>删除</Text>
          </Pressable>
        </View>
      )}
    >
      <Pressable
        testID={"book-annotation-" + annotation.id}
        accessibilityRole="button"
        accessibilityLabel={`${annotation.kind === "note" ? "笔记" : "高亮"}：${annotation.quote || annotation.body || "原文"}`}
        accessibilityHint="点按回到原文，左滑管理标注"
        accessibilityActions={[
          { name: "original", label: "回到原文" },
          ...(annotation.kind === "note"
            ? [{ name: "edit", label: "编辑笔记" }]
            : []),
          { name: "delete", label: "删除标注" },
        ]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === "original") onOpen();
          else if (nativeEvent.actionName === "edit") onEdit();
          else if (nativeEvent.actionName === "delete") onDelete();
        }}
        onPress={onOpen}
        style={({ pressed }) => [
          styles.row,
          pressed && { backgroundColor: palette.paperDeep },
        ]}
      >
        <View style={[styles.marker, { backgroundColor: tint }]} />
        <View style={styles.text}>
          {!!annotation.quote && (
            <Text
              style={styles.quote}
              numberOfLines={expanded ? undefined : 3}
              onTextLayout={({ nativeEvent }) => {
                if (canExpand() && !expanded && nativeEvent.lines.length >= 3)
                  setOverflows(true);
              }}
            >
              {annotation.quote}
            </Text>
          )}
          {!!annotation.body?.trim() && (
            <Text
              style={styles.body}
              numberOfLines={expanded ? undefined : 2}
              onTextLayout={({ nativeEvent }) => {
                if (canExpand() && !expanded && nativeEvent.lines.length >= 2)
                  setOverflows(true);
              }}
            >
              {annotation.body}
            </Text>
          )}
          <Text style={styles.chapter} numberOfLines={1}>
            {annotationChapter(annotation, format)}
          </Text>
          {isLong ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={expanded ? "收起标注" : "展开标注全文"}
              accessibilityState={{ expanded }}
              onPress={(event) => {
                event.stopPropagation();
                if (canExpand()) setExpanded((value) => !value);
              }}
              style={styles.expand}
            >
              <Text style={styles.expandText}>
                {expanded ? "收起" : "展开"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </Pressable>
    </Swipeable>
  );
}
function createStyles(palette: Palette) {
  return StyleSheet.create({
    root: { flex: 1 },
    toolbar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 20,
      paddingBottom: 12,
    },
    search: {
      flex: 1,
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingLeft: 12,
      borderRadius: 12,
      backgroundColor: palette.paperDeep,
    },
    searchInput: {
      flex: 1,
      minWidth: 0,
      paddingVertical: 10,
      fontSize: 15,
      color: palette.ink,
    },
    clear: {
      width: 40,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    clearText: { fontSize: 22, color: palette.ink2 },
    export: {
      width: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    content: { paddingHorizontal: 20, paddingBottom: 32 },
    swipe: { overflow: "hidden" },
    row: {
      flexDirection: "row",
      gap: 12,
      paddingVertical: 17,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.line,
      backgroundColor: palette.paper,
    },
    marker: { width: 3, borderRadius: 2, alignSelf: "stretch" },
    text: { flex: 1, gap: 7 },
    quote: { color: palette.ink, fontSize: 16, lineHeight: 25 },
    body: { color: palette.ink2, fontSize: 14, lineHeight: 22 },
    chapter: { color: palette.ink3, fontSize: 12, lineHeight: 18 },
    expand: {
      minHeight: 44,
      alignSelf: "flex-start",
      justifyContent: "center",
    },
    expandText: { color: palette.lampInk, fontSize: 13 },
    actions: { flexDirection: "row" },
    action: { width: 70, alignItems: "center", justifyContent: "center" },
    actionText: { color: "#FFFFFF", fontSize: 15 },
    edit: { backgroundColor: PlatformColor("systemGrayColor") },
    delete: { backgroundColor: PlatformColor("systemRedColor") },
  });
}
