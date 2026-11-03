import { type ReactNode, useMemo } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import type { Palette } from '../theme';
import { SERIF_BOLD } from './format';
import { tapFeedback } from './haptics';

/** 76% 底部 sheet：遮罩、把手、品牌头、关闭、键盘避让；AI 内容由 book-chat 编排。 */
export function ChatSheet({
  palette,
  height,
  bottomInset,
  onClose,
  children,
}: {
  readonly palette: Palette;
  readonly height: number;
  readonly bottomInset: number;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const styles = useMemo(() => createStyles(palette), [palette]);
  return (
    <View style={styles.overlay}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="收起问答"
        style={styles.backdrop}
        onPress={onClose}
      />
      <View style={[styles.sheet, { height, paddingBottom: Math.max(bottomInset, 8) }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <View style={styles.brand}>
            <View style={styles.brandMark}>
              <SymbolView name="lightbulb" size={15} weight="medium" tintColor={palette.lamp} />
            </View>
            <Text style={styles.brandTitle}>问问书灯</Text>
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
            <SymbolView name="xmark" size={15} weight="medium" tintColor={palette.ink2} />
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
    </View>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'flex-end' },
    backdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(16, 14, 11, 0.30)',
    },
    sheet: {
      width: '100%',
      backgroundColor: palette.paper,
      borderTopLeftRadius: 23,
      borderTopRightRadius: 23,
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
      paddingHorizontal: 23,
      marginTop: 6,
      marginBottom: 2,
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
    brandTitle: { fontFamily: SERIF_BOLD, fontSize: 16, color: palette.ink },
    closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1 },
    pressed: { opacity: 0.7 },
  });
}
