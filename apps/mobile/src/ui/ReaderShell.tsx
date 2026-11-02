import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ReaderWebView, type ReaderEvent } from '../reader/ReaderWebView';
import type { ReaderAnnotationSeed, ReaderLocator } from '../reader/readerProtocol';
import {
  deleteReaderAnnotation,
  loadBookAnnotations,
  saveBookProgress,
  saveReaderAnnotation,
  type BookFormat,
  type ShelfAnnotation,
  type StoredReaderLocator,
} from '../platform/library';
import { colors, radius, spacing } from './theme';

type ReaderShellProps = {
  readonly bookId: string;
  readonly initialLocation: string | undefined;
  readonly title?: string;
  readonly openOverride:
    | undefined
    | {
        readonly format: 'epub' | 'pdf';
        readonly title: string;
        readonly dataBase64: string;
        readonly mimeType: string;
      };
  readonly initialAnnotations?: readonly ShelfAnnotation[];
  readonly onJumpToLocator?: (locator: StoredReaderLocator) => void;
  readonly onAnnotationsChanged?: (annotations: readonly ShelfAnnotation[]) => void;
};

type SelectionState = {
  readonly quote: string;
  readonly locator: ReaderLocator;
};

const KIND_LABEL: Record<ShelfAnnotation['kind'], string> = {
  highlight: '高亮',
  note: '笔记',
  bookmark: '书签',
};

function toStoredLocator(locator: ReaderLocator | undefined): StoredReaderLocator | null {
  if (!locator) return null;
  if (locator.type === 'pdf' && typeof locator.page === 'number') {
    return {
      type: 'pdf',
      page: locator.page,
      ...(locator.rects
        ? { rects: locator.rects.map((rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })) }
        : {}),
    };
  }
  if (locator.type === 'epub' && typeof locator.cfi === 'string') {
    return {
      type: 'epub',
      cfi: locator.cfi,
      ...(locator.href ? { href: locator.href } : {}),
      ...(locator.chapter ? { chapter: locator.chapter } : {}),
    };
  }
  return null;
}

function toSeed(annotation: ShelfAnnotation, format: BookFormat): ReaderAnnotationSeed | null {
  if (!annotation.locator || annotation.kind === 'bookmark') return null;
  return {
    id: annotation.id,
    format: format === 'PDF' ? 'pdf' : 'epub',
    locator: annotation.locator as ReaderLocator,
    ...(annotation.quote ? { text: annotation.quote } : {}),
    ...(annotation.body ? { note: annotation.body } : {}),
    ...(annotation.color ? { color: annotation.color } : {}),
    ...(annotation.page !== null ? { page: annotation.page } : {}),
  };
}

