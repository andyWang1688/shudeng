import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import type { BookRow } from '@shudeng/core/db';
import { ReaderShell } from '../../src/ui/ReaderShell';
import { ImportedPdfReader } from '../../src/reader/ImportedPdfReader';
import { getDataLayer } from '../../src/platform/db';
import { findBookFile, readBookBase64 } from '../../src/platform/bookFiles';
import {
  deleteReaderAnnotation,
  loadBookAnnotations,
  loadBookProgress,
  saveBookProgress,
  saveReaderAnnotation,
  type BookProgress,
  type ShelfAnnotation,
  type StoredReaderLocator,
} from '../../src/platform/library';
import { radius, spacing, usePalette, type Palette } from '../../src/ui/theme';

const KIND_LABEL: Record<ShelfAnnotation['kind'], string> = {
  highlight: '高亮',
  note: '笔记',
  bookmark: '书签',
};

function parseReaderLocator(raw: string | string[] | undefined): StoredReaderLocator | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      if (record.type === 'pdf' && typeof record.page === 'number') {
        const rects = Array.isArray(record.rects)
          ? record.rects.filter((rect): rect is Record<string, unknown> => typeof rect === 'object' && rect !== null).map((rect) => ({
              x: Number(rect.x) || 0,
              y: Number(rect.y) || 0,
              width: Number(rect.width) || 0,
              height: Number(rect.height) || 0,
            }))
          : undefined;
        return { type: 'pdf', page: record.page, ...(rects ? { rects } : {}) };
      }
      if (record.type === 'epub' && typeof record.cfi === 'string') {
        return {
          type: 'epub',
          cfi: record.cfi,
          ...(typeof record.href === 'string' ? { href: record.href } : {}),
          ...(typeof record.chapter === 'string' ? { chapter: record.chapter } : {}),
        };
      }
    }
  } catch {
    // 旧调用方可能直接传 CFI 字符串。
  }
  return { type: 'epub', cfi: value };
}

