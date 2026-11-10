import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Maximize2, Trash2, X } from "lucide-react-native";
import { usePalette, type Palette } from "../theme";
import { AppSheet } from "../components/AppSheet";
import { BookNotice } from "../components/BookNotice";
import { useReaderSheetLifecycle } from "./useReaderSheetLifecycle";

interface NoteSheetProps {
  readonly visible: boolean;
  readonly quote: string;
  readonly body: string;
  readonly saving: boolean;
  readonly onChangeBody: (value: string) => void;
  readonly onClose: () => void;
  readonly onSave: () => void;
  readonly title?: string;
  readonly onDelete?: () => void;
  readonly notice?: { readonly title: string; readonly message: string } | null;
  readonly onDismissNotice?: () => void;
}

/** The common sheet owns gestures; its caller still owns explicit save and discarded edits. */
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
  const [editorHeight, setEditorHeight] = useState(180);
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);
  const deleteSequence = useRef(0);
  const pendingDelete = useRef<number | null>(null);
  const latest = useRef({
    body,
    onDelete,
    onSave,
    onChangeBody,
  });
  latest.current = {
    body,
    onDelete,
    onSave,
    onChangeBody,
  };
  const { sheet, close, didClose, onAnimate, isCurrent, canInteract, blocked } =
    useReaderSheetLifecycle({
      visible,
      busy: saving,
      onClose,
      onBeginClose: () => {
        pendingDelete.current = null;
        setConfirmingDelete(null);
      },
    });
  useEffect(() => {
    pendingDelete.current = null;
    setConfirmingDelete(null);
    if (visible) setEditorHeight(180);
  }, [visible]);
  const confirmDelete = () => {
    if (
      !latest.current.onDelete ||
      !canInteract() ||
      pendingDelete.current !== null
    )
      return;
    const id = ++deleteSequence.current;
    pendingDelete.current = id;
    setConfirmingDelete(id);
  };
  const disabled = !body.trim() || blocked;
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
            initialHeight={76}
            palette={palette}
            onClose={didClose}
            onAnimate={onAnimate}
            enablePanDownToClose={!blocked}
            enableHandlePanningGesture={!blocked}
            enableContentPanningGesture={!blocked}
            backdropPressBehavior={blocked ? "none" : "close"}
            backdropLabel="关闭笔记"
          >
            <View
              testID="note-editor-card"
              style={styles.root}
              pointerEvents={blocked ? "none" : "auto"}
              accessibilityViewIsModal
              onAccessibilityEscape={close}
            >
              <View style={styles.header}>
                <Pressable
                  testID="note-close"
                  accessibilityRole="button"
                  accessibilityLabel="关闭笔记"
                  disabled={blocked}
                  onPress={close}
                  style={styles.icon}
                >
                  <X size={20} color={palette.ink2} />
                </Pressable>
                <Text style={styles.title}>笔记</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="全屏笔记"
                  disabled={blocked}
                  onPress={() => {
                    if (canInteract()) sheet.current?.snapToIndex(1);
                  }}
                  style={styles.icon}
                >
                  <Maximize2 size={17} color={palette.ink2} />
                </Pressable>
                {onDelete ? (
                  <Pressable
                    testID="note-delete"
                    accessibilityRole="button"
                    accessibilityLabel="删除笔记"
                    disabled={blocked}
                    onPress={confirmDelete}
                    style={styles.icon}
                  >
                    <Trash2 size={18} color={palette.ink2} />
                  </Pressable>
                ) : null}
                <Pressable
                  testID="note-save"
                  accessibilityRole="button"
                  accessibilityLabel="保存笔记"
                  accessibilityState={{ disabled, busy: saving }}
                  disabled={disabled}
                  onPress={() => {
                    if (canInteract() && latest.current.body.trim())
                      latest.current.onSave();
                  }}
                  style={[styles.icon, disabled && styles.disabled]}
                >
                  <Text style={styles.save}>{saving ? "保存中…" : "保存"}</Text>
                </Pressable>
              </View>
              <BottomSheetScrollView
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                contentContainerStyle={[
                  styles.content,
                  { paddingBottom: Math.max(insets.bottom, 20) },
                ]}
              >
                <Text testID="note-quote" style={styles.quote}>
                  {quote}
                </Text>
                <BottomSheetTextInput
                  testID="note-body"
                  accessibilityLabel="个人笔记"
                  value={body}
                  onChangeText={(value) => {
                    if (canInteract()) latest.current.onChangeBody(value);
                  }}
                  placeholder="写下你的想法…"
                  placeholderTextColor={palette.ink3}
                  multiline
                  textAlignVertical="top"
                  editable={!blocked}
                  scrollEnabled={false}
                  onContentSizeChange={(event) => {
                    // Native text layout may finish after this editor closes.
                    if (isCurrent())
                      setEditorHeight(
                        Math.max(180, event.nativeEvent.contentSize.height),
                      );
                  }}
                  style={[styles.input, { height: editorHeight }]}
                />
              </BottomSheetScrollView>
            </View>
          </AppSheet>
        ) : null}
        {confirmingDelete !== null ? (
          <BookNotice
            key={confirmingDelete}
            title="删除笔记？"
            message="删除后无法恢复；原文中的高亮与笔记也会移除。"
            actions={[
              {
                title: "取消",
                style: "cancel",
                onPress: () => {
                  if (pendingDelete.current !== confirmingDelete) return;
                  pendingDelete.current = null;
                  setConfirmingDelete(null);
                },
              },
              {
                title: "删除",
                style: "destructive",
                onPress: () => {
                  if (pendingDelete.current !== confirmingDelete) return;
                  pendingDelete.current = null;
                  setConfirmingDelete(null);
                  if (canInteract()) latest.current.onDelete?.();
                },
              },
            ]}
          />
        ) : null}
        {notice ? (
          <BookNotice
            title={notice.title}
            message={notice.message}
            onAcknowledge={() => onDismissNotice?.()}
          />
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}
function makeStyles(palette: Palette) {
  return StyleSheet.create({
    root: { flex: 1 },
    header: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      paddingBottom: 8,
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
      fontWeight: "600",
      paddingLeft: 6,
    },
    save: { color: palette.lampInk, fontSize: 16, fontWeight: "600" },
    disabled: { opacity: 0.35 },
    content: { paddingHorizontal: 26 },
    quote: {
      color: palette.ink2,
      fontFamily: "Songti SC",
      fontSize: 17,
      lineHeight: 29,
      borderLeftWidth: 2,
      borderLeftColor: palette.lamp,
      paddingLeft: 14,
      marginVertical: 12,
    },
    input: {
      minHeight: 180,
      color: palette.ink,
      fontSize: 18,
      lineHeight: 29,
      padding: 0,
      paddingTop: 16,
    },
  });
}
