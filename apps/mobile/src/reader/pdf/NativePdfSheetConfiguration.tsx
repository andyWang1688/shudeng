import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ViewProps } from 'react-native';

type Props = ViewProps & { readonly dark: boolean; readonly grabber: boolean };

/** The enclosing RN Modal is a UIKit pageSheet; native code selects its large detent. */
export const NativePdfSheetConfiguration = requireOptionalNativeModule('ShudengPdf')
  ? requireNativeView<Props>('ShudengPdf', 'ShudengPdfSheetConfigurationView')
  : null;
