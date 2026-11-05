import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { usePalette, type Palette } from '../theme';

/** BookAlert's single text-field variant; actions run after the modal dismisses. */
export function ConversationRenamePrompt({ initialName, onCancel, onSave }: {
  readonly initialName: string; readonly onCancel: () => void; readonly onSave: (name: string) => void;
}) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [name, setName] = useState(initialName);
  const [visible, setVisible] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const mounted = useRef(true);
  const reduceMotion = useRef(true);
  const pending = useRef<(() => void) | null>(null);
  useEffect(() => {
    mounted.current = true;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { reduceMotion.current = value; });
    return () => { mounted.current = false; pending.current = null; subscription.remove(); opacity.stopAnimation(); };
  }, [opacity]);
  const show = async () => {
    const reduced = await AccessibilityInfo.isReduceMotionEnabled().catch(() => true);
    if (!mounted.current || closing.current) return;
    reduceMotion.current = reduced;
    Animated.timing(opacity, { toValue: 1, duration: reduced ? 0 : 350, easing: Easing.inOut(Easing.ease), useNativeDriver: true }).start();
  };
  const didDismiss = () => {
    if (!mounted.current) return;
    const action = pending.current; pending.current = null; action?.();
  };
  const choose = (action: () => void) => {
    if (closing.current) return;
    closing.current = true; pending.current = action; setDisabled(true);
    Animated.timing(opacity, { toValue: 0, duration: reduceMotion.current ? 0 : 160, easing: Easing.inOut(Easing.ease), useNativeDriver: true })
      .start(({ finished }) => {
        if (!finished || !mounted.current) return;
        setVisible(false);
        if (Platform.OS !== 'ios') didDismiss();
      });
  };
  return (
    <Modal visible={visible} transparent presentationStyle="overFullScreen" animationType="none" statusBarTranslucent
      supportedOrientations={['portrait', 'landscape-left', 'landscape-right']} onShow={show} onDismiss={didDismiss} onRequestClose={() => undefined}>
      <Animated.View style={[styles.overlay, { opacity }]} testID="book-dialog">
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.title} dynamicTypeRamp="headline" accessibilityRole="header">对话改名</Text>
          <Text style={styles.message} dynamicTypeRamp="footnote" lineBreakStrategyIOS="standard">生成中或内容尚未保存时请先取消生成或重试保存。</Text>
          <TextInput testID="conversation-name" accessibilityLabel="对话名称" value={name} onChangeText={setName}
            editable={!disabled} style={styles.field} allowFontScaling />
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={() => choose(() => onSave(name))}
              style={({ pressed }) => [styles.button, styles.primary, pressed && styles.pressed]}>
              <Text style={styles.primaryTitle} dynamicTypeRamp="subheadline">保存</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={() => choose(onCancel)}
              style={({ pressed }) => [styles.button, styles.cancel, pressed && styles.pressed]}>
              <Text style={styles.buttonTitle} dynamicTypeRamp="subheadline">取消</Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, backgroundColor: 'rgba(0,0,0,0.34)' },
    card: { width: 320, maxWidth: '100%', paddingTop: 20, paddingHorizontal: 20, paddingBottom: 16, borderRadius: 22,
      borderCurve: 'continuous', backgroundColor: palette.paper, shadowColor: '#000', shadowOpacity: 0.26, shadowRadius: 34, shadowOffset: { width: 0, height: 14 } },
    title: { fontFamily: 'SongtiSC-Bold', fontWeight: '600', fontSize: 17, color: palette.ink, textAlign: 'center' },
    message: { marginTop: 6, fontSize: 13, color: palette.ink2, textAlign: 'center' },
    field: { marginTop: 14, height: 40, paddingHorizontal: 10, paddingVertical: 0, borderRadius: 10, backgroundColor: palette.paperDeep, color: palette.ink, fontSize: 15 },
    actions: { marginTop: 18, gap: 8 },
    button: { minHeight: 44, paddingVertical: 11, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
    primary: { backgroundColor: palette.ink }, cancel: { backgroundColor: palette.paperDeep },
    primaryTitle: { fontSize: 14, fontWeight: '500', color: palette.paper }, buttonTitle: { fontSize: 14, fontWeight: '500', color: palette.ink },
    pressed: { opacity: 0.7 },
  });
}
