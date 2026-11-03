import { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import type { Palette } from '../theme';
import { radius } from '../theme';
import { SERIF } from './format';
import { tapFeedback } from './haptics';
import type { ChatTurn } from './types';

export const UserTurn = memo(function UserTurn({ turn, title, palette }: { readonly turn: ChatTurn; readonly title: string; readonly palette: Palette }) {
  const [expanded, setExpanded] = useState(false);
  const styles = useMemo(() => createStyles(palette), [palette]);
  return (
    <View style={styles.row}>
      <View style={styles.bubble}>
        {turn.selectionQuote ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="展开／收起提问选文"
              onPress={() => {
                tapFeedback();
                setExpanded((value) => !value);
              }}
              style={({ pressed }) => [styles.attachment, pressed && styles.pressed]}
            >
              <SymbolView name="text.quote" size={15} tintColor={palette.ink2} />
              <Text style={styles.attachmentText} numberOfLines={1}>
                {expanded ? '收起选文' : '附带选文'} · {title}
              </Text>
            </Pressable>
            {expanded ? (
              <View style={styles.quoteBox}>
                <View style={styles.quoteRule} />
                <Text style={styles.quoteText}>{turn.selectionQuote}</Text>
              </View>
            ) : null}
          </>
        ) : null}
        <Text style={styles.text}>{turn.text}</Text>
      </View>
    </View>
  );
});

function createStyles(palette: Palette) {
  return StyleSheet.create({
    row: { flexDirection: 'row', justifyContent: 'flex-end' },
    bubble: {
      maxWidth: '88%',
      backgroundColor: palette.paperDeep,
      borderRadius: radius.card,
      borderTopRightRadius: 6,
      paddingVertical: 10,
      paddingHorizontal: 12,
      gap: 8,
    },
    attachment: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    attachmentText: { flex: 1, fontSize: 11, lineHeight: 16, color: palette.ink2 },
    quoteBox: { flexDirection: 'row', gap: 9 },
    quoteRule: { width: 2, borderRadius: 1, backgroundColor: palette.lamp },
    quoteText: { flex: 1, fontFamily: SERIF, fontSize: 13, lineHeight: 22, color: palette.ink2 },
    text: { fontSize: 15, lineHeight: 25, color: palette.ink },
    pressed: { opacity: 0.7 },
  });
}
