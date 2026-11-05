import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type KeyboardEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import { font, usePalette, type Palette } from "../theme";
import { useReduceMotion } from "../chat/useReduceMotion";
import { BookNotice } from "../components/BookNotice";
import {
  NOTE_SHEET,
  noteSheetDragHeight,
  noteSheetKeyboardTransition,
  noteSheetRestingHeight,
  settleNoteSheetDrag,
  type NoteSheetBounds,
} from "./noteSheetGeometry";

interface NoteSheetProps {
  readonly visible: boolean;
  readonly quote: string;
  readonly body: string;
  readonly saving: boolean;
  readonly onChangeBody: (value: string) => void;
  readonly onClose: () => void;
  readonly onSave: () => void;
  /** Kept for callers; the native editor always displays the short heading “笔记”. */
  readonly title?: string;
  readonly onDelete?: () => void;
  readonly notice?: { readonly title: string; readonly message: string } | null;
  readonly onDismissNotice?: () => void;
}

/** App-owned card: continuous resizing, keyboard-safe height, and explicit save/delete actions. */
export function NoteSheet({
  visible,
  quote,
  body,
  saving,
  onChangeBody,
  onClose,
  onSave,
  onDelete,
  notice,
  onDismissNotice,
}: NoteSheetProps) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const [presented, setPresented] = useState(visible);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [editorHeight, setEditorHeight] = useState(96);
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);
  const deleteSequence = useRef(0);
  const pendingDelete = useRef<number | null>(null);
  const cardHeight = useRef(
    new Animated.Value(window.height * NOTE_SHEET.initialRatio),
  ).current;
  const cardBottom = useRef(new Animated.Value(0)).current;
  const cardOffset = useRef(
    new Animated.Value(window.height * NOTE_SHEET.initialRatio + 40),
  ).current;
  const dimOpacity = useRef(new Animated.Value(0)).current;
  const currentHeight = useRef(window.height * NOTE_SHEET.initialRatio);
  const ratio = useRef<number>(NOTE_SHEET.initialRatio);
  const bounds = useRef<NoteSheetBounds>({
    height: window.height,
    safeTop: insets.top,
    keyboardOverlap: 0,
  });
  const dragStartHeight = useRef(0);
  const dragging = useRef(false);
  const closing = useRef(false);
  const shown = useRef(false);
  const presentedRef = useRef(presented);
  presentedRef.current = presented;
  const keyboardTop = useRef<number | null>(null);
  const mounted = useRef(true);
  const presentationEpoch = useRef(0);
  const transition = useRef<Animated.CompositeAnimation | null>(null);
  const latest = useRef({ visible, saving, onClose, onDelete, reduceMotion });
  latest.current = { visible, saving, onClose, onDelete, reduceMotion };

  useEffect(() => {
    mounted.current = true;
    const listener = cardHeight.addListener(({ value }) => {
      currentHeight.current = value;
    });
    return () => {
      mounted.current = false;
      pendingDelete.current = null;
      presentationEpoch.current += 1;
      transition.current?.stop();
      cardHeight.removeListener(listener);
      cardHeight.stopAnimation();
      cardBottom.stopAnimation();
      cardOffset.stopAnimation();
      dimOpacity.stopAnimation();
    };
  }, [cardBottom, cardHeight, cardOffset, dimOpacity]);

  const animateLayout = useCallback(
    (height: number, bottom: number, duration = 250) => {
      Animated.parallel([
        Animated.timing(cardHeight, {
          toValue: height,
          duration: latest.current.reduceMotion ? 0 : duration,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(cardBottom, {
          toValue: bottom,
          duration: latest.current.reduceMotion ? 0 : duration,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ]).start();
    },
    [cardBottom, cardHeight],
  );

  const dismiss = useCallback(
    (notify: boolean) => {
      if (closing.current || (notify && latest.current.saving)) return;
      const epoch = ++presentationEpoch.current;
      transition.current?.stop();
      closing.current = true;
      dragging.current = false;
      Keyboard.dismiss();
      const animation = Animated.parallel([
        Animated.timing(cardBottom, {
          toValue: 0,
          duration: latest.current.reduceMotion ? 0 : 240,
          easing: Easing.in(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(cardOffset, {
          toValue: currentHeight.current + 40,
          duration: latest.current.reduceMotion ? 0 : 240,
          easing: Easing.in(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(dimOpacity, {
          toValue: 0,
          duration: latest.current.reduceMotion ? 0 : 240,
          easing: Easing.in(Easing.ease),
          useNativeDriver: false,
        }),
      ]);
      transition.current = animation;
      animation.start(({ finished }) => {
        if (
          !finished ||
          !mounted.current ||
          epoch !== presentationEpoch.current
        ) return;
        transition.current = null;
        shown.current = false;
        setPresented(false);
        if (notify) latest.current.onClose();
      });
    },
    [cardBottom, cardOffset, dimOpacity],
  );

  const appear = useCallback(() => {
    if (!latest.current.visible || closing.current) return;
    shown.current = true;
    transition.current?.stop();
    const animation = Animated.parallel([
      Animated.timing(cardOffset, {
        toValue: 0,
        duration: latest.current.reduceMotion ? 0 : 280,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
      Animated.timing(dimOpacity, {
        toValue: 1,
        duration: latest.current.reduceMotion ? 0 : 280,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
    ]);
    transition.current = animation;
    animation.start();
  }, [cardOffset, dimOpacity]);

  useEffect(() => {
    if (!visible) {
      pendingDelete.current = null;
      setConfirmingDelete(null);
      if (presentedRef.current) dismiss(false);
      return;
    }
    // Invalidate the old dismissal before stopping it: reopening must never run its callback.
    presentationEpoch.current += 1;
    transition.current?.stop();
    transition.current = null;
    closing.current = false;
    dragging.current = false;
    ratio.current = NOTE_SHEET.initialRatio;
    keyboardTop.current = null;
    setKeyboardVisible(false);
    bounds.current = {
      height: window.height,
      safeTop: insets.top,
      keyboardOverlap: 0,
    };
    currentHeight.current = window.height * NOTE_SHEET.initialRatio;
    cardHeight.setValue(currentHeight.current);
    cardBottom.setValue(0);
    cardOffset.setValue(currentHeight.current + 40);
    dimOpacity.setValue(0);
    setEditorHeight(96);
    setPresented(true);
    // Modal calls onShow on a fresh presentation; a replacement while open needs no new modal.
    if (shown.current) appear();
    // Geometry changes are handled separately so rotation does not discard the chosen detent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    visible,
    appear,
    cardBottom,
    cardHeight,
    cardOffset,
    dimOpacity,
    dismiss,
  ]);

  useEffect(() => {
    bounds.current = {
      ...bounds.current,
      height: window.height,
      safeTop: insets.top,
      keyboardOverlap:
        keyboardTop.current === null
          ? 0
          : Math.max(0, window.height - keyboardTop.current),
    };
    if (presented && !closing.current && !dragging.current) {
      animateLayout(
        noteSheetRestingHeight(bounds.current, ratio.current),
        bounds.current.keyboardOverlap,
        0,
      );
    }
  }, [animateLayout, insets.top, presented, window.height]);

  useEffect(() => {
    if (!presented) return;
    const updateKeyboard = (event: KeyboardEvent, hiding = false) => {
      if (closing.current) return;
      const target = noteSheetKeyboardTransition(
        bounds.current,
        ratio.current,
        hiding ? null : event.endCoordinates.screenY,
      );
      // iOS emits both willChangeFrame and willHide; either order must settle only once.
      if (!target) return;
      const { keyboardOverlap } = target;
      keyboardTop.current =
        keyboardOverlap > 0 ? event.endCoordinates.screenY : null;
      setKeyboardVisible(keyboardOverlap > 0);
      bounds.current = { ...bounds.current, keyboardOverlap };
      ratio.current = target.ratio;
      dragging.current = false;
      animateLayout(
        target.height,
        keyboardOverlap,
        event.duration ?? 250,
      );
    };
    const frame = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow",
      (event) => updateKeyboard(event),
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      (event) => updateKeyboard(event, true),
    );
    return () => {
      frame.remove();
      hide.remove();
    };
  }, [animateLayout, presented]);

  const settleDrag = useCallback(
    (velocityY: number) => {
      dragging.current = false;
      const target = settleNoteSheetDrag(
        currentHeight.current,
        velocityY,
        bounds.current,
      );
      if (target.dismiss) {
        dismiss(true);
        return;
      }
      ratio.current = target.ratio;
      if (latest.current.reduceMotion) cardHeight.setValue(target.height);
      else
        Animated.spring(cardHeight, {
          toValue: target.height,
          damping: 24,
          stiffness: 200,
          mass: 1,
          useNativeDriver: false,
        }).start();
    },
    [cardHeight, dismiss],
  );

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          !latest.current.saving &&
          !closing.current &&
          Math.abs(gesture.dy) > 8 &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderGrant: () => {
          dragging.current = true;
          dragStartHeight.current = currentHeight.current;
          cardHeight.stopAnimation((value) => {
            dragStartHeight.current = value;
            currentHeight.current = value;
          });
        },
        onPanResponderMove: (_event, gesture) => {
          const height = noteSheetDragHeight(
            dragStartHeight.current,
            gesture.dy,
            bounds.current,
          );
          currentHeight.current = height;
          cardHeight.setValue(height);
        },
        onPanResponderRelease: (_event, gesture) => settleDrag(gesture.vy),
        onPanResponderTerminate: () => settleDrag(0),
        onPanResponderTerminationRequest: () => false,
      }),
    [cardHeight, settleDrag],
  );

  const toggleExpansion = () => {
    if (saving || closing.current) return;
    ratio.current =
      ratio.current === NOTE_SHEET.maximumRatio
        ? NOTE_SHEET.initialRatio
        : NOTE_SHEET.maximumRatio;
    animateLayout(
      noteSheetRestingHeight(bounds.current, ratio.current),
      bounds.current.keyboardOverlap,
      250,
    );
  };
  const confirmDelete = () => {
    if (!onDelete || saving || closing.current || pendingDelete.current !== null) return;
    const id = ++deleteSequence.current;
    pendingDelete.current = id;
    setConfirmingDelete(id);
  };
  const disabled = !body.trim() || saving;

  return (
    <Modal
      visible={presented}
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      onShow={appear}
      onRequestClose={() => dismiss(true)}
    >
      <View
        style={styles.overlay}
        accessibilityViewIsModal
        onAccessibilityEscape={() => dismiss(true)}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.dimmer,
            { opacity: dimOpacity },
          ]}
        />
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => dismiss(true)}
          accessibilityLabel="关闭笔记"
          disabled={saving}
        />
        <Animated.View
          testID="note-editor-card"
          style={[
            styles.card,
            {
              height: cardHeight,
              bottom: cardBottom,
              maxHeight: window.height * NOTE_SHEET.maximumRatio,
              transform: [{ translateY: cardOffset }],
            },
          ]}
        >
          <View {...pan.panHandlers} style={styles.dragArea}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="调整笔记高度"
              accessibilityHint="轻点展开或收起，也可上下拖动"
              disabled={saving}
              onPress={toggleExpansion}
              style={styles.grabberTouch}
            >
              <View style={styles.grabber} />
            </Pressable>
          </View>
          <View
            style={[
              styles.header,
              { marginLeft: insets.left + 16, marginRight: insets.right + 16 },
            ]}
          >
            <Pressable
              testID="note-close"
              accessibilityRole="button"
              accessibilityLabel="关闭"
              disabled={saving}
              onPress={() => dismiss(true)}
              hitSlop={4}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && styles.pressed,
              ]}
            >
              <SymbolView
                name="xmark"
                size={19}
                weight="medium"
                tintColor={palette.ink2}
              />
            </Pressable>
            <Text style={styles.title} numberOfLines={1}>
              笔记
            </Text>
            <View style={styles.spacer} />
            {onDelete ? (
              <Pressable
                testID="note-delete"
                accessibilityRole="button"
                accessibilityLabel="删除笔记"
                disabled={saving}
                onPress={confirmDelete}
                hitSlop={{ top: 8, bottom: 8 }}
                style={({ pressed }) => [
                  styles.deleteButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.deleteText}>删除笔记</Text>
              </Pressable>
            ) : null}
            <Pressable
              testID="note-save"
              accessibilityRole="button"
              accessibilityLabel="保存笔记"
              accessibilityHint={
                disabled && !saving ? "写点什么再保存" : undefined
              }
              accessibilityState={{ disabled, busy: saving }}
              disabled={disabled}
              onPress={onSave}
              hitSlop={{ top: 6, bottom: 6 }}
              style={({ pressed }) => [
                styles.saveButton,
                disabled && styles.saveDisabled,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[styles.saveText, disabled && styles.saveTextDisabled]}
              >
                {saving ? "保存中…" : "保存笔记"}
              </Text>
            </Pressable>
          </View>
          <ScrollView
            style={[
              styles.scroll,
              { marginLeft: insets.left + 16, marginRight: insets.right + 16 },
            ]}
            contentContainerStyle={{
              paddingBottom: keyboardVisible ? 8 : insets.bottom + 8,
            }}
            keyboardDismissMode={
              Platform.OS === "ios" ? "interactive" : "on-drag"
            }
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.quoteContainer}>
              <Text
                testID="note-quote"
                style={styles.quote}
                numberOfLines={2}
                ellipsizeMode="tail"
              >
                {quote}
              </Text>
            </View>
            <TextInput
              testID="note-body"
              accessibilityLabel="个人笔记"
              value={body}
              onChangeText={onChangeBody}
              placeholder="写点什么…"
              placeholderTextColor={palette.ink3}
              multiline
              editable={!saving}
              scrollEnabled={false}
              onContentSizeChange={(event) =>
                setEditorHeight(
                  Math.max(96, event.nativeEvent.contentSize.height),
                )
              }
              style={[styles.input, { height: editorHeight }]}
            />
          </ScrollView>
        </Animated.View>
        {confirmingDelete !== null ? (
          <BookNotice
            key={confirmingDelete}
            title="删除笔记？"
            message="删除后无法恢复；原文中的高亮与笔记也会移除。"
            actions={[
              { title: "取消", style: "cancel", onPress: () => {
                if (pendingDelete.current !== confirmingDelete) return;
                pendingDelete.current = null;
                setConfirmingDelete(null);
              } },
              { title: "删除", style: "destructive", onPress: () => {
                if (pendingDelete.current !== confirmingDelete) return;
                pendingDelete.current = null;
                setConfirmingDelete(null);
                if (mounted.current && latest.current.visible && !latest.current.saving && !closing.current) latest.current.onDelete?.();
              } },
            ]}
          />
        ) : null}
        {notice ? (
          <BookNotice title={notice.title} message={notice.message} onAcknowledge={() => onDismissNotice?.()} />
        ) : null}
      </View>
    </Modal>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    overlay: { flex: 1 },
    dimmer: { backgroundColor: "rgba(0,0,0,.25)" },
    card: {
      position: "absolute",
      left: 0,
      right: 0,
      backgroundColor: palette.paper,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      overflow: "hidden",
    },
    dragArea: { height: 26 },
    grabberTouch: { flex: 1, alignItems: "center" },
    grabber: {
      width: 33,
      height: 4,
      marginTop: 8,
      borderRadius: 2,
      backgroundColor: palette.ink3,
      opacity: 0.35,
    },
    header: {
      marginTop: 2,
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    closeButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    title: {
      fontFamily: font.serif,
      fontSize: 17,
      fontWeight: "600",
      color: palette.ink,
      flexShrink: 0,
    },
    spacer: { flex: 1 },
    deleteButton: { paddingVertical: 6, paddingHorizontal: 8 },
    deleteText: { color: palette.error, fontSize: 13, fontWeight: "500" },
    saveButton: {
      backgroundColor: palette.lamp,
      borderRadius: 999,
      paddingVertical: 7,
      paddingHorizontal: 14,
    },
    saveDisabled: { backgroundColor: palette.paperDeep },
    saveText: { fontSize: 13, fontWeight: "500", color: palette.paper },
    saveTextDisabled: { color: palette.ink3 },
    pressed: { opacity: 0.72 },
    scroll: { flex: 1, marginTop: 8 },
    quoteContainer: {
      backgroundColor: palette.paperDeep,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    quote: { color: palette.ink, fontFamily: font.serif, fontSize: 14 },
    input: {
      minHeight: 96,
      marginTop: 10,
      paddingTop: 8,
      paddingBottom: 8,
      paddingHorizontal: 0,
      fontSize: 15,
      color: palette.ink,
      backgroundColor: palette.paper,
      textAlignVertical: "top",
    },
  });
}
