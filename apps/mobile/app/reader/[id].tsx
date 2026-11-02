import { useLocalSearchParams } from 'expo-router';
import { ReaderShell } from '../../src/ui/ReaderShell';

export default function ReaderRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const raw = params.id;
  const bookId = Array.isArray(raw) ? (raw[0] ?? 'epub-demo') : (raw ?? 'epub-demo');
  return <ReaderShell bookId={bookId} />;
}
