import { createContext, type ReactNode, useCallback, useContext, useRef } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import BottomSheet, { BottomSheetBackdrop, BottomSheetFooter, BottomSheetHandle, type BottomSheetBackdropProps, type BottomSheetBackgroundProps, type BottomSheetFooterProps, type BottomSheetHandleProps } from '@gorhom/bottom-sheet';
import Animated, { Extrapolation, interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { SymbolView } from 'expo-symbols';
import { useCSSVariable } from 'uniwind';
import type { Palette } from '../theme';
import { tapFeedback } from './haptics';
import { AssistantSheetFooterPosition, useAssistantSheetBodyLayout } from './AssistantSheetAdapter';

const SNAP_POINTS = ['76%', '100%'];
const ChromeContext = createContext<{ node: ReactNode; bottomInset: number; topInset: number; surface: string; ink: string } | null>(null);

/** Animate appearance from Gorhom's UI-thread progress, without a detent state switch. */
function SheetBackground({ animatedIndex, pointerEvents, style }: BottomSheetBackgroundProps) {
  const chrome = useContext(ChromeContext);
  const corners = useAnimatedStyle(() => {
    const radius = interpolate(animatedIndex.get(), [0, 1], [22, 0], Extrapolation.CLAMP);
    return { borderTopLeftRadius: radius, borderTopRightRadius: radius };
  });
  return <Animated.View pointerEvents={pointerEvents} style={[style, { backgroundColor: chrome?.surface, borderCurve: 'continuous' }, corners]} />;
}

function SheetHandle({ animatedIndex, ...props }: BottomSheetHandleProps) {
  const topInset = useContext(ChromeContext)?.topInset ?? 0;
  const safeArea = useAnimatedStyle(() => ({
    paddingTop: interpolate(animatedIndex.get(), [0, 1], [0, topInset], Extrapolation.CLAMP),
  }));
  return <Animated.View style={safeArea}><BottomSheetHandle {...props} animatedIndex={animatedIndex} /></Animated.View>;
}

/** Stable component identity preserves the input and focus during streaming. */
function SheetFooter(props: BottomSheetFooterProps) {
  const footer = useContext(ChromeContext);
  if (!footer) return null;
  return <BottomSheetFooter {...props} bottomInset={0}>
    <AssistantSheetFooterPosition animatedFooterPosition={props.animatedFooterPosition} />
    <View pointerEvents="box-none" style={{ paddingBottom: footer.bottomInset }}>{footer.node}</View>
  </BottomSheetFooter>;
}

/** Gorhom owns drag, release-to-snap, scrolling and keyboard coordination. */
export function ChatSheet({ palette, topInset, bottomInset, initialDetent, onDetentChange, onClose, footer, children }: {
  readonly palette: Palette;
  readonly topInset: number;
  readonly bottomInset: number;
  readonly initialDetent: number;
  readonly onDetentChange: (index: number) => void;
  readonly onClose: () => void;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}) {
  const [background, foreground] = useCSSVariable(['--color-background', '--color-muted-foreground']);
  const surface = typeof background === 'string' ? background : palette.paper;
  const ink = typeof foreground === 'string' ? foreground : palette.ink2;
  const sheet = useRef<BottomSheet>(null);
  const initialIndex = useRef(initialDetent === 1 ? 1 : 0).current;
  const onBodyLayout = useAssistantSheetBodyLayout();
  const backdrop = useCallback((props: BottomSheetBackdropProps) => <BottomSheetBackdrop {...props}
    appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.32} pressBehavior="close"
    onPress={Keyboard.dismiss} accessibilityLabel="收起问答，继续阅读" accessibilityHint="关闭面板，保留对话和输入" />, []);
  return <ChromeContext value={{ node: footer, bottomInset, topInset, surface, ink }}>
    <View testID="question-sheet" style={styles.sheet} accessibilityViewIsModal>
    <BottomSheet ref={sheet} index={initialIndex} snapPoints={SNAP_POINTS}
      topInset={0} bottomInset={0} enableDynamicSizing={false} enablePanDownToClose
      keyboardBehavior="interactive" keyboardBlurBehavior="restore" enableBlurKeyboardOnGesture
      android_keyboardInputMode="adjustResize" backdropComponent={backdrop}
      {...(footer ? { footerComponent: SheetFooter } : {})}
      backgroundComponent={SheetBackground} handleComponent={SheetHandle}
      handleIndicatorStyle={{ backgroundColor: ink, opacity: 0.38, width: 36 }}
      style={styles.elevation}
      onChange={index => {
        if (index < 0) return;
        onDetentChange(index);
      }} onClose={onClose}>
    <View testID="question-sheet-header" style={styles.controls}>
      <Pressable testID="question-sheet-close" accessibilityRole="button" accessibilityLabel="收起问答，继续阅读"
        onPress={() => { tapFeedback(); Keyboard.dismiss(); sheet.current?.close(); }} style={styles.close}>
        <SymbolView name="xmark" size={17} tintColor={ink} accessible={false} />
      </Pressable>
    </View>
    <View style={styles.body} onLayout={onBodyLayout}>{children}</View>
    </BottomSheet>
  </View>
  </ChromeContext>;
}
const styles = StyleSheet.create({
  sheet: { flex: 1, width: '100%' },
  elevation: { shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.16, shadowRadius: 16, elevation: 12 },
  controls: { height: 36, alignItems: 'flex-end', paddingRight: 8 },
  close: { width: 44, height: 44, marginTop: -4, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
});
