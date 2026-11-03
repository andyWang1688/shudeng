import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Pdf, { type PdfRef } from 'react-native-pdf';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../ui/theme';
import { ReaderChrome } from './ReaderChrome';

type Props = {
  readonly bookId: string;
  readonly title: string;
  readonly fileUri: string;
  readonly initialPage?: number;
  readonly referenceMode?: boolean;
  readonly annotationCount?: number;
  readonly onBack?: () => void;
  readonly onBookmark?: () => void;
  readonly onAnnotations?: () => void;
  readonly onMore?: () => void;
  readonly onAsk?: () => void;
  readonly onLoadComplete?: (totalPages: number) => void;
  readonly onPageChanged?: (page: number, total: number) => void;
};

/** 迁移后的真实 PDF：原生 PDFKit，覆盖式 chrome 与 EPUB 同一套观感。 */
export function ImportedPdfReader({
  bookId,
  title,
  fileUri,
  initialPage,
  referenceMode = false,
  annotationCount = 0,
  onBack,
  onAnnotations,
  onMore,
  onAsk,
  onLoadComplete,
  onPageChanged,
}: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const pdfRef = useRef<PdfRef>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(initialPage && initialPage > 0 ? initialPage : 1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [retryKey, setRetryKey] = useState(0);

  const progressText = totalPages > 0 ? `${Math.round((page / totalPages) * 100)}%` : '0%';
  const pageText = totalPages > 0 ? `第 ${page} / ${totalPages} 页` : '准备加载 PDF';

  return (
    <View style={styles.screen}>
      <Pdf
        ref={pdfRef}
        source={{ uri: fileUri, cache: true }}
        style={styles.pdf}
        onLoadComplete={(pages) => {
          setLoading(false);
          setTotalPages(pages);
          onLoadComplete?.(pages);
          if (initialPage && initialPage > 1 && initialPage <= pages) {
            pdfRef.current?.setPage(initialPage);
            setPage(initialPage);
          }
        }}
        onPageChanged={(nextPage, total) => {
          setPage(nextPage);
          setTotalPages(total);
          onPageChanged?.(nextPage, total);
        }}
        onPageSingleTap={() => setChromeVisible((value) => !value)}
        onError={(err) => { setLoading(false); setError(String(err)); }}
        enablePaging={false}
        enableAntialiasing
        spacing={8}
        key={`${bookId}-${fileUri}-${retryKey}`}
      />

      <ReaderChrome
        title={title}
        chapter={pageText}
        progressText={progressText}
        referenceMode={referenceMode}
        visible={chromeVisible}
        annotationCount={annotationCount}
        onBack={onBack ?? (() => router.back())}
        {...(onAnnotations ? { onAnnotations } : {})}
        {...(onMore ? { onMore } : {})}
        onAsk={onAsk ?? (() => router.back())}
      />

      {loading ? (
        <View style={[styles.loading, { top: insets.top + 60 }]}>
          <ActivityIndicator color={colors.lamp} />
          <Text style={styles.message}>{pageText}</Text>
        </View>
      ) : null}
      {error ? (
        <View style={[styles.errorOverlay, { top: insets.top + 80 }]}>
          <Text style={styles.errorTitle}>PDF 打开失败</Text>
          <Text style={styles.errorDetail} numberOfLines={3}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => { setError(null); setLoading(true); setRetryKey((value) => value + 1); }} style={styles.retryButton}>
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  pdf: { flex: 1, width: '100%', backgroundColor: colors.paper },
  loading: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 8, zIndex: 25 },
  message: { fontSize: 13, color: colors.ink3 },
  errorOverlay: { position: 'absolute', left: spacing.lg, right: spacing.lg, zIndex: 30, alignItems: 'center', gap: 10, borderRadius: 16, backgroundColor: colors.paper, padding: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  errorTitle: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  errorDetail: { color: colors.ink3, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  retryButton: { borderRadius: 12, backgroundColor: colors.lampWash, paddingHorizontal: spacing.lg, paddingVertical: 8 },
  retryText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
});
