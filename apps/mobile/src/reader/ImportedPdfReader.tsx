import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Pdf, { type PdfRef } from 'react-native-pdf';
import { colors, spacing } from '../ui/theme';

type Props = {
  readonly bookId: string;
  readonly title: string;
  readonly fileUri: string;
  readonly initialPage?: number;
  readonly onLoadComplete?: (totalPages: number) => void;
  readonly onPageChanged?: (page: number, total: number) => void;
};

/** 迁移后的真实 PDF：原生 PDFKit，不经过 WebView。 */
export function ImportedPdfReader({ bookId, title, fileUri, initialPage, onLoadComplete, onPageChanged }: Props) {
  const router = useRouter();
  const pdfRef = useRef<PdfRef>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [pageInfo, setPageInfo] = useState('准备加载 PDF');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回书架" onPress={() => router.back()} style={styles.backButton}><Text style={styles.back}>‹ 书架</Text></Pressable>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <Text style={styles.meta}>{pageInfo}</Text>
      </View>
      {loading ? <View style={styles.loading}><ActivityIndicator color={colors.lamp} /><Text style={styles.message}>{pageInfo}</Text></View> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pdf
        ref={pdfRef}
        source={{ uri: fileUri, cache: true }}
        style={styles.pdf}
        onLoadComplete={(pages) => {
          setLoading(false);
          setTotalPages(pages);
          setPageInfo(`共 ${pages} 页`);
          onLoadComplete?.(pages);
          if (initialPage && initialPage > 1 && initialPage <= pages) {
            pdfRef.current?.setPage(initialPage);
            setPageInfo(`第 ${initialPage} / ${pages} 页`);
          }
        }}
        onPageChanged={(page, total) => {
          setPageInfo(`第 ${page} / ${total} 页`);
          onPageChanged?.(page, total);
        }}
        onError={(err) => { setLoading(false); setError(String(err)); }}
        enablePaging={false}
        enableAntialiasing
        spacing={8}
        key={`${bookId}-${fileUri}`}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  backButton: { paddingVertical: 6, paddingRight: spacing.sm },
  back: { fontSize: 15, color: colors.lamp },
  title: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.ink },
  meta: { fontSize: 11, color: colors.ink3 },
  pdf: { flex: 1, width: '100%', backgroundColor: colors.paperDeep },
  loading: { position: 'absolute', top: 70, left: 0, right: 0, alignItems: 'center', gap: 8, zIndex: 2 },
  message: { fontSize: 13, color: colors.ink3 },
  error: { position: 'absolute', bottom: 16, left: 12, right: 12, zIndex: 3, color: '#7a2f24', backgroundColor: '#f6e3df', borderRadius: 8, padding: 8, fontSize: 12 },
});
