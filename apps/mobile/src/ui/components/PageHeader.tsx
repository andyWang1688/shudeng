import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { type as typeScale, usePalette, type Palette } from '../theme';

export type PageHeaderAction = {
  readonly symbol: string;
  readonly label: string;
  readonly onPress?: () => void;
  readonly busy?: boolean;
  readonly variant?: 'solid' | 'outline';
};

type Props = {
  readonly title: string;
  readonly action?: PageHeaderAction;
  readonly topSpacing?: number;
};

/** 根页面统一页头：31pt 标题 + 可选 44pt 圆钮。 */
export function PageHeader({ title, action, topSpacing = 0 }: Props) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const solid = action?.variant === 'solid';
  return (
    <View style={[styles.row, topSpacing > 0 && { marginTop: topSpacing }]}>
      <Text style={styles.title}>{title}</Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityState={action.busy ? { busy: true } : undefined}
          disabled={action.busy}
          onPress={action.onPress}
          android_ripple={{ color: palette.line, borderless: true }}
          style={({ pressed }) => [styles.button, solid ? styles.solid : styles.outline, pressed && styles.pressed]}
        >
          {action.busy ? (
            <ActivityIndicator color={solid ? palette.paper : palette.lampInk} size="small" />
          ) : (
            <SymbolView
              name={action.symbol as never}
              size={solid ? 22 : 20}
              tintColor={solid ? palette.paper : palette.lampInk}
            />
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { fontSize: typeScale.title, fontWeight: '700', color: palette.ink },
    button: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    solid: { backgroundColor: palette.ink },
    outline: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
    pressed: { opacity: 0.68 },
  });
}
