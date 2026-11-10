import { useEffect, useMemo, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Bookmark,
  ChevronLeft,
  Info,
  List,
  Maximize2,
  MessageCircle,
  Settings2,
} from "lucide-react-native";
import { usePalette, type Palette } from "../ui/theme";
import { useReduceMotion } from "../ui/chat/useReduceMotion";

export type ReaderChromeProps = {
  readonly title: string;
  readonly format?: "epub" | "pdf";
  readonly referenceMode?: boolean;
  readonly visible: boolean;
  readonly onBack: () => void;
  readonly onAnnotations?: () => void;
  readonly onSettings?: () => void;
  readonly onHelp?: () => void;
  readonly onBookmark?: () => void;
  readonly bookmarked?: boolean;
  readonly onAsk: () => void;
  readonly controlsEnabled?: boolean;
  readonly onToggleChrome?: () => void;
};

/** Reading occupies a stable viewport; these surfaces float above it on every platform. */
export function ReaderChrome({
  title,
  format = "epub",
  referenceMode = false,
  visible,
  controlsEnabled = true,
  onBack,
  onAnnotations,
  onSettings,
  onHelp,
  onBookmark,
  bookmarked = false,
  onAsk,
  onToggleChrome,
}: ReaderChromeProps) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: reduceMotion ? 0 : 180,
      useNativeDriver: true,
    }).start();
  }, [opacity, reduceMotion, visible]);
  return (
    <>
      {!visible && onToggleChrome ? (
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel="显示阅读工具栏"
          onPress={onToggleChrome}
          style={styles.accessibleToggle}
        />
      ) : null}
      <Animated.View
        style={[styles.root, { opacity }]}
        pointerEvents={visible ? "box-none" : "none"}
        accessibilityElementsHidden={!visible}
        importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
      >
        {/* PDFKit uses these mounted native bounds to position its selection menu. */}
        <View
          testID={format === "pdf" ? "pdf-reader-toolbar" : undefined}
          collapsable={false}
          style={[
            styles.toolbar,
            {
              top: insets.top + 8,
              left: Math.max(12, insets.left),
              right: Math.max(12, insets.right),
            },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={referenceMode ? "返回问答" : "返回书架"}
            onPress={onBack}
            style={styles.iconButton}
          >
            <ChevronLeft size={20} color={palette.ink2} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {referenceMode ? "返回问答 · " + title : title}
          </Text>
          {onHelp ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关于这份 PDF"
              onPress={onHelp}
              style={styles.iconButton}
            >
              <Info size={18} color={palette.ink2} />
            </Pressable>
          ) : null}
          {onToggleChrome ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="开启阅读专注模式"
              onPress={onToggleChrome}
              style={styles.iconButton}
            >
              <Maximize2 size={18} color={palette.ink2} />
            </Pressable>
          ) : null}
          {onBookmark ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                bookmarked ? "取消当前位置书签" : "添加当前位置书签"
              }
              accessibilityState={{
                selected: bookmarked,
                disabled: !controlsEnabled,
              }}
              disabled={!controlsEnabled}
              onPress={onBookmark}
              style={[styles.iconButton, !controlsEnabled && styles.disabled]}
            >
              <Bookmark
                size={20}
                color={bookmarked ? palette.lampInk : palette.ink2}
                fill={bookmarked ? palette.lampInk : "none"}
              />
            </Pressable>
          ) : null}
        </View>
        <View
          testID={format === "pdf" ? "pdf-reader-footer" : undefined}
          collapsable={false}
          style={[
            styles.footer,
            {
              bottom: Math.max(insets.bottom, 12),
              left: Math.max(16, insets.left),
              right: Math.max(16, insets.right),
            },
          ]}
        >
          {onAnnotations ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="目录、书签与标注"
              onPress={onAnnotations}
              disabled={!controlsEnabled}
              style={[styles.tool, !controlsEnabled && styles.disabled]}
            >
              <List size={20} color={palette.ink2} />
              <Text style={styles.toolLabel}>目录</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="问问这本书"
            onPress={onAsk}
            disabled={!controlsEnabled}
            style={[styles.ask, !controlsEnabled && styles.disabled]}
          >
            <MessageCircle size={18} color={palette.lampInk} />
            <Text style={styles.askText}>问问这本书</Text>
          </Pressable>
          {onSettings ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="阅读设置"
              onPress={onSettings}
              disabled={!controlsEnabled}
              style={[styles.tool, !controlsEnabled && styles.disabled]}
            >
              <Settings2 size={20} color={palette.ink2} />
              <Text style={styles.toolLabel}>阅读设置</Text>
            </Pressable>
          ) : null}
        </View>
      </Animated.View>
    </>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    root: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zIndex: 20,
    },
    accessibleToggle: {
      position: "absolute",
      left: 0,
      top: 0,
      width: 1,
      height: 1,
    },
    toolbar: {
      position: "absolute",
      minHeight: 52,
      paddingHorizontal: 4,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: palette.paper + "F5",
      borderRadius: 26,
      borderCurve: "continuous",
      shadowColor: "#000",
      shadowOpacity: 0.08,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 2 },
    },
    title: {
      flex: 1,
      paddingHorizontal: 4,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: "600",
      color: palette.ink,
    },
    iconButton: {
      width: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    footer: {
      position: "absolute",
      paddingHorizontal: 12,
      paddingVertical: 6,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      backgroundColor: palette.paper + "F5",
      borderRadius: 31,
      borderCurve: "continuous",
      shadowColor: "#000",
      shadowOpacity: 0.1,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 4 },
    },
    tool: {
      minWidth: 58,
      minHeight: 50,
      gap: 3,
      alignItems: "center",
      justifyContent: "center",
    },
    toolLabel: { color: palette.ink2, fontSize: 11, lineHeight: 17 },
    ask: {
      minHeight: 44,
      flexShrink: 1,
      paddingHorizontal: 18,
      gap: 7,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.lampWash,
      borderRadius: 24,
    },
    askText: { color: palette.lampInk, fontSize: 15, lineHeight: 23 },
    disabled: { opacity: 0.35 },
  });
}
