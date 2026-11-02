import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { colors } from './theme';

export type TabKey = 'shelf' | 'notes' | 'conversations' | 'profile';

const TABS: ReadonlyArray<{ key: TabKey; label: string; href: string; symbol: string }> = [
  { key: 'shelf', label: '书架', href: '/', symbol: 'books.vertical' },
  { key: 'notes', label: '笔记', href: '/notes', symbol: 'square.and.pencil' },
  { key: 'conversations', label: '对话', href: '/conversations', symbol: 'bubble.left.and.bubble.right' },
  { key: 'profile', label: '我的', href: '/profile', symbol: 'person.crop.circle' },
];

export function BottomBar({ active }: { readonly active: TabKey }) {
  const router = useRouter();
  return (
    <View style={styles.bar}>
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
            <SymbolView name={tab.symbol as never} size={22} tintColor={on ? colors.ink : colors.ink2} />
            <Text style={[styles.label, on && styles.on]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, backgroundColor: colors.paper, paddingTop: 7, paddingBottom: 7 },
  item: { flex: 1, alignItems: 'center', gap: 2 },
  marker: { width: 19, height: 3, borderRadius: 2, backgroundColor: 'transparent', marginBottom: 2 },
  markerOn: { backgroundColor: colors.lamp },
  label: { fontSize: 10, color: colors.ink2 },
  on: { color: colors.ink },
});
