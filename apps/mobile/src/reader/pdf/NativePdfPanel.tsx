import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';
import type { PdfContentsTab } from './PdfReaderPanels';

export type PdfPanelAction =
  | { readonly action: 'close' }
  | { readonly action: 'tab'; readonly tab: PdfContentsTab }
  | { readonly action: 'query'; readonly query: string; readonly eventCount: number }
  | { readonly action: 'flow'; readonly flow: 'paginated' | 'scrolled' }
  | { readonly action: 'jump' | 'delete'; readonly id: string };
type Props = ViewProps & {
  readonly state: string;
  readonly dark: boolean;
  readonly onPanelAction: (event: NativeSyntheticEvent<PdfPanelAction>) => void;
};

export const NativePdfPanel = requireOptionalNativeModule('ShudengPdf')
  ? requireNativeView<Props>('ShudengPdf', 'ShudengPdfPanelView')
  : null;