export function ReaderShell({ bookId, initialLocation, title, openOverride, initialAnnotations, onJumpToLocator, onAnnotationsChanged }: ReaderShellProps) {
  const router = useRouter();
  const [annotations, setAnnotations] = useState<readonly ShelfAnnotation[]>(initialAnnotations ?? []);
  const [progress, setProgress] = useState(0);
  const [chapter, setChapter] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteBody, setNoteBody] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const latestProgress = useRef<{ locator: StoredReaderLocator; percent: number; chapter: string | null } | null>(null);
  const lastSavedAt = useRef(0);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2400);
  }, []);

  const refreshAnnotations = useCallback(async () => {
    try {
      const next = await loadBookAnnotations(bookId);
      setAnnotations(next);
      onAnnotationsChanged?.(next);
    } catch {
      // 标注读取失败不阻塞阅读。
    }
  }, [bookId, onAnnotationsChanged]);

  useEffect(() => {
    setAnnotations(initialAnnotations ?? []);
  }, [initialAnnotations]);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      const latest = latestProgress.current;
      if (latest) void saveBookProgress(bookId, latest);
    };
  }, [bookId]);

  const persistProgress = useCallback((locator: StoredReaderLocator, percent: number, nextChapter: string | null, force = false) => {
    latestProgress.current = { locator, percent, chapter: nextChapter };
    const now = Date.now();
    if (!force && now - lastSavedAt.current < 1200) return;
    lastSavedAt.current = now;
    void saveBookProgress(bookId, { locator, percent, chapter: nextChapter });
  }, [bookId]);

  const persistHighlight = useCallback(async (event: Extract<ReaderEvent, { type: 'annotationAdded' }>) => {
    const locator = toStoredLocator(event.locator);
    if (!locator) return;
    try {
      await saveReaderAnnotation(bookId, {
        kind: 'highlight',
        color: 'yellow',
        quote: event.quote,
        format: 'EPUB',
        locator,
        chapter,
      });
      await refreshAnnotations();
      showNotice('已保存高亮');
    } catch (cause) {
      setError(`高亮保存失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }, [bookId, chapter, refreshAnnotations, showNotice]);

  const onReaderEvent = (event: ReaderEvent) => {
    switch (event.type) {
      case 'ready':
        setError(null);
        break;
      case 'selection': {
        const locator = toStoredLocator(event.locator);
        setSelection(locator ? { quote: event.quote, locator } : null);
        break;
      }
      case 'progress': {
        const locator = toStoredLocator(event.locator);
        if (!locator) break;
        const percent = Math.min(1, Math.max(0, event.percent));
        setProgress(percent);
        setChapter(null);
        persistProgress(locator, percent, null);
        break;
      }
      case 'annotationAdded':
        void persistHighlight(event);
        break;
      case 'error':
        setError(`阅读器错误：${event.message}`);
        break;
    }
  };

  const saveBookmark = async () => {
    const fallbackLocator: StoredReaderLocator | null = latestProgress.current?.locator
      ?? (initialLocation ? { type: 'epub', cfi: initialLocation } : null);
    if (!fallbackLocator) {
      showNotice('还没有可保存的阅读位置');
      return;
    }
    try {
      await saveReaderAnnotation(bookId, {
        kind: 'bookmark',
        quote: chapter ?? title ?? '书签',
        format: 'EPUB',
        locator: fallbackLocator,
        chapter,
      });
      await refreshAnnotations();
      showNotice('已加入书签');
    } catch (cause) {
      setError(`书签保存失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  const saveNote = async () => {
    if (!selection || noteBody.trim().length === 0 || savingNote) return;
    setSavingNote(true);
    try {
      await saveReaderAnnotation(bookId, {
        kind: 'note',
        color: 'yellow',
        body: noteBody.trim(),
        quote: selection.quote,
        format: 'EPUB',
        locator: selection.locator,
        chapter,
      });
      setNoteOpen(false);
      setNoteBody('');
      setSelection(null);
      await refreshAnnotations();
      showNotice('笔记已保存');
    } catch (cause) {
      Alert.alert('保存失败', cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSavingNote(false);
    }
  };

  const removeAnnotation = async (annotation: ShelfAnnotation) => {
    try {
      await deleteReaderAnnotation(annotation.id);
      await refreshAnnotations();
      showNotice('已删除标注');
    } catch (cause) {
      Alert.alert('删除失败', cause instanceof Error ? cause.message : String(cause));
    }
  };

  const jumpTo = (annotation: ShelfAnnotation) => {
    if (!annotation.locator || !onJumpToLocator) return;
    setPanelOpen(false);
    onJumpToLocator(annotation.locator);
  };

  const askAboutSelection = () => {
    const locator = selection?.locator ?? latestProgress.current?.locator;
    router.push({
      pathname: '/book-chat',
      params: {
        bookId,
        ...(title ? { bookTitle: title } : {}),
        ...(selection ? { selectionQuote: selection.quote } : {}),
        ...(locator ? { locator: JSON.stringify(locator) } : {}),
      },
    });
  };

  const askAboutBook = () => {
    router.push({
      pathname: '/book-chat',
      params: {
        bookId,
        ...(title ? { bookTitle: title } : {}),
        ...(latestProgress.current?.locator ? { locator: JSON.stringify(latestProgress.current.locator) } : {}),
      },
    });
  };

  const seedAnnotations = (initialAnnotations ?? []).flatMap((annotation) => {
    const seed = toSeed(annotation, 'EPUB');
    return seed ? [seed] : [];
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回书架" onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹ 书架</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{title ?? '阅读'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="书签" onPress={() => void saveBookmark()} style={styles.iconButton}>
          <Text style={styles.iconText}>书签</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="标注" onPress={() => setPanelOpen(true)} style={styles.iconButton}>
          <Text style={styles.iconText}>标注{annotations.length > 0 ? ` ${annotations.length}` : ''}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="问书灯" onPress={askAboutBook} style={styles.askButton}>
          <Text style={styles.askText}>问书灯</Text>
        </Pressable>
      </View>

      {error ? (
        <Pressable accessibilityRole="button" onPress={() => setError(null)} style={styles.errorBanner}>
          <Text style={styles.errorText} numberOfLines={2}>{error}</Text>
        </Pressable>
      ) : null}

      <ReaderWebView
        bookId={bookId}
        initialLocation={initialLocation}
        openOverride={openOverride}
        initialAnnotations={seedAnnotations}
        onEvent={onReaderEvent}
      />

      {selection ? (
        <View style={styles.selectionBar}>
          <Text style={styles.selectionQuote} numberOfLines={2}>{selection.quote}</Text>
          <View style={styles.selectionActions}>
            <Pressable accessibilityRole="button" onPress={() => { setNoteOpen(true); setNoteBody(''); }} style={styles.selectionButton}>
              <Text style={styles.selectionButtonText}>写笔记</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={askAboutSelection} style={styles.selectionButton}>
              <Text style={styles.selectionButtonText}>问书灯</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setSelection(null)} style={styles.selectionCancel}>
              <Text style={styles.selectionCancelText}>取消</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.footer}>
        {notice ? <Text style={styles.notice} numberOfLines={1}>{notice}</Text> : <Text style={styles.footerText}>{chapter ? `章节：${chapter}` : '继续阅读'}</Text>}
        <Text style={styles.percent}>{Math.round(progress * 100)}%</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.max(1, Math.round(progress * 100))}%` }]} />
        </View>
      </View>

      <Modal visible={panelOpen} transparent animationType="slide" onRequestClose={() => setPanelOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>标注与书签</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="关闭标注" onPress={() => setPanelOpen(false)}>
                <Text style={styles.panelClose}>完成</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.panelScroll} contentContainerStyle={styles.panelContent}>
              {annotations.length === 0 ? (
                <Text style={styles.panelEmpty}>还没有标注。在正文中选字可以高亮、写笔记；点「书签」记录当前位置。</Text>
              ) : (
                annotations.slice().reverse().map((annotation) => (
                  <View key={annotation.id} style={styles.annotationRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`跳转到${KIND_LABEL[annotation.kind]}`}
                      onPress={() => jumpTo(annotation)}
                      style={styles.annotationMain}
                    >
                      <View style={styles.annotationMeta}>
                        <View style={[styles.colorDot, { backgroundColor: annotation.color ?? colors.lamp }]} />
                        <Text style={styles.annotationKind}>{KIND_LABEL[annotation.kind]}</Text>
                        {annotation.page !== null ? <Text style={styles.annotationPage}>第 {annotation.page} 页</Text> : null}
                      </View>
                      <Text style={styles.annotationQuote} numberOfLines={2}>{annotation.quote || '（位置）'}</Text>
                      {annotation.body ? <Text style={styles.annotationBody}>{annotation.body}</Text> : null}
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="删除标注" onPress={() => void removeAnnotation(annotation)} style={styles.annotationDelete}>
                      <Text style={styles.annotationDeleteText}>删除</Text>
                    </Pressable>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={noteOpen} transparent animationType="slide" onRequestClose={() => setNoteOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.noteSheet}>
            <View style={styles.panelHeader}>
              <Pressable accessibilityRole="button" onPress={() => setNoteOpen(false)}>
                <Text style={styles.panelClose}>关闭</Text>
              </Pressable>
              <Text style={styles.panelTitle}>写笔记</Text>
              <Pressable accessibilityRole="button" disabled={noteBody.trim().length === 0 || savingNote} onPress={() => void saveNote()}>
                <Text style={[styles.panelDone, (noteBody.trim().length === 0 || savingNote) && styles.panelDoneDisabled]}>{savingNote ? '保存中…' : '保存'}</Text>
              </Pressable>
            </View>
            <Text style={styles.noteQuote} numberOfLines={3}>{selection?.quote ?? ''}</Text>
            <TextInput
              accessibilityLabel="笔记内容"
              value={noteBody}
              onChangeText={setNoteBody}
              placeholder="写下你的想法…"
              placeholderTextColor={colors.ink3}
              multiline
              autoFocus
              style={styles.noteInput}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    backgroundColor: colors.paper,
    gap: 6,
  },
  backButton: { paddingVertical: 6 },
  backText: { fontSize: 14, color: colors.lamp },
  title: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.ink },
  iconButton: { paddingVertical: 7, paddingHorizontal: 5 },
  iconText: { fontSize: 12, color: colors.ink2 },
  askButton: { borderRadius: radius.field, backgroundColor: colors.lampWash, paddingHorizontal: spacing.sm, paddingVertical: 7 },
  askText: { fontSize: 12, fontWeight: '600', color: colors.ink },
  errorBanner: { backgroundColor: '#F6E3DF', paddingHorizontal: spacing.sm, paddingVertical: 7 },
  errorText: { fontSize: 12, color: '#7A2F24' },
  selectionBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    gap: 6,
  },
  selectionQuote: { fontSize: 12, lineHeight: 17, color: colors.ink2 },
  selectionActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  selectionButton: { borderRadius: radius.field, backgroundColor: colors.lampWash, paddingHorizontal: spacing.sm, paddingVertical: 7 },
  selectionButtonText: { fontSize: 12, fontWeight: '600', color: colors.ink },
  selectionCancel: { paddingHorizontal: spacing.sm, paddingVertical: 7 },
  selectionCancelText: { fontSize: 12, color: colors.ink3 },
  footer: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.paper,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  footerText: { flex: 1, fontSize: 12, color: colors.ink3 },
  notice: { flex: 1, fontSize: 12, color: colors.lamp },
  percent: { fontSize: 12, color: colors.ink2 },
  progressTrack: { width: '100%', height: 3, borderRadius: 2, backgroundColor: colors.paperDeep, overflow: 'hidden' },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: colors.lamp },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.28)', justifyContent: 'flex-end' },
  panel: { maxHeight: '72%', backgroundColor: colors.paper, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  panelTitle: { fontSize: 16, fontWeight: '600', color: colors.ink },
  panelClose: { fontSize: 14, color: colors.lamp },
  panelDone: { fontSize: 14, fontWeight: '600', color: colors.lamp },
  panelDoneDisabled: { color: colors.ink3 },
  panelScroll: { flexGrow: 0 },
  panelContent: { padding: spacing.md, gap: spacing.sm },
  panelEmpty: { fontSize: 13, lineHeight: 20, color: colors.ink3, paddingVertical: spacing.lg },
  annotationRow: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.field, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: spacing.sm },
  annotationMain: { flex: 1 },
  annotationMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  colorDot: { width: 8, height: 8, borderRadius: 4 },
  annotationKind: { fontSize: 11, fontWeight: '600', color: colors.ink2 },
  annotationPage: { fontSize: 11, color: colors.ink3 },
  annotationQuote: { marginTop: 5, fontSize: 13, lineHeight: 19, color: colors.ink },
  annotationBody: { marginTop: 4, fontSize: 12, lineHeight: 18, color: colors.ink2 },
  annotationDelete: { paddingHorizontal: 8, paddingVertical: 6 },
  annotationDeleteText: { fontSize: 12, color: '#A63A2B' },
  noteSheet: { backgroundColor: colors.paper, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, paddingBottom: 24 },
  noteQuote: { marginHorizontal: spacing.md, marginTop: spacing.sm, fontSize: 12, lineHeight: 18, color: colors.ink3, backgroundColor: colors.paperDeep, borderRadius: radius.field, padding: spacing.sm },
  noteInput: { margin: spacing.md, minHeight: 110, borderRadius: radius.field, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: spacing.sm, fontSize: 14, color: colors.ink, textAlignVertical: 'top' },
});
