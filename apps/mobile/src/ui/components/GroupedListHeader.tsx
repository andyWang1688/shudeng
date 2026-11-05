import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { SERIF_BOLD } from '../chat/format';
import { usePalette, type Palette } from '../theme';

type Props = {
  readonly title: string;
  readonly query: string;
  readonly onChangeQuery: (query: string) => void;
  readonly placeholder: string;
  readonly exportAction?: { readonly busy: boolean; readonly onPress: () => void };
};

/** Notes/history use the native large-title navigation and system search geometry. */
export function GroupedListHeader({ title, query, onChangeQuery, placeholder, exportAction }: Props) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  return (
    <View style={styles.header}>
      <View style={styles.toolbar}>
        {exportAction ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="导出笔记"
            accessibilityState={{ busy: exportAction.busy }}
            disabled={exportAction.busy}
            onPress={exportAction.onPress}
            style={({ pressed }) => [styles.exportButton, pressed && styles.pressed]}
          >
            {exportAction.busy ? (
              <ActivityIndicator color={palette.lamp} />
            ) : (
              <SymbolView name="square.and.arrow.up" size={24} weight="medium" tintColor={palette.lamp} />
            )}
          </Pressable>
        ) : null}
      </View>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <View style={styles.search}>
        <SymbolView name="magnifyingglass" size={19} tintColor={palette.ink} />
        <TextInput
          value={query}
          onChangeText={onChangeQuery}
          placeholder={placeholder}
          placeholderTextColor={palette.paper === '#1B1A17' ? '#98989D' : '#8E8E93'}
          accessibilityLabel={placeholder}
          returnKeyType="search"
          autoCorrect={false}
          style={styles.input}
        />
        {query ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="清空搜索"
            onPress={() => onChangeQuery('')}
            hitSlop={8}
          >
            <SymbolView name="xmark.circle.fill" size={17} tintColor={palette.ink3} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    header: { paddingHorizontal: 16 },
    toolbar: { height: 44, alignItems: 'flex-end', justifyContent: 'center' },
    exportButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: palette.surface,
      shadowColor: '#000000',
      shadowOpacity: 0.06,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
    },
    title: { marginTop: 16, fontFamily: SERIF_BOLD, fontSize: 30, lineHeight: 36, color: palette.ink },
    search: {
      height: 55,
      marginTop: 11,
      borderRadius: 28,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      gap: 9,
      backgroundColor: palette.paper === '#1B1A17' ? '#302E2B' : '#EAE8E4',
    },
    input: { flex: 1, padding: 0, fontSize: 17, color: palette.ink },
    pressed: { opacity: 0.65 },
  });
}
