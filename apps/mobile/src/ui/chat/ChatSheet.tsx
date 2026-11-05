import { type ReactNode, useMemo } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import type { Palette } from '../theme';
import { SERIF_BOLD } from './format';
import { tapFeedback } from './haptics';

/** RN sheet content; the native stack owns detents, dimming and interactive dismissal. */
export function ChatSheet({
  palette,
  bottomInset,
  onClose,
  children,
}: {
  readonly palette: Palette;
  readonly bottomInset: number;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const styles = useMemo(() => createStyles(palette), [palette]);
  return (
    <View testID="question-sheet" style={[styles.sheet, { paddingBottom: Platform.OS === 'ios' ? bottomInset : Math.max(bottomInset, 8) }]}>
      <View testID="question-sheet-handle" accessible accessibilityLabel="问答面板把手" style={styles.handle} />
      <View testID="question-sheet-header" style={styles.header}>
        <View style={styles.brand}>
          <View style={styles.brandMark}>
            <SymbolView name="lightbulb" size={30} pointSize={15} weight="medium" scale="unspecified" contentLayout="intrinsic" resizeMode="scaleAspectFit" tintColor={palette.lamp}
              accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          </View>
          <Text dynamicTypeRamp={Platform.OS === 'ios' ? 'headline' : undefined} style={styles.brandTitle}>问问书灯</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="收起问答，继续阅读"
          onPress={() => {
            tapFeedback();
            onClose();
          }}
          style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
        >
          <SymbolView name="xmark" size={44} pointSize={15} weight="medium" scale="unspecified" contentLayout="systemButton" tintColor={palette.ink2}
            accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
        </Pressable>
      </View>
      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {children}
      </KeyboardAvoidingView>
    </View>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    sheet: {
      flex: 1,
      width: '100%',
      backgroundColor: palette.paper,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      overflow: 'hidden',
    },
    handle: {
      width: 33,
      height: 4,
      borderRadius: 2,
      backgroundColor: palette.ink3,
      opacity: 0.35,
      alignSelf: 'center',
      marginTop: 8,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 44,
      paddingLeft: 23,
      paddingRight: 15,
      marginTop: 6,
      marginBottom: 4,
    },
    brand: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
    brandMark: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: palette.lampWash,
      alignItems: 'center',
      justifyContent: 'center',
    },
    brandTitle: { fontFamily: SERIF_BOLD, fontSize: 16, fontWeight: '600', color: palette.ink },
    closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1 },
    pressed: { opacity: 0.7 },
  });
}
