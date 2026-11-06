/** Interactive reader proposal; locations and bookmarks are session-only samples. */
import { useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import BottomSheet, { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AlignJustify,
  Bookmark,
  Check,
  ChevronLeft,
  Columns2,
  List,
  Maximize2,
  MessageCircle,
  Minus,
  Plus,
  Settings2,
  Trash2,
  X,
} from "lucide-react-native";
import {
  DemoReadingSurface,
  type DemoSurfaceHandle,
} from "./DemoReadingSurface";
import { DemoPdfSurface } from "./DemoPdfSurface";
import { DemoSheet } from "./DemoSheet";
import { DemoAnnotationEditor } from "./DemoAnnotationEditor";
import type { DemoBook } from "./demoBooks";
import { demoColors as c } from "./demoTheme";
import {
  readerSamples,
  type DemoReadingPreferences,
  type DemoReadingState,
  type DemoAnnotation,
  type DemoTextSelection,
} from "./readerSamples";

type Panel = "contents" | "settings" | null;
type Jump = { position: number; revision: number };

export function DemoReader({
  book,
  reading,
  preferences,
  onReadingChange,
  onPreferencesChange,
  onBack,
  onAsk,
}: {
  book: DemoBook;
  reading: DemoReadingState;
  preferences: DemoReadingPreferences;
  onReadingChange: (state: DemoReadingState) => void;
  onPreferencesChange: (preferences: DemoReadingPreferences) => void;
  onBack: () => void;
  onAsk: (selection?: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const samples = useMemo(() => readerSamples(book), [book]);
  const isPdf = book.format === "PDF";
  const [pdfPages, setPdfPages] = useState(0);
  const locations = isPdf
    ? Array.from({ length: Math.max(1, pdfPages) }, (_, index) => ({
        id: "pdf:" + index,
        chapter: "第 " + (index + 1) + " 页",
        chapterIndex: index,
        paragraphIndex: 0,
        text: "",
      }))
    : samples;
  const flow = isPdf ? preferences.pdfFlow : preferences.flow;
  const [focused, setFocused] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [section, setSection] = useState<"contents" | "bookmarks">("contents");
  const [editing, setEditing] = useState<DemoAnnotation | null>(() => {
    const preview = process.env.EXPO_PUBLIC_UI_DEMO_DETAIL;
    return reading.annotations.find((item) => item.kind === preview) ?? null;
  });
  const surface = useRef<DemoSurfaceHandle>(null);
  const [jump, setJump] = useState<Jump>({
    position: reading.position,
    revision: 0,
  });
  const sheet = useRef<BottomSheet>(null);
  const current = locations[reading.position] ?? locations[0];
  const saved = reading.bookmarks.includes(reading.position);
  const openPanel = (next: Panel) => {
    setSection("contents");
    setPanel(next);
  };
  const closePanel = () => sheet.current?.close();
  const toggleBookmark = (position = reading.position) =>
    onReadingChange({
      ...reading,
      bookmarks: reading.bookmarks.includes(position)
        ? reading.bookmarks.filter((item) => item !== position)
        : [...reading.bookmarks, position].sort((a, b) => a - b),
    });
  const navigate = (position: number) => {
    onReadingChange({ ...reading, position });
    setJump((old) => ({ position, revision: old.revision + 1 }));
    closePanel();
  };
  const blocked = panel !== null || editing !== null;
  const saveAnnotation = (record: DemoAnnotation) =>
    onReadingChange({
      ...reading,
      annotations: [
        ...reading.annotations.filter((item) => item.id !== record.id),
        record,
      ],
    });
  const surfaceProps = {
    ref: surface,
    preferences,
    annotations: reading.annotations,
    initialPosition: reading.position,
    jump,
    onPosition: (position: number) => onReadingChange({ ...reading, position }),
    onTap: () => setFocused((value) => !value),
    onSelectionAction: (
      kind: DemoAnnotation["kind"],
      selection: DemoTextSelection,
    ) =>
      setEditing(
        reading.annotations.find((item) =>
          selection.pdf
            ? item.pdf?.page === selection.pdf.page &&
              item.pdf.rects.some((existing) =>
                selection.pdf!.rects.some(
                  (rect) =>
                    rect.x < existing.x + existing.width &&
                    rect.x + rect.width > existing.x &&
                    rect.y < existing.y + existing.height &&
                    rect.y + rect.height > existing.y,
                ),
              )
            : item.ranges.some((existing) =>
                selection.ranges.some(
                  (range) =>
                    range.position === existing.position &&
                    range.start < existing.end &&
                    range.end > existing.start,
                ),
              ),
        ) ?? {
          ...selection,
          id: "a-" + Date.now(),
          kind,
          color: "#EAD58A",
          body: "",
        },
      ),
    onAnnotation: (id: string) =>
      setEditing(reading.annotations.find((item) => item.id === id) ?? null),
  };
  if (!current) return null;
  return (
    <View style={s.root}>
      <View
        style={[s.bodyContainer, !isPdf && { marginTop: insets.top }]}
        pointerEvents={blocked ? "none" : "auto"}
        accessibilityElementsHidden={blocked}
        importantForAccessibility={blocked ? "no-hide-descendants" : "auto"}
      >
        {isPdf ? (
          <DemoPdfSurface
            {...surfaceProps}
            onReady={setPdfPages}
            onAsk={onAsk}
          />
        ) : (
          <DemoReadingSurface
            {...surfaceProps}
            samples={samples}
            focused={focused}
          />
        )}
        <View
          pointerEvents={focused ? "none" : "auto"}
          accessibilityElementsHidden={focused}
          importantForAccessibility={focused ? "no-hide-descendants" : "auto"}
          style={[
            s.topBar,
            isPdf && { top: insets.top + 8 },
            focused && s.hidden,
          ]}
        >
          <IconButton label="返回书架" icon={ChevronLeft} onPress={onBack} />
          <View style={s.titleBlock}>
            <Text numberOfLines={1} style={s.bookTitle}>
              {book.title}
            </Text>
          </View>
          <IconButton
            label="开启阅读专注模式"
            icon={Maximize2}
            onPress={() => setFocused(true)}
          />
          <IconButton
            label={saved ? "取消当前位置书签" : "添加当前位置书签"}
            icon={Bookmark}
            selected={saved}
            onPress={() => toggleBookmark()}
          />
        </View>
        <View
          pointerEvents={focused ? "none" : "auto"}
          accessibilityElementsHidden={focused}
          importantForAccessibility={focused ? "no-hide-descendants" : "auto"}
          style={[
            s.bottomBar,
            { bottom: Math.max(insets.bottom, 12) },
            focused && s.hidden,
          ]}
        >
          <View style={s.tools}>
            <Tool
              label="目录"
              icon={List}
              onPress={() => openPanel("contents")}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => onAsk()}
              style={({ pressed }) => [s.ask, pressed && s.pressed]}
            >
              <MessageCircle size={18} color={c.accent} />
              <Text style={s.askText}>问问这本书</Text>
            </Pressable>
            <Tool
              label="阅读设置"
              icon={Settings2}
              onPress={() => openPanel("settings")}
            />
          </View>
        </View>
      </View>
      {panel && (
        <DemoSheet
          ref={sheet}
          initialHeight={panel === "settings" ? 46 : 70}
          onClose={() => setPanel(null)}
        >
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>
              {panel === "settings" ? "阅读设置" : book.title}
            </Text>
            <IconButton
              label={panel === "settings" ? "全屏阅读设置" : "全屏目录"}
              icon={Maximize2}
              onPress={() => sheet.current?.snapToIndex(1)}
            />
            {panel === "settings" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="完成阅读设置"
                onPress={closePanel}
                style={s.done}
              >
                <Text style={s.doneLabel}>完成</Text>
              </Pressable>
            ) : (
              <IconButton label="关闭目录" icon={X} onPress={closePanel} />
            )}
          </View>
          <BottomSheetScrollView
            contentContainerStyle={[
              s.sheetContent,
              { paddingBottom: Math.max(insets.bottom, 16) },
            ]}
          >
            {panel === "settings" ? (
              <>
                <Text style={s.fieldLabel}>翻页方式</Text>
                <View style={s.segment} accessibilityRole="radiogroup">
                  {(
                    [
                      ["paginated", isPdf ? "单页" : "左右翻页", Columns2],
                      [
                        "scrolled",
                        isPdf ? "连续滚动" : "上下滚动",
                        AlignJustify,
                      ],
                    ] as const
                  ).map(([option, label, Icon]) => (
                    <Pressable
                      key={option}
                      accessibilityRole="radio"
                      accessibilityLabel={label}
                      accessibilityState={{
                        checked: flow === option,
                      }}
                      onPress={() =>
                        onPreferencesChange(
                          isPdf
                            ? { ...preferences, pdfFlow: option }
                            : { ...preferences, flow: option },
                        )
                      }
                      style={[
                        s.segmentItem,
                        flow === option && s.segmentSelected,
                      ]}
                    >
                      <Icon
                        size={18}
                        color={flow === option ? c.accent : c.secondary}
                      />
                      <Text
                        style={[s.segmentLabel, flow === option && s.accent]}
                      >
                        {label}
                      </Text>
                      {flow === option && <Check size={15} color={c.accent} />}
                    </Pressable>
                  ))}
                </View>
                {!isPdf && (
                  <View style={s.fontRow}>
                    <Text style={s.fieldLabel}>字号</Text>
                    <View style={s.fontControls}>
                      <IconButton
                        label="减小阅读字号"
                        icon={Minus}
                        disabled={preferences.fontSize <= 16}
                        onPress={() =>
                          onPreferencesChange({
                            ...preferences,
                            fontSize: preferences.fontSize - 2,
                          })
                        }
                      />
                      <Text style={s.fontValue}>{preferences.fontSize}</Text>
                      <IconButton
                        label="增大阅读字号"
                        icon={Plus}
                        disabled={preferences.fontSize >= 28}
                        onPress={() =>
                          onPreferencesChange({
                            ...preferences,
                            fontSize: preferences.fontSize + 2,
                          })
                        }
                      />
                    </View>
                  </View>
                )}
              </>
            ) : (
              <>
                <View style={s.segment} accessibilityRole="tablist">
                  {(
                    [
                      ["contents", isPdf ? "页面" : "目录"],
                      [
                        "bookmarks",
                        "书签" +
                          (reading.bookmarks.length
                            ? " · " + reading.bookmarks.length
                            : ""),
                      ],
                    ] as const
                  ).map(([id, label]) => (
                    <Pressable
                      key={id}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: section === id }}
                      onPress={() => setSection(id)}
                      style={[
                        s.segmentItem,
                        section === id && s.segmentSelected,
                      ]}
                    >
                      <Text
                        style={[s.segmentLabel, section === id && s.accent]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {section === "contents" ? (
                  locations.map(
                    (item, index) =>
                      item.paragraphIndex === 0 && (
                        <Pressable
                          key={item.id}
                          accessibilityRole="button"
                          accessibilityLabel={"跳转到" + item.chapter}
                          accessibilityState={{
                            selected:
                              item.chapterIndex === current.chapterIndex,
                          }}
                          onPress={() => navigate(index)}
                          style={({ pressed }) => [
                            s.chapterRow,
                            pressed && s.pressed,
                          ]}
                        >
                          <Text style={s.chapterNumber}>
                            {String(item.chapterIndex + 1).padStart(2, "0")}
                          </Text>
                          <Text
                            style={[
                              s.chapterName,
                              item.chapterIndex === current.chapterIndex &&
                                s.accent,
                            ]}
                          >
                            {item.chapter}
                          </Text>
                          {item.chapterIndex === current.chapterIndex && (
                            <Text style={s.currentLabel}>正在读</Text>
                          )}
                        </Pressable>
                      ),
                  )
                ) : (
                  <>
                    {!reading.bookmarks.length && (
                      <Text style={s.empty}>还没有书签</Text>
                    )}
                    {reading.bookmarks.map((position) => {
                      const item = locations[position];
                      return (
                        item && (
                          <View key={item.id} style={s.bookmarkRow}>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={
                                "跳转到书签：" +
                                item.chapter +
                                "：" +
                                item.text.slice(0, 12)
                              }
                              onPress={() => navigate(position)}
                              style={s.bookmarkContent}
                            >
                              <Text style={s.bookmarkTitle}>
                                {item.chapter}
                              </Text>
                              <Text numberOfLines={2} style={s.bookmarkQuote}>
                                {item.text}
                              </Text>
                            </Pressable>
                            <IconButton
                              label={
                                "删除书签：" +
                                item.chapter +
                                "第" +
                                (item.paragraphIndex + 1) +
                                "段"
                              }
                              icon={Trash2}
                              onPress={() => toggleBookmark(position)}
                            />
                          </View>
                        )
                      );
                    })}
                  </>
                )}
              </>
            )}
          </BottomSheetScrollView>
        </DemoSheet>
      )}
      {editing && (
        <DemoAnnotationEditor
          key={editing.id}
          annotation={editing}
          existing={reading.annotations.some((item) => item.id === editing.id)}
          onSave={saveAnnotation}
          onRemove={() =>
            onReadingChange({
              ...reading,
              annotations: reading.annotations.filter(
                (item) => item.id !== editing.id,
              ),
            })
          }
          onClose={() => {
            setEditing(null);
            surface.current?.clearSelection();
          }}
        />
      )}
    </View>
  );
}

function IconButton({
  label,
  icon: Icon,
  onPress,
  selected,
  disabled,
}: {
  label: string;
  icon: typeof Bookmark;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.iconButton,
        (pressed || disabled) && s.pressed,
      ]}
    >
      <Icon
        size={20}
        color={selected ? c.accent : c.secondary}
        fill={selected ? c.accent : "none"}
      />
    </Pressable>
  );
}
function Tool({
  label,
  icon: Icon,
  onPress,
}: {
  label: string;
  icon: typeof List;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [s.tool, pressed && s.pressed]}
    >
      <Icon size={19} color={c.secondary} />
      <Text style={s.toolLabel}>{label}</Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: c.paper,
  },
  bodyContainer: { flex: 1 },
  hidden: { opacity: 0 },
  pressed: { opacity: 0.45 },
  topBar: {
    position: "absolute",
    top: 8,
    left: 12,
    right: 12,
    minHeight: 52,
    paddingHorizontal: 4,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(250,249,246,0.96)",
    borderRadius: 26,
    borderCurve: "continuous",
    shadowColor: c.ink,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
  },
  titleBlock: { flex: 1, paddingHorizontal: 4 },
  bookTitle: { fontSize: 15, lineHeight: 22, fontWeight: "600", color: c.ink },
  iconButton: {
    width: 44,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  bottomBar: {
    position: "absolute",
    left: 16,
    right: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "rgba(250,249,246,0.96)",
    borderRadius: 31,
    borderCurve: "continuous",
    shadowColor: c.ink,
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
  },
  tools: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  tool: {
    minHeight: 50,
    minWidth: 58,
    gap: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  toolLabel: { color: c.secondary, fontSize: 11, lineHeight: 17 },
  ask: {
    minHeight: 44,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: c.accentWash,
    borderRadius: 24,
  },
  askText: { color: c.accent, fontSize: 15, lineHeight: 23 },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 24,
    paddingRight: 12,
    paddingBottom: 8,
    gap: 12,
  },
  sheetTitle: {
    color: c.ink,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "600",
    flex: 1,
  },
  sheetContent: { paddingHorizontal: 24 },
  fieldLabel: {
    color: c.secondary,
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 10,
  },
  segment: {
    flexDirection: "row",
    backgroundColor: c.tint,
    borderRadius: 12,
    padding: 3,
    marginBottom: 14,
    gap: 3,
  },
  segmentItem: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  segmentSelected: { backgroundColor: c.surface },
  segmentLabel: { color: c.secondary, fontSize: 15, lineHeight: 22 },
  accent: { color: c.accent },
  fontRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  fontControls: { flexDirection: "row", alignItems: "center" },
  fontValue: {
    color: c.ink,
    fontSize: 16,
    fontVariant: ["tabular-nums"],
    minWidth: 28,
    textAlign: "center",
  },
  done: {
    minWidth: 60,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  doneLabel: { color: c.accent, fontSize: 16, fontWeight: "600" },
  chapterRow: {
    minHeight: 68,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
  },
  chapterNumber: {
    color: c.muted,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  chapterName: { color: c.ink, fontSize: 18, lineHeight: 28, flex: 1 },
  currentLabel: { color: c.accent, fontSize: 11, lineHeight: 18 },
  empty: {
    color: c.muted,
    fontSize: 15,
    lineHeight: 24,
    textAlign: "center",
    paddingVertical: 42,
  },
  bookmarkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
  },
  bookmarkContent: { flex: 1, minHeight: 60 },
  bookmarkTitle: {
    color: c.ink,
    fontSize: 17,
    lineHeight: 25,
    marginBottom: 6,
  },
  bookmarkQuote: {
    fontFamily: "Songti SC",
    color: c.secondary,
    fontSize: 15,
    lineHeight: 25,
  },
});
