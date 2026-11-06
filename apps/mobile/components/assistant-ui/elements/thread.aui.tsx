import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/elements/attachment.aui";
import {
  groupedIconButtonHitSlop,
  iconButtonClassName,
} from "@/components/assistant-ui/elements/icon-button";
import { File } from "@/components/assistant-ui/elements/file";
import { Image } from "@/components/assistant-ui/elements/image";
import { MarkdownText } from "@/components/assistant-ui/elements/markdown-text";
import {
  Reasoning,
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from "@/components/assistant-ui/elements/reasoning.aui";
import {
  ShimmerLabel,
  useAnnounce,
  useHydrated,
  webLiveRegion,
} from "@/components/assistant-ui/elements/surfaces";
import { ToolFallback } from "@/components/assistant-ui/elements/tool-fallback";
import { TypingIndicator } from "@/components/assistant-ui/elements/typing-indicator";
import { readingFontFamily } from "@/components/assistant-ui/elements/typography";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  ActionBarPrimitive,
  AuiIf,
  type AssistantState,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadPrimitive,
  type TextMessagePartComponent,
  type ThreadMessage,
  type ToolCallMessagePartComponent,
  type GroupByContext,
  groupPartByType,
  useAui,
  useAuiState,
} from "@assistant-ui/react-native";
import * as Clipboard from "expo-clipboard";
import {
  ArrowUpIcon,
  AudioLinesIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  PencilIcon,
  MicIcon,
  PhoneIcon,
  RefreshCwIcon,
  SparklesIcon,
} from "lucide-react-native";
import {
  type ComponentRef,
  type ComponentType,
  createContext,
  type FC,
  type PropsWithChildren,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AccessibilityInfo,
  type FlatList,
  type FlatListProps,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Text,
  View,
  type ViewProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  (!s.thread.isLoading || s.threads.isLoading);

const isHistoryLoadingView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  s.thread.isLoading &&
  !s.thread.isDisabled &&
  !s.threads.isLoading;

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart;

const reasoningDuration = (timing: ThreadGroupPart["timing"]) =>
  timing?.completedAt === undefined
    ? undefined
    : Math.round((timing.completedAt - timing.startedAt) / 1000);

export type ThreadComponents = {
  /** Host-only business additions; the official message and composer stay intact. */
  MessageWrapper?: ComponentType<PropsWithChildren> | undefined;
  UserHeader?: ComponentType | undefined;
  AssistantFooter?: ComponentType | undefined;
  ComposerBefore?: ComponentType | undefined;
  ComposerTools?: ComponentType | undefined;
  ComposerFooter?: ComponentType | undefined;
  AssistantMessage?: ComponentType | undefined;
  Welcome?: ComponentType | undefined;
  ToolFallback?: ToolCallMessagePartComponent | undefined;
  /** Renders tool calls that carry a nested conversation and have no registered UI; without it they render like any other tool call. */
  TaskGroup?: ComponentType<{ group: ThreadGroupPart }> | undefined;
  /** Replaces the text input of both the new message composer and the edit composer; read `composer.type` to tell them apart. */
  ComposerInput?: ComponentType | undefined;
  /** Overlays the message list, which keeps a gutter free along its left edge for it; it reads the list through `useThreadViewport`. Mounting or unmounting it remounts the list. */
  Rail?: ComponentType | undefined;
};

export type ThreadHistory = {
  /** Whether messages older than the loaded window exist. */
  readonly hasMore: boolean;
  /** Whether a page of older messages is on its way. */
  readonly isLoadingMore: boolean;
  /** Loads the next page of older messages above the window. */
  readonly loadMore: () => void;
};

export type ThreadProps = {
  components?: ThreadComponents | undefined;
  /** A windowed thread: the list asks for older messages when it reaches its start and shows the loading edge above them. Omit it to page through the runtime's `thread.hasEarlier` and `loadEarlier()`. */
  history?: ThreadHistory | undefined;
  /** A native sheet can already own keyboard avoidance and safe-area padding. */
  keyboardAvoidanceEnabled?: boolean;
  /** Render ThreadComposer in a host-managed footer instead of the content layout. */
  composerExternal?: boolean;
  bottomInset?: number;
  hostListRef?: RefObject<FlatList<ThreadMessage> | null>;
  hostViewportRef?: RefObject<ComponentRef<typeof View> | null>;
  onViewportLayout?: (() => void) | undefined;
  listProps?: Omit<ThreadPrimitive.MessagesFlatListProps, "children" | "components">;
};

export type ThreadViewportSnapshot = {
  /** The ids of the messages on screen, in list order. */
  readonly visibleMessageIds: readonly string[];
  /**
   * Zero until the list is within one screenful of its end, then the share of
   * that stretch scrolled, so a reading line placed at this fraction of the
   * viewport can still reach the final turns.
   */
  readonly descent: number;
  /** The message list's height. */
  readonly height: number;
  /** The message list's offset from the top of the thread viewport, which grows while the history edge shows. */
  readonly top: number;
};

export type ThreadViewport = ThreadViewportSnapshot & {
  /** Scrolls the message list until the message starts at the top of the viewport. */
  readonly scrollToMessage: (id: string) => void;
};

type ThreadViewportStore = {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ThreadViewportSnapshot;
  readonly scrollToMessage: (id: string) => void;
};

const EMPTY_COMPONENTS: ThreadComponents = {};
const EMPTY_IDS: readonly string[] = [];
const IDLE_VIEWPORT: ThreadViewportSnapshot = {
  visibleMessageIds: EMPTY_IDS,
  descent: 0,
  height: 0,
  top: 0,
};
const MESSAGE_VIEWABILITY = {
  minimumViewTime: 0,
  viewAreaCoveragePercentThreshold: 0,
};
type ViewabilityInfo = Parameters<
  NonNullable<FlatListProps<ThreadMessage>["onViewableItemsChanged"]>
>[0];
const SCROLL_RETRY_DELAY = 100;

const ThreadComponentsContext =
  createContext<ThreadComponents>(EMPTY_COMPONENTS);

const ThreadViewportContext = createContext<ThreadViewportStore>({
  subscribe: () => () => {},
  getSnapshot: () => IDLE_VIEWPORT,
  scrollToMessage: () => {},
});

const createViewportStore = () => {
  const listeners = new Set<() => void>();
  let snapshot = IDLE_VIEWPORT;

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    publish: (next: Partial<ThreadViewportSnapshot>) => {
      snapshot = { ...snapshot, ...next };
      for (const listener of listeners) listener();
    },
  };
};

