import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewInstance,
} from "react-native";
import {
  BottomSheetFlatList,
  type BottomSheetFlatListMethods,
} from "@gorhom/bottom-sheet";
import { ChevronLeft, Search } from "lucide-react-native";
import type { AnnotationUpdate, ShelfAnnotation } from "../platform/library";
import { ReaderPanel } from "../ui/reader/ReaderPanel";
import { BookAnnotationsContent } from "../ui/annotations/BookAnnotationsContent";
import {
  ReaderNavigationTabs,
  ReaderNavigationRow,
  ReaderNavigationEmpty,
  ReaderSearchField,
} from "../ui/reader/ReaderNavigation";
import { usePalette, type Palette } from "../ui/theme";
import {
  useEpubNavigation,
  type EpubNavigationSource,
} from "./useEpubNavigation";
import type { ReaderContentsItem } from "./readerProtocol";

type Props = {
  readonly bookId: string;
  readonly title: string;
  readonly visible: boolean;
  readonly resumeSearch?: boolean;
  readonly currentTocHref?: string | null;
  readonly contents: readonly ReaderContentsItem[];
  readonly contentsLoaded: boolean;
  readonly annotations: readonly ShelfAnnotation[];
  readonly onClose: () => void;
  readonly onNavigate: (locator: string, source: EpubNavigationSource) => void;
  readonly onRemoveBookmark: (annotation: ShelfAnnotation) => Promise<boolean>;
  readonly onAnnotationsChanged: (update: AnnotationUpdate) => void;
};
type NavigationRow = {
  readonly id: string;
  readonly title: string;
  readonly depth?: number;
  readonly detail?: string;
  readonly selectionKey?: string;
};

