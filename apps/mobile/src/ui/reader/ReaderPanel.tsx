import { useMemo, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Maximize2, X } from "lucide-react-native";
import { AppSheet } from "../components/AppSheet";
import { usePalette, type Palette } from "../theme";
import {
  useReaderSheetLifecycle,
  type ReaderPanelActions,
} from "./useReaderSheetLifecycle";

export type { ReaderPanelActions } from "./useReaderSheetLifecycle";
type PanelContent = ReactNode | ((actions: ReaderPanelActions) => ReactNode);

/** A native modal host also covers the tab bar when a panel opens from the shelf. */
export function ReaderPanel({
  visible,
  title,
  onClose,
  children,
  action,
  initialHeight = 70,
  busy = false,
  testID,
}: {
  readonly visible: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: PanelContent;
  readonly action?: PanelContent;
  readonly initialHeight?: number;
  readonly busy?: boolean;
  readonly testID?: string;
}) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const { sheet, close, didClose, onAnimate, canInteract, blocked } =
    useReaderSheetLifecycle({ visible, busy, onClose });
  const actions: ReaderPanelActions = { blocked, canInteract };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      onRequestClose={close}
    >
      <GestureHandlerRootView style={styles.root}>
        {visible ? (
          <AppSheet
            ref={sheet}
            initialHeight={initialHeight}
            palette={palette}
            onClose={didClose}
            onAnimate={onAnimate}
            enablePanDownToClose={!blocked}
            enableHandlePanningGesture={!blocked}
            enableContentPanningGesture={!blocked}
            backdropPressBehavior={blocked ? "none" : "close"}
          >
            <View
              testID={testID}
              style={styles.body}
              pointerEvents={blocked ? "none" : "auto"}
              accessibilityViewIsModal
              onAccessibilityEscape={close}
            >
              <View style={styles.header}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={"关闭" + title}
                  disabled={blocked}
                  onPress={close}
                  style={styles.icon}
                >
                  <X size={20} color={palette.ink2} />
                </Pressable>
                <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
                  {title}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={"全屏" + title}
                  disabled={blocked}
                  onPress={() => {
                    if (canInteract()) sheet.current?.snapToIndex(1);
                  }}
                  style={styles.icon}
                >
                  <Maximize2 size={17} color={palette.ink2} />
                </Pressable>
                {typeof action === "function" ? action(actions) : action}
              </View>
              {typeof children === "function" ? children(actions) : children}
            </View>
          </AppSheet>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}
function makeStyles(palette: Palette) {
  return StyleSheet.create({
    root: { flex: 1 },
    body: { flex: 1 },
    header: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      paddingBottom: 8,
      gap: 4,
    },
    icon: {
      minWidth: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    title: {
      flex: 1,
      color: palette.ink,
      fontSize: 20,
      lineHeight: 28,
      fontWeight: "600",
      paddingLeft: 6,
    },
  });
}
