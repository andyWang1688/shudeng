import { useMemo, useRef, useState, type ComponentRef } from "react";
import {
  Keyboard,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { SymbolView } from "expo-symbols";
import {
  searchFieldChrome,
  searchFieldIconColor,
  searchFieldPlaceholderColor,
  searchFieldTextColor,
  usePalette,
  type Palette,
} from "../theme";

type Props = {
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder: string;
  readonly style?: StyleProp<ViewStyle>;
};

/** 书架搜索：编辑时显示取消，结束编辑后收回；取消同时清空查询。 */
export function SearchField({
  value,
  onChangeText,
  placeholder,
  style,
}: Props) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [focused, setFocused] = useState(false);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const reducedMotion = useReducedMotion();
  const updateFocus = (next: boolean) => {
    if (!reducedMotion)
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setFocused(next);
  };
  return (
    <View style={[styles.row, style]}>
      <View style={styles.field}>
        <SymbolView
          name="magnifyingglass"
          size={20}
          weight="medium"
          tintColor={searchFieldIconColor(palette)}
        />
        <TextInput
          ref={input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={searchFieldPlaceholderColor(palette)}
          style={styles.input}
          returnKeyType="search"
          accessibilityLabel={placeholder}
          onFocus={() => updateFocus(true)}
          onBlur={() => updateFocus(false)}
          onSubmitEditing={() => input.current?.blur()}
        />
        {value.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="清空搜索"
            onPress={() => onChangeText("")}
            hitSlop={8}
            style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
          >
            <SymbolView
              name="xmark.circle.fill"
              size={17}
              tintColor={palette.ink3}
            />
          </Pressable>
        ) : null}
      </View>
      {focused ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="取消搜索"
          onPress={() => {
            onChangeText("");
            input.current?.blur();
            Keyboard.dismiss();
          }}
          style={styles.cancel}
        >
          <Text style={styles.cancelLabel}>取消</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 8 },
    field: {
      ...searchFieldChrome(palette),
      flex: 1,
      height: 44,
      borderRadius: 24,
      borderWidth: 0,
      shadowOpacity: 0.08,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 10 },
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 14,
      gap: 7,
    },
    input: {
      flex: 1,
      padding: 0,
      fontSize: 17,
      color: searchFieldTextColor(palette),
    },
    clear: { padding: 2 },
    cancel: { minHeight: 44, justifyContent: "center" },
    cancelLabel: { fontSize: 17, color: palette.lampInk },
    pressed: { opacity: 0.6 },
  });
}
