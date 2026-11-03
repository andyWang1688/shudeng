import '../src/shims/installGlobals';
import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { darkColors, lightColors } from '../src/ui/theme';

export default function RootLayout() {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? darkColors : lightColors;
  const contentStyle = useMemo(() => ({ backgroundColor: palette.paper }), [palette]);
  return (
    <SafeAreaProvider>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle }} />
    </SafeAreaProvider>
  );
}
