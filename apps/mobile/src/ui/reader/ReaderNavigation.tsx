import { useMemo, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SegmentedControl } from "@expo/ui/community/segmented-control";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { Search, Trash2 } from "lucide-react-native";
import { usePalette, type Palette } from "../theme";
import { useAppearance } from "../appearance";

/** Shared presentation only; EPUB and PDF keep their own queries and source locations. */
export function ReaderNavigationTabs<T extends string>({
  value,
  items,
  onChange,
  disabled = false,
  accessibilityLabel = "书内导航",
  style,
}: {
  readonly value: T;
  readonly items: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
  readonly accessibilityLabel?: string;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const { resolvedMode } = useAppearance();
  return (
    <SegmentedControl
      style={[segmentLayout, style]}
      accessibilityLabel={accessibilityLabel}
      values={items.map((item) => item.label)}
      selectedIndex={items.findIndex((item) => item.value === value)}
      appearance={resolvedMode}
      enabled={!disabled}
      onChange={({ nativeEvent: { selectedSegmentIndex } }) => {
        const selected = items[selectedSegmentIndex];
        if (!disabled && selected && selected.value !== value) onChange(selected.value);
      }}
    />
  );
}

const segmentLayout = { marginHorizontal: 24, marginBottom: 12 };

export function ReaderSearchField({
  value,
  onChange,
  enabled = true,
}: {
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly enabled?: boolean;
}) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  return (
    <View style={styles.searchBox}>
      <Search size={17} color={palette.ink3} accessible={false} />
      <BottomSheetTextInput
        value={value}
        onChangeText={onChange}
        editable={enabled}
        accessibilityLabel="搜索书内文字"
        placeholder="搜索书内文字"
        placeholderTextColor={palette.ink3}
        autoCorrect={false}
        returnKeyType="search"
        style={styles.input}
      />
    </View>
  );
}

export function ReaderNavigationRow({
  title,
  detail,
  depth = 0,
  detailLines = 2,
  selected = false,
  selectedLabel,
  onPress,
  onDelete,
}: {
  readonly title: string;
  readonly detail?: string | null;
  readonly depth?: number;
  readonly detailLines?: number;
  readonly selected?: boolean;
  readonly selectedLabel?: string;
  readonly onPress: (event: GestureResponderEvent) => void;
  readonly onDelete?: (() => void) | undefined;
}) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        style={[
          styles.rowContent,
          { paddingLeft: 10 + Math.min(depth, 5) * 16 },
        ]}
        onPress={onPress}
      >
        <Text
          style={[
            styles.rowTitle,
            depth === 0 && styles.chapter,
            selected && styles.activeTabText,
          ]}
        >
          {title}
        </Text>
        {selected && selectedLabel ? <Text style={styles.selectedLabel}>{selectedLabel}</Text> : null}
        {detail ? (
          <Text style={styles.detail} numberOfLines={detailLines}>
            {detail}
          </Text>
        ) : null}
      </Pressable>
      {onDelete ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={"删除书签：" + title}
          onPress={onDelete}
          style={styles.icon}
        >
          <Trash2 size={18} color={palette.ink3} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function ReaderNavigationEmpty({
  busy,
  children,
}: {
  readonly busy?: boolean;
  readonly children: ReactNode;
}) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  return (
    <View style={styles.empty}>
      {busy ? <ActivityIndicator color={palette.lampInk} /> : null}
      <Text style={styles.emptyText}>{children}</Text>
    </View>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    selectedLabel: { color: palette.lampInk, fontSize: 12, fontWeight: "600" },
    activeTabText: { color: palette.ink, fontWeight: "600" },
    searchBox: {
      marginHorizontal: 24,
      marginBottom: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: palette.paperDeep,
      borderRadius: 14,
      paddingHorizontal: 12,
    },
    input: { flex: 1, color: palette.ink, minHeight: 44, fontSize: 16 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.line,
    },
    rowContent: {
      flex: 1,
      minHeight: 58,
      justifyContent: "center",
      paddingRight: 10,
      paddingVertical: 15,
      gap: 5,
    },
    rowTitle: { color: palette.ink, fontSize: 16, lineHeight: 25 },
    chapter: { fontWeight: "600" },
    detail: { color: palette.ink3, fontSize: 14, lineHeight: 23 },
    icon: {
      width: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    empty: {
      minHeight: 180,
      alignItems: "center",
      justifyContent: "center",
      gap: 14,
    },
    emptyText: {
      color: palette.ink3,
      textAlign: "center",
      fontSize: 15,
      lineHeight: 24,
    },
  });
}
