import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Pdf from 'react-native-pdf';
import { File, Paths } from 'expo-file-system';
import { colors, spacing } from '../src/ui/theme';

/** 原生 PDFKit 大 PDF 验证页：不经过 WebView/pdf.js。 */
export default function PdfKitReaderRoute() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [pageInfo, setPageInfo] = useState('准备加载 PDFKit');
  const [error, setError] = useState<string | null>(null);
  const file = useMemo(() => new File(Paths.document, 'large.pdf'), []);
  const source = useMemo(() => ({ uri: file.uri, cache: true }), [file]);

  if (!file.exists) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.toolbar}><Pressable onPress={() => router.back()}><Text style={styles.back}>‹ 书架</Text></Pressable><Text style={styles.title}>原生 PDFKit</Text></View>
        <Text style={styles.message}>App Documents/large.pdf 不存在</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}><Text style={styles.back}>‹ 书架</Text></Pressable>
        <Text style={styles.title}>大 PDF · 原生 PDFKit</Text>
        <Text style={styles.meta}>{pageInfo}</Text>
      </View>
      {loading ? <View style={styles.loading}><ActivityIndicator color={colors.lamp} /><Text style={styles.message}>{pageInfo}</Text></View> : null}
      {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}
      <Pdf
        source={source}
        style={styles.pdf}
        onLoadComplete={(numberOfPages) => { setLoading(false); setPageInfo(`共 ${numberOfPages} 页`); }}
        onPageChanged={(page, total) => setPageInfo(`第 ${page} / ${total} 页`)}
        onError={(err) => { setLoading(false); setError(String(err)); }}
        enableAntialiasing
        enablePaging={false}
        spacing={8}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  toolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, gap: spacing.xs },
  backButton: { paddingVertical: 6, paddingRight: spacing.sm },
  back: { fontSize: 15, color: colors.lamp },
  title: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.ink },
  meta: { fontSize: 11, color: colors.ink3 },
  pdf: { flex: 1, width: '100%', backgroundColor: colors.paperDeep },
  loading: { position: 'absolute', top: 70, left: 0, right: 0, zIndex: 2, alignItems: 'center', gap: 8 },
  message: { fontSize: 13, color: colors.ink3, textAlign: 'center', marginTop: 12 },
  error: { position: 'absolute', bottom: 20, left: 12, right: 12, zIndex: 3, backgroundColor: '#f6e3df', borderRadius: 10, padding: 10 },
  errorText: { fontSize: 12, color: '#7a2f24' },
});
