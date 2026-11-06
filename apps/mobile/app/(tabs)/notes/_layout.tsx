import { Stack } from 'expo-router';
import { usePalette } from '../../../src/ui/theme';
import { nativeListNavigationOptions } from '../../../src/ui/navigation/nativeListNavigationOptions';

export default function NotesLayout() {
  const palette = usePalette();
  return (
    <Stack screenOptions={{
      title: '笔记',
      ...nativeListNavigationOptions(palette),
    }} />
  );
}
