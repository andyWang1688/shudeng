import { useState } from 'react';
import { Image } from 'expo-image';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { bookCoverTone, font, radius } from '../theme';

type Props = {
  readonly title: string;
  readonly author?: string | null;
  readonly format?: string;
  readonly coverUri?: string | null | undefined;
  readonly width: number;
  readonly height: number;
  readonly compact?: boolean;
  readonly showDot?: boolean;
  readonly style?: StyleProp<ViewStyle>;
};

/** Publication cover with the same generic fallback and placement as BookCoverView. */
export function BookCover({
  title,
  author,
  format,
  coverUri,
  width,
  height,
  compact = false,
  showDot = false,
  style,
}: Props) {
  const tone = bookCoverTone(title, format);
  const [titleHeight, setTitleHeight] = useState(compact ? 15 : 25);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.cover, { width, height, backgroundColor: tone.background }, style]}
    >
      <View style={[styles.inset, { borderColor: `${tone.ink}2E` }]} />
      <View
        style={[styles.lettering, { top: height / 2 - 6, transform: [{ translateY: -titleHeight / 2 }] }]}
      >
        <Text
          onLayout={(event) => setTitleHeight(event.nativeEvent.layout.height)}
          style={[styles.title, compact ? styles.titleCompact : styles.titleGrid, { color: tone.ink }]}
          numberOfLines={2}
        >
          {title}
        </Text>
        <View style={[styles.rule, { backgroundColor: tone.rule }]} />
        <Text
          style={[styles.author, compact ? styles.authorCompact : styles.authorGrid, { color: tone.ink }]}
          numberOfLines={1}
        >
          {author ?? ''}
        </Text>
      </View>
      {showDot ? <View style={[styles.dot, { backgroundColor: tone.ink }]} /> : null}
      {coverUri && coverUri !== failedUri ? (
        <Image
          source={{ uri: coverUri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          onError={() => setFailedUri(coverUri)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { borderRadius: radius.cover, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  inset: { position: 'absolute', borderWidth: 1, borderRadius: 2, top: 6, left: 6, right: 6, bottom: 6 },
  lettering: { position: 'absolute', left: 10, right: 10, alignItems: 'center' },
  title: { fontFamily: font.serif, fontWeight: '600', textAlign: 'center' },
  titleCompact: { fontSize: 11, lineHeight: 15 },
  titleGrid: { fontSize: 19, lineHeight: 25 },
  rule: { height: 1, width: 14, marginTop: 7 },
  author: { fontWeight: '500', opacity: 0.78 },
  authorCompact: { marginTop: 7, fontSize: 6.5 },
  authorGrid: { marginTop: 7, fontSize: 8 },
  dot: { position: 'absolute', bottom: 9, width: 4, height: 4, borderRadius: 2, opacity: 0.45 },
});
