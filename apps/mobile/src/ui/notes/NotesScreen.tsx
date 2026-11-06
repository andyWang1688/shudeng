import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  PlatformColor,
  SectionList,
  Share,
  StyleSheet,
  Text,
  View,
  type SectionListRenderItem,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { File, Paths } from 'expo-file-system';
import {
  deleteReaderAnnotation,
  loadAllAnnotations,
  loadAppPreference,
  saveAppPreference,
  updateReaderAnnotation,
  type ShelfAnnotation,
  type ShelfBookRecord,
} from '../../platform/library';
import { NoteSheet } from '../reader/NoteSheet';
import { EmptyState } from '../components/EmptyState';
import { BookNotice } from '../components/BookNotice';
import { SectionHeader } from '../components/SectionHeader';
import { groupByKey } from '../components/groupBy';
import { useHaptics } from '../components/useHaptics';
import { recordTime } from '../format';
import { SERIF } from '../chat/format';
import { type as typeScale, usePalette, type Palette } from '../theme';
import { useNativeListSearch } from '../navigation/useNativeListSearch';

type NoteItem = { book: ShelfBookRecord; annotation: ShelfAnnotation };
type NoteSection = { book: ShelfBookRecord; count: number; collapsed: boolean; data: NoteItem[] };
const KIND_LABEL: Record<ShelfAnnotation['kind'], string> = {
  highlight: '高亮',
  note: '笔记',
  bookmark: '书签',
};

function chapterText({ book, annotation }: NoteItem): string {
  if (book.format === 'PDF') {
    const page = annotation.page ?? annotation.position;
    if (page !== null && page !== undefined) return `第 ${page} 页`;
  }
  return annotation.chapter || '阅读位置';
}

function readingOrder(a: NoteItem, b: NoteItem): number {
  const progression = (a.annotation.locator === null ? 1 : a.annotation.progression ?? a.annotation.localProgression ?? 0) -
    (b.annotation.locator === null ? 1 : b.annotation.progression ?? b.annotation.localProgression ?? 0);
  if (progression) return progression;
  const position =
    (a.annotation.locator === null ? 0 : a.annotation.position ?? 0) -
    (b.annotation.locator === null ? 0 : b.annotation.position ?? 0);
  if (position) return position;
  return a.annotation.id.localeCompare(b.annotation.id);
}

function buildExportText(entries: readonly NoteItem[]): string {
  return (
    entries
      .map((item) =>
        [
          `《${item.book.title}》`,
          chapterText(item),
          item.annotation.quote ? `原文：${item.annotation.quote}` : null,
          item.annotation.body ? `想法：${item.annotation.body}` : null,
        ]
          .filter((line): line is string => Boolean(line))
          .join('\n'),
      )
      .join('\n\n') + '\n'
  );
}