export default function ReaderRoute() {
  const params = useLocalSearchParams<{ id?: string | string[]; locator?: string | string[] }>();
  const router = useRouter();
  const navigation = useNavigation();
  const palette = usePalette();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const rawId = params.id;
  const bookId = Array.isArray(rawId) ? (rawId[0] ?? '') : (rawId ?? '');
  const [book, setBook] = useState<BookRow | null>(null);
  const [epubBase64, setEpubBase64] = useState<string | null>(null);
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [progress, setProgress] = useState<BookProgress | null>(null);
  const [annotations, setAnnotations] = useState<readonly ShelfAnnotation[]>([]);
  const [jump, setJump] = useState<StoredReaderLocator | null>(() => parseReaderLocator(params.locator));
  const [jumpVersion, setJumpVersion] = useState(0);
  const [checked, setChecked] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pdfPanelOpen, setPdfPanelOpen] = useState(false);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfTotal, setPdfTotal] = useState(0);
  const [pdfNotice, setPdfNotice] = useState<string | null>(null);
  const previousRouteName = (() => {
    try {
      const state = navigation.getState() as { index?: number; routes?: Array<{ name?: string }> } | undefined;
      const index = state?.index ?? 0;
      return state?.routes?.[index - 1]?.name;
    } catch {
      return undefined;
    }
  })();
  const referenceMode = previousRouteName === 'book-chat';
  const pdfLatestPage = useRef(1);
  const pdfTotalRef = useRef(0);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshAnnotations = useCallback(async () => {
    try {
      setAnnotations(await loadBookAnnotations(bookId));
    } catch {
      // 标注读取失败不阻塞打开书。
    }
  }, [bookId]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        if (!bookId) {
          setFailure('缺少书籍标识');
          return;
        }
        const layer = await getDataLayer();
        const row = await layer.store.getBook(bookId);
        if (!mounted) return;
        if (!row) {
          setFailure('这本书不在书架上，可能已被删除');
          return;
        }
        setBook(row);
        const file = findBookFile(row);
        if (!file) {
          setFailure('书籍文件缺失，请重新导入');
          return;
        }
        setFileUri(file.uri);
        if (row.format === 'epub') setEpubBase64(await readBookBase64(row));
        const [savedProgress, loadedAnnotations] = await Promise.all([
          loadBookProgress(bookId),
          loadBookAnnotations(bookId),
        ]);
        if (!mounted) return;
        setProgress(savedProgress);
        setAnnotations(loadedAnnotations);
      } catch (cause) {
        if (mounted) setFailure(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (mounted) setChecked(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [bookId]);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  const showPdfNotice = (message: string) => {
    setPdfNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setPdfNotice(null), 2200);
  };

  const jumpToLocator = (locator: StoredReaderLocator) => {
    setJump(locator);
    setJumpVersion((value) => value + 1);
    if (book?.format === 'pdf' && locator.type === 'pdf') {
      pdfLatestPage.current = locator.page;
      setPdfPage(locator.page);
    }
  };

  const savePdfPage = (page: number, total: number) => {
    pdfLatestPage.current = page;
    pdfTotalRef.current = total;
    setPdfPage(page);
    setPdfTotal(total);
    const percent = total > 0 ? Math.min(1, Math.max(0, page / total)) : 0;
    void saveBookProgress(bookId, { locator: { type: 'pdf', page }, percent });
  };

  const bookmarkPdf = async () => {
    const page = pdfLatestPage.current;
    if (!page) return;
    try {
      await saveReaderAnnotation(bookId, {
        kind: 'bookmark',
        quote: pdfTotalRef.current > 0 ? `第 ${page} / ${pdfTotalRef.current} 页` : `第 ${page} 页`,
        format: 'PDF',
        locator: { type: 'pdf', page },
        page,
      });
      await refreshAnnotations();
      showPdfNotice('已加入书签');
    } catch (cause) {
      Alert.alert('书签保存失败', cause instanceof Error ? cause.message : String(cause));
    }
  };

  const askPdfBook = (selectionQuote?: string) => {
    router.push({
      pathname: '/book-chat',
      params: {
        bookId,
        theme: scheme,
        ...(book ? { bookTitle: book.title } : {}),
        ...(selectionQuote ? { selectionQuote } : {}),
        locator: JSON.stringify({ type: 'pdf', page: pdfLatestPage.current }),
      },
    });
  };

  const removePdfAnnotation = async (annotation: ShelfAnnotation) => {
    try {
      await deleteReaderAnnotation(annotation.id);
      await refreshAnnotations();
      showPdfNotice('已删除标注');
    } catch (cause) {
      Alert.alert('删除失败', cause instanceof Error ? cause.message : String(cause));
    }
  };

  if (!checked) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={palette.lamp} />
        <Text style={styles.hint}>打开书籍…</Text>
      </View>
    );
  }

  if (failure || !book || !fileUri) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.errorToolbar}>
          <Pressable accessibilityRole="button" onPress={() => router.back()}><Text style={styles.back}>‹ 书架</Text></Pressable>
          <Text style={styles.errorTitle}>无法打开书籍</Text>
        </View>
        <View style={styles.center}>
          <Text style={styles.errorDetail}>{failure ?? '书籍文件不可用'}</Text>
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.errorButton}>
            <Text style={styles.errorButtonText}>返回书架</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (book.format === 'pdf') {
    const showPdfMoreMenu = () => {
      Alert.alert('阅读选项', undefined, [
        { text: '添加书签', onPress: () => void bookmarkPdf() },
        { text: '标注', onPress: () => setPdfPanelOpen(true) },
        { text: '取消', style: 'cancel' },
      ]);
    };
    const initialPage = jump?.type === 'pdf' ? jump.page : progress?.locator.type === 'pdf' ? progress.locator.page : undefined;
    const pdfAnnotations = annotations.filter((annotation) => annotation.kind === 'bookmark' || annotation.kind === 'note');
    return (
      <View style={styles.pdfContainer}>
        <ImportedPdfReader
          key={`${bookId}-pdf-${jumpVersion}-${initialPage ?? 1}`}
          bookId={bookId}
          title={book.title}
          fileUri={fileUri}
          referenceMode={referenceMode}
          annotationCount={pdfAnnotations.length}
          {...(initialPage ? { initialPage } : {})}
          onLoadComplete={(total) => {
            pdfTotalRef.current = total;
            setPdfTotal(total);
          }}
          onPageChanged={(page, total) => savePdfPage(page, total)}
          onBack={() => router.back()}
          onBookmark={() => void bookmarkPdf()}
          onAnnotations={() => setPdfPanelOpen(true)}
          onMore={showPdfMoreMenu}
          onAsk={() => askPdfBook()}
        />
        {pdfNotice ? <Text style={[styles.pdfToast, { top: 70 }]}>{pdfNotice}</Text> : null}
        <Modal visible={pdfPanelOpen} transparent animationType="slide" onRequestClose={() => setPdfPanelOpen(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.panel}>
              <View style={styles.panelHeader}>
                <Text style={styles.panelTitle}>PDF 标注</Text>
                <Pressable accessibilityRole="button" onPress={() => setPdfPanelOpen(false)}><Text style={styles.panelClose}>完成</Text></Pressable>
              </View>
              <ScrollView style={styles.panelScroll} contentContainerStyle={styles.panelContent}>
                {pdfAnnotations.length === 0 ? (
                  <Text style={styles.panelEmpty}>还没有书签。点「书签」记录当前页；PDF 选字高亮暂不支持。</Text>
                ) : (
                  pdfAnnotations.slice().reverse().map((annotation) => (
                    <View key={annotation.id} style={styles.annotationRow}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          if (annotation.locator?.type === 'pdf') {
                            setPdfPanelOpen(false);
                            jumpToLocator(annotation.locator);
                          }
                        }}
                        style={styles.annotationMain}
                      >
                        <Text style={styles.annotationKind}>{KIND_LABEL[annotation.kind]}{annotation.page !== null ? ` · 第 ${annotation.page} 页` : ''}</Text>
                        <Text style={styles.annotationQuote} numberOfLines={2}>{annotation.quote || annotation.body || '（位置）'}</Text>
                        {annotation.body ? <Text style={styles.annotationBody}>{annotation.body}</Text> : null}
                      </Pressable>
                      <Pressable accessibilityRole="button" onPress={() => void removePdfAnnotation(annotation)} style={styles.annotationDelete}>
                        <Text style={styles.annotationDeleteText}>删除</Text>
                      </Pressable>
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  const savedLocation = progress?.locator.type === 'epub' ? progress.locator.cfi : undefineProgressLocation(progress);
  const jumpLocation = jump?.type === 'epub' ? jump.cfi : null;
  const initialLocation = jumpLocation ?? savedLocation ?? undefined;

  return (
    <ReaderShell
      key={`${bookId}-epub-${jumpVersion}`}
      bookId={bookId}
      initialLocation={initialLocation}
      title={book.title}
      openOverride={{ format: 'epub', title: book.title, dataBase64: epubBase64 ?? '', mimeType: 'application/epub+zip' }}
      initialAnnotations={annotations}
      referenceMode={referenceMode}
      onJumpToLocator={jumpToLocator}
      onAnnotationsChanged={setAnnotations}
    />
  );
}

function undefineProgressLocation(progress: BookProgress | null): string | null {
  if (progress?.locator.type !== 'epub') return null;
  return progress.locator.cfi.length > 0 ? progress.locator.cfi : null;
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: palette.paper, padding: spacing.lg },
  hint: { fontSize: 13, color: palette.ink3 },
  safeArea: { flex: 1, backgroundColor: palette.paper },
  errorToolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  back: { fontSize: 15, color: palette.lamp },
  errorTitle: { fontSize: 16, fontWeight: '600', color: palette.ink },
  errorDetail: { fontSize: 13, lineHeight: 20, color: palette.ink2, textAlign: 'center' },
  errorButton: { marginTop: spacing.sm, borderRadius: radius.field, backgroundColor: palette.paperDeep, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  errorButtonText: { fontSize: 13, fontWeight: '600', color: palette.ink },
  pdfContainer: { flex: 1, backgroundColor: palette.paper },
  pdfActions: { position: 'absolute', right: spacing.sm, bottom: 28, flexDirection: 'row', gap: 6 },
  pdfActionButton: { borderRadius: 18, backgroundColor: 'rgba(255,253,248,0.94)', borderWidth: StyleSheet.hairlineWidth, borderColor: palette.line, paddingHorizontal: 12, paddingVertical: 8 },
  pdfActionText: { fontSize: 12, fontWeight: '600', color: palette.ink },
  pdfAskButton: { backgroundColor: palette.lamp },
  pdfAskText: { fontSize: 12, fontWeight: '600', color: palette.ink },
  pdfToast: { position: 'absolute', alignSelf: 'center', top: 86, borderRadius: 12, backgroundColor: 'rgba(36,33,28,0.82)', color: '#FFFDF8', fontSize: 12, paddingHorizontal: 12, paddingVertical: 6, overflow: 'hidden', zIndex: 20 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.28)', justifyContent: 'flex-end' },
  panel: { maxHeight: '72%', backgroundColor: palette.paper, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  panelTitle: { fontSize: 16, fontWeight: '600', color: palette.ink },
  panelClose: { fontSize: 14, color: palette.lamp },
  panelScroll: { flexGrow: 0 },
  panelContent: { padding: spacing.md, gap: spacing.sm },
  panelEmpty: { fontSize: 13, lineHeight: 20, color: palette.ink3, paddingVertical: spacing.lg },
  annotationRow: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.field, backgroundColor: palette.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.line, padding: spacing.sm },
  annotationMain: { flex: 1 },
  annotationKind: { fontSize: 11, fontWeight: '600', color: palette.ink2 },
  annotationQuote: { marginTop: 4, fontSize: 13, lineHeight: 19, color: palette.ink },
  annotationBody: { marginTop: 3, fontSize: 12, lineHeight: 18, color: palette.ink2 },
  annotationDelete: { paddingHorizontal: 8, paddingVertical: 6 },
  annotationDeleteText: { fontSize: 12, color: palette.danger },
  });
}
