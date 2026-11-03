import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { bookSwatchTone, type as typeScale, usePalette, type Palette } from '../theme';

type Props = {
  readonly title: string;
  readonly count?: string;
  readonly countSuffix?: string;
  readonly variant?: 'section' | 'group';
  readonly swatch?: { readonly title: string; readonly format?: string | undefined };
  readonly expanded?: boolean;
  readonly onPress?: () => void;
  readonly trailing?: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
};

/** 分组头/书架 section 头二合一：group 带书脊与折叠，section 带标题/计数/右侧操作。 */
export function SectionHeader({ title, count, countSuffix, variant = 'section', swatch, expanded, onPress, trailing, style }: Props) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  if (variant === 'section') {
    return (
      <View style={[styles.section, style]}>
        <View style={styles.sectionIdentity}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {count ? <Text style={styles.sectionCount}>{countSuffix ?? count}</Text> : null}
        </View>
        {trailing}
      </View>
    );
  }
  const tone = swatch ? bookSwatchTone(swatch.title, swatch.format) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title} ${count ?? ''}${countSuffix ?? ''}`}
      accessibilityState={{ expanded: expanded ?? false }}
      onPress={onPress}
      android_ripple={{ color: palette.line }}
      style={({ pressed }) => [styles.group, style, pressed && styles.pressed]}
    >
      {tone ? (
        <View style={[styles.swatch, { backgroundColor: tone.background }]}>
          <Text style={[styles.swatchText, { color: tone.ink }]}>{swatch!.title.slice(0, 1)}</Text>
        </View>
      ) : null}
      <View style={styles.groupBody}>
        <Text style={styles.groupTitle} numberOfLines={1}>{title}</Text>
        {count ? <Text style={styles.groupCount}>{count}{countSuffix ?? ''}</Text> : null}
      </View>
      {onPress ? (
        <SymbolView name={expanded ? 'chevron.down' : 'chevron.right'} size={15} tintColor={palette.lamp} />
      ) : trailing}
    </Pressable>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, marginTop: 26 },
    sectionIdentity: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
    sectionTitle: { fontSize: typeScale.section, fontWeight: '600', color: palette.ink },
    sectionCount: { fontSize: typeScale.captionSmall, color: palette.ink3 },
    group: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10 },
    pressed: { opacity: 0.7 },
    swatch: { width: 26, height: 28, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
    swatchText: { fontSize: 10, fontWeight: '600' },
    groupBody: { flex: 1 },
    groupTitle: { fontSize: 17, fontWeight: '600', color: palette.ink },
    groupCount: { marginTop: 3, fontSize: typeScale.subhead, color: palette.ink3 },
  });
}
