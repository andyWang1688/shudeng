import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type Ref,
} from "react";
import { Keyboard, StyleSheet, View } from "react-native";
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
import { usePalette, type Palette } from "../theme";

type Props = Omit<
  BottomSheetProps,
  | "index"
  | "snapPoints"
  | "enableDynamicSizing"
  | "backgroundComponent"
  | "handleComponent"
  | "backdropComponent"
  | "topInset"
  | "bottomInset"
> & {
  ref?: Ref<BottomSheet>;
  open?: boolean;
  initialHeight: number;
  initialIndex?: 0 | 1;
  palette?: Palette;
  topSafeInset?: number;
  backdropOpacity?: number;
  backdropPressBehavior?: "close" | "none";
  backdropLabel?: string;
};
const Chrome = createContext({ top: 0, surface: "" });

/** Shared detents and geometry; each caller retains its own save and close rules. */
export function AppSheet({
  ref,
  open = true,
  initialHeight,
  initialIndex = 0,
  palette: override,
  topSafeInset,
  backdropOpacity = 0.22,
  backdropPressBehavior = "close",
  backdropLabel = "关闭面板",
  enablePanDownToClose = true,
  children,
  ...props
}: Props) {
  const defaults = usePalette();
  const palette = override ?? defaults;
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
        pressBehavior={backdropPressBehavior}
        accessible={backdropPressBehavior === "close"}
        {...(backdropPressBehavior === "close"
          ? { onPress: Keyboard.dismiss }
          : {})}
        accessibilityLabel={backdropLabel}
      />
    ),
    [backdropOpacity, backdropPressBehavior, backdropLabel],
  );
  return (
    <Chrome
      value={{
        top: topSafeInset ?? insets.top,
        surface: palette.paper,
      }}
    >
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents={open ? "box-none" : "none"}
        accessibilityViewIsModal={open}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      >
        <BottomSheet
          ref={ref}
          accessible={false}
          index={open ? initialIndex : -1}
          snapPoints={snapPoints}
          topInset={0}
          bottomInset={0}
          enableDynamicSizing={false}
          enablePanDownToClose={enablePanDownToClose}
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
          enableBlurKeyboardOnGesture
          android_keyboardInputMode="adjustResize"
          {...props}
          backgroundComponent={SheetBackground}
          handleComponent={SheetHandle}
          backdropComponent={backdrop}
          handleIndicatorStyle={[
            styles.handle,
            { backgroundColor: palette.line },
            props.handleIndicatorStyle,
          ]}
          style={[styles.sheet, props.style]}
        >
          {children}
        </BottomSheet>
      </View>
    </Chrome>
  );
}
function SheetBackground({
  animatedIndex,
  pointerEvents,
  style,
}: BottomSheetBackgroundProps) {
  const chrome = useContext(Chrome);
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
      style={[
        style,
        styles.background,
        { backgroundColor: chrome.surface },
        corners,
      ]}
    />
  );
}
function SheetHandle({ animatedIndex, ...props }: BottomSheetHandleProps) {
  const { top } = useContext(Chrome);
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
const styles = StyleSheet.create({
  background: { borderCurve: "continuous" },
  handle: { width: 32, height: 4 },
  sheet: {
    shadowColor: "#292722",
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 10,
  },
});
