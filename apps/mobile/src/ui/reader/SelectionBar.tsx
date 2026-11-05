/** Anchored three-action menu, matching the native reader's 234×51pt bubble. */
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePalette, type Palette } from '../theme';
import type { SelectionRect } from '../../reader/readerProtocol';

export function SelectionBar({ rects, onHighlight, onNote, onAsk }: {
  readonly quote: string; readonly rects?: readonly SelectionRect[] | undefined;
  readonly onHighlight: () => void; readonly onNote: () => void; readonly onAsk: () => void; readonly onCancel: () => void;
}) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const validRects = (rects ?? []).filter(rect => rect.width > 0 && rect.height > 0);
  const left = validRects.length ? Math.min(...validRects.map(rect => rect.x)) : width / 2;
  const right = validRects.length ? Math.max(...validRects.map(rect => rect.x + rect.width)) : width / 2;
  const top = validRects.length ? Math.min(...validRects.map(rect => rect.y)) + insets.top : height / 2;
  const bottom = validRects.length ? Math.max(...validRects.map(rect => rect.y + rect.height)) + insets.top : height / 2;
  const minY = insets.top + 55, maxY = height - 82;
  const above = top - 55, below = bottom + 8;
  const useBelow = above < minY && below + 46 <= maxY;
  const x = Math.max(8, Math.min((left + right) / 2 - 117, width - 242));
  const fitsAbove = above >= minY;
  const fitsBelow = below + 46 <= maxY;
  const preferredY = !fitsAbove && !fitsBelow
    ? (top - minY > maxY - bottom ? minY : maxY - 51)
    : useBelow ? below : Math.max(minY, above);
  const y = Math.min(preferredY, maxY - (useBelow ? 46 : 51));
  return <View style={[styles.menu, { left: x, top: y, height: useBelow ? 46 : 51 }]}>
    {!useBelow ? <View style={[styles.caret, { left: Math.max(12, Math.min(222, (left + right) / 2 - x)) - 5.5 }]} /> : null}
    <View style={styles.bubble}>
      <Pressable accessibilityRole="button" accessibilityLabel="高亮" onPress={onHighlight} style={styles.action}><Text style={styles.label}>高亮</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="写笔记" onPress={onNote} style={styles.action}><Text style={styles.label}>笔记</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="问书灯" onPress={onAsk} style={styles.action}><SymbolView name="lightbulb" size={17} tintColor={palette.paper} /><Text style={styles.label}>提问</Text></Pressable>
      <View pointerEvents="none" style={[styles.rule, { left: 78 }]} />
      <View pointerEvents="none" style={[styles.rule, { left: 156 }]} />
    </View>
  </View>;
}
function makeStyles(palette: Palette) { return StyleSheet.create({
  menu: { position: 'absolute', width: 234, zIndex: 40 },
  bubble: { height: 46, borderRadius: 12, backgroundColor: palette.ink, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, shadowColor: '#000', shadowOpacity: .16, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
  action: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5 }, label: { color: palette.paper, fontSize: 13, fontWeight: '500' },
  rule: { position: 'absolute', top: 9, width: 1, height: 28, backgroundColor: 'rgba(255,255,255,.22)' }, caret: { position: 'absolute', width: 11, height: 11, bottom: 0, backgroundColor: palette.ink, transform: [{ rotate: '45deg' }] },
}); }
