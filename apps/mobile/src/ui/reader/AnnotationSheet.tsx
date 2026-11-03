/** 「标注与书签」底部面板：列出当前书高亮/笔记/书签，可跳转或删除。 */
import { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ShelfAnnotation } from '../../platform/library';
import { radius, spacing, usePalette, type Palette } from '../theme';

const KIND_LABEL: Record<ShelfAnnotation['kind'], string> = {
  highlight: '高亮',
  note: '笔记',
  bookmark: '书签',
};

export function AnnotationSheet({
  visible,
  annotations,
  onClose,
  onJump,
  onDelete,
}: {
  readonly visible: boolean;
  readonly annotations: readonly ShelfAnnotation[];
  readonly onClose: () => void;
  readonly onJump: (annotation: ShelfAnnotation) => void;
  readonly onDelete: (annotation: ShelfAnnotation) => void;
}) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <Text style={styles.title}>标注与书签</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭标注" onPress={onClose}>
              <Text style={styles.close}>完成</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            {annotations.length === 0 ? (
              <Text style={styles.empty}>还没有标注。在正文中选字可以高亮、写笔记；点「书签」记录当前位置。</Text>
            ) : (
              annotations.slice().reverse().map((annotation) => (
                <View key={annotation.id} style={styles.row}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`跳转到${KIND_LABEL[annotation.kind]}`}
                    onPress={() => onJump(annotation)}
                    style={styles.main}
                  >
                    <View style={styles.meta}>
                      <View style={[styles.colorDot, { backgroundColor: annotation.color ?? palette.lamp }]} />
                      <Text style={styles.kind}>{KIND_LABEL[annotation.kind]}</Text>
                      {annotation.page !== null ? <Text style={styles.page}>第 {annotation.page} 页</Text> : null}
                    </View>
                    <Text style={styles.quote} numberOfLines={2}>{annotation.quote || '（位置）'}</Text>
                    {annotation.body ? <Text style={styles.body}>{annotation.body}</Text> : null}
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="删除标注" onPress={() => onDelete(annotation)} style={styles.delete}>
                    <Text style={styles.deleteText}>删除</Text>
                  </Pressable>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.28)', justifyContent: 'flex-end' },
    panel: { maxHeight: '72%', backgroundColor: palette.paper, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
    title: { fontSize: 16, fontWeight: '600', color: palette.ink },
    close: { fontSize: 14, color: palette.lamp },
    scroll: { flexGrow: 0 },
    content: { padding: spacing.md, gap: spacing.sm },
    empty: { fontSize: 13, lineHeight: 20, color: palette.ink3, paddingVertical: spacing.lg },
    row: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.field, backgroundColor: palette.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.line, padding: spacing.sm },
    main: { flex: 1 },
    meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    colorDot: { width: 8, height: 8, borderRadius: 4 },
    kind: { fontSize: 11, fontWeight: '600', color: palette.ink2 },
    page: { fontSize: 11, color: palette.ink3 },
    quote: { marginTop: 5, fontSize: 13, lineHeight: 19, color: palette.ink },
    body: { marginTop: 4, fontSize: 12, lineHeight: 18, color: palette.ink2 },
    delete: { paddingHorizontal: 8, paddingVertical: 6 },
    deleteText: { fontSize: 12, color: palette.danger },
  });
}
