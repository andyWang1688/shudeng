import { useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import {
  BottomSheetFlatList,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { ChevronLeft, Search } from "lucide-react-native";
import type {
  AnnotationUpdate,
  ShelfAnnotation,
  StoredReaderLocator,
} from "../../platform/library";
import type { ReaderPreferences } from "../../platform/library/readerPreferences";
import type { PdfOutlineItem, PdfSearchHit } from "../../platform/pdfNative";
import { trimPdfSearchQuery } from "../../platform/pdfSearchResults";
import { HighlightPalette } from "../../ui/reader/ReaderPanels";
import { ReaderPanel } from "../../ui/reader/ReaderPanel";
import { BookAnnotationsContent } from "../../ui/annotations/BookAnnotationsContent";
import {
  ReaderNavigationTabs,
  ReaderNavigationRow,
  ReaderNavigationEmpty,
  ReaderSearchField,
} from "../../ui/reader/ReaderNavigation";
import { usePalette, type Palette } from "../../ui/theme";

export type PdfPanel = "contents" | "settings" | null;
export type PdfContentsTab =
  | "contents"
  | "bookmarks"
  | "annotations"
  | "search";
export type HighlightColor = "yellow" | "green" | "blue" | "rose";

export function PdfColorPalette({
  visible,
  selected,
  editing,
  quote,
  saving = false,
  onPick,
  onClose,
}: {
  readonly visible: boolean;
  readonly selected: string | null;
  readonly editing: boolean;
  readonly quote?: string;
  readonly saving?: boolean;
  readonly onPick: (color: HighlightColor) => void;
  readonly onClose: () => void;
}) {
  return (
    <HighlightPalette
      visible={visible}
      selected={selected}
      quote={quote}
      newHighlight={!editing}
      busy={saving}
      onColor={(color) => onPick(color as HighlightColor)}
      onClose={onClose}
    />
  );
}

type PanelRow = {
  readonly id: string;
  readonly title: string;
  readonly detail: string | null;
  readonly depth: number;
  readonly locator: StoredReaderLocator;
  readonly annotation?: ShelfAnnotation;
};
type PanelProps = {
  readonly bookId: string;
  readonly title: string;
  readonly panel: PdfPanel;
  readonly tab: PdfContentsTab;
  readonly onTab: (tab: PdfContentsTab) => void;
  readonly outline: readonly PdfOutlineItem[];
  readonly totalPages: number;
  readonly currentPage: number;
  readonly annotations: readonly ShelfAnnotation[];
  readonly query: string;
  readonly queryEventCount: number;
  readonly onQuery: (query: string, eventCount: number) => void;
  readonly searching: boolean;
  readonly searchError: string | null;
  readonly searchAvailable: boolean;
  readonly hits: readonly PdfSearchHit[];
  readonly preferences: ReaderPreferences | null;
  readonly onPreferences: (
    change: Partial<Pick<ReaderPreferences, "flow" | "theme">>,
  ) => Promise<void>;
  readonly onJump: (locator: StoredReaderLocator) => void;
  readonly onDeleteBookmark: (annotation: ShelfAnnotation) => void;
  readonly onAnnotationsChanged: (update: AnnotationUpdate) => void;
  readonly onClose: () => void;
};

/** Shared sheets display PDFKit results without changing its source locations or search lifecycle. */
export function PdfReaderPanels({
  bookId,
  title,
  panel,
  tab,
  onTab,
  outline,
  totalPages,
  currentPage,
  annotations,
  query,
  queryEventCount,
  onQuery,
  searching,
  searchError,
  searchAvailable,
  hits,
  preferences,
  onPreferences,
  onJump,
  onDeleteBookmark,
  onAnnotationsChanged,
  onClose,
}: PanelProps) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const querySequence = useRef(queryEventCount);
  querySequence.current = Math.max(querySequence.current, queryEventCount);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const navigationTab = useRef<Exclude<PdfContentsTab, "search">>("contents");
  if (tab !== "search") navigationTab.current = tab;
  const [annotationFeedback, setAnnotationFeedback] = useState<string | null>(
    null,
  );
  const rows = useMemo<readonly PanelRow[]>(() => {
    if (tab === "bookmarks")
      return annotations
        .flatMap((item) =>
          item.kind === "bookmark" && item.locator?.type === "pdf"
            ? [
                {
                  id: item.id,
                  title: "第 " + item.locator.page + " 页",
                  detail: item.quote || null,
                  depth: 0,
                  annotation: item,
                  locator: item.locator,
                },
              ]
            : [],
        )
        .sort((a, b) => a.locator.page - b.locator.page);
    if (tab === "search")
      return hits.map((item, index) => ({
        id: "search-" + index,
        title: "第 " + item.page + " 页",
        detail: item.text,
        depth: 0,
        locator: {
          type: "pdf",
          page: item.page,
          rects: item.rects,
          text: item.text,
        },
      }));
    if (!outline.length)
      return Array.from(
        { length: Math.max(0, Math.trunc(totalPages)) },
        (_, index) => ({
          id: "page-" + (index + 1),
          title: "第 " + (index + 1) + " 页",
          detail: null,
          depth: 0,
          locator: { type: "pdf" as const, page: index + 1 },
        }),
      );
    return outline.map((item, index) => ({
      id: "outline-" + index,
      title: item.title,
      detail: "第 " + item.page + " 页",
      depth: item.depth,
      locator: { type: "pdf", page: item.page },
    }));
  }, [annotations, hits, outline, tab, totalPages]);
  const latestRows = useRef(rows);
  latestRows.current = rows;
  const status =
    tab === "bookmarks"
      ? "还没有书签"
      : tab === "contents"
        ? "这份 PDF 没有目录"
        : !searchAvailable
          ? "没有可搜索的文字"
          : (searchError ??
            (searching
              ? "正在搜索…"
              : trimPdfSearchQuery(query)
                ? "没有找到相关文字"
                : "输入要查找的文字"));
  const applyFlow = async (flow: "paginated" | "scrolled") => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await onPreferences({ flow });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const search = panel === "contents" && tab === "search";
  return (
    <ReaderPanel
      visible={panel !== null}
      title={panel === "settings" ? "阅读设置" : search ? "书内搜索" : title}
      initialHeight={panel === "settings" ? 46 : 70}
      busy={saving}
      onClose={onClose}
      action={({ canInteract }) =>
        panel === "contents" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={search ? "返回目录、书签与标注" : "书内搜索"}
            onPress={() => {
              if (canInteract())
                onTab(search ? navigationTab.current : "search");
            }}
            style={styles.icon}
          >
            {search ? (
              <ChevronLeft size={19} color={palette.ink2} />
            ) : (
              <Search size={19} color={palette.ink2} />
            )}
          </Pressable>
        ) : null
      }
    >
      {({ canInteract, blocked }) => (
        <>
          {panel === "settings" ? (
            <BottomSheetScrollView contentContainerStyle={styles.settings}>
              <Text style={styles.section}>阅读方式</Text>
              <ReaderNavigationTabs
                disabled={blocked || !preferences}
                value={
                  preferences?.flow === "scrolled" ? "scrolled" : "paginated"
                }
                items={[
                  { value: "paginated", label: "分页" },
                  { value: "scrolled", label: "滚动" },
                ]}
                onChange={(flow) => {
                  if (canInteract() && !saving && preferences)
                    void applyFlow(flow);
                }}
              />
            </BottomSheetScrollView>
          ) : (
            <>
              {search ? (
                <ReaderSearchField
                  value={query}
                  enabled={searchAvailable}
                  onChange={(text) => {
                    if (canInteract()) onQuery(text, ++querySequence.current);
                  }}
                />
              ) : (
                <>
                  <ReaderNavigationTabs
                    value={
                      tab === "bookmarks" || tab === "annotations"
                        ? tab
                        : "contents"
                    }
                    items={[
                      {
                        value: "contents",
                        label: outline.length ? "目录" : "页面",
                      },
                      { value: "bookmarks", label: "书签" },
                      { value: "annotations", label: "标注" },
                    ]}
                    onChange={(value) => {
                      if (canInteract()) {
                        setAnnotationFeedback(null);
                        onTab(value);
                      }
                    }}
                  />
                  {tab !== "annotations" ? (
                    <Text
                      style={styles.position}
                      accessibilityLiveRegion="polite"
                    >
                      第 {currentPage} / {totalPages} 页
                    </Text>
                  ) : null}
                </>
              )}
              {tab === "annotations" ? (
                <>
                  {annotationFeedback ? (
                    <Text
                      accessibilityLiveRegion="polite"
                      style={styles.position}
                    >
                      {annotationFeedback}
                    </Text>
                  ) : null}
                  <BookAnnotationsContent
                    bookId={bookId}
                    title={title}
                    format="PDF"
                    annotations={annotations}
                    active={panel === "contents"}
                    canInteract={canInteract}
                    onChanged={onAnnotationsChanged}
                    onNavigate={(annotation) => {
                      if (!canInteract()) return;
                      const locator = annotation.locator;
                      if (
                        locator?.type !== "pdf" ||
                        !Number.isSafeInteger(locator.page) ||
                        locator.page < 1 ||
                        locator.page > totalPages
                      ) {
                        setAnnotationFeedback(
                          "这条记录缺少可用的原文位置，仍可查看内容。",
                        );
                        return;
                      }
                      onJump(locator);
                    }}
                  />
                </>
              ) : (
                <BottomSheetFlatList<PanelRow>
                  data={rows}
                  keyExtractor={(row: PanelRow) => row.id}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.list}
                  ListEmptyComponent={
                    <ReaderNavigationEmpty busy={searching && search}>
                      {status}
                    </ReaderNavigationEmpty>
                  }
                  renderItem={({ item }: { item: PanelRow }) => (
                    <ReaderNavigationRow
                      title={item.title}
                      detail={item.detail}
                      depth={item.depth}
                      detailLines={search ? 4 : 2}
                      selected={
                        !search &&
                        item.locator.type === "pdf" &&
                        item.locator.page === currentPage
                      }
                      onPress={() => {
                        if (canInteract() && latestRows.current.includes(item))
                          onJump(item.locator);
                      }}
                      onDelete={
                        item.annotation
                          ? () => {
                              if (
                                canInteract() &&
                                item.annotation &&
                                latestRows.current.includes(item)
                              )
                                onDeleteBookmark(item.annotation);
                            }
                          : undefined
                      }
                    />
                  )}
                />
              )}
            </>
          )}
        </>
      )}
    </ReaderPanel>
  );
}
function makeStyles(palette: Palette) {
  return StyleSheet.create({
    icon: {
      width: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    section: {
      margin: 24,
      marginTop: 12,
      marginBottom: 14,
      color: palette.ink3,
      fontSize: 13,
    },
    settings: { paddingBottom: 40 },
    position: {
      marginHorizontal: 26,
      marginBottom: 8,
      color: palette.ink3,
      fontSize: 12,
    },
    list: { paddingHorizontal: 16, paddingBottom: 40 },
  });
}
