import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type Ref,
} from "react";
import { StyleSheet, View } from "react-native";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetHandle,
  type BottomSheetBackdropProps,
  type BottomSheetBackgroundProps,
  type BottomSheetHandleProps,
  type BottomSheetProps,
} from "@gorhom/bottom-sheet";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { demoColors as c } from "./demoTheme";

type Props = Omit<
  BottomSheetProps,
  | "index"
  | "snapPoints"
  | "enableDynamicSizing"
  | "backgroundComponent"
  | "handleComponent"
  | "backdropComponent"
> & {
  ref?: Ref<BottomSheet>;
  open?: boolean;
  initialHeight: number;
  backdropOpacity?: number;
};
const SafeTop = createContext(0);

/** One prototype sheet contract: compact detent, full screen, continuous corners. */
export function DemoSheet({
  ref,
  open = true,
  initialHeight,
  backdropOpacity = 0.22,
  children,
  ...props
}: Props) {
  const insets = useSafeAreaInsets();
  const snapPoints = useMemo(
    () => [initialHeight + "%", "100%"],
    [initialHeight],
  );
  const backdrop = useCallback(
    (options: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...options}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={backdropOpacity}
        pressBehavior="close"
      />
    ),
    [backdropOpacity],
  );
  return (
    <SafeTop value={insets.top}>
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents={open ? "box-none" : "none"}
        accessibilityViewIsModal={open}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      >
        <BottomSheet
          {...props}
          ref={ref}
          accessible={false}
          index={open ? 0 : -1}
          snapPoints={snapPoints}
          enableDynamicSizing={false}
          enablePanDownToClose
          topInset={0}
          bottomInset={0}
          backgroundComponent={SheetBackground}
          handleComponent={SheetHandle}
          backdropComponent={backdrop}
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
          enableBlurKeyboardOnGesture
          handleIndicatorStyle={s.handle}
          style={s.sheet}
        >
          {children}
        </BottomSheet>
      </View>
    </SafeTop>
  );
}
function SheetBackground({
  animatedIndex,
  pointerEvents,
  style,
}: BottomSheetBackgroundProps) {
  const corners = useAnimatedStyle(() => {
    const radius = interpolate(
      animatedIndex.get(),
      [0, 1],
      [24, 0],
      Extrapolation.CLAMP,
    );
    return { borderTopLeftRadius: radius, borderTopRightRadius: radius };
  });
  return (
    <Animated.View
      pointerEvents={pointerEvents}
      style={[style, s.background, corners]}
    />
  );
}
function SheetHandle({ animatedIndex, ...props }: BottomSheetHandleProps) {
  const top = useContext(SafeTop);
  const safeArea = useAnimatedStyle(() => ({
    paddingTop: interpolate(
      animatedIndex.get(),
      [0, 1],
      [0, top],
      Extrapolation.CLAMP,
    ),
  }));
  return (
    <Animated.View style={safeArea}>
      <BottomSheetHandle {...props} animatedIndex={animatedIndex} />
    </Animated.View>
  );
}
const s = StyleSheet.create({
  background: { backgroundColor: c.paper, borderCurve: "continuous" },
  handle: { width: 32, height: 4, backgroundColor: c.line },
  sheet: {
    shadowColor: c.ink,
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 10,
  },
});