export function EpubNavigationPanel(props: Props) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const { snapshot, onAction } = useEpubNavigation(props);
  const rows: readonly NavigationRow[] = snapshot.searchOpen
    ? snapshot.results
    : snapshot.tab === "contents"
      ? snapshot.contents
      : snapshot.bookmarks;
  const list = useRef<BottomSheetFlatListMethods>(null);
  const viewport = useRef<ViewInstance>(null);
  const sheetIndex = useRef<0 | 1>(0);
  const savedViewport = useRef<{
    query: string;
    index: number;
    hit: string;
    offset: number;
    sheet: 0 | 1;
  } | null>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const attempts = useRef(0);
  const userScrolled = useRef(false);
  const clearRetry = useCallback(() => clearTimeout(retry.current), []);
  const contentsIndex =
    !snapshot.searchOpen && snapshot.tab === "contents" && props.currentTocHref
      ? props.contents.findIndex((item) => item.href === props.currentTocHref)
      : -1;
  const saved =
    props.resumeSearch &&
    snapshot.searchOpen &&
    savedViewport.current?.query === snapshot.query
      ? savedViewport.current
      : null;
  const targetIndex = saved
    ? Math.min(saved.index, rows.length - 1)
    : contentsIndex;
  const initialIndex = saved ? Math.max(0, targetIndex - 1) : targetIndex;
  const listKey = snapshot.searchOpen
    ? (snapshot.results[0]?.selectionKey ?? "search")
    : snapshot.tab + ":" + contentsIndex;
  useEffect(() => {
    attempts.current = 0;
    userScrolled.current = false;
    return clearRetry;
  }, [clearRetry, listKey, props.visible]);
  const positionList = (delay = 32) => {
    clearRetry();
    if (!props.visible || targetIndex < 0 || userScrolled.current) return;
    const mountedList = list.current;
    retry.current = setTimeout(() => {
      if (mountedList && mountedList === list.current && !userScrolled.current)
        mountedList.scrollToIndex({
          index: targetIndex,
          viewOffset: saved?.offset ?? 0,
          animated: false,
        });
    }, delay);
  };
  const empty = snapshot.searchOpen
    ? snapshot.searchBusy
      ? "正在搜索…"
      : (snapshot.searchError ??
        (snapshot.query.trim() ? "没有找到相关文字" : "输入要查找的文字"))
    : snapshot.tab === "contents"
      ? snapshot.contentsStatus
      : "还没有书签";
  return (
    <ReaderPanel
      visible={props.visible}
      panFromContent={false}
      initialIndex={saved?.sheet ?? 0}
      onSnapChange={(index) => {
        if (index === 0 || index === 1) sheetIndex.current = index;
      }}
      title={snapshot.searchOpen ? "书内搜索" : props.title}
      onClose={props.onClose}
      action={({ canInteract }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            snapshot.searchOpen ? "返回目录、书签与标注" : "书内搜索"
          }
          style={styles.icon}
          onPress={() => {
            if (canInteract()) {
              savedViewport.current = null;
              onAction({
                action: snapshot.searchOpen ? "searchClose" : "searchOpen",
              });
            }
          }}
        >
          {snapshot.searchOpen ? (
            <ChevronLeft size={19} color={palette.ink2} />
          ) : (
            <Search size={19} color={palette.ink2} />
          )}
        </Pressable>
      )}
    >
      {({ canInteract }) => (
        <>
          {snapshot.searchOpen ? (
            <View style={styles.searchArea}>
              <ReaderSearchField
                value={snapshot.query}
                onChange={(query) => {
                  if (canInteract()) {
                    if (query !== snapshot.query) savedViewport.current = null;
                    onAction({ action: "query", query });
                  }
                }}
              />
            </View>
          ) : (
            <ReaderNavigationTabs
              value={snapshot.tab}
              items={[
                { value: "contents", label: "目录" },
                { value: "bookmarks", label: "书签" },
                { value: "annotations", label: "标注" },
              ]}
              onChange={(tab) => {
                if (canInteract()) onAction({ action: "tab", tab });
              }}
            />
          )}
          {snapshot.feedback ? (
            <Text accessibilityLiveRegion="polite" style={styles.feedback}>
              {snapshot.feedback}
            </Text>
          ) : null}
          {!snapshot.searchOpen && snapshot.tab === "annotations" ? (
            <BookAnnotationsContent
              bookId={props.bookId}
              title={props.title}
              format="EPUB"
              annotations={props.annotations}
              active={props.visible}
              canInteract={canInteract}
              onNavigate={(annotation) => {
                if (canInteract())
                  onAction({
                    action: "navigate",
                    source: "annotations",
                    id: annotation.id,
                  });
              }}
              onChanged={props.onAnnotationsChanged}
            />
          ) : (
            <View ref={viewport} collapsable={false} style={styles.viewport}>
              <BottomSheetFlatList<NavigationRow>
                ref={list}
                key={listKey}
                {...(initialIndex > 0
                  ? { initialScrollIndex: initialIndex }
                  : {})}
                onContentSizeChange={() => positionList()}
                onLayout={() => positionList()}
                onScrollBeginDrag={() => {
                  userScrolled.current = true;
                  clearRetry();
                }}
                onScrollToIndexFailed={({ index, averageItemLength }) => {
                  clearRetry();
                  if (userScrolled.current || ++attempts.current > 3) return;
                  if (averageItemLength > 0)
                    list.current?.scrollToOffset({
                      offset: index * averageItemLength,
                      animated: false,
                    });
                  positionList(100);
                }}
                style={styles.viewport}
                data={rows}
                keyExtractor={(row: NavigationRow) =>
                  row.selectionKey ?? row.id
                }
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.list}
                ListEmptyComponent={
                  <ReaderNavigationEmpty busy={snapshot.searchBusy}>
                    {empty}
                  </ReaderNavigationEmpty>
                }
                ListFooterComponent={snapshot.searchOpen ? (
                  <View style={styles.status}>
                    <Text style={styles.statusText}>{snapshot.preparationMessage}</Text>
                    {snapshot.canPrepare ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                          snapshot.preparationFailed ? "重新准备书内资料" : "准备书内资料"
                        }
                        onPress={() => {
                          if (canInteract()) onAction({ action: "prepare" });
                        }}
                        style={styles.prepare}
                      >
                        <Text style={styles.prepareText}>
                          {snapshot.preparationFailed ? "重试" : "重新准备"}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : undefined}
                renderItem={({
                  item,
                  index,
                }: {
                  item: NavigationRow;
                  index: number;
                }) => (
                  <ReaderNavigationRow
                    title={item.title}
                    detail={item.detail ?? null}
                    depth={item.depth ?? 0}
                    selected={
                      snapshot.searchOpen
                        ? saved?.hit === item.id
                        : contentsIndex >= 0 && index === contentsIndex
                    }
                    selectedLabel={snapshot.searchOpen ? "上次查看" : "正在读"}
                    detailLines={snapshot.searchOpen ? 4 : 2}
                    onPress={(event) => {
                      if (!canInteract()) return;
                      if (snapshot.searchOpen && item.selectionKey) {
                        const row = event?.currentTarget;
                        const offset =
                          row && typeof row !== "number" && viewport.current
                            ? row.getBoundingClientRect().top -
                              viewport.current.getBoundingClientRect().top
                            : 0;
                        savedViewport.current = {
                          query: snapshot.query,
                          hit: item.id,
                          index,
                          offset,
                          sheet: sheetIndex.current,
                        };

                        onAction({
                          action: "selectSearchResult",
                          id: item.id,
                          selectionKey: item.selectionKey,
                        });
                        onAction({
                          action: "navigate",
                          source: "search",
                          id: item.id,
                          selectionKey: item.selectionKey,
                        });
                      } else if (
                        !snapshot.searchOpen &&
                        snapshot.tab !== "annotations"
                      )
                        onAction({
                          action: "navigate",
                          source: snapshot.tab,
                          id: item.id,
                        });
                    }}
                    onDelete={
                      !snapshot.searchOpen && snapshot.tab === "bookmarks"
                        ? () => {
                            if (canInteract())
                              onAction({
                                action: "deleteBookmark",
                                id: item.id,
                              });
                          }
                        : undefined
                    }
                  />
                )}
              />
            </View>
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
    searchArea: { paddingBottom: 8 },
    status: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 8,
    },
    statusText: { flexBasis: "70%", flexGrow: 1, color: palette.ink3, fontSize: 12, lineHeight: 19 },
    prepare: { minHeight: 44, justifyContent: "center" },
    prepareText: { color: palette.lampInk, fontSize: 13 },
    feedback: {
      color: palette.ink2,
      fontSize: 13,
      paddingHorizontal: 26,
      paddingBottom: 8,
    },
    list: { paddingHorizontal: 16, paddingBottom: 40 },
    viewport: { flex: 1 },
  });
}
