import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  useWindowDimensions,
  type KeyboardEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import type { AgentRunSession, VerifiedCitation } from '@shudeng/core';
import {
  BookChatConfigError,
  BookChatIndexError,
  getBookChatAvailability,
  startBookChatTurn,
  type BookChatAvailability,
} from '../src/platform/ai';
import { appendBookChatTurn } from '../src/platform/library';
import { darkColors, lightColors, radius, type Palette } from '../src/ui/theme';

/** Swift BookType.serif 使用 PostScript 名 SongtiSC-*；用 family 名在 RN 会回退系统字体。 */
const SERIF = 'SongtiSC-Regular';
const SERIF_BOLD = 'SongtiSC-Bold';

interface ToolLine {
  readonly callId: string;
  readonly name: string;
  status: 'running' | 'done' | 'error';
  detail?: string;
}

interface ChatTurn {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  text: string;
  reasoning: string;
  tools: ToolLine[];
  citations: VerifiedCitation[];
  warnings: string[];
  status: 'streaming' | 'done' | 'error' | 'cancelled';
  error?: string;
  /** 用户原始问题（不含选中原文前缀），用于多轮 history。 */
  readonly sourceQuestion?: string;
  /** 实际发送给 Agent 的问题（含选文前缀），重试时复用。 */
  readonly agentQuestion?: string;
  /** 该轮附带的选中原文（用户气泡内展开）。 */
  readonly selectionQuote?: string;
  readonly bookTitle?: string;
}

function paramValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

let turnSequence = 0;
function nextTurnId(): string {
  turnSequence += 1;
  return `turn-${Date.now()}-${turnSequence}`;
}

/** 旧索引 locator 是 Readium JSON；转成 reader 可用 locator，无法定位时就只打开书。 */
function locatorForCitation(citation: VerifiedCitation): string | undefined {
  if (citation.page) return JSON.stringify({ type: 'pdf', page: citation.page });
  try {
    const parsed: unknown = JSON.parse(citation.locator);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const record = parsed as Record<string, unknown>;
    const locations =
      typeof record.locations === 'object' && record.locations !== null
        ? (record.locations as Record<string, unknown>)
        : undefined;
    const cfi = typeof locations?.cfi === 'string' ? locations.cfi : undefined;
    if (!cfi) return undefined;
    return JSON.stringify({
      type: 'epub',
      cfi,
      ...(typeof record.href === 'string' ? { href: record.href } : {}),
      ...(typeof record.title === 'string' ? { chapter: record.title } : {}),
    });
  } catch {
    return undefined;
  }
}

function toolLabel(name: string): string {
  if (name === 'search_book') return '检索书内原文';
  if (name === 'read_page') return '读取页/章';
  if (name === 'read_chapter') return '读取章节';
  return name;
}

function serviceName(provider: 'deepseek' | 'openai' | 'anthropic' | undefined): string {
  if (provider === 'deepseek') return 'DeepSeek';
  if (provider === 'openai') return 'OpenAI';
  if (provider === 'anthropic') return 'Anthropic';
  return 'AI 服务';
}

function friendlyError(message: string | undefined): string {
  if (!message) return '请稍后重试；问题与选文已保留。';
  if (/fetch|network|network request|timeout|abort/i.test(message)) {
    return '暂时没能连接 AI 服务，问题与选文已保留，请重试。';
  }
  return message.replace(/^[a-z-]+：/i, '');
}

function citationTitle(citation: VerifiedCitation, index: number, bookTitle: string, format: 'epub' | 'pdf'): string {
  const chapter = citation.chapter ?? (citation.page ? `第 ${citation.page} 页` : '原文');
  const head = `${index + 1} · ${bookTitle} · ${chapter}`;
  if (format === 'pdf') {
    const quote = citation.quote.replace(/\n/g, ' ').trim();
    return `${head}\n${quote.length > 36 ? `${quote.slice(0, 36)}…` : quote}`;
  }
  return `${head}\n查看原文，核对这段解释`;
}

