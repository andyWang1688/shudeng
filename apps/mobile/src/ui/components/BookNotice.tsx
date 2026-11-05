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
import { usePalette, type Palette } from "../theme";

export interface BookNoticeAction {
  readonly title: string;
  readonly style?: "default" | "cancel" | "destructive";
  readonly onPress: () => void;
}

type BookNoticeProps = {
  readonly title: string;
  readonly message: string;
  readonly onShow?: () => void;
  readonly onCloseStart?: () => void;
  readonly onDismiss?: () => void;
} & (
  | { readonly onAcknowledge: () => void; readonly actions?: never }
  | { readonly actions: readonly BookNoticeAction[]; readonly onAcknowledge?: never }
);

/** Notice and confirmation card matching the native BookAlertController. */
export function BookNotice(props: BookNoticeProps) {
  const { title, message } = props;
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [visible, setVisible] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const reduceMotion = useRef(true);
  const mounted = useRef(true);
  const pendingAction = useRef<(() => void) | null>(null);
  const actions: readonly BookNoticeAction[] = props.actions ?? [
    { title: "知道了", onPress: props.onAcknowledge },
  ];
  const orderedActions = [
    ...actions.filter((action) => action.style !== "cancel"),
    ...actions.filter((action) => action.style === "cancel").slice(0, 1),
  ];
  const primaryIndex = orderedActions.findIndex((action) => action.style !== "cancel" && action.style !== "destructive");

  useEffect(() => {
    mounted.current = true;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
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
    props.onDismiss?.();
  };

  const choose = (action: BookNoticeAction) => {
    if (closing.current) return;
    closing.current = true;
    pendingAction.current = action.onPress;
    setDisabled(true);
    props.onCloseStart?.();
    Animated.timing(opacity, {
      toValue: 0,
      duration: reduceMotion.current ? 0 : 160,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished || !mounted.current) return;
      setVisible(false);
      // iOS invokes actions only after the native modal has actually dismissed.
      // Other platforms do not provide Modal.onDismiss.
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
      supportedOrientations={["portrait", "landscape-left", "landscape-right"]}
      onShow={() => { props.onShow?.(); void animateIn(); }}
      onDismiss={didDismiss}
      onRequestClose={() => undefined}
    >
      <Animated.View style={[styles.overlay, { opacity }]} testID="book-dialog">
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.title} dynamicTypeRamp="headline" accessibilityRole="header">
            {title}
          </Text>
          <Text style={styles.message} dynamicTypeRamp="footnote" lineBreakStrategyIOS="standard">{message}</Text>
          <View style={styles.actions}>
            {orderedActions.map((action, index) => (
              <Pressable
                key={`${index}:${action.title}`}
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => choose(action)}
                style={({ pressed }) => [
                  styles.button,
                  index === primaryIndex && styles.primaryButton,
                  action.style === "destructive" && styles.destructiveButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.buttonTitle,
                    index === primaryIndex && styles.primaryTitle,
                    action.style === "destructive" && styles.destructiveTitle,
                  ]}
                  dynamicTypeRamp="subheadline"
                >
                  {action.title}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 24,
      backgroundColor: "rgba(0,0,0,0.34)",
    },
    card: {
      width: 320,
      maxWidth: "100%",
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
    title: { fontFamily: "SongtiSC-Bold", fontWeight: "600", fontSize: 17, color: palette.ink, textAlign: "center" },
    message: { marginTop: 6, fontSize: 13, color: palette.ink2, textAlign: "center" },
    actions: { marginTop: 18, gap: 8 },
    button: {
      minHeight: 44,
      paddingVertical: 11,
      paddingHorizontal: 16,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
      backgroundColor: palette.paperDeep,
    },
    primaryButton: { backgroundColor: palette.ink },
    destructiveButton: { backgroundColor: palette.errorWash },
    buttonTitle: { fontSize: 14, fontWeight: "500", color: palette.ink, textAlign: "center" },
    primaryTitle: { color: palette.paper },
    destructiveTitle: { color: palette.error },
    pressed: { opacity: 0.7 },
  });
}
