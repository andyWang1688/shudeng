import { useMemo } from 'react';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { SymbolView } from 'expo-symbols';
import {
  searchFieldChrome,
  searchFieldIconColor,
  searchFieldPlaceholderColor,
  searchFieldTextColor,
  usePalette,
  type Palette,
} from '../theme';

type Props = {
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder: string;
  readonly style?: StyleProp<ViewStyle>;
};

/** 书架/笔记/对话统一白色（深色暗底）搜索条，含清空按钮。 */
export function SearchField({ value, onChangeText, placeholder, style }: Props) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  return (
    <View style={[styles.field, style]}>
      <SymbolView name="magnifyingglass" size={24} tintColor={searchFieldIconColor(palette)} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={searchFieldPlaceholderColor(palette)}
        style={styles.input}
        returnKeyType="search"
        accessibilityLabel={placeholder}
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="清空搜索"
          onPress={() => onChangeText('')}
          hitSlop={8}
          style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
        >
          <SymbolView name="xmark.circle.fill" size={17} tintColor={palette.ink3} />
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    field: {
      ...searchFieldChrome(palette),
      height: 56,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 18,
      gap: 10,
    },
    input: { flex: 1, padding: 0, fontSize: 17, color: searchFieldTextColor(palette) },
    clear: { padding: 2 },
    pressed: { opacity: 0.6 },
  });
}