/** What the thread's message list shows right now, for an element that overlays it. */
export const useThreadViewport = (): ThreadViewport => {
  const { subscribe, getSnapshot, scrollToMessage } = useContext(
    ThreadViewportContext,
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useMemo(
    () => ({ ...snapshot, scrollToMessage }),
    [snapshot, scrollToMessage],
  );
};

const copyToClipboard = async (text: string) => {
  await Clipboard.setStringAsync(text);
};

export const Thread: FC<ThreadProps> = ({
  components = EMPTY_COMPONENTS,
  history,
  keyboardAvoidanceEnabled = true,
  composerExternal = false,
  bottomInset,
  hostListRef,
  hostViewportRef,
  onViewportLayout,
  listProps,
}) => {
  const aui = useAui();
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const insets = useSafeAreaInsets();
  const viewportRef = useRef<ComponentRef<typeof View>>(null);
  const [viewportTop, setViewportTop] = useState(0);
  const [store] = useState(createViewportStore);
  const listRef = useRef<FlatList<ThreadMessage>>(null);
  const metricsRef = useRef({
    contentHeight: 0,
    viewportHeight: 0,
    scrollY: 0,
  });
  const jumpRef = useRef<
    | {
        id: string;
        retried: boolean;
        timer: ReturnType<typeof setTimeout> | undefined;
      }
    | undefined
  >(undefined);
  const { Rail } = components;

  useEffect(() => () => clearTimeout(jumpRef.current?.timer), []);

  const jumpTo = useCallback(
    (id: string) => {
      const index = aui.thread
        .getState()
        .messages.findIndex((message) => message.id === id);
      if (index === -1) return;
      listRef.current?.scrollToIndex({
        index,
        animated: true,
        viewPosition: 0,
      });
    },
    [aui],
  );

  const scrollToMessage = useCallback(
    (id: string) => {
      clearTimeout(jumpRef.current?.timer);
      jumpRef.current = { id, retried: false, timer: undefined };
      jumpTo(id);
    },
    [jumpTo],
  );

  // The list cannot scroll to a row it has not laid out yet: an instant jump
  // to the estimated offset gets it rendering near the row, and one retry,
  // resolved by id again so a changed list cannot send it to another turn,
  // lands on the row itself.
  const onScrollToIndexFailed = useCallback(
    ({
      index,
      averageItemLength,
    }: {
      index: number;
      averageItemLength: number;
    }) => {
      listRef.current?.scrollToOffset({
        offset: index * averageItemLength,
        animated: false,
      });
      const jump = jumpRef.current;
      if (!jump || jump.retried) return;
      jump.retried = true;
      jump.timer = setTimeout(() => jumpTo(jump.id), SCROLL_RETRY_DELAY);
    },
    [jumpTo],
  );

  const publishDescent = useCallback(() => {
    const { contentHeight, viewportHeight, scrollY } = metricsRef.current;
    const remaining = contentHeight - viewportHeight - scrollY;
    const descent =
      viewportHeight > 0
        ? Math.round(
            Math.min(
              1,
              Math.max(0, (viewportHeight - remaining) / viewportHeight),
            ) * 100,
          ) / 100
        : 0;
    if (descent !== store.getSnapshot().descent) store.publish({ descent });
  }, [store]);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: ViewabilityInfo) => {
      store.publish({
        visibleMessageIds: viewableItems.map((token) => token.item.id),
      });
    },
    [store],
  );

  const onListScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      metricsRef.current = {
        contentHeight: contentSize.height,
        viewportHeight: layoutMeasurement.height,
        scrollY: contentOffset.y,
      };
      publishDescent();
    },
    [publishDescent],
  );

  const onListContentSizeChange = useCallback(
    (_width: number, height: number) => {
      metricsRef.current.contentHeight = height;
      publishDescent();
    },
    [publishDescent],
  );

  const onListLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { height, y } = event.nativeEvent.layout;
      metricsRef.current.viewportHeight = height;
      const snapshot = store.getSnapshot();
      if (height !== snapshot.height || y !== snapshot.top) {
        store.publish({ height, top: y });
      }
      publishDescent();
    },
    [publishDescent, store],
  );

  const viewport = useMemo(
    () => ({
      subscribe: store.subscribe,
      getSnapshot: store.getSnapshot,
      scrollToMessage,
    }),
    [store, scrollToMessage],
  );

  useEffect(() => {
    if (isRunning) {
      AccessibilityInfo.announceForAccessibility("助手正在回答");
    }
  }, [isRunning]);

  // KeyboardAvoidingView measures its frame against its parent, so a navigation
  // header above the thread would leave the composer covered by the header's
  // height; the viewport's window position supplies that offset, minus the
  // bottom inset the footer already pads.
  const measureViewport = () => {
    viewportRef.current?.measureInWindow((_x, y) => setViewportTop(y));
    onViewportLayout?.();
  };

  return (
    <ThreadComponentsContext.Provider value={components}>
      <ThreadViewportContext.Provider value={viewport}>
        <ThreadPrimitive.Root className="aui-root aui-thread-root bg-background flex-1">
          <KeyboardAvoidingView
            className="flex-1"
            enabled={keyboardAvoidanceEnabled}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={viewportTop - insets.bottom}
          >
            <View
              ref={node => { viewportRef.current = node; if (hostViewportRef) hostViewportRef.current = node; }}
              onLayout={measureViewport}
              className="aui-thread-viewport mx-auto w-full max-w-[44rem] flex-1"
            >
              <View className="min-h-0 flex-1">
                <AuiIf condition={isNewChatView}>
                  <WelcomeSlot />
                </AuiIf>
                <AuiIf condition={isHistoryLoadingView}>
                  <ThreadHistorySkeleton />
                </AuiIf>
                <AuiIf condition={(s) => s.thread.messages.length > 0}>
                  <AuiIf
                    condition={(s) =>
                      history ? history.isLoadingMore : s.thread.isLoadingEarlier
                    }
                  >
                    <HistoryEdge />
                  </AuiIf>
                  <ThreadPrimitive.MessagesFlatList
                    // Viewability props cannot change once a FlatList is mounted.
                    key={Rail ? "tracked" : "plain"}
                    ref={node => { listRef.current = node; if (hostListRef) hostListRef.current = node; }}
                    className="aui-message-group flex-1"
                    contentContainerClassName={cn(
                      "gap-6 px-4 pt-4 pb-6",
                      Rail && "pl-10",
                    )}
                    showsVerticalScrollIndicator={false}
                    keyboardDismissMode="interactive"
                    keyboardShouldPersistTaps="handled"
                    {...(Rail
                      ? {
                          onContentSizeChange: onListContentSizeChange,
                          onLayout: onListLayout,
                          onScroll: onListScroll,
                          onScrollToIndexFailed,
                          onViewableItemsChanged,
                          viewabilityConfig: MESSAGE_VIEWABILITY,
                        }
                      : {})}
                    {...(history
                      ? {
                          history,
                        }
                      : {})}
                    {...listProps}
                  >
                    {() => <ThreadMessage />}
                  </ThreadPrimitive.MessagesFlatList>
                </AuiIf>
              </View>
              {!composerExternal && <ThreadComposer components={components} {...(bottomInset !== undefined ? { bottomInset } : {})} />}
              {Rail && (
                <View
                  pointerEvents="box-none"
                  className="aui-thread-rail absolute inset-0"
                >
                  <Rail />
                </View>
              )}
            </View>
          </KeyboardAvoidingView>
        </ThreadPrimitive.Root>
      </ThreadViewportContext.Provider>
    </ThreadComponentsContext.Provider>
  );
};

