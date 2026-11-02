import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { colors } from './theme';

const ICONS: Record<string, string> = {
  index: 'books.vertical',
  notes: 'square.and.pencil',
  conversations: 'bubble.left.and.bubble.right',
  profile: 'person.crop.circle',
};

type TabBarProps = { readonly state: any; readonly descriptors: any; readonly navigation?: any; readonly navigateToTab?: (key: string) => void };

export function TabBar({ state, descriptors, navigation, navigateToTab }: TabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 6) }]}>
      {state.routes.map((route: any, index: number) => {
        const focused = state.index === index;
        const options = descriptors[route.key]?.options;
        const label = typeof options?.title === 'string' ? options.title : route.name;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={label}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) {
                if (navigation?.navigate) navigation.navigate(route.name);
                else navigateToTab?.(route.key);
              }
            }}
            style={styles.item}
          >
            <View style={[styles.marker, focused && styles.markerOn]} />
            <SymbolView name={(ICONS[route.name] ?? 'circle') as never} size={22} tintColor={focused ? colors.ink : colors.ink2} />
            <Text style={[styles.label, focused && styles.labelOn]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: colors.paper, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: 7 },
  item: { flex: 1, alignItems: 'center', minHeight: 44, gap: 3 },
  marker: { width: 19, height: 3, borderRadius: 2, backgroundColor: 'transparent', marginBottom: 3 },
  markerOn: { backgroundColor: colors.lamp },
  label: { fontSize: 10, color: colors.ink2 },
  labelOn: { color: colors.ink },
});
