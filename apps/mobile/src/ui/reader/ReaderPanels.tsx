import { useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { Check } from "lucide-react-native";
import type {
  ReaderPreferences,
  ShelfAnnotation,
} from "../../platform/library";
import { usePalette, type Palette } from "../theme";
import { useAppearance } from "../appearance";
import { ReaderPanel } from "./ReaderPanel";

/** Every change is applied to the actual book; closing only dismisses the controls. */
export function ReaderSettingsPanel({
  visible,
  preferences,
  onClose,
  onApply,
  curlAvailable = false,
}: {
  readonly visible: boolean;
  readonly preferences: ReaderPreferences;
  readonly onClose: () => void;
  readonly onApply: (value: ReaderPreferences) => Promise<boolean>;
  readonly curlAvailable?: boolean;
}) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  // A native button event can arrive after saving but before new props commit.
  const confirmed = useRef({ supplied: preferences, value: preferences });
  if (confirmed.current.supplied !== preferences)
    confirmed.current = { supplied: preferences, value: preferences };
  const apply = async (change: Partial<ReaderPreferences>) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const next = { ...confirmed.current.value, ...change };
      if (await onApply(next)) confirmed.current.value = next;
    } catch (cause) {
      Alert.alert(
        "设置尚未保存",
        cause instanceof Error ? cause.message : String(cause),
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return (
    <ReaderPanel
      visible={visible}
      title="阅读设置"
      initialHeight={46}
      busy={saving}
      onClose={onClose}
    >
      {({ canInteract, blocked }) => (
        <BottomSheetScrollView contentContainerStyle={styles.settingsContent}>
          <Text style={styles.section}>阅读方式</Text>
          <View style={styles.segment}>
            {(["paginated", "scrolled", "curl"] as const).map((flow, index) => {
              const disabled = blocked || (flow === "curl" && !curlAvailable);
              return (
                <Pressable
                  key={flow}
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: preferences.flow === flow,
                    disabled,
                  }}
                  disabled={disabled}
                  onPress={() => {
                    if (canInteract()) void apply({ flow });
                  }}
                  style={[
                    styles.segmentItem,
                    preferences.flow === flow && styles.segmentSelected,
                    disabled && styles.disabled,
                  ]}
                >
                  <Text style={styles.text}>
                    {["分页", "滚动", "仿真"][index]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.section}>字号</Text>
          <View style={styles.fontRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="缩小字号"
              disabled={blocked || preferences.fontScale <= 0.75}
              onPress={() => {
                if (canInteract())
                  void apply({
                    fontScale: Math.max(
                      0.75,
                      confirmed.current.value.fontScale - 0.25,
                    ),
                  });
              }}
              style={styles.fontButton}
            >
              <Text style={styles.action}>A−</Text>
            </Pressable>
            <Text style={styles.text}>
              {Math.round(preferences.fontScale * 100)}%
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="增大字号"
              disabled={blocked || preferences.fontScale >= 2}
              onPress={() => {
                if (canInteract())
                  void apply({
                    fontScale: Math.min(
                      2,
                      confirmed.current.value.fontScale + 0.25,
                    ),
                  });
              }}
              style={styles.fontButton}
            >
              <Text style={styles.action}>A+</Text>
            </Pressable>
          </View>
          <Text style={styles.section}>主题</Text>
          <View style={styles.segment}>
            {(["light", "dark"] as const).map((theme) => (
              <Pressable
                key={theme}
                accessibilityRole="button"
                accessibilityState={{ selected: preferences.theme === theme }}
                disabled={blocked}
                onPress={() => {
                  if (canInteract()) void apply({ theme });
                }}
                style={[
                  styles.segmentItem,
                  preferences.theme === theme && styles.segmentSelected,
                ]}
              >
                <Text style={styles.text}>
                  {theme === "light" ? "明亮" : "深色"}
                </Text>
              </Pressable>
            ))}
          </View>
        </BottomSheetScrollView>
      )}
    </ReaderPanel>
  );
}

export const highlightColors = {
  yellow: "#F2DBA6",
  green: "#DEE8D3",
  blue: "#DCE6EC",
  rose: "#F3DEDA",
} as const;
export const darkHighlightColors = {
  yellow: "#5A4A2A",
  green: "#30402C",
  blue: "#2C3A44",
  rose: "#472F2C",
} as const;

export function HighlightPanel({
  annotation,
  onClose,
  onColor,
  busy = false,
}: {
  readonly annotation: ShelfAnnotation | null;
  readonly onClose: () => void;
  readonly onColor: (color: string) => void;
  readonly busy?: boolean;
}) {
  return (
    <HighlightPalette
      visible={!!annotation}
      selected={annotation?.color ?? null}
      quote={annotation?.quote}
      busy={busy}
      onClose={onClose}
      onColor={onColor}
    />
  );
}

export function HighlightPalette({
  visible,
  selected,
  quote,
  newHighlight = false,
  busy = false,
  onClose,
  onColor,
}: {
  readonly visible: boolean;
  readonly selected: string | null;
  readonly quote?: string | undefined;
  readonly newHighlight?: boolean;
  readonly busy?: boolean;
  readonly onClose: () => void;
  readonly onColor: (color: string) => void;
}) {
  const palette = usePalette();
  const { resolvedMode } = useAppearance();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const current = selected === "pink" ? "rose" : selected;
  return (
    <ReaderPanel
      visible={visible}
      title="高亮"
      initialHeight={42}
      busy={busy}
      onClose={onClose}
    >
      {({ canInteract, blocked }) => (
        <BottomSheetScrollView contentContainerStyle={styles.highlightContent}>
          {quote ? (
            <Text numberOfLines={3} style={styles.secondary}>
              {quote}
            </Text>
          ) : null}
          <View style={styles.colorRow}>
            {Object.entries(highlightColors).map(([color, paint]) => (
              <Pressable
                key={color}
                accessibilityRole="button"
                accessibilityLabel={
                  { yellow: "黄色", green: "绿色", blue: "蓝色", rose: "粉色" }[
                    color as keyof typeof highlightColors
                  ] + "高亮"
                }
                accessibilityHint={
                  !newHighlight && current === color
                    ? "再次点击取消高亮"
                    : undefined
                }
                accessibilityState={{
                  selected: current === color,
                  disabled: blocked,
                }}
                disabled={blocked}
                onPress={() => {
                  if (canInteract()) onColor(color);
                }}
                style={[
                  styles.color,
                  {
                    backgroundColor:
                      resolvedMode === "dark"
                        ? darkHighlightColors[
                            color as keyof typeof darkHighlightColors
                          ]
                        : paint,
                  },
                  blocked && styles.disabled,
                ]}
              >
                {current === color ? (
                  <Check size={22} color={palette.ink} />
                ) : null}
              </Pressable>
            ))}
          </View>
        </BottomSheetScrollView>
      )}
    </ReaderPanel>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    action: { color: palette.lampInk, fontSize: 16 },
    text: { color: palette.ink, fontSize: 16, lineHeight: 24 },
    secondary: { color: palette.ink2, fontSize: 14, lineHeight: 24 },
    segment: {
      flexDirection: "row",
      margin: 20,
      backgroundColor: palette.paperDeep,
      borderRadius: 12,
      padding: 3,
    },
    segmentItem: {
      flex: 1,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 9,
    },
    segmentSelected: { backgroundColor: palette.surface },
    section: {
      marginTop: 16,
      marginLeft: 24,
      fontSize: 13,
      color: palette.ink2,
    },
    settingsContent: { paddingBottom: 36 },
    fontRow: {
      margin: 20,
      minHeight: 56,
      backgroundColor: palette.paperDeep,
      borderRadius: 12,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    fontButton: {
      minWidth: 72,
      minHeight: 52,
      alignItems: "center",
      justifyContent: "center",
    },
    disabled: { opacity: 0.35 },
    highlightContent: { paddingHorizontal: 26, paddingBottom: 32, gap: 20 },
    colorRow: {
      flexDirection: "row",
      justifyContent: "space-around",
      gap: 12,
      paddingVertical: 12,
    },
    color: {
      width: 46,
      height: 46,
      borderRadius: 23,
      alignItems: "center",
      justifyContent: "center",
    },
  });
}
