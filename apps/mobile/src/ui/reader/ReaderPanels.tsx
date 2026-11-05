import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { useReduceMotion } from '../chat/useReduceMotion';
import type { ReaderPreferences, ShelfAnnotation } from '../../platform/library';
import type { ReaderContentsItem, ReaderSearchResult } from '../../reader/readerProtocol';
import { NativeEpubSettings, type EpubSettingsAction } from '../../reader/NativeEpubSettings';
import { radius, spacing, usePalette, type Palette } from '../theme';

function Panel({ visible, title, onClose, children, action }: { readonly visible: boolean; readonly title: string; readonly onClose: () => void; readonly children: ReactNode; readonly action?: ReactNode }) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.headerButton}><Text style={styles.action}>关闭</Text></Pressable>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.headerButton}>{action}</View>
      </View>
      {children}
    </View>
  </Modal>;
}

export function ReaderNavigationPanel({ visible, contents, bookmarks, onClose, onNavigate, onDelete, onBookmark, bookmarked, onSearch }: {
  readonly visible: boolean; readonly contents: readonly ReaderContentsItem[]; readonly bookmarks: readonly ShelfAnnotation[];
  readonly onClose: () => void; readonly onNavigate: (locator: string) => void;
  readonly onDelete: (annotation: ShelfAnnotation) => void; readonly onBookmark: () => void; readonly bookmarked: boolean;
  readonly onSearch?: () => void;
}) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [tab, setTab] = useState<'contents' | 'bookmarks'>('contents');
  const sorted = useMemo(() => bookmarks.slice().sort((a, b) => {
    if (a.locator?.type === 'epub' && b.locator?.type === 'epub') return a.locator.cfi.localeCompare(b.locator.cfi, undefined, { numeric: true });
    return (a.page ?? 0) - (b.page ?? 0);
  }), [bookmarks]);
  return <Panel visible={visible} title="目录与书签" onClose={onClose} action={onSearch ? <Pressable accessibilityRole="button" onPress={onSearch}><Text style={styles.action}>搜索</Text></Pressable> : undefined}>
    <View style={styles.segment}>
      {(['contents', 'bookmarks'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)} style={[styles.segmentItem, tab === value && styles.segmentSelected]}><Text style={styles.text}>{value === 'contents' ? '目录' : '书签'}</Text></Pressable>)}
    </View>
    {tab === 'contents' ? <FlatList data={contents} keyExtractor={(item, index) => item.href + index} ListEmptyComponent={<Text style={styles.empty}>本书没有目录</Text>} renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => onNavigate(item.href)} style={[styles.row, { paddingLeft: 24 + item.depth * 18 }]}><Text style={styles.text}>{item.label}</Text></Pressable>} /> : <>
      <Pressable accessibilityRole="button" onPress={onBookmark} style={styles.row}><Text style={styles.action}>{bookmarked ? '移除当前页书签' : '添加当前页书签'}</Text></Pressable>
      <FlatList data={sorted} keyExtractor={item => item.id} ListEmptyComponent={<Text style={styles.empty}>还没有书签</Text>} renderItem={({ item }) => <View style={styles.row}>
        <Pressable accessibilityRole="button" style={styles.flex} onPress={() => { if (item.locator) onNavigate(JSON.stringify(item.locator)); }}><Text style={styles.text}>{item.chapter ?? item.quote ?? '书签'}</Text><Text numberOfLines={2} style={styles.secondary}>{item.quote}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="删除书签" onPress={() => onDelete(item)} style={styles.deleteButton}><Text style={styles.danger}>删除</Text></Pressable>
      </View>} />
    </>}
  </Panel>;
}