/** Shares the native composer and business slots with an optional host footer. */
export const ThreadComposer: FC<{ components?: ThreadComponents; bottomInset?: number }> = ({
  components = EMPTY_COMPONENTS,
  bottomInset,
}) => {
  const insets = useSafeAreaInsets();
  const { ComposerFooter } = components;
  return <ThreadComponentsContext.Provider value={components}>
    <View pointerEvents="box-none" className="aui-thread-viewport-footer gap-2 px-4 pt-2"
      style={{ paddingBottom: (bottomInset ?? insets.bottom) + 8 }}>
      <Composer />
      {ComposerFooter && <ComposerFooter />}
      <AuiIf condition={(s) => isNewChatView(s) && s.composer.isEmpty}>
        <ThreadSuggestions />
      </AuiIf>
    </View>
  </ThreadComponentsContext.Provider>;
};

const WelcomeSlot: FC = () => {
  const { Welcome = ThreadWelcome } = useContext(ThreadComponentsContext);
  return <Welcome />;
};

const ThreadMessage: FC = () => {
  const { MessageWrapper } = useContext(ThreadComponentsContext);
  return MessageWrapper ? <MessageWrapper><ThreadMessageContent /></MessageWrapper> : <ThreadMessageContent />;
};

const ThreadMessageContent: FC = () => {
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);
  const isSpoken = useAuiState((s) => s.message.metadata.modality === "voice");
  const { AssistantMessage: CustomAssistantMessage } = useContext(
    ThreadComponentsContext,
  );

  if (isEditing) return <EditComposer />;
  if (isSpoken) return <SpokenMessage />;
  if (role === "user") return <UserMessage />;
  const Assistant = CustomAssistantMessage ?? AssistantMessage;
  return <Assistant />;
};

