import { createContext, type ReactNode, useContext, useRef } from "react";
import { Keyboard, Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetFooter,
  type BottomSheetFooterProps,
} from "@gorhom/bottom-sheet";
import { Maximize2, X } from "lucide-react-native";
import { AppSheet } from "../components/AppSheet";
import { useReaderSheetLifecycle } from "../reader/useReaderSheetLifecycle";
import type { Palette } from "../theme";
import { tapFeedback } from "./haptics";
import {
  AssistantSheetFooterPosition,
  useAssistantSheetBodyLayout,
} from "./AssistantSheetAdapter";

const ChromeContext = createContext<{
  node: ReactNode;
  bottomInset: number;
} | null>(null);

/** Stable component identity preserves the input and focus during streaming. */
function SheetFooter(props: BottomSheetFooterProps) {
  const footer = useContext(ChromeContext);
  if (!footer) return null;
  return (
    <BottomSheetFooter {...props} bottomInset={0}>
      <AssistantSheetFooterPosition
        animatedFooterPosition={props.animatedFooterPosition}
      />
      <View
        pointerEvents="box-none"
        style={{ paddingBottom: Math.max(footer.bottomInset, 12) }}
      >
        {footer.node}
      </View>
    </BottomSheetFooter>
  );
}

/** Gorhom owns drag, release-to-snap, scrolling and keyboard coordination. */
export function ChatSheet({
  title,
  palette,
  topInset,
  bottomInset,
  initialDetent,
  onDetentChange,
  onClose,
  footer,
  children,
}: {
  readonly title: string;
  readonly palette: Palette;
  readonly topInset: number;
  readonly bottomInset: number;
  readonly initialDetent: number;
  readonly onDetentChange: (index: number) => void;
  readonly onClose: () => void;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}) {
  const lifecycle = useReaderSheetLifecycle({
    visible: true,
    busy: false,
    onClose: () => {
      Keyboard.dismiss();
      onClose();
    },
  });
  const { sheet } = lifecycle;
  const initialIndex = useRef<0 | 1>(initialDetent === 1 ? 1 : 0).current;
  const onBodyLayout = useAssistantSheetBodyLayout();
  return (
    <ChromeContext value={{ node: footer, bottomInset }}>
      <View
        testID="question-sheet"
        style={styles.sheet}
        accessibilityViewIsModal
      >
        <AppSheet
          ref={sheet}
          palette={palette}
          topSafeInset={topInset}
          initialHeight={76}
          initialIndex={initialIndex}
          backdropLabel="收起问答，继续阅读"
          {...(footer ? { footerComponent: SheetFooter } : {})}
          onAnimate={lifecycle.onAnimate}
          onChange={(index) => {
            if (index < 0 || !lifecycle.canInteract()) return;
            onDetentChange(index);
          }}
          onClose={lifecycle.didClose}
        >
          <View testID="question-sheet-header" style={styles.controls}>
            <Text
              numberOfLines={1}
              style={[styles.title, { color: palette.ink }]}
            >
              {title}
            </Text>
            <Pressable
              testID="question-sheet-expand"
              accessibilityRole="button"
              accessibilityLabel="全屏问答"
              disabled={lifecycle.blocked}
              onPress={() => {
                if (!lifecycle.canInteract()) return;
                tapFeedback();
                sheet.current?.snapToIndex(1);
              }}
              style={styles.control}
            >
              <Maximize2 size={17} color={palette.ink2} accessible={false} />
            </Pressable>
            <Pressable
              testID="question-sheet-close"
              accessibilityRole="button"
              accessibilityLabel="收起问答，继续阅读"
              disabled={lifecycle.blocked}
              onPress={() => {
                if (!lifecycle.canInteract()) return;
                tapFeedback();
                lifecycle.close();
              }}
              style={styles.control}
            >
              <X size={19} color={palette.ink2} accessible={false} />
            </Pressable>
          </View>
          <View style={styles.body} onLayout={onBodyLayout}>
            {children}
          </View>
        </AppSheet>
      </View>
    </ChromeContext>
  );
}
const styles = StyleSheet.create({
  sheet: { flex: 1, width: "100%" },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 24,
    paddingRight: 14,
    paddingTop: 6,
    paddingBottom: 12,
  },
  title: {
    flex: 1,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "600",
    marginRight: 12,
  },
  control: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1 },
});