export function ReaderSearchPanel({ visible, items, busy, error, onSearch, onNavigate, onClose }: {
  readonly visible: boolean; readonly items: readonly ReaderSearchResult[]; readonly busy: boolean; readonly error: string | null;
  readonly onSearch: (query: string) => void; readonly onNavigate: (locator: string) => void; readonly onClose: () => void;
}) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!visible) return;
    const timeout = setTimeout(() => onSearch(query), 300);
    return () => clearTimeout(timeout);
  }, [onSearch, query, visible]);
  return <Panel visible={visible} title="书内搜索" onClose={onClose}>
    <TextInput accessibilityLabel="搜索书中内容" placeholder="搜索书中内容" placeholderTextColor={palette.ink3} value={query} onChangeText={setQuery} returnKeyType="search" autoFocus style={styles.input} />
    {busy ? <View style={styles.status}><ActivityIndicator color={palette.lamp} /><Text style={styles.secondary}>正在搜索…</Text></View> : null}
    {error ? <View style={styles.status}><Text style={styles.danger}>{error}</Text><Pressable accessibilityRole="button" onPress={() => onSearch(query)}><Text style={styles.action}>重试</Text></Pressable></View> : null}
    <FlatList data={items} keyboardShouldPersistTaps="handled" keyExtractor={item => item.locator} ListEmptyComponent={!busy && !error && query.trim() ? <Text style={styles.empty}>没有找到相关内容</Text> : undefined} renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => onNavigate(item.locator)} style={styles.searchRow}><Text style={styles.secondary}>{item.label}</Text><Text numberOfLines={4} style={styles.text}>{item.excerpt}</Text></Pressable>} />
  </Panel>;
}