type VoiceRunPosition = "single" | "start" | "middle" | "end";

const useVoiceRunPosition = (): VoiceRunPosition =>
  useAuiState((s) => {
    const before =
      s.thread.messages[s.message.index - 1]?.metadata.modality === "voice";
    const after =
      s.thread.messages[s.message.index + 1]?.metadata.modality === "voice";
    if (before) return after ? "middle" : "end";
    return after ? "start" : "single";
  });

const SpokenText: TextMessagePartComponent = ({ text }) => (
  <Text
    className="aui-spoken-message-text text-foreground text-sm leading-relaxed"
    selectable
  >
    {text}
  </Text>
);

const SpokenMessage: FC = () => {
  const role = useAuiState((s) => s.message.role);
  const position = useVoiceRunPosition();
  const isSpeaking = useAuiState(
    (s) =>
      s.message.role === "assistant" && s.message.status?.type === "running",
  );
  const opensExchange = position === "start" || position === "single";

  return (
    <MessagePrimitive.Root
      className={cn(
        "aui-spoken-message bg-muted/40 mx-2 px-3 py-1.5",
        `aui-spoken-message-${position}`,
        position === "single" && "rounded-xl py-2",
        position === "start" && "rounded-t-xl pt-2",
        position === "middle" && "-mt-6",
        position === "end" && "-mt-6 rounded-b-xl pb-2",
      )}
    >
      {opensExchange && (
        <View className="aui-spoken-exchange-header mb-1.5 flex-row items-center gap-1.5">
          <Icon as={PhoneIcon} className="text-muted-foreground size-3" />
          <Text className="text-muted-foreground text-xs">
            语音对话
          </Text>
        </View>
      )}
      <View className="aui-spoken-message-content flex-row items-start gap-2">
        <View
          className="mt-1 shrink-0"
          accessible
          accessibilityLabel={role === "user" ? "你说" : "助手说"}
        >
          <Icon
            as={role === "user" ? MicIcon : AudioLinesIcon}
            className="text-muted-foreground size-3.5"
          />
        </View>
        <View className="min-w-0 flex-1 flex-row items-center">
          <View className="min-w-0 flex-1">
            <MessagePrimitive.Parts components={{ Text: SpokenText }} />
            {isSpeaking && (
              <TypingIndicator
                variant="bare"
                announce={false}
                className="aui-spoken-message-indicator ms-1"
                accessibilityLabel="助手正在说话"
              />
            )}
          </View>
          <SpokenActionBar />
        </View>
      </View>
    </MessagePrimitive.Root>
  );
};

