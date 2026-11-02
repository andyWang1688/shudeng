import { useLocalSearchParams } from 'expo-router';
import { ReaderShell } from '../../src/ui/ReaderShell';

export default function ReaderRoute() {
  const params = useLocalSearchParams<{ id?: string | string[]; locator?: string | string[] }>();
  const raw = params.id;
  const bookId = Array.isArray(raw) ? (raw[0] ?? 'epub-demo') : (raw ?? 'epub-demo');
  const rawLocator = params.locator;
  const initialLocation = Array.isArray(rawLocator) ? rawLocator[0] : rawLocator;
  return <ReaderShell bookId={bookId} initialLocation={initialLocation} />;
}
