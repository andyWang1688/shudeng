import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';

export type EpubNavigationAction =
  | { readonly action: 'close' | 'searchOpen' | 'searchClose' | 'prepare' | 'addBookmark' }
  | { readonly action: 'tab'; readonly tab: 'contents' | 'bookmarks' }
  | { readonly action: 'query'; readonly query: string }
  | { readonly action: 'selectSearchResult'; readonly id: string; readonly selectionKey: string }
  | { readonly action: 'navigate'; readonly source: 'search'; readonly id: string; readonly selectionKey: string }
  | { readonly action: 'navigate'; readonly source: 'contents' | 'bookmarks'; readonly id: string }
  | { readonly action: 'deleteBookmark'; readonly id: string };

type Props = ViewProps & {
  readonly visible: boolean;
  readonly state: string;
  readonly dark: boolean;
  readonly onNavigationAction: (event: NativeSyntheticEvent<EpubNavigationAction>) => void;
};

export const NativeEpubNavigation = requireOptionalNativeModule('ShudengEpub')
  ? requireNativeView<Props>('ShudengEpub', 'ShudengEpubNavigationView')
  : null;
