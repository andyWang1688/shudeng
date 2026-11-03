import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SectionList,
  Share,
  StyleSheet,
  Text,
  View,
  type SectionListRenderItem,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { loadAllAnnotations, type ShelfAnnotation, type ShelfBookRecord } from '../../src/platform/library';
import { EmptyState } from '../../src/ui/components/EmptyState';
import { PageHeader } from '../../src/ui/components/PageHeader';
import { SearchField } from '../../src/ui/components/SearchField';
import { SectionHeader } from '../../src/ui/components/SectionHeader';
import { groupByKey } from '../../src/ui/components/groupBy';
import { useHaptics } from '../../src/ui/components/useHaptics';
import { recordTime } from '../../src/ui/format';
import { font, spacing, type as typeScale, usePalette, type Palette } from '../../src/ui/theme';

type NoteItem = { book: ShelfBookRecord; annotation: ShelfAnnotation };
type NoteSection = { book: ShelfBookRecord; count: number; collapsed: boolean; data: NoteItem[] };
const KIND_LABEL: Record<ShelfAnnotation['kind'], string> = { highlight: '高亮', note: '笔记', bookmark: '书签' };

function buildExportText(entries: readonly NoteItem[]): string {
  return groupByKey(entries, (item) => item.book.id)
    .map(({ items: bookEntries }) => {
      const book = bookEntries[0]!.book;
      const header = `《${book.title}》${book.author ? ` · ${book.author}` : ''}`;
      const rows = bookEntries.map(({ annotation }) => {
        const place = [
          annotation.chapter,
          annotation.page ? `第 ${annotation.page} 页` : null,
          KIND_LABEL[annotation.kind],
          recordTime(annotation.createdAt),
        ].filter((part): part is string => Boolean(part)).join(' · ');
        return [place, annotation.quote ? `“${annotation.quote}”` : null, annotation.body]
          .filter((part): part is string => Boolean(part))
          .join('\n');
      });
      return [header, ...rows].join('\n\n');
    })
    .join('\n\n---\n\n');
}

export default function NotesRoute() {
  const router = useRouter();
  const haptics = useHaptics();
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [items, setItems] = useState<readonly NoteItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useFocusEffect(useCallback(() => {
    let mounted = true;
    void loadAllAnnotations()
      .then((next) => { if (mounted) setItems(next); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []));

  const needle = query.trim().toLowerCase();
  const filtered = items
    .filter(({ annotation }) => annotation.kind !== 'bookmark')
    .filter(({ book, annotation }) => !needle
      || (`${annotation.quote} ${annotation.body ?? ''} ${book.title} ${annotation.chapter ?? ''}`).toLowerCase().includes(needle));
  const sections: NoteSection[] = groupByKey(filtered, (item) => item.book.id).map(({ items: entries }) => {
    const book = entries[0]!.book;
    return { book, count: entries.length, collapsed: collapsed[book.id] ?? false, data: collapsed[book.id] ? [] : entries };
  });

  const handleExport = async (): Promise<void> => {
    const exportable = items.filter(({ annotation }) => annotation.kind !== 'bookmark');
    if (exportable.length === 0) {
      Alert.alert('暂无可导出的笔记', '阅读时选中文字写下的高亮和笔记会出现在这里。');
      return;
    }
    if (exporting) return;
    setExporting(true);
    haptics();
    try {
      const result = await Share.share({ message: buildExportText(exportable), title: '导出笔记' });
      if (result.action === Share.sharedAction) haptics('success');
    } catch (cause) {
      Alert.alert('分享失败', cause instanceof Error ? cause.message : String(cause));
    } finally {
      setExporting(false);
    }
  };

  const renderNote: SectionListRenderItem<NoteItem, NoteSection> = ({ item, index, section }) => {
    const { book, annotation } = item;
    const chapter = annotation.chapter && !annotation.chapter.includes('页') ? annotation.chapter : book.title;
    const last = index === section.data.length - 1;
    return (
      <View style={[styles.entry, index === 0 && styles.entryFirst, last && styles.entryLast]}>
        {annotation.quote ? (
          <View style={styles.quoteBlock}>
            <Text style={styles.quote} numberOfLines={5}>“{annotation.quote}”</Text>
          </View>
        ) : null}
        {annotation.body ? <Text style={styles.body}>{annotation.body}</Text> : null}
        <View style={styles.metaRow}>
          <Text style={styles.meta} numberOfLines={1}>
            {chapter}{annotation.page ? ` · 第 ${annotation.page} 页` : ''} · {KIND_LABEL[annotation.kind]} · {recordTime(annotation.createdAt)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="回到原文"
            onPress={() => {
              const locator = annotation.locator ? JSON.stringify(annotation.locator) : undefined;
              router.push({ pathname: '/reader/[id]', params: locator ? { id: book.id, locator } : { id: book.id } });
            }}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <Text style={styles.jump}>回到原文 ↗</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <PageHeader
          title="笔记"
          action={{ symbol: 'square.and.arrow.up', label: '导出笔记', variant: 'outline', busy: exporting, onPress: () => void handleExport() }}
        />
        <SearchField value={query} onChangeText={setQuery} placeholder="搜索笔记" style={styles.search} />
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={palette.lamp} /></View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.annotation.id}
          renderItem={renderNote}
          renderSectionHeader={({ section }) => (
            <SectionHeader
              variant="group"
              title={section.book.title}
              count={String(section.count)}
              countSuffix=" 条笔记"
              swatch={{ title: section.book.title, format: section.book.format }}
              expanded={!section.collapsed}
              onPress={() => setCollapsed((current) => ({ ...current, [section.book.id]: !section.collapsed }))}
            />
          )}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.content}
          ListEmptyComponent={<EmptyState title="还没有笔记" description="阅读时选中文字即可高亮、写笔记或加书签。" />}
          ListFooterComponent={<View style={styles.footer} />}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: palette.paper },
    header: { paddingHorizontal: spacing.screen },
    search: { marginTop: 18 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    content: { paddingHorizontal: spacing.screen, paddingTop: 12 },
    footer: { height: 24 },
    entry: { paddingVertical: 16, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: palette.line, backgroundColor: palette.surface },
    entryFirst: { marginTop: 4, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
    entryLast: { marginBottom: 8, borderBottomWidth: 0, borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
    pressed: { opacity: 0.6 },
    quoteBlock: { borderLeftWidth: 2, borderLeftColor: palette.lamp, paddingLeft: 12 },
    quote: { fontFamily: font.serif, fontSize: 17, lineHeight: 30, color: palette.ink },
    body: { marginTop: 8, fontSize: typeScale.body, lineHeight: 24, color: palette.ink2 },
    metaRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    meta: { flex: 1, fontSize: typeScale.captionSmall, color: palette.ink3 },
    jump: { fontSize: typeScale.caption, color: palette.ink2 },
  });
}
