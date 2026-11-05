import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ViewProps } from 'react-native';

type Props = ViewProps & {
  readonly html: string;
  readonly archiveSessionID: string;
  readonly command: string;
  readonly curl: boolean;
  readonly dark: boolean;
  readonly onEpubEvent: (event: { readonly nativeEvent: { readonly message: string } }) => void;
};

/** The native view hosts this build's reader-web and UIKit presentation. */
export const NativeEpubSurface = requireOptionalNativeModule('ShudengEpub')
  ? requireNativeView<Props>('ShudengEpub', 'ShudengEpubView')
  : null;
