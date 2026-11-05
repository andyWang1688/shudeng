import { Stack } from 'expo-router';
import { usePalette } from '../../../src/ui/theme';

export default function NotesLayout() {
  const palette = usePalette();
  return (
    <Stack screenOptions={{
      title: '笔记',
      headerShown: true,
      headerLargeTitleEnabled: true,
      headerLargeTitleShadowVisible: false,
      headerShadowVisible: false,
      headerTintColor: palette.lamp,
      headerStyle: { backgroundColor: palette.paper },
      // Match BookDesign.applyListPageNavigationAppearance: a transparent scroll
      // edge keeps iOS 26 search dismissal from covering the large title.
      headerLargeStyle: { backgroundColor: 'transparent' },
      headerLargeTitleStyle: { fontFamily: 'SongtiSC-Bold', fontSize: 30, fontWeight: '600', color: palette.ink },
      headerTitleStyle: { fontFamily: 'SongtiSC-Bold', fontSize: 17, fontWeight: '600', color: palette.ink },
      contentStyle: { backgroundColor: palette.paper },
    }} />
  );
}
