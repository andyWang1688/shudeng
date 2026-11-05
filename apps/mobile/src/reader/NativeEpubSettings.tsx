import { requireNativeView, requireOptionalNativeModule } from 'expo';
import { Platform, type ViewProps } from 'react-native';

export type EpubSettingsAction =
  | { readonly action: 'flow'; readonly value: 'paginated' | 'scrolled' | 'curl' }
  | { readonly action: 'theme'; readonly value: 'light' | 'dark' }
  | { readonly action: 'fontStep'; readonly delta: -1 | 1 }
  | { readonly action: 'done' | 'cancel' };

type Props = ViewProps & {
  readonly visible: boolean;
  readonly value: string;
  readonly saving: boolean;
  readonly dark: boolean;
  readonly curlAvailable: boolean;
  readonly onSettingsAction: (event: { readonly nativeEvent: EpubSettingsAction }) => void;
};

export const NativeEpubSettings = Platform.OS === 'ios' && requireOptionalNativeModule('ShudengEpub')
  ? requireNativeView<Props>('ShudengEpub', 'ShudengEpubSettingsView')
  : null;