const SpokenActionBar: FC = () => (
  <AuiIf
    condition={(s) =>
      !(s.message.role === "assistant" && s.message.status?.type === "running")
    }
  >
    <View className="aui-spoken-action-bar flex-row gap-1">
      <ActionBarPrimitive.Copy
        copyToClipboard={copyToClipboard}
        className={iconButtonClassName}
        hitSlop={groupedIconButtonHitSlop}
        accessibilityLabel="复制"
      >
        {({ isCopied }) => (
          <Icon
            as={isCopied ? CheckIcon : CopyIcon}
            className="text-muted-foreground size-3.5"
          />
        )}
      </ActionBarPrimitive.Copy>
    </View>
  </AuiIf>
);

// The edge sits above the list rather than inside it as a header: the list
// keeps its first visible row anchored, so a header inserted above that row
// would land outside the viewport instead of pushing into it.
const HistoryEdge: FC = () => {
  useAnnounce("正在加载更早的消息");

  return (
    <View
      className="aui-thread-history-edge items-center pb-4"
      accessibilityLiveRegion={webLiveRegion}
    >
      <ShimmerLabel className="text-muted-foreground text-[13px]">
        正在加载更早的消息
      </ShimmerLabel>
    </View>
  );
};

const ThreadHistorySkeleton: FC = () => (
  <View
    className="aui-thread-history-skeleton flex-1 gap-6 px-4 pt-4"
    accessible
    accessibilityRole="progressbar"
    accessibilityLabel="正在加载对话"
  >
    <View className="bg-muted ml-auto h-9 w-2/5 rounded-xl" />
    <View className="gap-2">
      <View className="bg-muted h-4 w-11/12 rounded" />
      <View className="bg-muted h-4 w-4/5 rounded" />
      <View className="bg-muted h-4 w-3/5 rounded" />
    </View>
    <View className="bg-muted ml-auto h-9 w-1/3 rounded-xl" />
    <View className="gap-2">
      <View className="bg-muted h-4 w-10/12 rounded" />
      <View className="bg-muted h-4 w-2/3 rounded" />
    </View>
  </View>
);

export const ThreadWelcome: FC = () => (
  <View className="aui-thread-welcome-root min-h-0 flex-1 items-center justify-center gap-3 px-6">
    <Icon as={SparklesIcon} className="text-primary size-8" />
    <Text className="aui-thread-welcome-message text-foreground text-center text-2xl leading-9"
      style={{ fontFamily: readingFontFamily }}>
      想聊聊书里的什么？
    </Text>
    <Text className="text-muted-foreground text-center text-sm leading-6">选一段文字，或直接提问</Text>
  </View>
);

