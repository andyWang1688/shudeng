import { useCallback, useEffect, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import type { SearchBarCommands, SearchBarProps } from 'react-native-screens';
import type { Palette } from '../theme';

interface NativeListSearchOptions {
  readonly placeholder: string;
  readonly palette: Pick<Palette, 'lamp' | 'ink'>;
  readonly restoreOffset: (y: number) => void;
}

/** The system owns field text and animation; this hook owns filtering and restoration. */
export function useNativeListSearch({ placeholder, palette, restoreOffset }: NativeListSearchOptions) {
  const [query, setQuery] = useState('');
  const searchBar = useRef<SearchBarCommands>(null);
  const offset = useRef(0);
  const beforeSearch = useRef<number | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const restore = useRef(restoreOffset);
  restore.current = restoreOffset;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      beforeSearch.current = null;
    };
  }, []);

  const clear = useCallback(() => {
    searchBar.current?.clearText();
    setQuery('');
  }, []);
  const cancel = useCallback(() => {
    setQuery('');
    const y = beforeSearch.current;
    beforeSearch.current = null;
    if (y === null) return;
    const request = ++generation.current;
    requestAnimationFrame(() => {
      if (mounted.current && generation.current === request) restore.current(y);
    });
  }, []);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = event.nativeEvent.contentOffset.y;
  }, []);
  const headerSearchBarOptions: SearchBarProps = {
    ref: searchBar, placeholder, placement: 'stacked', hideWhenScrolling: false,
    obscureBackground: false, cancelButtonText: '取消',
    tintColor: palette.lamp, textColor: palette.ink,
    onFocus: () => {
      generation.current++;
      beforeSearch.current ??= offset.current;
    },
    onChangeText: event => setQuery(event.nativeEvent.text),
    onCancelButtonPress: cancel,
  };
  return { query, clear, headerSearchBarOptions, onScroll };
}
