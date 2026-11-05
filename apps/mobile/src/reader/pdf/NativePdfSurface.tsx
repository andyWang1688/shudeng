import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';
import type { StoredPdfRect } from '../../platform/library';
import type { PdfOutlineItem } from '../../platform/pdfNative';

export type PdfViewEvent =
  | { readonly type: 'ready'; readonly pageCount: number; readonly outline: readonly PdfOutlineItem[] }
  | { readonly type: 'page'; readonly page: number; readonly pageCount: number; readonly pageHasText: boolean }
  | { readonly type: 'selection'; readonly page: number; readonly text: string; readonly rects: readonly StoredPdfRect[] }
  | { readonly type: 'selectionAction'; readonly action: 'highlight' | 'note' | 'ask' | 'cancel'; readonly page: number; readonly text: string; readonly rects: readonly StoredPdfRect[] }
  | { readonly type: 'annotation'; readonly id: string }
  | { readonly type: 'navigation'; readonly operationId: string; readonly status: 'arrived' | 'failed'; readonly message?: string }
  | { readonly type: 'selectionCleared' | 'tap' }
  | { readonly type: 'error'; readonly message: string };

export type NativePdfSurfaceProps = ViewProps & {
  readonly uri: string;
  readonly page: number;
  readonly mode: 'auto' | 'paginated' | 'scrolled';
  readonly dark: boolean;
  readonly annotations: string;
  readonly command: string;
  readonly onPdfEvent: (event: NativeSyntheticEvent<PdfViewEvent>) => void;
};

export const NativePdfSurface = requireOptionalNativeModule('ShudengPdf')
  ? requireNativeView<NativePdfSurfaceProps>('ShudengPdf', 'ShudengPdfView')
  : null;