const ThreadSuggestions: FC = () => (
  <View className="aui-thread-welcome-suggestions w-full flex-row flex-wrap items-center justify-center gap-2">
    <ThreadPrimitive.Suggestions>
      {() => <ThreadSuggestionItem />}
    </ThreadPrimitive.Suggestions>
  </View>
);

const ThreadSuggestionItem: FC = () => (
  <SuggestionPrimitive.Trigger
    send
    className="aui-thread-welcome-suggestion border-border active:bg-muted min-h-11 flex-row items-center gap-1.5 rounded-full border px-3.5 py-2"
  >
    <SuggestionPrimitive.Title className="aui-thread-welcome-suggestion-text-1 text-foreground text-sm" />
    <AuiIf condition={(s) => !!s.suggestion.label}>
      <SuggestionPrimitive.Description className="aui-thread-welcome-suggestion-text-2 text-muted-foreground text-sm" />
    </AuiIf>
  </SuggestionPrimitive.Trigger>
);

// The placeholder color is a class to prop mapping that reads the CSSOM, so it applies from the first render after hydration.
const DefaultComposerInput: FC = () => {
  const hydrated = useHydrated();
  const isEmpty = useAuiState((s) => s.composer.text.length === 0);
  const [contentHeight, setContentHeight] = useState(44);
  const height = isEmpty ? 44 : Math.min(144, Math.max(44, contentHeight));

  return (
    <ComposerPrimitive.Input
      placeholder="问问这本书…"
      {...(hydrated ? { placeholderTextColorClassName: "accent-muted-foreground" } : {})}
      className="aui-composer-input text-foreground web:resize-none web:outline-none max-h-36 min-h-11 px-2 py-2 text-base leading-6"
      style={{ textAlignVertical: "top", includeFontPadding: false, ...(Platform.OS !== "web" ? { height } : {}) }}
      onContentSizeChange={(event) => setContentHeight(Math.ceil(event.nativeEvent.contentSize.height))}
      scrollEnabled={contentHeight > 144}
      submitMode="none"
      multiline
      accessibilityLabel="向阅读助手提问"
    />
  );
};

const Composer: FC = () => {
  const { ComposerInput = DefaultComposerInput, ComposerBefore, ComposerTools } = useContext(
    ThreadComponentsContext,
  );

  return (
    <ComposerPrimitive.Root className="aui-composer-root w-full">
      <View className="aui-composer-shell border-input bg-card gap-1 rounded-2xl border p-1.5"
        style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 3 }}>
        {ComposerBefore && <ComposerBefore />}
        <ComposerAttachments />
        <View className="flex-row items-end gap-1">
          <View className="flex-row items-center">
            <AuiIf condition={s => s.thread.capabilities.attachments}><ComposerAddAttachment /></AuiIf>
            {ComposerTools && <ComposerTools />}
          </View>
          <View className="min-w-0 flex-1"><ComposerInput /></View>
          <ComposerAction />
        </View>
      </View>
    </ComposerPrimitive.Root>
  );
};

const ComposerAction: FC = () => {
  // The stop control only cancels the send while no run it could stop is going.
  const isSending = useAuiState(
    (s) =>
      s.composer.submission !== undefined &&
      !(s.thread.isRunning && s.thread.capabilities.cancel),
  );

  return (
    <View className="aui-composer-action-wrapper flex-row items-center">
      <AuiIf
        condition={(s) =>
          s.composer.submission === undefined &&
          (!s.thread.isRunning || s.thread.voice !== undefined)
        }
      >
        <ComposerPrimitive.Send
          className="aui-composer-send bg-primary active:bg-primary/90 size-11 items-center justify-center rounded-xl disabled:opacity-40"
          accessibilityLabel="发送问题"
        >
          <Icon
            as={ArrowUpIcon}
            className="aui-composer-send-icon text-primary-foreground size-5"
          />
        </ComposerPrimitive.Send>
      </AuiIf>
      <AuiIf
        condition={(s) =>
          s.composer.submission !== undefined ||
          (s.thread.isRunning && s.thread.voice === undefined)
        }
      >
        <ComposerPrimitive.Cancel
          className="aui-composer-cancel bg-primary active:bg-primary/90 size-11 items-center justify-center rounded-xl"
          accessibilityLabel={isSending ? "取消发送" : "停止回答"}
        >
          <View className="aui-composer-cancel-icon bg-primary-foreground size-3 rounded-[2px]" />
        </ComposerPrimitive.Cancel>
      </AuiIf>
    </View>
  );
};