/** 书内 AI 问答（产品页；76% 底部面板，对齐 Swift QuestionController）。 */
export default function BookChatRoute() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const systemScheme = useColorScheme();
  const params = useLocalSearchParams<{
    bookId?: string | string[];
    bookTitle?: string | string[];
    selectionQuote?: string | string[];
    locator?: string | string[];
    initialQuestion?: string | string[];
    /** 透明 modal 内 useColorScheme 可能读不到下层 scheme；由入口显式传 dark/light。 */
    theme?: string | string[];
  }>();
  const themeParam = paramValue(params.theme);
  const palette: Palette =
    themeParam === 'dark'
      ? darkColors
      : themeParam === 'light'
        ? lightColors
        : systemScheme === 'dark'
          ? darkColors
          : lightColors;
  const styles = useMemo(() => createStyles(palette), [palette]);
  const bookId = paramValue(params.bookId) ?? '';
  const bookTitleParam = paramValue(params.bookTitle);
  const selectionQuote = paramValue(params.selectionQuote);
  const initialQuestion = paramValue(params.initialQuestion);

  const [availability, setAvailability] = useState<BookChatAvailability | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState(initialQuestion ?? '');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [running, setRunning] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [expandedSelections, setExpandedSelections] = useState<Record<string, boolean>>({});
  const [expandedReasoning, setExpandedReasoning] = useState<Record<string, boolean>>({});
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const sessionRef = useRef<AgentRunSession | null>(null);
  const historyRef = useRef<Array<{ question: string; answer: string }>>([]);
  const selectionUsedRef = useRef(false);
  const initialSentRef = useRef(false);
  const scrollRef = useRef<React.ElementRef<typeof ScrollView> | null>(null);

  const updateAssistant = useCallback((id: string, updater: (turn: ChatTurn) => ChatTurn) => {
    setTurns((current) =>
      current.map((turn) => (turn.role === 'assistant' && turn.id === id ? updater(turn) : turn)),
    );
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      if (!bookId) {
        if (mounted) {
          setLoadError('缺少 bookId，无法打开书内问答');
          setLoading(false);
        }
        return;
      }
      try {
        const next = await getBookChatAvailability(bookId);
        if (!mounted) return;
        setAvailability(next);
        if (!next.book) setLoadError('这本书不在书架里');
        else if (!next.index.available) setLoadError(next.index.detail);
      } catch (error) {
        if (mounted) setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
      sessionRef.current?.cancel();
    };
  }, [bookId]);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', (event: KeyboardEvent) =>
      setKeyboardHeight(event.endCoordinates.height),
    );
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [turns]);

  const sheetHeight = Math.round(windowHeight * 0.76);

  const runTurn = useCallback(
    async (options: {
      displayQuestion: string;
      agentQuestion: string;
      attachSelection: boolean;
      appendUser: boolean;
      assistantId?: string;
    }): Promise<void> => {
      if (running || !availability?.book || !availability.index.available || !availability.config) return;
      const assistantId = options.assistantId ?? nextTurnId();
      setRunning(true);
      if (options.appendUser) {
        const userTurn: ChatTurn = {
          id: nextTurnId(),
          role: 'user',
          text: options.displayQuestion,
          reasoning: '',
          tools: [],
          citations: [],
          warnings: [],
          status: 'done',
          sourceQuestion: options.displayQuestion,
          agentQuestion: options.agentQuestion,
          ...(options.attachSelection && selectionQuote ? { selectionQuote } : {}),
          ...(availability.book ? { bookTitle: availability.book.title } : {}),
        };
        setTurns((current) => [
          ...current,
          userTurn,
          {
            id: assistantId,
            role: 'assistant',
            text: '',
            reasoning: '',
            tools: [],
            citations: [],
            warnings: [],
            status: 'streaming',
          },
        ]);
      } else {
        setTurns((current) => [
          ...current,
          {
            id: assistantId,
            role: 'assistant',
            text: '',
            reasoning: '',
            tools: [],
            citations: [],
            warnings: [],
            status: 'streaming',
          },
        ]);
      }
      try {
        const started = await startBookChatTurn({
          bookId,
          question: options.agentQuestion,
          history: historyRef.current,
        });
        sessionRef.current = started.session;
        for await (const event of started.session.events) {
          switch (event.type) {
            case 'reasoningDelta':
              updateAssistant(assistantId, (turn) => ({ ...turn, reasoning: turn.reasoning + event.delta }));
              break;
            case 'textDelta':
              updateAssistant(assistantId, (turn) => ({ ...turn, text: turn.text + event.delta }));
              break;
            case 'toolStarted':
              updateAssistant(assistantId, (turn) => ({
                ...turn,
                tools: [...turn.tools, { callId: event.callId, name: event.name, status: 'running' }],
              }));
              break;
            case 'toolFinished':
              updateAssistant(assistantId, (turn) => ({
                ...turn,
                tools: turn.tools.map((tool) =>
                  tool.callId === event.callId
                    ? { ...tool, status: event.isError ? 'error' : 'done', detail: `${Math.round(event.durationMs)}ms` }
                    : tool,
                ),
              }));
              break;
            case 'citation':
              updateAssistant(assistantId, (turn) =>
                turn.citations.some((item) => item.id === event.citation.id)
                  ? turn
                  : { ...turn, citations: [...turn.citations, event.citation] },
              );
              break;
            case 'completed': {
              const result = event.result;
              updateAssistant(assistantId, (turn) => ({
                ...turn,
                text: result.answer,
                citations: result.citations,
                warnings: result.warnings,
                status: 'done',
                sourceQuestion: options.displayQuestion,
              }));
              historyRef.current.push({ question: options.displayQuestion, answer: result.answer });
              void appendBookChatTurn({
                bookId,
                question: options.displayQuestion,
                answer: result.answer,
                citations: result.citations.map((citation) => ({
                  id: citation.id,
                  quote: citation.quote,
                  locator: citation.locator,
                  ...(citation.chapter ? { chapter: citation.chapter } : {}),
                  ...(citation.page ? { page: citation.page } : {}),
                })),
              }).catch(() => undefined);
              break;
            }
            case 'failed':
              updateAssistant(assistantId, (turn) => ({
                ...turn,
                status: 'error',
                error: friendlyError(`${event.code}：${event.message}`),
                sourceQuestion: options.displayQuestion,
              }));
              break;
            case 'cancelled':
              updateAssistant(assistantId, (turn) => ({
                ...turn,
                status: 'cancelled',
                sourceQuestion: options.displayQuestion,
              }));
              break;
            case 'started':
              break;
          }
        }
        const result = await started.session.result;
        if (result === null) {
          updateAssistant(assistantId, (turn) =>
            turn.status === 'streaming' || turn.status === 'done' ? { ...turn, status: 'cancelled' } : turn,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof BookChatConfigError || error instanceof BookChatIndexError) setLoadError(message);
        updateAssistant(assistantId, (turn) => ({ ...turn, status: 'error', error: friendlyError(message) }));
      } finally {
        sessionRef.current = null;
        setRunning(false);
      }
    },
    [availability, bookId, running, selectionQuote, updateAssistant],
  );

  const send = useCallback(
    async (override?: string): Promise<void> => {
      const text = (override ?? question).trim();
      if (!text || running || !availability?.book || !availability.index.available || !availability.config) return;
      setQuestion('');
      const useSelection = Boolean(selectionQuote) && !selectionUsedRef.current;
      selectionUsedRef.current = true;
      const agentQuestion = useSelection ? `我选中了书中这段原文：「${selectionQuote}」\n\n${text}` : text;
      await runTurn({ displayQuestion: text, agentQuestion, attachSelection: useSelection, appendUser: true });
    },
    [availability, question, runTurn, running, selectionQuote],
  );

  useEffect(() => {
    if (initialSentRef.current || !initialQuestion || !availability?.book || !availability.index.available || !availability.config || running) return;
    initialSentRef.current = true;
    void send(initialQuestion);
  }, [availability, initialQuestion, running, send]);

  const retry = useCallback(
    (turn: ChatTurn): void => {
      setTurns((current) => current.filter((item) => item.id !== turn.id));
      const agentQuestion = turn.agentQuestion ?? turn.sourceQuestion;
      if (!agentQuestion) return;
      void runTurn({
        displayQuestion: turn.sourceQuestion ?? agentQuestion,
        agentQuestion,
        attachSelection: false,
        appendUser: false,
      });
    },
    [runTurn],
  );

  const cancel = useCallback(() => {
    sessionRef.current?.cancel();
  }, []);

  const title = availability?.book?.title ?? bookTitleParam ?? '书内问答';
  const format = availability?.book?.format ?? 'epub';
  const configMissing = availability !== null && availability.config === null;
  const indexMissing = availability !== null && !availability.index.available;
  const canSend = Boolean(
    availability?.book && availability.config && availability.index.available && !running && question.trim(),
  );
  const placeholder = turns.length > 0 ? '继续问书灯…' : '问问书灯…';
  const service = serviceName(availability?.config?.provider);

  return (
    <View style={styles.overlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="收起问答"
          style={styles.backdrop}
          onPress={() => router.back()}
        />
        <View style={[styles.sheet, { height: sheetHeight, paddingBottom: Math.max(insets.bottom, 8) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.brand}>
              <View style={styles.brandMark}>
                <SymbolView name="lightbulb" size={15} weight="medium" tintColor={palette.lamp} />
              </View>
              <Text style={styles.brandTitle}>问问书灯</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="收起问答，继续阅读"
              onPress={() => router.back()}
              style={styles.closeButton}
            >
              <SymbolView name="xmark" size={15} weight="medium" tintColor={palette.ink2} />
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={palette.lamp} />
              <Text style={styles.emptyHint}>准备书内资料…</Text>
            </View>
          ) : (
            <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
              <ScrollView
                ref={scrollRef}
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
              >
                {indexMissing || loadError ? (
                  <View style={styles.errorBanner}>
                    <View style={styles.statusCard}>
                      <Text style={styles.statusTitle}>{indexMissing ? '这本书暂不能问答' : '暂时无法问答'}</Text>
                      <Text style={styles.statusBody}>{friendlyError(loadError ?? availability?.index.detail)}</Text>
                    </View>
                  </View>
                ) : null}
                {turns.map((turn) =>
                  turn.role === 'user' ? (
                    <View key={turn.id} style={styles.userRow}>
                      <View style={styles.userBubble}>
                        {turn.selectionQuote && availability?.book ? (
                          <>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel="展开／收起提问选文"
                              style={styles.attachmentRow}
                              onPress={() =>
                                setExpandedSelections((current) => ({ ...current, [turn.id]: !current[turn.id] }))
                              }
                            >
                              <SymbolView name="text.quote" size={15} tintColor={palette.ink2} />
                              <Text style={styles.attachmentText} numberOfLines={1}>
                                {expandedSelections[turn.id] ? '收起选文' : '附带选文'} · {title}
                              </Text>
                            </Pressable>
                            {expandedSelections[turn.id] ? (
                              <View style={styles.quoteBox}>
                                <View style={styles.quoteRule} />
                                <Text style={styles.quoteText}>{turn.selectionQuote}</Text>
                              </View>
                            ) : null}
                          </>
                        ) : null}
                        <Text style={styles.userText}>{turn.text}</Text>
                      </View>
                    </View>
                  ) : (
                    <View key={turn.id} style={styles.assistantBlock}>
                      <View style={styles.identityRow}>
                        <View style={styles.identityMark}>
                          <SymbolView name="lightbulb" size={13} weight="medium" tintColor={palette.lamp} />
                        </View>
                        <Text style={styles.identityText}>书灯 · AI</Text>
                      </View>

                      {turn.reasoning || turn.tools.length > 0 ? (
                        <View style={styles.processBox}>
                          {turn.reasoning ? (
                            <>
                              <Pressable
                                accessibilityRole="button"
                                style={styles.processHeader}
                                onPress={() =>
                                  setExpandedReasoning((current) => ({ ...current, [turn.id]: !current[turn.id] }))
                                }
                              >
                                <SymbolView
                                  name={expandedReasoning[turn.id] ? 'chevron.down' : 'chevron.right'}
                                  size={11}
                                  tintColor={palette.ink2}
                                />
                                <Text style={styles.processTitle}>
                                  {turn.status === 'streaming' && !turn.text ? '正在思考' : '已思考'}
                                </Text>
                              </Pressable>
                              {expandedReasoning[turn.id] ? <Text style={styles.reasoningText}>{turn.reasoning}</Text> : null}
                            </>
                          ) : null}
                          {turn.tools.length > 0 ? (
                            <>
                              <Pressable
                                accessibilityRole="button"
                                style={styles.processHeader}
                                onPress={() => setExpandedTools((current) => ({ ...current, [turn.id]: !current[turn.id] }))}
                              >
                                <SymbolView
                                  name={expandedTools[turn.id] ? 'chevron.down' : 'chevron.right'}
                                  size={11}
                                  tintColor={palette.ink2}
                                />
                                <Text style={styles.processTitle}>
                                  {turn.status === 'streaming'
                                    ? `正在查书 · 已完成 ${turn.tools.filter((tool) => tool.status !== 'running').length} 步`
                                    : `查书 ${turn.tools.length} 步`}
                                </Text>
                              </Pressable>
                              {expandedTools[turn.id] ? (
                                <View style={styles.toolList}>
                                  {turn.tools.map((tool) => (
                                    <View key={tool.callId} style={styles.toolRow}>
                                      <Text style={styles.toolDot}>
                                        {tool.status === 'error' ? '!' : tool.status === 'running' ? '…' : '✓'}
                                      </Text>
                                      <Text style={styles.toolText}>
                                        {toolLabel(tool.name)}
                                        {tool.detail ? ` · ${tool.detail}` : ''}
                                      </Text>
                                    </View>
                                  ))}
                                </View>
                              ) : null}
                            </>
                          ) : null}
                        </View>
                      ) : null}

                      {turn.status === 'streaming' && !turn.text ? (
                        <View style={styles.skeleton}>
                          <View style={[styles.skeletonBar, { width: '82%' }]} />
                          <View style={[styles.skeletonBar, { width: '100%' }]} />
                          <View style={[styles.skeletonBar, { width: '62%' }]} />
                        </View>
                      ) : turn.text ? (
                        <Text style={styles.answerText}>{turn.text}</Text>
                      ) : null}

                      {turn.citations.length > 0 ? (
                        <View style={styles.citations}>
                          <Text style={styles.citationHeading}>
                            书内依据 {turn.citations.map((_, index) => `[${index + 1}]`).join(' ')}
                          </Text>
                          {turn.citations.map((citation, index) => {
                            const locator = locatorForCitation(citation);
                            return (
                              <Pressable
                                key={citation.id}
                                accessibilityRole="button"
                                accessibilityLabel={`查看原文：${citation.chapter ?? '原文'}`}
                                style={styles.citationCard}
                                onPress={() => {
                                  if (!locator) return;
                                  router.push({ pathname: '/reader/[id]', params: { id: bookId, locator } });
                                }}
                              >
                                <Text style={styles.citationTitle}>
                                  {citationTitle(citation, index, title, format)}
                                </Text>
                                <SymbolView name="arrow.up.right" size={18} tintColor={palette.ink2} />
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : null}

                      {turn.text.length > 0 ? (
                        <View style={styles.answerFooter}>
                          <Text style={styles.answerHint}>解释供参考，可回原文核查</Text>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="复制回答"
                            style={styles.copyButton}
                            onPress={() => void Share.share({ message: turn.text })}
                          >
                            <SymbolView name="doc.on.doc" size={15} tintColor={palette.ink2} />
                          </Pressable>
                        </View>
                      ) : null}

                      {turn.status === 'error' || turn.status === 'cancelled' ? (
                        <View style={styles.recovery}>
                          <View style={styles.statusCard}>
                            <Text style={styles.statusTitle}>回答未完成</Text>
                            <Text style={styles.statusBody}>
                              {turn.status === 'cancelled'
                                ? '已中断，回答可能不完整。问题与选文已保留，请重试。'
                                : turn.error ?? '暂时没能连接 AI 服务，问题与选文已保留，请重试。'}
                            </Text>
                          </View>
                          <Pressable accessibilityRole="button" style={styles.retryButton} onPress={() => retry(turn)}>
                            <SymbolView name="arrow.clockwise" size={16} tintColor={palette.lampInk} />
                            <Text style={styles.retryText}>重试回答</Text>
                          </Pressable>
                        </View>
                      ) : null}

                      {turn.status === 'streaming' && !turn.text && (turn.reasoning || turn.tools.length > 0) ? (
                        <View style={styles.statusCardGenerating}>
                          <Text style={styles.statusBodyGenerating}>正在生成</Text>
                        </View>
                      ) : null}

                      {turn.status === 'done' || turn.status === 'error' || turn.status === 'cancelled' ? (
                        <Pressable
                          accessibilityRole="button"
                          style={styles.moreRow}
                          onPress={() => Alert.alert('更多', '回答仅依据本次书内检索结果，可回原文核对。')}
                        >
                          <SymbolView name="ellipsis" size={13} tintColor={palette.ink2} />
                          <Text style={styles.moreText}>更多</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ),
                )}
              </ScrollView>

              <View style={styles.composerDivider} />
              <View style={styles.composer}>
                {selectionQuote && !selectionUsedRef.current ? (
                  <View style={styles.composerSelection}>
                    <SymbolView name="text.quote" size={13} tintColor={palette.lamp} />
                    <Text style={styles.composerSelectionText}>附带选文</Text>
                  </View>
                ) : null}
                <Pressable
                  accessibilityRole={configMissing ? 'button' : undefined}
                  accessibilityLabel={configMissing ? '去设置 AI 服务' : undefined}
                  onPress={configMissing ? () => router.push('/ai-settings') : undefined}
                  style={styles.serviceHint}
                >
                  <SymbolView name="lock.shield" size={13} tintColor={palette.ink2} />
                  <Text style={styles.serviceHintText}>
                    发送给 {service}
                    {configMissing ? ' · 去设置' : ''}
                  </Text>
                </Pressable>
                <View style={styles.field}>
                  <TextInput
                    value={question}
                    onChangeText={setQuestion}
                    placeholder={placeholder}
                    placeholderTextColor={palette.ink3}
                    multiline
                    editable={!running && Boolean(availability?.book)}
                    style={styles.input}
                  />
                  {!running ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="发送问题"
                      onPress={() => void send()}
                      disabled={!canSend}
                      style={[styles.sendButton, !canSend && styles.sendDisabled]}
                    >
                      <SymbolView name="arrow.up" size={16} weight="semibold" tintColor={palette.paper} />
                    </Pressable>
                  ) : null}
                </View>
                {/* Swift QuestionController 的上下文用量：16pt 圆环 + caption 文案；核心 AgentRunResult
                    暂无 usage 字段，当前真实可用值只有 0%（空态无上下文）。 */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="上下文用量 0%"
                  accessibilityHint="查看本次对话的上下文用量"
                  onPress={() =>
                    Alert.alert(
                      '上下文用量',
                      turns.length === 0
                        ? '还没有开始对话，已用约 0 字。'
                        : '当前版本暂未提供本次对话的上下文用量。',
                    )
                  }
                  style={styles.contextUsage}
                >
                  <View style={styles.contextRing} />
                  <Text style={styles.contextUsageText}>上下文 0%</Text>
                </Pressable>
                {running ? (
                  <Pressable accessibilityRole="button" style={styles.cancelButton} onPress={cancel}>
                    <Text style={styles.cancelText}>取消生成</Text>
                  </Pressable>
                ) : null}
              </View>
            </KeyboardAvoidingView>
          )}
        </View>
      </View>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(16, 14, 11, 0.30)' },
    sheet: {
      width: '100%',
      backgroundColor: palette.paper,
      borderTopLeftRadius: 23,
      borderTopRightRadius: 23,
      overflow: 'hidden',
    },
    handle: {
      width: 33,
      height: 4,
      borderRadius: 2,
      backgroundColor: palette.ink3,
      opacity: 0.35,
      alignSelf: 'center',
      marginTop: 8,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 44,
      paddingHorizontal: 23,
      marginTop: 6,
      marginBottom: 2,
    },
    brand: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
    brandMark: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: palette.lampWash,
      alignItems: 'center',
      justifyContent: 'center',
    },
    brandTitle: { fontFamily: SERIF_BOLD, fontSize: 16, color: palette.ink },
    closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
    emptyHint: { fontSize: 12, lineHeight: 18, color: palette.ink3 },
    errorContent: { flex: 1, paddingHorizontal: 20, paddingTop: 16, gap: 12 },
    errorBanner: { gap: 10, marginBottom: 8 },
    flex: { flex: 1 },
    scroll: { flex: 1 },
    scrollContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, gap: 24 },
    userRow: { flexDirection: 'row', justifyContent: 'flex-end' },
    userBubble: {
      maxWidth: '88%',
      backgroundColor: palette.paperDeep,
      borderRadius: radius.card,
      borderTopRightRadius: 6,
      paddingVertical: 10,
      paddingHorizontal: 12,
      gap: 8,
    },
    attachmentRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    attachmentText: { flex: 1, fontSize: 11, lineHeight: 16, color: palette.ink2 },
    quoteBox: { flexDirection: 'row', gap: 9 },
    quoteRule: { width: 2, borderRadius: 1, backgroundColor: palette.lamp },
    quoteText: { flex: 1, fontFamily: SERIF, fontSize: 13, lineHeight: 22, color: palette.ink2 },
    userText: { fontSize: 15, lineHeight: 25, color: palette.ink },
    assistantBlock: { gap: 9 },
    identityRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    identityMark: {
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: palette.lampWash,
      alignItems: 'center',
      justifyContent: 'center',
    },
    identityText: { fontSize: 12, lineHeight: 16, color: palette.ink2 },
    processBox: { gap: 6 },
    processHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 24 },
    processTitle: { fontSize: 12, lineHeight: 17, color: palette.ink2 },
    reasoningText: { fontSize: 12, lineHeight: 19, color: palette.ink2, paddingLeft: 16 },
    toolList: { gap: 3, paddingLeft: 16 },
    toolRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    toolDot: { fontSize: 11, lineHeight: 17, color: palette.ink3 },
    toolText: { flex: 1, fontSize: 11, lineHeight: 17, color: palette.ink3 },
    skeleton: { gap: 8, paddingVertical: 2 },
    skeletonBar: { height: 10, borderRadius: 4, backgroundColor: palette.line },
    answerText: { fontFamily: SERIF, fontSize: 15, lineHeight: 28, color: palette.ink },
    citations: { gap: 8, marginTop: 8 },
    citationHeading: { fontFamily: SERIF_BOLD, fontSize: 15, lineHeight: 22, color: palette.ink, marginBottom: 1 },
    citationCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: palette.surface,
      borderRadius: radius.field,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.line,
      paddingVertical: 11,
      paddingHorizontal: 12,
    },
    citationTitle: { flex: 1, fontSize: 12, lineHeight: 19, color: palette.ink },
    answerFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
    answerHint: { flex: 1, fontSize: 10, lineHeight: 16, color: palette.ink2 },
    copyButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    recovery: { gap: 8 },
    statusCard: { backgroundColor: palette.errorWash, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 11, gap: 2 },
    statusTitle: { fontSize: 12, lineHeight: 18, fontWeight: '600', color: palette.error },
    statusBody: { fontSize: 12, lineHeight: 18, color: palette.error },
    statusCardGenerating: {
      backgroundColor: palette.paperDeep,
      borderRadius: 12,
      paddingVertical: 9,
      paddingHorizontal: 11,
    },
    statusBodyGenerating: { fontSize: 12, lineHeight: 18, color: palette.ink2 },
    retryButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
    retryText: { fontSize: 13, lineHeight: 18, color: palette.lampInk },
    moreRow: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 30 },
    moreText: { fontSize: 11, lineHeight: 16, color: palette.ink2 },
    composerDivider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.line },
    composer: { paddingTop: 12, paddingHorizontal: 20, paddingBottom: 12, gap: 8, backgroundColor: palette.paper },
    composerSelection: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    composerSelectionText: { fontSize: 11, color: palette.ink2 },
    serviceHint: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    serviceHintText: { fontSize: 11, lineHeight: 16, color: palette.ink2 },
    contextUsage: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 24 },
    contextRing: {
      width: 16,
      height: 16,
      borderRadius: 8,
      borderWidth: 2.4,
      borderColor: palette.line,
    },
    contextUsageText: { fontSize: 10.5, lineHeight: 15, fontWeight: '500', color: palette.ink2 },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 44,
      borderRadius: radius.pill,
      backgroundColor: palette.paperDeep,
      paddingLeft: 12,
      paddingRight: 5,
      paddingVertical: 5,
    },
    input: { flex: 1, minHeight: 34, maxHeight: 92, paddingVertical: 7, fontSize: 14, lineHeight: 20, color: palette.ink },
    sendButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: palette.ink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendDisabled: { opacity: 0.35 },
    cancelButton: { alignSelf: 'center', minHeight: 30, justifyContent: 'center' },
    cancelText: { fontSize: 13, lineHeight: 19, color: palette.lampInk },
    primaryButton: {
      alignSelf: 'flex-start',
      borderRadius: radius.field,
      backgroundColor: palette.lamp,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    primaryButtonText: { fontSize: 13, fontWeight: '600', color: palette.ink },
  });
}
