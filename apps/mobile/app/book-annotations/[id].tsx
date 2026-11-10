import { useLocalSearchParams } from "expo-router";
import { BookAnnotationsScreen } from "../../src/ui/BookAnnotationsScreen";

export default function BookAnnotationsRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const bookId = (Array.isArray(params.id) ? params.id[0] : params.id) ?? "";
  return <BookAnnotationsScreen key={bookId} bookId={bookId} />;
}
