import { useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { Check } from "lucide-react-native";
import { normalizeReaderSpacing } from "@shudeng/core/domain/reader-spacing";
import type {
  ReaderPreferences,
  ShelfAnnotation,
} from "../../platform/library";
import { usePalette, type Palette } from "../theme";
import { useAppearance } from "../appearance";
import { ReaderPanel } from "./ReaderPanel";
import { ReaderNavigationTabs } from "./ReaderNavigation";
import { ReaderSpacingControls, ReaderValueStepper } from "./ReaderSpacingControls";

const readerThemes = [
  { value: "light", label: "明亮" },
  { value: "dark", label: "深色" },
] as const;

/** Every change is applied to the actual book; closing only dismisses the controls. */
export function ReaderSettingsPanel({
  visible,
  preferences,
  onClose,
  onApply,
  curlAvailable = false,
  spacingAvailable = true,
}: {
  readonly visible: boolean;
  readonly preferences: ReaderPreferences;
  readonly onClose: () => void;
  readonly onApply: (value: ReaderPreferences) => Promise<boolean>;
  readonly curlAvailable?: boolean;
  readonly spacingAvailable?: boolean;
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
      initialHeight={spacingAvailable ? 62 : 46}
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
          <View style={styles.typography}>
            <ReaderValueStepper
              label="字号"
              value={preferences.fontScale}
              min={0.75}
              max={2}
              step={0.25}
              palette={palette}
              disabled={blocked}
              onAdjust={(delta) => {
                if (!canInteract()) return;
                const fontScale = Math.max(0.75, Math.min(2, confirmed.current.value.fontScale + delta));
                if (fontScale !== confirmed.current.value.fontScale) void apply({ fontScale });
              }}
            />
            {spacingAvailable && (
              <ReaderSpacingControls
                spacing={preferences}
                palette={palette}
                disabled={blocked}
                onAdjust={(field, delta) => {
                  if (!canInteract()) return;
                  const current = confirmed.current.value[field];
                  const next = normalizeReaderSpacing(field, current + delta);
                  if (next !== current) void apply({ [field]: next });
                }}
              />
            )}
          </View>
          <Text style={styles.section}>主题</Text>
          <ReaderNavigationTabs
            accessibilityLabel="阅读主题"
            style={styles.themeControl}
            value={preferences.theme}
            items={readerThemes}
            disabled={blocked}
            onChange={(theme) => {
              if (canInteract()) void apply({ theme });
            }}
          />
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
    text: { color: palette.ink, fontSize: 16, lineHeight: 24 },
    secondary: { color: palette.ink2, fontSize: 14, lineHeight: 24 },
    segment: {
      flexDirection: "row",
      marginHorizontal: 20,
      marginTop: 8,
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
      marginTop: 12,
      marginLeft: 24,
      fontSize: 13,
      color: palette.ink2,
    },
    settingsContent: { paddingBottom: 36 },
    themeControl: { marginHorizontal: 20, marginTop: 8, marginBottom: 0 },
    typography: { marginHorizontal: 20 },
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
