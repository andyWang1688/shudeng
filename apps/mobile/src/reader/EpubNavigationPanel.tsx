import { StyleSheet } from 'react-native';
import type { ShelfAnnotation } from '../platform/library';
import { usePalette } from '../ui/theme';
import { NativeEpubNavigation } from './NativeEpubNavigation';
import { useEpubNavigation } from './useEpubNavigation';
import type { ReaderContentsItem } from './readerProtocol';

type Props = {
  readonly bookId: string;
  readonly visible: boolean;
  readonly contents: readonly ReaderContentsItem[];
  readonly contentsLoaded: boolean;
  readonly annotations: readonly ShelfAnnotation[];
  readonly onClose: () => void;
  readonly onNavigate: (locator: string) => void;
  readonly onAddBookmark: () => Promise<boolean>;
  readonly onRemoveBookmark: (annotation: ShelfAnnotation) => Promise<boolean>;
};

export function EpubNavigationPanel(props: Props) {
  const palette = usePalette();
  const navigation = useEpubNavigation(props);
  return NativeEpubNavigation ? <NativeEpubNavigation visible={props.visible} state={navigation.state}
    dark={palette.paper === '#1B1A17'} onNavigationAction={event => navigation.onAction(event.nativeEvent)}
    pointerEvents="none" accessibilityElementsHidden style={styles.presenter} /> : null;
}
const styles = StyleSheet.create({ presenter: { position: 'absolute', width: 0, height: 0 } });