const MessageError: FC = () => (
  <ErrorPrimitive.Root className="aui-message-error-root border-destructive bg-destructive/10 dark:bg-destructive/5 mt-2 rounded-md border p-3">
    <ErrorPrimitive.Message
      className="aui-message-error-message text-destructive text-sm"
      numberOfLines={2}
    />
  </ErrorPrimitive.Root>
);

const UserText: TextMessagePartComponent = ({ text }) => (
  <Text
    className="aui-user-message-text text-foreground text-base leading-6"
    style={{ fontFamily: readingFontFamily }}
    selectable
  >
    {text}
  </Text>
);

const AssistantIndicator: FC = () => {
  const isRunning = useAuiState((s) => s.message.status?.type === "running");
  if (!isRunning) return null;

  return (
    <TypingIndicator
      variant="bare"
      announce={false}
      className="aui-assistant-message-indicator py-2"
      accessibilityLabel="助手正在回答"
    />
  );
};

const messageGroupBy = groupPartByType({
  reasoning: ["group-chainOfThought", "group-reasoning"],
  "tool-call": ["group-chainOfThought", "group-tool"],
  "standalone-tool-call": [],
});

type ThreadGroupKey =
  | "group-chainOfThought"
  | "group-reasoning"
  | "group-tool"
  | "group-task";

const TASK_GROUP_PATH: readonly ThreadGroupKey[] = [
  "group-chainOfThought",
  "group-task",
];

const taskAwareGroupBy = (
  part: Parameters<typeof messageGroupBy>[0],
  context?: GroupByContext,
): readonly ThreadGroupKey[] => {
  const path = messageGroupBy(part, context);
  return part.type === "tool-call" &&
    part.messages !== undefined &&
    path.length > 0 &&
    !context?.toolUIs?.[part.toolName]?.length
    ? TASK_GROUP_PATH
    : path;
};

