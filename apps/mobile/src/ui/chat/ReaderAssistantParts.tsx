import { createContext, useContext, useMemo, useSyncExternalStore, type PropsWithChildren } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useAuiState, type ThreadMessage } from '@assistant-ui/react-native';
import { useRouter } from 'expo-router';
import { BookOpenIcon, ChevronDownIcon, ChevronRightIcon, MoreHorizontalIcon, QuoteIcon, RefreshCwIcon, XIcon } from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';
import { Image } from 'expo-image';
import { useCSSVariable } from 'uniwind';
import { groupedIconButtonHitSlop, iconButtonClassName } from '@/components/assistant-ui/elements/icon-button';
import type { CitationTarget, QuestionPresentation } from '../reader-question/session';
import { readerLocatorFromLegacy, storedLocatorFromUnknown } from '../../platform/library/pure';
import { citationTitle, locatorForCitation } from './format';
import { questionMaterials } from './materialsPresentation';
import { contextRingSource, contextUsagePresentation } from './contextPresentation';
import { AssistantWebSources } from './AssistantWebSources';
import type { useBookChat } from './useBookChat';
import type { useChatListScroll } from './useChatListScroll';

type ReaderAssistantContextValue = {
  chat: ReturnType<typeof useBookChat>; presentation: QuestionPresentation;
  scroll: ReturnType<typeof useChatListScroll<ThreadMessage>>; onOpenSettings: () => void;
  contextExpanded: boolean; toggleContext: () => void;
};
export const ReaderAssistantContext = createContext<ReaderAssistantContextValue | null>(null);
const useReaderAssistant = () => {
  const context = useContext(ReaderAssistantContext);
  if (!context) throw Error('Reader assistant additions require a book conversation');
  return context;
};

/** Adds book navigation around the official row without replacing its layout. */
export function ReaderMessageWrapper({ children }: PropsWithChildren) {
  const id = useAuiState(s => s.message.id);
  const { scroll } = useReaderAssistant();
  return <View collapsable={false} onLayout={scroll.restore}
    ref={node => { if (node) scroll.rows.current.set(id, node); else scroll.rows.current.delete(id); }}>
    {children}
  </View>;
}

export function ReaderUserSelection() {
  const id = useAuiState(s => s.message.id);
  const { chat, presentation } = useReaderAssistant();
  const view = useSyncExternalStore(presentation.subscribe, presentation.getSnapshot, presentation.getSnapshot);
  const turn = chat.turns.find(item => item.id === id);
  if (!turn || !(turn.selectionAttached ?? Boolean(turn.selectionQuote))) return null;
  const expanded = view.expandedSelection.includes(id);
  return <View className="mb-2 gap-2">
    <Pressable accessibilityRole="button" accessibilityLabel="展开或收起提问选文" aria-expanded={expanded}
      testID={`question-selection-toggle-${id}`} onPress={() => presentation.toggle('expandedSelection', id)}
      className="min-h-11 flex-row items-center gap-2 py-1" hitSlop={groupedIconButtonHitSlop}>
      <Icon as={QuoteIcon} className="text-muted-foreground size-3.5" />
      <Text className="text-muted-foreground flex-1 text-xs" numberOfLines={1}>提问选文 · {chat.title}</Text>
      <Icon as={expanded ? ChevronDownIcon : ChevronRightIcon} className="text-muted-foreground size-3.5" />
    </Pressable>
    {expanded ? <Text selectable className="text-muted-foreground border-border border-l-2 pl-3 text-sm leading-6">{turn.selectionQuote}</Text> : null}
  </View>;
}

export function ReaderComposerSelection() {
  const { chat, presentation } = useReaderAssistant();
  if (!chat.selectionPending || !presentation.selectionQuote) return null;
  return <View className="bg-muted mx-1 gap-1 rounded-xl px-3 py-2">
    <Text className="text-muted-foreground text-xs">提问选文</Text>
    <Text className="text-foreground text-sm leading-5" numberOfLines={3}>{presentation.selectionQuote}</Text>
  </View>;
}

function ReaderConfigurationNotice() {
  const { chat, onOpenSettings } = useReaderAssistant();
  if (!chat.configurationNotice) return null;
  return <View testID="question-configuration-notice" className="mx-1 flex-row items-center gap-1 pl-2" accessibilityLiveRegion="polite">
    <Text className="text-muted-foreground min-w-0 flex-1 text-xs leading-5">{chat.configurationNotice}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="设置 AI 服务" onPress={onOpenSettings}
      className="active:bg-muted min-h-11 justify-center rounded-lg px-2">
      <Text className="text-link text-xs font-medium">去设置</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="收起 AI 服务提示"
      onPress={chat.dismissConfigurationNotice} className={iconButtonClassName}>
      <Icon as={XIcon} className="text-muted-foreground size-3.5" />
    </Pressable>
  </View>;
}

/** Inline details share the same footer/context as the current selection and draft. */
export function ReaderComposerContext() {
  const { chat, presentation, contextExpanded } = useReaderAssistant();
  const hasSelection = chat.selectionPending && Boolean(presentation.selectionQuote);
  const usage = contextUsagePresentation(chat.contextEstimate);
  if (!chat.configurationNotice && !hasSelection && !contextExpanded) return null;
  return <View className="gap-1">
    <ReaderConfigurationNotice />
    <ReaderComposerSelection />
    {contextExpanded ? <View testID="question-context-details" className="bg-muted/50 mx-1 gap-1 rounded-xl px-3 py-2">
      <Text testID="question-context-percent" className="text-muted-foreground text-xs tabular-nums">
        {usage.ratio === undefined ? '上下文' : '上下文 · 约 ' + usage.percent + ' 已用'}
      </Text>
      <Text testID="question-context-summary" className="text-foreground text-xs leading-5 tabular-nums">{usage.tokenAmount}</Text>
    </View> : null}
  </View>;
}

