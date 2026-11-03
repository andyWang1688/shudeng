import { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { bookCoverTone, font, radius } from '../theme';

type Props = {
  readonly title: string;
  readonly author?: string | null;
  readonly format?: string;
  readonly width: number;
  readonly height: number;
  readonly compact?: boolean;
  readonly showDot?: boolean;
  readonly style?: StyleProp<ViewStyle>;
};

/** 统一书封：纸/绿/暖色自动映射，compact 用于继续阅读卡。 */
export function BookCover({ title, author, format, width, height, compact = false, showDot = false, style }: Props) {
  const tone = bookCoverTone(title, format);
  const styles = useMemo(() => createStyles(), []);
  return (
    <View style={[styles.cover, compact ? styles.compactPadding : styles.gridPadding, { width, height, backgroundColor: tone.background }, style]}>
      <View style={[styles.inset, compact ? styles.insetCompact : styles.insetGrid, { borderColor: tone.rule }]} />
      <Text style={[styles.title, compact ? styles.titleCompact : styles.titleGrid, { color: tone.ink }]} numberOfLines={compact ? 2 : 3}>
        {title}
      </Text>
      <View style={[styles.rule, compact ? styles.ruleCompact : styles.ruleGrid, { backgroundColor: tone.rule }]} />
      <Text style={[styles.author, compact ? styles.authorCompact : styles.authorGrid, { color: tone.ink }]} numberOfLines={1}>
        {author ?? '作者未知'}
      </Text>
      {showDot ? <View style={[styles.dot, { backgroundColor: tone.ink }]} /> : null}
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    cover: { borderRadius: radius.cover, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    compactPadding: { padding: 7 },
    gridPadding: { padding: 12 },
    inset: { position: 'absolute', borderWidth: 1, borderRadius: 2 },
    insetCompact: { top: 5, left: 5, right: 5, bottom: 5 },
    insetGrid: { top: 5, left: 5, right: 5, bottom: 5 },
    title: { fontFamily: font.serif, fontWeight: '600', textAlign: 'center' },
    titleCompact: { fontSize: 11, lineHeight: 15 },
    titleGrid: { fontSize: 19, lineHeight: 25 },
    rule: { height: 1 },
    ruleCompact: { width: 12, marginTop: 5 },
    ruleGrid: { width: 14, marginTop: 7 },
    author: { fontWeight: '500', opacity: 0.8 },
    authorCompact: { marginTop: 5, fontSize: 6.5 },
    authorGrid: { marginTop: 7, fontSize: 8 },
    dot: { position: 'absolute', bottom: 9, width: 4, height: 4, borderRadius: 2, opacity: 0.36 },
  });
}
