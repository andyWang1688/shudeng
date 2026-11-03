import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { font, type as typeScale, usePalette, type Palette } from '../theme';

type Props = {
  readonly title: string;
  readonly description?: string;
  readonly symbol?: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
};

/** 空态：可选图标 + 标题/说明 + 主按钮；只表达业务空态。 */
export function EmptyState({ title, description, symbol, actionLabel, onAction }: Props) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  return (
    <View style={styles.wrap}>
      {symbol ? <SymbolView name={symbol as never} size={44} tintColor={palette.lamp} /> : null}
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          android_ripple={{ color: palette.line }}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    wrap: { alignItems: 'center', paddingVertical: 72, paddingHorizontal: 16 },
    title: { marginTop: 20, fontSize: 24, fontFamily: font.serif, fontWeight: '600', color: palette.ink, textAlign: 'center' },
    description: { marginTop: 8, fontSize: typeScale.caption, color: palette.ink2, textAlign: 'center' },
    button: { marginTop: 24, minWidth: 168, height: 44, borderRadius: 12, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
    buttonText: { fontSize: 14, fontWeight: '500', color: palette.paper },
    pressed: { opacity: 0.72 },
  });
}