const AssistantMessage: FC = () => {
  const { ToolFallback: CustomToolFallback, TaskGroup: TaskGroupComponent, AssistantFooter } =
    useContext(ThreadComponentsContext);
  const ToolFallbackComponent = CustomToolFallback ?? ToolFallback;
  const groupBy = TaskGroupComponent ? taskAwareGroupBy : messageGroupBy;

  return (
    <MessagePrimitive.Root className="aui-assistant-message-root">
      <View className="aui-assistant-message-content">
        <MessagePrimitive.GroupedParts groupBy={groupBy}>
          {({ part, children }) => {
            switch (part.type) {
              case "group-chainOfThought":
              case "group-tool":
                return children;
              case "group-task":
                return TaskGroupComponent ? (
                  <TaskGroupComponent group={part} />
                ) : null;
              case "group-reasoning": {
                const streaming = part.status.type === "running";
                return (
                  <ReasoningRoot streaming={streaming}>
                    <ReasoningTrigger
                      active={streaming}
                      duration={reasoningDuration(part.timing)}
                    />
                    <ReasoningContent>
                      <ReasoningText>{children}</ReasoningText>
                    </ReasoningContent>
                  </ReasoningRoot>
                );
              }
              case "text":
                return <MarkdownText {...part} />;
              case "image":
                return <Image {...part} />;
              case "file":
                return <File {...part} />;
              case "reasoning":
                return <Reasoning {...part} />;
              case "tool-call":
                return part.toolUI ?? <ToolFallbackComponent {...part} />;
              case "data":
                return part.dataRendererUI;
              case "indicator":
                return <AssistantIndicator />;
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        <MessageError />
        {AssistantFooter && <AssistantFooter />}
      </View>
      <View className="aui-assistant-message-footer min-h-11 flex-row items-center pt-1">
        <BranchPicker />
        <AssistantActionBar />
      </View>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => (
  <AuiIf
    condition={(s) =>
      !(s.message.role === "assistant" && s.message.status?.type === "running")
    }
  >
    <View className="aui-assistant-action-bar-root -ms-1 flex-row gap-1">
      <ActionBarPrimitive.Copy
        copyToClipboard={copyToClipboard}
        className={iconButtonClassName}
        hitSlop={groupedIconButtonHitSlop}
        accessibilityLabel="复制回答"
      >
        {({ isCopied }) => (
          <Icon
            as={isCopied ? CheckIcon : CopyIcon}
            className="text-muted-foreground size-4"
          />
        )}
      </ActionBarPrimitive.Copy>
      <AuiIf condition={s => s.thread.capabilities.reload}>
      <ActionBarPrimitive.Reload
        className={iconButtonClassName}
        hitSlop={groupedIconButtonHitSlop}
        accessibilityLabel="重新回答"
      >
        <Icon as={RefreshCwIcon} className="text-muted-foreground size-4" />
      </ActionBarPrimitive.Reload>
      </AuiIf>
    </View>
  </AuiIf>
);

const UserMessage: FC = () => {
  const { UserHeader } = useContext(ThreadComponentsContext);
  return (
  <MessagePrimitive.Root className="aui-user-message-root items-end gap-y-2">
    <UserMessageAttachments />
    <AuiIf condition={(s) => s.message.parts.length > 0}>
      <View className="aui-user-message-content bg-muted max-w-[88%] rounded-2xl px-4 py-3">
        {UserHeader && <UserHeader />}
        <MessagePrimitive.Parts components={{ Text: UserText, Image, File }} />
      </View>
    </AuiIf>
    <View className="aui-user-message-footer -me-1 flex-row items-center justify-end">
      <BranchPicker />
      <UserActionBar />
    </View>
  </MessagePrimitive.Root>
);
};

const UserActionBar: FC = () => (
  <AuiIf condition={(s) => !s.thread.isRunning && s.thread.capabilities.edit}>
    <ActionBarPrimitive.Edit
      className={cn(iconButtonClassName, "aui-user-action-edit")}
      hitSlop={groupedIconButtonHitSlop}
      accessibilityLabel="编辑问题"
    >
      <Icon as={PencilIcon} className="text-muted-foreground size-4" />
    </ActionBarPrimitive.Edit>
  </AuiIf>
);

const DefaultEditComposerInput: FC = () => (
  <ComposerPrimitive.Input
    className="aui-edit-composer-input text-foreground web:resize-none web:outline-none min-h-14 px-4 pt-3 pb-1 text-base"
    multiline
    autoFocus
  />
);

const EditComposer: FC = () => {
  const { ComposerInput = DefaultEditComposerInput } = useContext(
    ThreadComponentsContext,
  );

  return (
    <MessagePrimitive.Root className="aui-edit-composer-wrapper px-2">
      <ComposerPrimitive.Root className="aui-edit-composer-root border-border/60 dark:border-muted-foreground/15 bg-card ms-auto w-full max-w-[85%] rounded-3xl border">
        <ComposerInput />
        <View className="aui-edit-composer-footer mx-2.5 mb-2.5 flex-row items-center gap-1.5 self-end">
          <ComposerPrimitive.Cancel className="active:bg-accent h-11 justify-center rounded-full px-3.5">
            <Text className="text-foreground text-sm font-medium">取消</Text>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send className="bg-primary active:bg-primary/90 h-11 justify-center rounded-full px-3.5">
            <Text className="text-primary-foreground text-sm font-medium">
              更新
            </Text>
          </ComposerPrimitive.Send>
        </View>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<ViewProps> = ({ className, ...rest }) => {
  const branchCount = useAuiState((s) => s.message.branchCount);
  if (branchCount <= 1) return null;

  return (
    <View
      className={cn(
        "aui-branch-picker-root -ms-2 me-2 flex-row items-center",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous
        className={cn(iconButtonClassName, "disabled:opacity-35")}
        hitSlop={groupedIconButtonHitSlop}
        accessibilityLabel="上一条"
      >
        <Icon as={ChevronLeftIcon} className="text-muted-foreground size-4" />
      </BranchPickerPrimitive.Previous>
      <Text className="aui-branch-picker-state text-muted-foreground text-xs font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </Text>
      <BranchPickerPrimitive.Next
        className={cn(iconButtonClassName, "disabled:opacity-35")}
        hitSlop={groupedIconButtonHitSlop}
        accessibilityLabel="下一条"
      >
        <Icon as={ChevronRightIcon} className="text-muted-foreground size-4" />
      </BranchPickerPrimitive.Next>
    </View>
  );
};
