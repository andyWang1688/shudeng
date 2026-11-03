/** 写笔记底部弹层：引用选文 + 多行输入；空内容禁用保存。 */
import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { radius, spacing, usePalette, type Palette } from '../theme';

export function NoteSheet({
  visible,
  quote,
  body,
  saving,
  onChangeBody,
  onClose,
  onSave,
}: {
  readonly visible: boolean;
  readonly quote: string;
  readonly body: string;
  readonly saving: boolean;
  readonly onChangeBody: (value: string) => void;
  readonly onClose: () => void;
  readonly onSave: () => void;
}) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const disabled = body.trim().length === 0 || saving;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭写笔记" onPress={onClose}>
              <Text style={styles.close}>关闭</Text>
            </Pressable>
            <Text style={styles.title}>写笔记</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="保存笔记" disabled={disabled} onPress={onSave}>
              <Text style={[styles.done, disabled && styles.doneDisabled]}>{saving ? '保存中…' : '保存'}</Text>
            </Pressable>
          </View>
          <Text style={styles.quote} numberOfLines={3}>{quote}</Text>
          <TextInput
            accessibilityLabel="笔记内容"
            value={body}
            onChangeText={onChangeBody}
            placeholder="写下你的想法…"
            placeholderTextColor={palette.ink3}
            multiline
            autoFocus
            style={styles.input}
          />
        </View>
      </View>
    </Modal>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.28)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: palette.paper, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, paddingBottom: 24 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
    title: { fontSize: 16, fontWeight: '600', color: palette.ink },
    close: { fontSize: 14, color: palette.lamp },
    done: { fontSize: 14, fontWeight: '600', color: palette.lamp },
    doneDisabled: { color: palette.ink3 },
    quote: { marginHorizontal: spacing.md, marginTop: spacing.sm, fontSize: 12, lineHeight: 18, color: palette.ink3, backgroundColor: palette.paperDeep, borderRadius: radius.field, padding: spacing.sm },
    input: { margin: spacing.md, minHeight: 110, borderRadius: radius.field, backgroundColor: palette.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.line, padding: spacing.sm, fontSize: 14, color: palette.ink, textAlignVertical: 'top' },
  });
}