export function ReaderSettingsPanel({ visible, preferences, onClose, onApply, curlAvailable = false }: {
  readonly visible: boolean; readonly preferences: ReaderPreferences; readonly onClose: () => void; readonly onApply: (value: ReaderPreferences) => Promise<boolean>;
  readonly curlAvailable?: boolean;
}) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [draft, setDraft] = useState(preferences);
  const draftRef = useRef(preferences);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  useEffect(() => {
    if (visible && !savingRef.current) { draftRef.current = preferences; setDraft(preferences); }
  }, [preferences, visible]);
  const updateDraft = (update: (value: ReaderPreferences) => ReaderPreferences) => {
    if (savingRef.current) return;
    const next = update(draftRef.current);
    draftRef.current = next;
    setDraft(next);
  };
  const close = () => { if (!savingRef.current) onClose(); };
  const done = async () => {
    if (savingRef.current || !visible) return;
    savingRef.current = true;
    setSaving(true);
    try { if (await onApply(draftRef.current)) onClose(); }
    catch (cause) { Alert.alert('设置尚未保存', cause instanceof Error ? cause.message : String(cause)); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const handleNativeAction = (action: EpubSettingsAction) => {
    if (!visible) return;
    switch (action.action) {
      case 'cancel': close(); break;
      case 'done': void done(); break;
      case 'flow': if (action.value !== 'curl' || curlAvailable) updateDraft(value => ({ ...value, flow: action.value })); break;
      case 'theme': updateDraft(value => ({ ...value, theme: action.value })); break;
      case 'fontStep': updateDraft(value => ({ ...value, fontScale: Math.max(.75, Math.min(2, value.fontScale + action.delta * .25)) })); break;
    }
  };
  if (NativeEpubSettings) return <NativeEpubSettings
    visible={visible} value={JSON.stringify(draft)} saving={saving} dark={preferences.theme === 'dark'} curlAvailable={curlAvailable}
    onSettingsAction={event => handleNativeAction(event.nativeEvent)}
    pointerEvents="none" accessibilityElementsHidden style={styles.nativePresenter}
  />;
  return <Panel visible={visible} title="阅读设置" onClose={close} action={<Pressable accessibilityRole="button" onPress={() => void done()} disabled={saving}><Text style={styles.action}>{saving ? '保存中…' : '完成'}</Text></Pressable>}>
    <Text style={styles.section}>阅读方式</Text>
    <View style={styles.segment}>
      {(['paginated', 'scrolled', 'curl'] as const).map((flow, index) => <Pressable key={flow} accessibilityRole="button" accessibilityState={{ selected: draft.flow === flow, disabled: saving || flow === 'curl' && !curlAvailable }} disabled={saving || flow === 'curl' && !curlAvailable} onPress={() => updateDraft(value => ({ ...value, flow }))} style={[styles.segmentItem, draft.flow === flow && styles.segmentSelected, flow === 'curl' && !curlAvailable && styles.disabled]}><Text style={styles.text}>{['分页', '滚动', '仿真'][index]}</Text></Pressable>)}
    </View>
    <Text style={styles.section}>字号</Text>
    <View style={styles.fontRow}>
      <Pressable accessibilityRole="button" accessibilityLabel="缩小字号" disabled={saving || draft.fontScale <= .75} onPress={() => updateDraft(value => ({ ...value, fontScale: Math.max(.75, value.fontScale - .25) }))} style={styles.fontButton}><Text style={styles.action}>A−</Text></Pressable>
      <Text style={styles.text}>{Math.round(draft.fontScale * 100)}%</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="增大字号" disabled={saving || draft.fontScale >= 2} onPress={() => updateDraft(value => ({ ...value, fontScale: Math.min(2, value.fontScale + .25) }))} style={styles.fontButton}><Text style={styles.action}>A+</Text></Pressable>
    </View>
    <Text style={styles.section}>主题</Text>
    <View style={styles.segment}>{(['light', 'dark'] as const).map(theme => <Pressable key={theme} accessibilityRole="button" accessibilityState={{ selected: draft.theme === theme }} disabled={saving} onPress={() => updateDraft(value => ({ ...value, theme }))} style={[styles.segmentItem, draft.theme === theme && styles.segmentSelected]}><Text style={styles.text}>{theme === 'light' ? '明亮' : '深色'}</Text></Pressable>)}</View>
    <Text style={styles.footnote}>仅用于本书</Text>
  </Panel>;
}

export const highlightColors = { yellow: '#F2DBA6', green: '#DEE8D3', blue: '#DCE6EC', rose: '#F3DEDA' } as const;
const darkHighlightColors = { yellow: '#5A4A2A', green: '#30402C', blue: '#2C3A44', rose: '#472F2C' } as const;
export function HighlightPanel({ annotation, onClose, onColor, onRemove, compact = false }: { readonly annotation: ShelfAnnotation | null; readonly onClose: () => void; readonly onColor: (color: string) => void; readonly onRemove: () => void; readonly compact?: boolean }) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const swatches = palette.paper === '#1B1A17' ? darkHighlightColors : highlightColors;
  return <Modal visible={annotation?.kind === 'highlight' || compact && annotation?.kind === 'note'} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onClose}>
    <View style={[styles.dimmer, compact && styles.clearDimmer]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="收起调色条" />
      <View style={compact ? [styles.compactPanel, { bottom: insets.bottom + 92 }] : [styles.highlightPanel, { marginBottom: insets.bottom + 8 }]}>
        {!compact ? <Text style={styles.paletteTitle}>高亮颜色</Text> : null}
        <View style={[styles.colorRow, compact && styles.compactColorRow]}>{Object.entries(swatches).map(([color, hex]) => {
          const selected = annotation?.color === color || (color === 'rose' && annotation?.color === 'pink');
          const label = { yellow: '黄色', green: '青瓷', blue: '雾蓝', rose: '胭脂' }[color];
          return <View key={color} style={styles.colorColumn}><Pressable accessibilityRole="button" accessibilityLabel={label + '高亮'} accessibilityState={{ selected }} onPress={() => onColor(color)} style={[styles.color, compact && styles.compactColor, { backgroundColor: hex }, selected && (compact ? styles.compactColorSelected : styles.colorSelected)]} />{!compact ? <Text style={styles.secondary}>{label}</Text> : null}</View>;
        })}
          {compact ? <Pressable accessibilityRole="button" accessibilityLabel="收起调色条" onPress={onClose} style={styles.compactClose}><SymbolView name="xmark" size={11} weight="semibold" tintColor={palette.ink3} /></Pressable> : null}
        </View>
        {!compact ? <><Pressable accessibilityRole="button" onPress={onRemove} style={styles.paletteTextButton}><Text style={styles.danger}>取消高亮</Text></Pressable><Pressable accessibilityRole="button" onPress={onClose} style={styles.paletteTextButton}><Text style={styles.text}>取消</Text></Pressable></> : null}
      </View>
    </View>
  </Modal>;
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    nativePresenter: { position: 'absolute', width: 0, height: 0 },
    screen: { flex: 1, backgroundColor: palette.paper }, flex: { flex: 1 },
    header: { minHeight: 56, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
    headerButton: { minWidth: 60, minHeight: 44, justifyContent: 'center' }, title: { color: palette.ink, fontWeight: '600', fontSize: 17 },
    action: { color: palette.lamp, fontSize: 16 }, text: { color: palette.ink, fontSize: 16, lineHeight: 24 }, secondary: { color: palette.ink3, fontSize: 12, lineHeight: 18 }, danger: { color: palette.danger, fontSize: 14 },
    row: { paddingHorizontal: 24, paddingVertical: 16, minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, flexDirection: 'row', alignItems: 'center' },
    searchRow: { paddingHorizontal: 24, paddingVertical: 14, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
    segment: { flexDirection: 'row', margin: 20, backgroundColor: palette.paperDeep, borderRadius: 9, padding: 3 },
    segmentItem: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 7 }, segmentSelected: { backgroundColor: palette.surface },
    section: { marginTop: 24, marginLeft: 24, fontSize: 13, color: palette.ink3 }, empty: { margin: 24, fontSize: 15, color: palette.ink3 },
    footnote: { marginLeft: 24, color: palette.ink3, fontSize: 12 }, fontRow: { margin: 20, minHeight: 56, backgroundColor: palette.surface, borderRadius: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    fontButton: { minWidth: 72, minHeight: 52, alignItems: 'center', justifyContent: 'center' }, disabled: { opacity: .35 },
    input: { margin: 20, padding: 14, fontSize: 16, color: palette.ink, backgroundColor: palette.surface, borderRadius: radius.field, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.line },
    status: { paddingHorizontal: 24, flexDirection: 'row', gap: 10, alignItems: 'center', paddingBottom: 12 }, deleteButton: { padding: 12 },
    dimmer: { flex: 1, backgroundColor: 'rgba(0,0,0,.34)', justifyContent: 'flex-end', paddingHorizontal: 8 }, clearDimmer: { backgroundColor: 'transparent' },
    highlightPanel: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, borderRadius: radius.sheet, backgroundColor: palette.paper, gap: 14 }, paletteTitle: { color: palette.ink, fontSize: 17, fontFamily: 'Songti SC', fontWeight: '600' },
    compactPanel: { position: 'absolute', alignSelf: 'center', backgroundColor: palette.surface, borderRadius: 16, paddingLeft: 16, paddingRight: 12, borderWidth: 1, borderColor: palette.line, shadowColor: '#000', shadowOpacity: .12, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } },
    colorRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 0, gap: 12 }, compactColorRow: { gap: 14, paddingVertical: 10, alignItems: 'center' }, colorColumn: { alignItems: 'center', gap: 6 },
    color: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: palette.line }, compactColor: { width: 28, height: 28, borderRadius: 14, borderWidth: 0 }, colorSelected: { borderColor: palette.ink, borderWidth: 3 }, compactColorSelected: { borderColor: palette.ink, borderWidth: 2 }, compactClose: { width: 32, height: 32, marginLeft: -2, alignItems: 'center', justifyContent: 'center' }, paletteTextButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  });
}
