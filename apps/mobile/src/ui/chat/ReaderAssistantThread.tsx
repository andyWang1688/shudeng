import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { AssistantRuntimeProvider, MessageNotSentError, useExternalStoreRuntime, type ThreadMessage } from '@assistant-ui/react-native';
import { Thread, ThreadComposer, type ThreadComponents } from '@/components/assistant-ui/elements/thread.aui';
import type { CitationTarget, QuestionPresentation } from '../reader-question/session';
import type { Palette } from '../theme';
import type { useBookChat } from './useBookChat';
import type { ChatTurn } from './types';
import { bookTurnToAssistantMessage, submittedQuestion } from './assistantRuntimeAdapter';
import { useChatListScroll } from './useChatListScroll';
import { AssistantSheetLayoutProvider, AssistantSheetThreadFrame, renderSheetScrollComponent, SheetComposerInput, SheetWelcome } from './AssistantSheetAdapter';
import { ReaderAssistantContext, ReaderAssistantFooter, ReaderComposerContext, ReaderComposerTools, ReaderMessageWrapper, ReaderUserSelection } from './ReaderAssistantParts';

const bookAdditions: ThreadComponents = {
  MessageWrapper: ReaderMessageWrapper, UserHeader: ReaderUserSelection,
  AssistantFooter: ReaderAssistantFooter, ComposerBefore: ReaderComposerContext, ComposerTools: ReaderComposerTools,
  ComposerInput: SheetComposerInput,
  Welcome: SheetWelcome,
};
// Context consumers inside this stable element still update as the conversation changes.
const bookComposer = <ThreadComposer components={bookAdditions} bottomInset={0} />;

export type ReaderAssistantContainer = { readonly content: ReactNode; readonly composer: ReactNode };

/** Official native registry Thread, with book-only sources and selection slots. */
export function ReaderAssistantThread({ chat, presentation, onOpenSettings, onOpenCitation, renderContainer }: {
  readonly chat: ReturnType<typeof useBookChat>; readonly palette: Palette; readonly presentation: QuestionPresentation;
  readonly onOpenSettings: () => void; readonly onOpenCitation: (target: CitationTarget) => void;
  readonly renderContainer: (parts: ReaderAssistantContainer) => ReactNode;
}) {
  const [contextExpanded, setContextExpanded] = useState(false);
  const toggleContext = useCallback(() => setContextExpanded(expanded => !expanded), []);
  const runtime = useExternalStoreRuntime<ChatTurn>({
    messages: chat.turns, isRunning: chat.running, isLoading: chat.loading,
    isDisabled: !chat.availability?.book, isSendDisabled: !chat.canSend,
    convertMessage: bookTurnToAssistantMessage,
    onNew: async message => {
      const text = submittedQuestion(message);
      if (text && !await chat.send(text)) throw new MessageNotSentError('The question was not accepted.');
    },
    onCancel: async () => { chat.cancel(); },
  });
  const composer = runtime.thread.composer;
  useLayoutEffect(() => {
    if (composer.getState().text !== chat.question) composer.setText(chat.question);
  }, [chat.question, composer]);
  useEffect(() => composer.subscribe(() => {
    const text = composer.getState().text;
    if (text !== presentation.getSnapshot().draft) chat.setQuestion(text);
  }), [chat.setQuestion, composer, presentation]);
  const scroll = useChatListScroll<ThreadMessage>(presentation, onOpenCitation);
  useLayoutEffect(() => { scroll.update(runtime.thread.getState().messages, true); }, [chat.turns, runtime, scroll.update]);
  useEffect(() => runtime.thread.subscribe(() => { scroll.update(runtime.thread.getState().messages, true); }), [runtime, scroll.update]);
  const restoredScroll = useRef(Boolean(presentation.getSnapshot().scroll.anchorId || presentation.getSnapshot().scroll.offset > 0 || presentation.getSnapshot().restoreReferenceFocus));
  const content = <>
      {chat.indexMissing || chat.loadError ? <View accessibilityRole="alert" className="bg-destructive/10 mx-4 my-2 rounded-lg p-3">
        <Text className="text-destructive text-sm leading-5">{chat.loadError || chat.indexDetail}</Text>
      </View> : null}
      <AssistantSheetThreadFrame>
      <Thread components={bookAdditions} keyboardAvoidanceEnabled={false} composerExternal bottomInset={0}
        hostListRef={scroll.list} hostViewportRef={scroll.viewport} onViewportLayout={scroll.restore}
        listProps={{ testID: 'question-scroll', renderScrollComponent: renderSheetScrollComponent,
          scrollToBottomOnInitialize: !restoredScroll.current, scrollToBottomOnThreadSwitch: false,
          onScroll: event => scroll.onScroll(event.nativeEvent.contentOffset.y),
          onScrollBeginDrag: scroll.beginDrag, onScrollEndDrag: scroll.endDrag, onMomentumScrollEnd: scroll.endDrag,
          onViewableItemsChanged: scroll.onViewableItemsChanged, onContentSizeChange: scroll.onContentSizeChange,
          onScrollToIndexFailed: info => scroll.list.current?.scrollToOffset({ offset: Math.max(0, info.averageItemLength * info.index), animated: false }),
        }} />
      </AssistantSheetThreadFrame>
  </>;
  return <AssistantRuntimeProvider runtime={runtime}>
    <ReaderAssistantContext.Provider value={{ chat, presentation, scroll, onOpenSettings, contextExpanded, toggleContext }}>
      <AssistantSheetLayoutProvider>{renderContainer({ content, composer: bookComposer })}</AssistantSheetLayoutProvider>
    </ReaderAssistantContext.Provider>
  </AssistantRuntimeProvider>;
}
