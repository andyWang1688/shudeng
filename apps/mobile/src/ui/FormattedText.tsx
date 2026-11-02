import { StyleSheet, Text, View, type TextStyle, type StyleProp } from 'react-native';
import { colors, spacing } from './theme';

function inline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    nodes.push(<Text key={`b-${key++}`} style={styles.bold}>{match[1]}</Text>);
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

type Props = { readonly text: string; readonly style?: StyleProp<TextStyle> };

/** 轻量 Markdown：标题、列表、加粗；用于 AI 回答，不引入第三方渲染器。 */
export function FormattedText({ text, style }: Props) {
  const clean = text.replace(/\[E\d+\]/g, '').trim();
  const lines = clean.split('\n');
  return (
    <View style={styles.container}>
      {lines.map((raw, index) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <View key={index} style={styles.gap} />;
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        if (heading) {
          const level = heading[1]?.length ?? 2;
          return (
            <Text key={index} style={[styles.base, style, level <= 2 ? styles.h2 : styles.h3]}>
              {heading[2]}
            </Text>
          );
        }
        const bullet = /^[-*]\s+(.*)$/.exec(line);
        if (bullet) {
          return (
            <View key={index} style={styles.bulletRow}>
              <Text style={[styles.base, style, styles.bullet]}>•</Text>
              <Text style={[styles.base, style, styles.flex]}>{inline(bullet[1] ?? '')}</Text>
            </View>
          );
        }
        const numbered = /^(\d+)[.)]\s+(.*)$/.exec(line);
        if (numbered) {
          return (
            <View key={index} style={styles.bulletRow}>
              <Text style={[styles.base, style, styles.bullet]}>{numbered[1]}.</Text>
              <Text style={[styles.base, style, styles.flex]}>{inline(numbered[2] ?? '')}</Text>
            </View>
          );
        }
        return <Text key={index} style={[styles.base, style]}>{inline(line)}</Text>;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 2 },
  base: { fontSize: 14, lineHeight: 22, color: colors.ink },
  flex: { flex: 1 },
  h2: { fontSize: 17, fontWeight: '600', marginTop: 6, color: colors.ink },
  h3: { fontSize: 15, fontWeight: '600', marginTop: 4, color: colors.ink },
  bold: { fontWeight: '600' },
  bulletRow: { flexDirection: 'row', gap: spacing.xs, alignItems: 'flex-start' },
  bullet: { width: 16, color: colors.ink2 },
  gap: { height: 6 },
});
