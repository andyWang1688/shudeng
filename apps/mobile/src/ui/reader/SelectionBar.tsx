/** 阅读器选区操作条：高亮 / 写笔记 / 问书灯 / 取消。 */
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, spacing, usePalette, type Palette } from '../theme';

export function SelectionBar({
  quote,
  onHighlight,
  onNote,
  onAsk,
  onCancel,
}: {
  readonly quote: string;
  readonly onHighlight: () => void;
  readonly onNote: () => void;
  readonly onAsk: () => void;
  readonly onCancel: () => void;
}) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { bottom: insets.bottom + 72 }]}>
      <Text style={styles.quote} numberOfLines={2}>{quote}</Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="高亮" onPress={onHighlight} style={styles.button}>
          <Text style={styles.buttonText}>高亮</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="写笔记" onPress={onNote} style={styles.button}>
          <Text style={styles.buttonText}>写笔记</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="问书灯" onPress={onAsk} style={styles.button}>
          <Text style={styles.buttonText}>问书灯</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="取消选择" onPress={onCancel} style={styles.cancel}>
          <Text style={styles.cancelText}>取消</Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    bar: {
      position: 'absolute',
      left: spacing.sm,
      right: spacing.sm,
      zIndex: 40,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.line,
      borderRadius: radius.card,
      backgroundColor: palette.surface,
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.xs,
      paddingBottom: spacing.sm,
      gap: 6,
      shadowColor: palette.ink,
      shadowOpacity: 0.12,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
    },
    quote: { fontSize: 12, lineHeight: 17, color: palette.ink2 },
    actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    button: { borderRadius: radius.field, backgroundColor: palette.lampWash, paddingHorizontal: spacing.sm, paddingVertical: 7 },
    buttonText: { fontSize: 12, fontWeight: '600', color: palette.ink },
    cancel: { paddingHorizontal: spacing.sm, paddingVertical: 7 },
    cancelText: { fontSize: 12, color: palette.ink3 },
  });
}
