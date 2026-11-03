import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { spacing, type, usePalette, type Palette } from './theme';

export type TabKey = 'shelf' | 'notes' | 'conversations' | 'profile';

const TABS: ReadonlyArray<{ key: TabKey; label: string; href: string; symbol: string; selectedSymbol: string }> = [
  { key: 'shelf', label: '书架', href: '/', symbol: 'books.vertical', selectedSymbol: 'books.vertical.fill' },
  { key: 'notes', label: '笔记', href: '/notes', symbol: 'square.and.pencil', selectedSymbol: 'square.and.pencil' },
  { key: 'conversations', label: '对话', href: '/conversations', symbol: 'bubble.left.and.bubble.right', selectedSymbol: 'bubble.left.and.bubble.right.fill' },
  { key: 'profile', label: '我的', href: '/profile', symbol: 'person.crop.circle', selectedSymbol: 'person.crop.circle.fill' },
];

export function BottomBar({ active }: { readonly active: TabKey }) {
  const router = useRouter();
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const barHeight = width >= 390 ? 83 : spacing.bottomBar;
  return (
    <View style={[styles.bar, { height: barHeight }]}>
      {TABS.map((tab) => {
        const on = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="button"
            accessibilityLabel={tab.label}
            accessibilityState={on ? { selected: true } : {}}
            onPress={() => { if (!on) router.replace(tab.href); }}
            style={styles.item}
          >
            <View style={[styles.marker, on && styles.markerOn]} />
            <View style={styles.iconSlot}>
              <SymbolView name={(on ? tab.selectedSymbol : tab.symbol) as never} size={22} tintColor={on ? palette.ink : palette.ink3} />
            </View>
            <Text style={[styles.label, on && styles.on]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    bar: {
      flexDirection: 'row',
      borderTopWidth: 1,
      borderTopColor: palette.line,
      backgroundColor: palette.paper,
      paddingHorizontal: 6,
    },
    item: { flex: 1, alignItems: 'center' },
    marker: { marginTop: 8, width: 19, height: 3, borderRadius: 1.5, backgroundColor: 'transparent' },
    markerOn: { backgroundColor: palette.lamp },
    iconSlot: { marginTop: 5, width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
    label: { marginTop: 3, fontSize: type.captionSmall, lineHeight: 12, fontWeight: '500', color: palette.ink3 },
    on: { color: palette.ink },
  });
}