export default function NotesRoute() {
  const router = useRouter();
  const haptics = useHaptics();
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [items, setItems] = useState<readonly NoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [preferencesReady, setPreferencesReady] = useState(false);
  const groupsInitialized = useRef(false);
  const hasGroupPreferences = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<NoteItem | null>(null);
  const [noteBody, setNoteBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<NoteItem | null>(null);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const mutationInFlight = useRef(false);
  const exportInFlight = useRef(false);
  const mounted = useRef(true);
  const list = useRef<SectionList<NoteItem, NoteSection>>(null);
  const { query, clear: clearSearch, headerSearchBarOptions, onScroll } = useNativeListSearch({
    placeholder: '搜索笔记', palette,
    restoreOffset: y => list.current?.getScrollResponder()?.scrollTo({ y, animated: false }),
  });
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const showNotice = (title: string, message: string) => {
    if (mounted.current) setNotice({ title, message });
  };
  useEffect(() => {
    let active = true;
    void loadAppPreference('notes.collapsed')
      .then((value) => {
        if (!active || !value || typeof value !== 'object' || Array.isArray(value)) return;
        hasGroupPreferences.current = true;
        const entries = Object.entries(value).filter(
          (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
        );
        setCollapsed(Object.fromEntries(entries));
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setPreferencesReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const toggleGroup = (bookId: string) => {
    if (query.trim()) return;
    const next = { ...collapsed, [bookId]: !collapsed[bookId] };
    setCollapsed(next);
    void saveAppPreference('notes.collapsed', next).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  };

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      void loadAllAnnotations()
        .then((next) => {
          if (mounted) {
            setItems(next);
            setError(null);
          }
        })
        .catch((cause: unknown) => {
          if (mounted) setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (mounted) setLoading(false);
        });
      return () => {
        mounted = false;
      };
    }, []),
  );

  useEffect(() => {
    if (!preferencesReady || loading || groupsInitialized.current) return;
    const records = items.filter((item) => item.annotation.kind !== 'bookmark');
    if (records.length === 0) return;
    groupsInitialized.current = true;
    const latest = records.reduce<NoteItem | undefined>(
      (result, item) => !result || item.annotation.createdAt > result.annotation.createdAt ? item : result,
      undefined,
    )?.book.id;
    const next = { ...collapsed };
    for (const { book } of records) next[book.id] ??= hasGroupPreferences.current || book.id !== latest;
    hasGroupPreferences.current = true;
    setCollapsed(next);
    void saveAppPreference('notes.collapsed', next).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [preferencesReady, loading, items, collapsed]);

  const needle = query.trim().toLowerCase();
  const filtered = items
    .filter(({ annotation }) => annotation.kind !== 'bookmark')
    .filter(
      ({ book, annotation }) =>
        !needle ||
        `${annotation.quote} ${annotation.body ?? ''} ${book.title} ${annotation.chapter ?? ''}`
          .toLowerCase()
          .includes(needle),
    );
  const sections: NoteSection[] = groupByKey(filtered, (item) => item.book.id).map(({ items: entries }) => {
    const book = entries[0]!.book;
    const ordered = [...entries].sort(readingOrder);
    const isCollapsed = !needle && (collapsed[book.id] ?? true);
    return { book, count: entries.length, collapsed: isCollapsed, data: isCollapsed ? [] : ordered };
  });

  const openOriginal = ({ book, annotation }: NoteItem) => {
    if (book.removed) {
      showNotice('原书已移除', '笔记仍保留，重新导入同一个文件后即可回到原文。');
      return;
    }
    if (!annotation.locator) {
      showNotice('无法返回原文', '这条旧记录缺少阅读位置，内容仍可查看和导出。');
      return;
    }
    router.push({
      pathname: '/reader/[id]',
      params: { id: book.id, locator: JSON.stringify(annotation.locator) },
    });
  };
  const editNote = (item: NoteItem) => {
    if (!item.annotation.body?.trim() || mutationInFlight.current) return;
    setNoteBody(item.annotation.body ?? '');
    setEditing(item);
  };
  const removeAnnotation = (item: NoteItem) => {
    if (!mutationInFlight.current && !deleting) setDeleting(item);
  };
  const performDelete = async (item: NoteItem, fromEditor = false) => {
    setDeleting(null);
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setSaving(true);
    try {
      await deleteReaderAnnotation(item.annotation.id);
      if (!mounted.current) return;
      setItems((current) => current.filter((entry) => entry.annotation.id !== item.annotation.id));
      if (fromEditor) setEditing(null);
    } catch {
      showNotice(fromEditor ? '删除失败' : '操作未保存', fromEditor
        ? '笔记仍保留；请检查储存空间后重试。'
        : '删除失败，笔记仍保留；请重试。');
    } finally {
      mutationInFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  const saveNote = async () => {
    if (!editing || mutationInFlight.current || !noteBody.trim()) return;
    mutationInFlight.current = true;
    setSaving(true);
    try {
      await updateReaderAnnotation(editing.annotation.id, { body: noteBody });
      if (!mounted.current) return;
      setItems((current) => current.map((entry) => entry.annotation.id === editing.annotation.id
        ? { ...entry, annotation: { ...entry.annotation, body: noteBody } } : entry));
      setEditing(null);
    } catch {
      showNotice('笔记保存失败', '内容仍在此页；请检查储存空间后重试保存。');
    } finally {
      mutationInFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const handleExport = async (): Promise<void> => {
    const exportable = sections.flatMap((section) => {
      const entries = filtered.filter((item) => item.book.id === section.book.id);
      return [...entries].sort(readingOrder);
    });
    if (exportable.length === 0) {
      showNotice('还没有可导出的笔记', '阅读时选中原文，写下高亮或笔记后再导出。');
      return;
    }
    if (exportInFlight.current) return;
    exportInFlight.current = true;
    setExporting(true);
    haptics();
    const date = new Date();
    const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    let file: File | null = null;
    try {
      file = new File(Paths.cache, `书灯笔记-${stamp}.txt`);
      file.write(buildExportText(exportable));
      const result = await Share.share({ url: file.uri, title: '导出笔记' });
      if (result.action === Share.sharedAction) haptics('success');
    } catch {
      showNotice('无法导出', '笔记仍保存在本机，请检查储存空间后重试。');
    } finally {
      exportInFlight.current = false;
      if (mounted.current) setExporting(false);
      try {
        if (file?.exists) file.delete();
      } catch { /* Cache cleanup does not invalidate a completed export. */ }
    }
  };

  const renderNote: SectionListRenderItem<NoteItem, NoteSection> = ({ item, index, section }) => {
    const { annotation } = item;
    const chapter = chapterText(item);
    const highlightTints: Record<string, string> = {
      yellow: '#F2DBA6',
      green: '#DEE8D3',
      blue: '#DCE6EC',
      rose: '#F3DEDA',
    };
    const tint = annotation.body?.trim()
      ? palette.lamp
      : (highlightTints[annotation.color ?? 'yellow'] ?? annotation.color ?? palette.selection);
    const last = index === section.data.length - 1;
    return (
      <Swipeable
        containerStyle={[styles.swipeContainer, index === 0 && styles.entryFirst, last && styles.entryLast]}
        overshootLeft={false}
        overshootRight={false}
        {...(annotation.body?.trim()
          ? {
              renderLeftActions: (_progress: unknown, _translation: unknown, actions: { close(): void }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="编辑笔记"
                  onPress={() => {
                    actions.close();
                    editNote(item);
                  }}
                  style={styles.editAction}
                >
                  <Text style={styles.swipeText}>编辑</Text>
                </Pressable>
              ),
            }
          : {})}
        renderRightActions={(_progress, _translation, actions) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`删除${KIND_LABEL[annotation.kind]}`}
            onPress={() => {
              actions.close();
              removeAnnotation(item);
            }}
            style={styles.deleteAction}
          >
            <Text style={styles.swipeText}>删除</Text>
          </Pressable>
        )}
      >
        <Pressable
          testID={'annotation-' + annotation.id}
          accessibilityRole="button"
          accessibilityLabel={`查看${KIND_LABEL[annotation.kind]}原文`}
          onPress={() => openOriginal(item)}
          style={styles.entry}
        >
          <View style={styles.metaRow}>
            <View style={[styles.dot, { backgroundColor: tint }]} />
            <Text style={styles.meta} numberOfLines={1}>
              {chapter}
            </Text>
            <Text style={styles.date}>{recordTime(annotation.createdAt)}</Text>
          </View>
          {annotation.quote ? (
            <Text style={styles.quote} numberOfLines={4}>
              “{annotation.quote}”
            </Text>
          ) : null}
          {annotation.body?.trim() ? (
            <View style={styles.bodyRow}>
              <Text style={styles.body} numberOfLines={3}>
                {annotation.body.trim()}
              </Text>
            </View>
          ) : null}
          {!last ? <View style={styles.separator} /> : null}
        </Pressable>
      </Swipeable>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['left', 'right']}>
      <Stack.Screen options={{ headerSearchBarOptions }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon="square.and.arrow.up"
          accessibilityLabel="导出笔记"
          disabled={exporting}
          tintColor={palette.ink2}
          onPress={() => void handleExport()}
        />
      </Stack.Toolbar>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.lamp} />
        </View>
      ) : (
        <SectionList
          ref={list}
          sections={sections}
          contentInsetAdjustmentBehavior="automatic"
          onScroll={onScroll}
          scrollEventThrottle={16}
          ListHeaderComponent={error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : undefined}
          keyExtractor={(item) => item.annotation.id}
          renderItem={renderNote}
          renderSectionHeader={({ section }) => (
            <SectionHeader
              style={styles.groupHeader}
              variant="group"
              title={section.book.title}
              count={String(section.count)}
              countSuffix=" 条笔记"
              swatch={{
                title: section.book.title,
                format: section.book.format,
                coverUri: section.book.coverUri,
              }}
              expanded={!section.collapsed}
              onPress={() => toggleGroup(section.book.id)}
            />
          )}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.content}
          ListEmptyComponent={
            <EmptyState
              title={needle ? '没有找到相关笔记' : '还没有笔记'}
              description={needle
                ? '换一个关键词，或清除搜索后再看。'
                : '阅读时选中原文，画下高亮或写下想法，之后会出现在这里。'}
              symbol="square.and.pencil"
              actionLabel={needle ? '清除搜索' : '去书架读书'}
              onAction={() => needle ? clearSearch() : router.navigate('/(tabs)')}
            />
          }
          ListFooterComponent={<View style={styles.footer} />}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        />
      )}
      <NoteSheet
        visible={editing !== null}
        title="编辑笔记"
        quote={editing?.annotation.quote ?? ''}
        body={noteBody}
        saving={saving}
        onChangeBody={setNoteBody}
        onClose={() => {
          if (!saving) setEditing(null);
        }}
        onSave={() => void saveNote()}
        onDelete={() => { if (editing) void performDelete(editing, true); }}
        notice={editing ? notice : null}
        onDismissNotice={() => setNotice(null)}
      />
      {deleting ? (
        <BookNotice
          title="删除笔记？"
          message="删除后无法恢复；原文中的高亮与笔记也会移除。"
          actions={[
            { title: '取消', style: 'cancel', onPress: () => setDeleting(null) },
            { title: '删除', style: 'destructive', onPress: () => void performDelete(deleting) },
          ]}
        />
      ) : null}
      {!editing && notice ? (
        <BookNotice title={notice.title} message={notice.message} onAcknowledge={() => setNotice(null)} />
      ) : null}
    </SafeAreaView>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: palette.paper },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    content: { paddingHorizontal: 16, paddingTop: 12, flexGrow: 1 },
    groupHeader: { marginHorizontal: 16 },
    footer: { height: 24 },
    error: { fontSize: typeScale.caption, color: palette.error, marginTop: 8, marginHorizontal: 16 },
    editAction: { width: 76, alignItems: 'center', justifyContent: 'center', backgroundColor: PlatformColor('systemGray') },
    deleteAction: {
      width: 76,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: PlatformColor('systemRed'),
    },
    swipeText: { color: '#FFFFFF', fontSize: 17 },
    swipeContainer: { overflow: 'hidden', backgroundColor: palette.surface },
    entry: {
      paddingVertical: 10,
      paddingHorizontal: 16,
      backgroundColor: palette.surface,
    },
    entryFirst: { marginTop: 3, borderTopLeftRadius: 30, borderTopRightRadius: 30 },
    entryLast: {
      marginBottom: 12,
      borderBottomLeftRadius: 30,
      borderBottomRightRadius: 30,
    },
    pressed: { opacity: 0.6 },
    quote: { marginTop: 8, fontFamily: SERIF, fontSize: 15, lineHeight: 26, color: palette.ink },
    bodyRow: { marginTop: 6, borderLeftWidth: 2, borderLeftColor: palette.line, paddingLeft: 6 },
    body: { fontSize: 13, lineHeight: 17, color: palette.ink2 },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    dot: { width: 8, height: 8, borderRadius: 4 },
    meta: { flex: 1, fontSize: 10.5, lineHeight: 13, fontWeight: '500', color: palette.ink3 },
    date: { fontSize: 10.5, lineHeight: 13, fontWeight: '500', color: palette.ink3 },
    separator: {
      position: 'absolute',
      bottom: 0,
      left: 16,
      right: 16,
      height: StyleSheet.hairlineWidth,
      backgroundColor: palette.line,
    },
  });
}
