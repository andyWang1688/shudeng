import type { ComponentProps } from 'react';
import type { Stack } from 'expo-router';
import type { Palette } from '../theme';

type ScreenOptions = NonNullable<ComponentProps<typeof Stack.Screen>['options']>;

/** Shared native list chrome; each route retains its title, toolbar and anchor. */
export function nativeListNavigationOptions(palette: Pick<Palette, 'lamp' | 'paper' | 'ink'>) {
  return {
    headerShown: true,
    headerLargeTitleEnabled: true,
    headerLargeTitleShadowVisible: false,
    headerShadowVisible: false,
    headerTintColor: palette.lamp,
    headerStyle: { backgroundColor: palette.paper },
    // A transparent scroll edge keeps search dismissal from covering the large title.
    headerLargeStyle: { backgroundColor: 'transparent' },
    headerLargeTitleStyle: { fontFamily: 'SongtiSC-Bold', fontSize: 30, fontWeight: '600', color: palette.ink },
    headerTitleStyle: { fontFamily: 'SongtiSC-Bold', fontSize: 17, fontWeight: '600', color: palette.ink },
    contentStyle: { backgroundColor: palette.paper },
  } satisfies ScreenOptions;
}
