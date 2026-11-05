import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Keyboard, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ShelfAnnotation, StoredReaderLocator } from '../../platform/library';
import type { ReaderPreferences } from '../../platform/library/readerPreferences';
import type { PdfOutlineItem, PdfSearchHit } from '../../platform/pdfNative';
import { trimPdfSearchQuery } from '../../platform/pdfSearchResults';
import { usePalette, type Palette } from '../../ui/theme';
import { useAppearance } from '../../ui/appearance';
import { useReduceMotion } from '../../ui/chat/useReduceMotion';
import { NativePdfSheetConfiguration } from './NativePdfSheetConfiguration';
import { NativePdfPanel, type PdfPanelAction } from './NativePdfPanel';

export type PdfPanel = 'contents' | 'settings' | null;
export type PdfContentsTab = 'contents' | 'bookmarks' | 'search';
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'rose';
const COLORS = [
  { value: 'yellow', title: '黄色', paint: '#F2DBA6', darkPaint: '#5A4A2A' },
  { value: 'green', title: '青瓷', paint: '#DEE8D3', darkPaint: '#30402C' },
  { value: 'blue', title: '雾蓝', paint: '#DCE6EC', darkPaint: '#2C3A44' },
  { value: 'rose', title: '胭脂', paint: '#F3DEDA', darkPaint: '#472F2C' },
] as const;

export function PdfColorPalette({ visible, selected, editing, onPick, onDelete, onClose }: {
  readonly visible: boolean;
  readonly selected: string | null;
  readonly editing: boolean;
  readonly onPick: (color: HighlightColor) => void;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const { resolvedMode } = useAppearance();
  const reduceMotion = useReduceMotion();
  const insets = useSafeAreaInsets();
  const [presented, setPresented] = useState(visible);
  const opacity = useRef(new Animated.Value(1)).current;
  const mounted = useRef(false);
  const finishing = useRef(false);
  const pending = useRef<{ close: () => void; action: (() => void) | null } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; pending.current = null; opacity.stopAnimation();
    };
  }, [opacity]);
  useEffect(() => {
    // An external close (including reader navigation) revokes a pending action.
    pending.current = null; finishing.current = false; opacity.stopAnimation();
    opacity.setValue(1); setPresented(visible);
  }, [opacity, visible]);
  const finish = (action: (() => void) | null) => {
    if (!mounted.current || !visible || !presented || finishing.current) return;
    finishing.current = true;
    pending.current = { close: onClose, action };
    Animated.timing(opacity, { toValue: 0, duration: reduceMotion ? 0 : 160, useNativeDriver: true }).start(({ finished }) => {
      if (finished && mounted.current && pending.current) setPresented(false);
    });
  };
  const didDismiss = () => {
    const request = pending.current; pending.current = null;
    if (!mounted.current || !request) return;
    // Use the callbacks captured at the tap, after UIKit confirms dismissal.
    // Neither a render with a new target nor rapid taps may replace that action.
    request.close();
    request.action?.();
  };
  const current = selected === 'pink' ? 'rose' : selected;
  return (
    <Modal visible={presented} transparent animationType={presented && !reduceMotion ? 'fade' : 'none'} onRequestClose={() => finish(null)} onDismiss={didDismiss}>
      <Animated.View testID="pdf-highlight-palette" accessibilityViewIsModal style={[styles.backdrop, { paddingBottom: insets.bottom + 8, opacity }]}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="关闭高亮颜色" onPress={() => finish(null)} />
        <View testID="pdf-highlight-card" style={styles.colorSheet}>
          <Text dynamicTypeRamp="headline" style={styles.title}>高亮</Text>
          <View style={styles.colors}>
            {COLORS.map((color) => (
              <View key={color.value} style={styles.colorColumn}>
                <Pressable
                  testID={'pdf-highlight-color-' + color.value}
                  accessibilityRole="button"
                  accessibilityLabel={color.title + '高亮'}
                  accessibilityState={{ selected: current === color.value }}
                  onPress={() => finish(() => onPick(color.value))}
                  style={[styles.color, { backgroundColor: resolvedMode === 'dark' ? color.darkPaint : color.paint }, current === color.value && styles.selectedColor]}
                />
                <Text dynamicTypeRamp="caption1" style={styles.colorLabel}>{color.title}</Text>
              </View>
            ))}
          </View>
          {editing ? <Pressable testID="pdf-highlight-remove" accessibilityRole="button" onPress={() => finish(onDelete)} style={styles.paletteAction}><Text dynamicTypeRamp="subheadline" style={styles.deleteText}>取消高亮</Text></Pressable> : null}
          <Pressable testID="pdf-highlight-cancel" accessibilityRole="button" onPress={() => finish(null)} style={styles.paletteAction}><Text dynamicTypeRamp="subheadline" style={styles.action}>取消</Text></Pressable>
        </View>
      </Animated.View>
    </Modal>
  );
}

type PanelRow = {
  readonly id: string;
  readonly title: string;
  readonly detail: string | null;
  readonly depth: number;
  readonly deletable: boolean;
  readonly bookmark: boolean;
  readonly locator: StoredReaderLocator;
  readonly annotation?: ShelfAnnotation;
};

