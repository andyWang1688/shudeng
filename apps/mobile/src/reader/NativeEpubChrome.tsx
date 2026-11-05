import { requireNativeView, requireOptionalNativeModule } from 'expo';
import { Platform, type ViewProps } from 'react-native';

export type EpubChromeAction = 'back' | 'contents' | 'settings' | 'ask' | 'bookmark' | 'toggleChrome';

type Props = ViewProps & {
  readonly title: string;
  readonly chapter: string;
  readonly progress: string;
  readonly referenceMode: boolean;
  readonly bookmarked: boolean;
  readonly chromeVisible: boolean;
  readonly controlsEnabled: boolean;
  readonly dark: boolean;
  readonly onChromeAction: (event: { readonly nativeEvent: { readonly action: EpubChromeAction } }) => void;
};

/** The native port displays immutable reader state and emits presentation intents. */
export const NativeEpubChrome = Platform.OS === 'ios' && requireOptionalNativeModule('ShudengEpub')
  ? requireNativeView<Props>('ShudengEpub', 'ShudengEpubChromeView')
  : null;
