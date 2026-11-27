import { createContext, useCallback, useContext, useMemo, type EffectCallback, type PropsWithChildren } from 'react';
import { View, useWindowDimensions, type FlatListProps, type LayoutChangeEvent } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAui, useAuiState, type ThreadMessage } from '@assistant-ui/react-native';
import { BottomSheetScrollView, BottomSheetTextInput, type BottomSheetFooterProps } from '@gorhom/bottom-sheet';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { withUniwind } from 'uniwind';
import { useHydrated } from '@/components/assistant-ui/elements/surfaces';
import { ThreadWelcome } from '@/components/assistant-ui/elements/thread.aui';

type SheetLayout = {
  readonly footerTop: SharedValue<number>;
  readonly bodyTop: SharedValue<number>;
  readonly threadTop: SharedValue<number>;
};
const SheetLayoutContext = createContext<SheetLayout | null>(null);

/** A shared coordinate frame; Gorhom remains the source of keyboard/sheet geometry. */
export function AssistantSheetLayoutProvider({ children }: PropsWithChildren) {
  const footerTop = useSharedValue(0);
  const bodyTop = useSharedValue(0);
  const threadTop = useSharedValue(0);
  const layout = useMemo(() => ({ footerTop, bodyTop, threadTop }), [footerTop, bodyTop, threadTop]);
  return <SheetLayoutContext value={layout}>{children}</SheetLayoutContext>;
}

/** Copies the library's final footer position, including its keyboard coordination. */
export function AssistantSheetFooterPosition({ animatedFooterPosition }: BottomSheetFooterProps) {
  const layout = useContext(SheetLayoutContext);
  useAnimatedReaction(() => animatedFooterPosition.get(), position => {
    if (layout) layout.footerTop.set(position);
  }, [animatedFooterPosition, layout]);
  return null;
}

export function useAssistantSheetBodyLayout() {
  const layout = useContext(SheetLayoutContext);
  return useCallback((event: LayoutChangeEvent) => {
    if (layout) layout.bodyTop.set(event.nativeEvent.layout.y);
  }, [layout]);
}

/** Accounts for a book-index/error banner above the thread without hard-coded header sizes. */
export function AssistantSheetThreadFrame({ children }: PropsWithChildren) {
  const layout = useContext(SheetLayoutContext);
  const visibleStyle = useVisibleThreadHeight();
  return <View style={{ flex: 1 }} onLayout={event => {
    if (layout) layout.threadTop.set(event.nativeEvent.layout.y);
  }}><Animated.View style={visibleStyle}>{children}</Animated.View></View>;
}

/** Center inside the visible chat region, rather than the maximum snap-point content. */
function useVisibleThreadHeight() {
  const layout = useContext(SheetLayoutContext);
  return useAnimatedStyle(() => ({
    height: layout ? Math.max(0, layout.footerTop.get() - layout.bodyTop.get() - layout.threadTop.get()) : 0,
  }), [layout]);
}

export function SheetWelcome() {
  return <ThreadWelcome />;
}

// Expo Router explicitly forbids a second argument; Gorhom accepts an optional deps argument.
function useSheetFocus(effect: EffectCallback) { useFocusEffect(effect); }

/** Keep assistant-ui's FlatList, row providers, refs and auto-scroll intact. */
export const renderSheetScrollComponent: NonNullable<FlatListProps<ThreadMessage>['renderScrollComponent']> = props => (
  <BottomSheetScrollView {...props} focusHook={useSheetFocus}>
    {props.children}
  </BottomSheetScrollView>
);

const SheetTextInput = withUniwind(BottomSheetTextInput);

/** The composer runtime remains the only draft source; Gorhom owns keyboard handling. */
export function SheetComposerInput() {
  const aui = useAui();
  const hydrated = useHydrated();
  const text = useAuiState(state => state.composer.text);
  const disabled = useAuiState(state => state.thread.isDisabled || state.composer.dictation?.inputDisabled === true);
  const { fontScale } = useWindowDimensions();
  const minimumHeight = Math.max(44, Math.ceil(24 * fontScale + 16));
  const maximumHeight = Math.max(144, minimumHeight);

  return <SheetTextInput
    value={text}
    onChangeText={value => { if (!disabled) aui.composer.setText(value, { origin: 'user' }); }}
    editable={!disabled}
    readOnly={disabled}
    placeholder="问问这本书…"
    {...(hydrated ? { placeholderTextColorClassName: 'accent-muted-foreground' } : {})}
    className="aui-composer-input text-foreground px-2 text-base leading-6"
    style={{ minHeight: minimumHeight, maxHeight: maximumHeight, paddingVertical: 8, textAlignVertical: 'top', includeFontPadding: false }}
    scrollEnabled
    multiline
    submitBehavior="newline"
    allowFontScaling
    accessibilityLabel="向阅读助手提问"
  />;
}