type PanelProps = {
  readonly panel: PdfPanel;
  readonly tab: PdfContentsTab;
  readonly onTab: (tab: PdfContentsTab) => void;
  readonly outline: readonly PdfOutlineItem[];
  readonly totalPages: number;
  readonly annotations: readonly ShelfAnnotation[];
  readonly query: string;
  readonly queryEventCount: number;
  readonly onQuery: (query: string, eventCount: number) => void;
  readonly searching: boolean;
  readonly searchError: string | null;
  readonly searchAvailable: boolean;
  readonly hits: readonly PdfSearchHit[];
  readonly preferences: ReaderPreferences | null;
  readonly onPreferences: (change: Partial<Pick<ReaderPreferences, 'flow' | 'theme'>>) => void;
  readonly onJump: (locator: StoredReaderLocator) => void;
  readonly onDeleteBookmark: (annotation: ShelfAnnotation) => void;
  readonly onClose: () => void;
};

/** UIKit owns navigation/control appearance. All presentation data and actions are in TS. */
export function PdfReaderPanels(props: PanelProps) {
  const { panel, tab, onTab, outline, annotations, query, queryEventCount, onQuery, searching, searchError,
    searchAvailable, hits, preferences, onPreferences, onJump, onDeleteBookmark, onClose } = props;
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const { resolvedMode } = useAppearance();
  const reduceMotion = useReduceMotion();
  const rows = useMemo<readonly PanelRow[]>(() => {
    if (tab === 'bookmarks') return annotations.flatMap((item) => item.kind === 'bookmark' && item.locator?.type === 'pdf'
      ? [{ id: item.id, title: '第 ' + item.locator.page + ' 页', detail: item.quote || null, depth: 0,
        deletable: true, bookmark: true, annotation: item, locator: item.locator }]
      : []).sort((a, b) => a.locator.page - b.locator.page);
    if (tab === 'search') return hits.map((item, index) => ({
      id: 'search-' + index, title: '第 ' + item.page + ' 页', detail: item.text, depth: 0,
      deletable: false, bookmark: false, locator: { type: 'pdf', page: item.page, rects: item.rects, text: item.text },
    }));
    return outline.filter(item => item.depth <= 1).slice(0, 500).map((item, index) => ({
      id: 'outline-' + index, title: item.title, detail: '第 ' + item.page + ' 页', depth: item.depth,
      deletable: false, bookmark: false, locator: { type: 'pdf', page: item.page },
    }));
  }, [annotations, hits, outline, tab]);
  const status = tab === 'bookmarks' ? '还没有书签' : tab === 'contents' ? '这份 PDF 没有目录'
    : !searchAvailable ? '没有可搜索的文字' : searchError ?? (searching ? '正在准备搜索…' : trimPdfSearchQuery(query) ? '没有找到相关内容' : '输入关键词搜索这本书');
  const nativeState = useMemo(() => JSON.stringify({
    kind: panel ?? 'contents', tab, query, queryEventCount, status, flow: preferences?.flow ?? 'paginated',
    searchEnabled: searchAvailable, rows: rows.map(({ locator: _locator, annotation: _annotation, ...row }) => row),
  }), [panel, preferences?.flow, query, queryEventCount, rows, searchAvailable, status, tab]);
  const close = () => { Keyboard.dismiss(); onClose(); };
  const onAction = (event: PdfPanelAction) => {
    switch (event.action) {
      case 'close': close(); break;
      case 'tab': onTab(event.tab); break;
      case 'query': onQuery(event.query, event.eventCount); break;
      case 'flow': onPreferences({ flow: event.flow }); break;
      case 'jump': {
        const row = rows.find(item => item.id === event.id);
        if (row) onJump(row.locator);
        break;
      }
      case 'delete': {
        const annotation = rows.find(item => item.id === event.id)?.annotation;
        if (annotation) onDeleteBookmark(annotation);
        break;
      }
    }
  };
  return (
    <Modal visible={panel !== null} presentationStyle="pageSheet" animationType={reduceMotion ? 'none' : 'slide'} allowSwipeDismissal onRequestClose={close}>
      <View style={styles.sheet}>
        {NativePdfSheetConfiguration ? <NativePdfSheetConfiguration dark={resolvedMode === 'dark'} grabber={panel === 'settings'} pointerEvents="none" style={styles.configuration} /> : null}
        {NativePdfPanel ? <NativePdfPanel state={nativeState} dark={resolvedMode === 'dark'} style={styles.panel} onPanelAction={(event) => onAction(event.nativeEvent)} /> : null}
      </View>
    </Modal>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.34)', justifyContent: 'flex-end', paddingHorizontal: 8 },
    sheet: { flex: 1, backgroundColor: palette.paper },
    panel: { flex: 1 },
    configuration: { position: 'absolute', width: 0, height: 0 },
    colorSheet: { backgroundColor: palette.paper, borderRadius: 22, borderCurve: 'continuous', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, gap: 14, shadowColor: '#000', shadowOpacity: .26, shadowRadius: 34, shadowOffset: { width: 0, height: 14 } },
    title: { color: palette.ink, fontFamily: 'SongtiSC-Bold', fontSize: 17, fontWeight: '600' },
    action: { color: palette.ink2, fontSize: 14, fontWeight: '500' },
    colors: { flexDirection: 'row', gap: 12 },
    colorColumn: { flex: 1, alignItems: 'center', gap: 6 },
    colorLabel: { color: palette.ink2, fontSize: 10.5, fontWeight: '500', textAlign: 'center' },
    color: { width: 44, height: 44, borderRadius: 22, borderCurve: 'continuous', borderWidth: 1, borderColor: palette.line },
    selectedColor: { borderColor: palette.ink, borderWidth: 3 },
    paletteAction: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
    deleteText: { color: palette.danger, fontSize: 14, fontWeight: '500' },
  });
}
