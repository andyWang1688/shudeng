import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette, type Palette } from "../theme";

export interface BookActionSheetAction {
  readonly key: string;
  readonly title: string;
  readonly onPress: () => void;
}

type Props = {
  readonly title: string;
  readonly message: string;
  readonly actions: readonly BookActionSheetAction[];
  readonly onCancel: () => void;
};

/** Bottom paper card matching BookAlertController.actionSheet, including dismissal order. */
export function BookActionSheet({ title, message, actions, onCancel }: Props) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const reduceMotion = useRef(true);
  const mounted = useRef(true);
  const pendingAction = useRef<(() => void) | null>(null);

  useEffect(() => {
    mounted.current = true;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", value => {
      reduceMotion.current = value;
    });
    return () => {
      mounted.current = false;
      pendingAction.current = null;
      subscription.remove();
      opacity.stopAnimation();
    };
  }, [opacity]);

  const animateIn = async () => {
    const enabled = await AccessibilityInfo.isReduceMotionEnabled().catch(() => true);
    if (!mounted.current || closing.current) return;
    reduceMotion.current = enabled;
    Animated.timing(opacity, {
      toValue: 1,
      duration: enabled ? 0 : 350,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start();
  };

  const didDismiss = () => {
    if (!mounted.current) return;
    const action = pendingAction.current;
    pendingAction.current = null;
    action?.();
  };

  const choose = (action: () => void) => {
    if (closing.current) return;
    closing.current = true;
    pendingAction.current = action;
    setDisabled(true);
    Animated.timing(opacity, {
      toValue: 0,
      duration: reduceMotion.current ? 0 : 160,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished || !mounted.current) return;
      setVisible(false);
      // iOS has a real dismissal completion. Other Modal platforms lack onDismiss.
      if (Platform.OS !== "ios") didDismiss();
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      presentationStyle="overFullScreen"
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={["portrait", "landscape-left", "landscape-right"]}
      onShow={animateIn}
      onDismiss={didDismiss}
      onRequestClose={() => choose(onCancel)}
    >
      <Animated.View
        style={[styles.overlay, { paddingBottom: insets.bottom + 8, opacity }]}
        testID="book-dialog"
      >
        <Pressable
          testID="book-action-sheet-backdrop"
          accessible={false}
          importantForAccessibility="no"
          style={styles.backdrop}
          disabled={disabled}
          onPress={() => choose(onCancel)}
        />
        <View
          style={styles.card}
          testID={title}
          accessibilityViewIsModal
          onAccessibilityEscape={() => choose(onCancel)}
        >
          <Text style={styles.title} dynamicTypeRamp="headline" accessibilityRole="header">
            {title}
          </Text>
          {message.length > 0 ? (
            <Text style={styles.message} dynamicTypeRamp="footnote" lineBreakStrategyIOS="standard">
              {message}
            </Text>
          ) : null}
          <View style={styles.actions}>
            {actions.map((action, index) => (
              <View key={action.key}>
                {index > 0 ? <View style={styles.separator} /> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={action.title}
                  accessibilityState={{ disabled }}
                  disabled={disabled}
                  onPress={() => choose(action.onPress)}
                  style={({ pressed }) => [styles.button, pressed && styles.pressed]}
                >
                  <Text style={styles.buttonTitle} dynamicTypeRamp="subheadline">{action.title}</Text>
                </Pressable>
              </View>
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="取消"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => choose(onCancel)}
            style={({ pressed }) => [styles.button, styles.cancel, pressed && styles.pressed]}
          >
            <Text style={[styles.buttonTitle, styles.cancelTitle]} dynamicTypeRamp="subheadline">取消</Text>
          </Pressable>
        </View>
      </Animated.View>
    </Modal>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    overlay: { flex: 1, justifyContent: "flex-end", paddingHorizontal: 8 },
    backdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.34)" },
    card: {
      paddingTop: 20,
      paddingHorizontal: 20,
      paddingBottom: 16,
      borderRadius: 22,
      borderCurve: "continuous",
      backgroundColor: palette.paper,
      shadowColor: "#000000",
      shadowOpacity: 0.26,
      shadowRadius: 34,
      shadowOffset: { width: 0, height: 14 },
    },
    title: {
      fontFamily: Platform.OS === "ios" ? "SongtiSC-Bold" : "serif",
      fontWeight: "600",
      fontSize: 17,
      color: palette.ink,
    },
    message: { marginTop: 6, fontSize: 13, color: palette.ink2 },
    actions: { marginTop: 18 },
    button: { paddingVertical: 14, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
    buttonTitle: { fontSize: 14, fontWeight: "500", color: palette.ink, textAlign: "center" },
    separator: { height: 1, backgroundColor: palette.line },
    cancel: { marginTop: 10, borderRadius: 12, backgroundColor: palette.paperDeep },
    cancelTitle: { color: palette.ink2 },
    pressed: { opacity: 0.7 },
  });
}
