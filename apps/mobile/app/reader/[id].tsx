import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { BookRow } from '@shudeng/core/db';
import { ReaderShell } from '../../src/ui/ReaderShell';
import { ImportedPdfReader } from '../../src/reader/ImportedPdfReader';
import { getDataLayer } from '../../src/platform/db';
import { findBookFile, readBookBase64 } from '../../src/platform/bookFiles';
import { colors } from '../../src/ui/theme';

export default function ReaderRoute() {
  const params = useLocalSearchParams<{ id?: string | string[]; locator?: string | string[] }>();
  const raw = params.id;
  const bookId = Array.isArray(raw) ? (raw[0] ?? 'epub-demo') : (raw ?? 'epub-demo');
  const rawLocator = params.locator;
  const initialLocation = Array.isArray(rawLocator) ? rawLocator[0] : rawLocator;
  const [book, setBook] = useState<BookRow | null>(null);
  const [epubBase64, setEpubBase64] = useState<string | null>(null);
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const layer = await getDataLayer();
        const row = await layer.store.getBook(bookId);
        if (!mounted) return;
        setBook(row);
        if (row) {
          const file = findBookFile(row);
          if (file) {
            setFileUri(file.uri);
            if (row.format === 'epub') setEpubBase64(await readBookBase64(row));
          }
        }
      } finally {
        if (mounted) setChecked(true);
      }
    })();
    return () => { mounted = false; };
  }, [bookId]);

  if (!checked) {
    return <View style={styles.center}><ActivityIndicator color={colors.lamp} /><Text style={styles.hint}>打开书籍…</Text></View>;
  }
  if (book && fileUri && book.format === 'pdf') {
    return <ImportedPdfReader bookId={bookId} title={book.title} fileUri={fileUri} />;
  }
  if (book && fileUri && book.format === 'epub' && epubBase64) {
    return (
      <ReaderShell
        bookId={bookId}
        initialLocation={initialLocation}
        title={book.title}
        openOverride={{ format: 'epub', title: book.title, dataBase64: epubBase64, mimeType: 'application/epub+zip' }}
      />
    );
  }
  return <ReaderShell bookId={bookId} initialLocation={initialLocation} openOverride={undefined} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.paper },
  hint: { fontSize: 13, color: colors.ink3 },
});
