import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radius, spacing, usePalette, type Palette } from '../ui/theme';
import type { SelectionRect } from './readerProtocol';

/** 选字后贴在选区附近的原生小浮层（WebView CSS 像素 ≈ RN point，spike 直接使用）。 */
export function ReaderSelectionBar({
  rects,
  onHighlight,
  onCancel,
}: {
  readonly rects?: readonly SelectionRect[] | undefined;
  readonly onHighlight: () => void;
  readonly onCancel: () => void;
}) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const first = rects?.[0];
  const top = Math.max(spacing.xs, (first?.y ?? 120) - 56);
  return (
    <View style={[styles.wrap, { top }]} pointerEvents="box-none">
      <View style={styles.card}>
        <Text style={styles.hint} numberOfLines={1}>已选中文字</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="高亮选中文字" onPress={onHighlight} style={styles.action}>
          <Text style={styles.actionText}>高亮</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="取消选择" onPress={onCancel} style={styles.cancel}>
          <Text style={styles.cancelText}>取消</Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.sm, right: spacing.sm, zIndex: 20 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.card,
    backgroundColor: palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.line,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  hint: { flex: 1, color: palette.ink3, fontSize: 12 },
  action: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.field, backgroundColor: palette.lampWash },
  actionText: { color: palette.ink, fontSize: 13, fontWeight: '600' },
  cancel: { paddingHorizontal: spacing.xs, paddingVertical: 6 },
  cancelText: { color: palette.ink2, fontSize: 13 },
  });
}
