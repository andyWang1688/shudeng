import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Search, X } from "lucide-react-native";
import { usePalette } from "../theme";

/** Stable heading and search geometry across the app's primary destinations. */
export function PageHeading({
  title,
  action,
}: {
  readonly title: string;
  readonly action?: ReactNode;
}) {
  const palette = usePalette();
  return (
    <View style={styles.heading}>
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: palette.ink }]}
      >
        {title}
      </Text>
      {action}
    </View>
  );
}

export function PageSearch({
  value,
  onChange,
  placeholder,
  testID,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly testID?: string;
}) {
  const palette = usePalette();
  return (
    <View style={styles.searchContainer}>
      <View style={[styles.search, { backgroundColor: palette.paperDeep }]}>
        <Search size={19} color={palette.ink3} accessible={false} />
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={palette.ink3}
          accessibilityLabel={placeholder}
          returnKeyType="search"
          autoCorrect={false}
          style={[styles.input, { color: palette.ink }]}
        />
        {!!value.length && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="清除搜索"
            onPress={() => onChange("")}
            style={styles.clear}
          >
            <X size={17} color={palette.ink2} accessible={false} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    width: "100%",
    maxWidth: 900,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingTop: 15,
    paddingBottom: 21,
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    flexShrink: 1,
    fontSize: 34,
    lineHeight: 43,
    fontWeight: "700",
    letterSpacing: -0.6,
  },
  searchContainer: {
    width: "100%",
    maxWidth: 900,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingBottom: 12,
  },
  search: {
    minHeight: 46,
    paddingLeft: 13,
    paddingRight: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderRadius: 12,
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 11,
    fontSize: 16,
    lineHeight: 23,
  },
  clear: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
