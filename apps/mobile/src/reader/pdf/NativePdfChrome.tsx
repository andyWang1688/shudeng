import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';

export type PdfChromeAction = 'back' | 'bookmark' | 'contents' | 'help' | 'settings' | 'ask';
type Props = ViewProps & {
  readonly title: string;
  // Avoid Yoga style names: Expo/Fabric flattens styles and custom props together.
  readonly pagePosition: readonly [number, number];
  readonly bookmarked: boolean;
  readonly hasScannedPages: boolean;
  readonly referenceMode: boolean;
  readonly dark: boolean;
  readonly chromeVisible: boolean;
  readonly onChromeAction: (event: NativeSyntheticEvent<{ readonly action: PdfChromeAction }>) => void;
};

/** UIKit supplies PDF-specific typography and controls; commands remain owned by RN. */
export const NativePdfChrome = requireOptionalNativeModule('ShudengPdf')
  ? requireNativeView<Props>('ShudengPdf', 'ShudengPdfChromeView')
  : null;
