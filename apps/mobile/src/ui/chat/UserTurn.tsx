import { memo, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import type { Palette } from '../theme';
import { SERIF } from './format';
import { tapFeedback } from './haptics';
import type { ChatTurn } from './types';
import { hasNativeTextMetrics } from '../../platform/text/NativeTextMetrics';
import { explicitSystemRNTextProps } from '../../platform/text/textMetricsState';
import { usesPlainUserTextMetrics, type PlainUserTextLayout } from './plainUserTextLayout';

export const UserTurn = memo(function UserTurn({
  turn,
  title,
  palette,
  expanded: controlledExpanded,
  onToggleExpanded,
  plainLayout,
}: {
  readonly turn: ChatTurn;
  readonly title: string;
  readonly palette: Palette;
  readonly expanded?: boolean | undefined;
  readonly plainLayout?: PlainUserTextLayout | undefined;
  readonly onToggleExpanded?: (() => void) | undefined;
}) {
  const [localExpanded, setExpanded] = useState(false);
  const expanded = controlledExpanded ?? localExpanded;
  const styles = useMemo(() => createStyles(palette), [palette]);
  const attached = turn.selectionAttached ?? Boolean(turn.selectionQuote);
  if (hasNativeTextMetrics && usesPlainUserTextMetrics(Platform.OS, attached)) {
    // ChatList inserts this row only after both measurement passes complete.
    if (!plainLayout || plainLayout.measurement.request.text !== turn.text) return null;
    const textProps = explicitSystemRNTextProps(plainLayout.measurement);
    return <View style={styles.row}>
      <View style={[styles.bubble, { maxWidth: undefined, width: plainLayout.width, minHeight: plainLayout.minimumHeight }]}>
        <Text {...textProps} style={[styles.text, textProps.style]}>{turn.text}</Text>
      </View>
    </View>;
  }
  return (
    <View style={styles.row}>
      <View style={styles.bubble}>
        {(turn.selectionAttached ?? Boolean(turn.selectionQuote)) ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="展开／收起提问选文"
              accessibilityState={Platform.OS === 'ios' ? undefined : { expanded }}
              accessibilityValue={{ text: expanded ? '已展开' : '已收起' }}
              testID={`question-selection-toggle-${turn.id}`}
              onPress={() => {
                tapFeedback();
                if (onToggleExpanded) onToggleExpanded();
                else setExpanded((value) => !value);
              }}
              style={({ pressed }) => [styles.attachment, pressed && styles.pressed]}
            >
              <SymbolView name="text.quote" size={15} tintColor={palette.ink2}
                accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
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
      borderRadius: 14,
      borderTopRightRadius: 0,
      paddingVertical: 10,
      paddingHorizontal: 12,
      gap: 8,
    },
    attachment: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    attachmentText: { flex: 1, fontSize: 11, lineHeight: 16, color: palette.ink2 },
    quoteBox: { flexDirection: 'row', gap: 9 },
    quoteRule: { width: 2, borderRadius: 1, backgroundColor: palette.lamp },
    quoteText: { flex: 1, fontFamily: SERIF, fontSize: 13, lineHeight: 22, color: palette.ink2 },
    text: {
      fontSize: 15,
      ...(Platform.OS === 'ios' ? { lineSpacing: 4 } : { lineHeight: 25 }),
      color: palette.ink,
    },
    pressed: { opacity: 0.7 },
  });
}