/** A compact ring toggles inline details; it never opens a menu or modal. */
export function ReaderComposerTools() {
  const { chat, contextExpanded, toggleContext } = useReaderAssistant();
  const usage = contextUsagePresentation(chat.contextEstimate);
  const [border, primary, destructive] = useCSSVariable(['--color-border', '--color-primary', '--color-destructive']);
  const track = typeof border === 'string' ? border : '#e5e0d6';
  const tint = usage.ratio !== undefined && usage.ratio >= 0.8 ? destructive : primary;
  const progress = typeof tint === 'string' ? tint : '#c96442';
  const source = useMemo(() => ({ uri: contextRingSource(usage.ratio, track, progress) }), [usage.ratio, track, progress]);
  return <Pressable testID="question-context-usage" accessibilityRole="button" accessibilityLabel="上下文用量"
    accessibilityValue={{ text: usage.ratio !== undefined ? usage.percent + '，本地估算' : '占比尚未知' }}
    accessibilityState={{ expanded: contextExpanded }} accessibilityHint="展开或收起输入框内的容量明细"
    onPress={toggleContext} className={iconButtonClassName}>
    <Image source={source} style={{ width: 20, height: 20 }} transition={0} accessible={false}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
  </Pressable>;
}

/** Sources are the book-specific content appended to the official answer. */
export function ReaderAssistantFooter() {
  const id = useAuiState(s => s.message.id);
  const { chat, presentation, scroll } = useReaderAssistant();
  const router = useRouter();
  const turn = chat.turns.find(item => item.id === id);
  if (!turn) return null;
  const sourceAvailable = Boolean(chat.availability?.book && chat.availability.book.removedAt === null);
  const openCitation = (index: number) => {
    const citation = turn.citations[index];
    if (!citation) return;
    if (!sourceAvailable) { Alert.alert('保存的原文片段', citation.quote + '\n\n重新导入原书后可回到书中核查。'); return; }
    const locator = locatorForCitation(citation);
    if (!locator) { Alert.alert('无法定位原文', citation.quote); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(locator); } catch { parsed = { type: 'epub', cfi: locator }; }
    const target = storedLocatorFromUnknown(parsed) ?? readerLocatorFromLegacy(locator, chat.format === 'pdf' ? 'PDF' : 'EPUB');
    if (!target) { Alert.alert('无法定位原文', citation.quote); return; }
    presentation.update({ referenceFocus: `${id}:${citation.id}`, restoreReferenceFocus: false }, false);
    scroll.openCitation({ locator: target, quote: citation.quote, ordinal: index + 1, id: citation.id } satisfies CitationTarget);
  };
  const recoverable = turn.status === 'error' || turn.status === 'cancelled' || turn.status === 'interrupted';
  const materials = questionMaterials(turn);
  return <View className="gap-2">
    {turn.warnings.length ? <Text className="text-muted-foreground mt-2 text-xs leading-5">{turn.warnings.join('\n')}</Text> : null}
    {turn.citations.length ? <View className="mt-2 gap-1">
      <Text className="text-muted-foreground mb-1 text-xs font-medium">书内依据</Text>
      {turn.citations.map((citation, index) => <Pressable key={citation.id}
        ref={node => scroll.registerCitation(`${id}:${citation.id}`, node)}
        accessibilityRole="button" accessibilityLabel={`查看原文：${citation.chapter ?? '原文'}`}
        onLongPress={() => Alert.alert('保存的原文片段', citation.quote)} onPress={() => openCitation(index)}
        className="border-border active:bg-muted min-h-11 flex-row items-center gap-2 rounded-xl border px-3 py-2">
        <Icon as={BookOpenIcon} className="text-muted-foreground size-3.5" />
        <Text className="text-foreground flex-1 text-xs leading-5">{citationTitle(citation, index, chat.title, chat.format)}</Text>
      </Pressable>)}
    </View> : null}
    <AssistantWebSources turn={turn} />
    {turn.saveError ? <Text className="text-destructive mt-2 text-sm leading-5">对话未保存：{turn.saveError}</Text> : null}
    {turn.status === 'cancelled' || turn.status === 'interrupted' ? <Text className="text-muted-foreground mt-2 text-xs leading-5">
      {turn.status === 'cancelled' ? '已停止，回答可能不完整。' : turn.error || '上次回答已中断。'}
    </Text> : null}
    {turn.saveError || recoverable ? <Pressable accessibilityRole="button" accessibilityLabel={turn.saveError ? '重试保存' : '重试回答'}
      disabled={chat.running} testID={`question-retry-${id}`} onPress={() => chat.retry(turn)}
      className="active:bg-muted min-h-11 flex-row items-center gap-2 self-start rounded-xl px-2 disabled:opacity-50">
      <Icon as={RefreshCwIcon} className="text-muted-foreground size-3.5" />
      <Text className="text-muted-foreground text-sm">{turn.saveError ? '重试保存' : '重试回答'}</Text>
    </Pressable> : null}
    {turn.status !== 'streaming' && materials?.values.length ? <Pressable accessibilityRole="button" accessibilityLabel="查看本次实际发送材料"
      testID={`question-more-${id}`} className={iconButtonClassName} hitSlop={groupedIconButtonHitSlop}
      onPress={() => router.push({ pathname: '/book-chat/materials', params: { conversationId: presentation.conversationId, turnId: id, ...presentation.appearanceParams() } })}>
      <Icon as={MoreHorizontalIcon} className="text-muted-foreground size-4" />
    </Pressable> : null}
  </View>;
}
