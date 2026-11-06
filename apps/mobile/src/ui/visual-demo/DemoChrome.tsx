import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Search, X } from "lucide-react-native";
import { demoColors as c } from "./demoTheme";

/** Consistent fixed page heading/search for this experiment. */
export function DemoHeading({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <View style={s.heading}>
      <Text accessibilityRole="header" style={s.title}>
        {title}
      </Text>
      {action}
    </View>
  );
}

export function DemoSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <View style={s.search}>
      <Search size={19} color={c.muted} accessible={false} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        accessibilityLabel={placeholder}
        returnKeyType="search"
        style={s.input}
      />
      {value.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="清除搜索"
          onPress={() => onChange("")}
          style={s.clear}
        >
          <X size={17} color={c.secondary} />
        </Pressable>
      )}
    </View>
  );
}
export function DemoEmpty({ query }: { query: string }) {
  return (
    <View style={s.empty}>
      <Text style={s.emptyTitle}>没有找到相关内容</Text>
      <Text style={s.emptyText}>试试其他关键词</Text>
      <Text style={s.emptyQuery} numberOfLines={2}>
        {query}
      </Text>
    </View>
  );
}
const s = StyleSheet.create({
  heading: {
    paddingHorizontal: 24,
    paddingTop: 15,
    paddingBottom: 21,
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 34,
    lineHeight: 43,
    fontWeight: "700",
    letterSpacing: -0.6,
    color: c.ink,
  },
  search: {
    marginHorizontal: 24,
    marginBottom: 12,
    minHeight: 46,
    paddingLeft: 13,
    paddingRight: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderRadius: 12,
    backgroundColor: c.tint,
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 11,
    color: c.ink,
    fontSize: 16,
    lineHeight: 23,
  },
  clear: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    paddingHorizontal: 24,
    paddingTop: 64,
    alignItems: "center",
    gap: 10,
  },
  emptyTitle: { fontSize: 18, color: c.ink, fontWeight: "500" },
  emptyText: { fontSize: 15, color: c.secondary },
  emptyQuery: { fontSize: 14, color: c.muted },
});
