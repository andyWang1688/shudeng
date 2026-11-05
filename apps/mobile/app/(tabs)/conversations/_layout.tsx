import { Stack } from 'expo-router';
import { usePalette } from '../../../src/ui/theme';

export default function ConversationsLayout() {
  const palette = usePalette();
  return <Stack screenOptions={{
    title: '对话', headerShown: true, headerLargeTitleEnabled: true,
    headerLargeTitleShadowVisible: false, headerShadowVisible: false, headerTintColor: palette.lamp,
    headerStyle: { backgroundColor: palette.paper }, headerLargeStyle: { backgroundColor: 'transparent' },
    headerLargeTitleStyle: { fontFamily: 'SongtiSC-Bold', fontSize: 30, fontWeight: '600', color: palette.ink },
    headerTitleStyle: { fontFamily: 'SongtiSC-Bold', fontSize: 17, fontWeight: '600', color: palette.ink },
    contentStyle: { backgroundColor: palette.paper },
  }} />;
}
