import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { useRouter } from 'expo-router';
import Pdf, { type PdfRef } from 'react-native-pdf';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, usePalette, type Palette } from '../ui/theme';
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
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const isDark = useColorScheme() === 'dark';
  const insets = useSafeAreaInsets();
  const pdfRef = useRef<PdfRef>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(initialPage && initialPage > 0 ? initialPage : 1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [retryKey, setRetryKey] = useState(0);

  const progressText = totalPages > 0 ? `${Math.floor((page / totalPages) * 100)}%` : '0%';
  const pageText = totalPages > 0 ? `第 ${page} / ${totalPages} 页` : '准备加载 PDF';

  return (
    <View style={styles.screen}>
      <View style={styles.pdfStage}>
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
      {/*
        react-native-pdf 在 iOS 由原生 PDFKit 渲染；RN 0.88 iOS Fabric 的 filter 实现不支持 invert。
        iOS 用白色 difference 图层反色（白底→黑底、黑字→白字）；Android 用标准 filter invert。
      */}
      {isDark ? (
        <View
          pointerEvents="none"
          style={[
            styles.pdfInvertOverlay,
            Platform.OS === 'ios' ? { backgroundColor: '#FFFFFF', mixBlendMode: 'difference' } : { filter: [{ invert: 1 }] },
          ]}
        />
      ) : null}
      </View>

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
          <ActivityIndicator color={palette.lamp} />
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

function makeStyles(palette: Palette) {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.paper },
  pdfStage: { flex: 1 },
  pdf: { flex: 1, width: '100%', backgroundColor: palette.paper },
  pdfInvertOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  loading: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 8, zIndex: 25 },
  message: { fontSize: 13, color: palette.ink3 },
  errorOverlay: { position: 'absolute', left: spacing.lg, right: spacing.lg, zIndex: 30, alignItems: 'center', gap: 10, borderRadius: 16, backgroundColor: palette.paper, padding: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.line },
  errorTitle: { color: palette.ink, fontSize: 15, fontWeight: '600' },
  errorDetail: { color: palette.ink3, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  retryButton: { borderRadius: 12, backgroundColor: palette.lampWash, paddingHorizontal: spacing.lg, paddingVertical: 8 },
  retryText: { color: palette.ink, fontSize: 13, fontWeight: '600' },
  });
}
