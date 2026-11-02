import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { AgentRunSession, VerifiedCitation } from '@shudeng/core';
import {
  BookChatConfigError,
  BookChatIndexError,
  getBookChatAvailability,
  startBookChatTurn,
  type BookChatAvailability,
} from '../src/platform/ai';
import { colors, radius, spacing } from '../src/ui/theme';
import { FormattedText } from '../src/ui/FormattedText';

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

function toolLabel(name: string): string {
  if (name === 'search_book') return '检索书内原文';
  if (name === 'read_page') return '读取页/章';
  if (name === 'read_chapter') return '读取章节';
  return name;
}

/** 书内 AI 问答（产品页；从书架/阅读器带 bookId 进入）。 */
export default function BookChatRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    bookId?: string | string[];
    bookTitle?: string | string[];
    selectionQuote?: string | string[];
    locator?: string | string[];
    initialQuestion?: string | string[];
  }>();
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
  const sessionRef = useRef<AgentRunSession | null>(null);
  const historyRef = useRef<Array<{ question: string; answer: string }>>([]);
  const selectionUsedRef = useRef(false);
  const scrollRef = useRef<React.ElementRef<typeof ScrollView> | null>(null);

  const updateAssistant = useCallback((id: string, updater: (turn: ChatTurn) => ChatTurn) => {
    setTurns((current) => current.map((turn) => (turn.role === 'assistant' && turn.id === id ? updater(turn) : turn)));
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
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [turns]);

  const send = useCallback(async () => {
    const text = question.trim();
    if (!text || running || !availability?.book || !availability.index.available) return;
    if (!availability.config) return;
    setQuestion('');
    const agentQuestion =
      selectionQuote && !selectionUsedRef.current
        ? `我选中了书中这段原文：「${selectionQuote}」\n\n${text}`
        : text;
    selectionUsedRef.current = true;
    const userTurn: ChatTurn = {
      id: nextTurnId(),
      role: 'user',
      text,
      reasoning: '',
      tools: [],
      citations: [],
      warnings: [],
      status: 'done',
      sourceQuestion: text,
    };
    const assistantId = nextTurnId();
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
    setRunning(true);
    try {
      const started = await startBookChatTurn({
        bookId,
        question: agentQuestion,
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
                  ? {
                      ...tool,
                      status: event.isError ? 'error' : 'done',
                      detail: `${Math.round(event.durationMs)}ms`,
                    }
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
            }));
            historyRef.current.push({ question: text, answer: result.answer });
            break;
          }
          case 'failed':
            updateAssistant(assistantId, (turn) => ({ ...turn, status: 'error', error: `${event.code}：${event.message}` }));
            break;
          case 'cancelled':
            updateAssistant(assistantId, (turn) => ({ ...turn, status: 'cancelled' }));
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
      if (error instanceof BookChatConfigError || error instanceof BookChatIndexError) {
        setLoadError(message);
      }
      updateAssistant(assistantId, (turn) => ({ ...turn, status: 'error', error: message }));
    } finally {
      sessionRef.current = null;
      setRunning(false);
    }
  }, [availability, bookId, question, running, selectionQuote, updateAssistant]);

  const initialSentRef = useRef(false);
  useEffect(() => {
    if (initialSentRef.current || !initialQuestion || !availability?.book || !availability.index.available || !availability.config || running) return;
    initialSentRef.current = true;
    void send();
  }, [availability, initialQuestion, running, send]);

  const cancel = useCallback(() => {
    sessionRef.current?.cancel();
  }, []);

  const title = availability?.book?.title ?? bookTitleParam ?? '书内问答';
  const configMissing = availability !== null && availability.config === null;
  const indexMissing = availability !== null && !availability.index.available;
  const canSend = Boolean(
    availability?.book && availability.config && availability.index.available && !running && question.trim(),
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹ 返回</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <View style={styles.chip}>
          <Text style={styles.chipText}>
            {availability?.index.semantic ? '全文+语义' : availability?.index.available ? '全文' : '索引未就绪'}
          </Text>
        </View>
      </View>

      {selectionQuote ? (
        <View style={styles.selection}>
          <Text style={styles.selectionLabel}>选中的原文</Text>
          <Text style={styles.selectionText} numberOfLines={3}>{selectionQuote}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.lamp} />
          <Text style={styles.hint}>准备书内资料…</Text>
        </View>
      ) : loadError ? (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>暂时无法问答</Text>
          <Text style={styles.hint}>{loadError}</Text>
          {configMissing ? (
            <Pressable accessibilityRole="button" onPress={() => router.push('/ai-settings')} style={styles.actionButton}>
              <Text style={styles.actionText}>去设置 AI 服务</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={8}
        >
          <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            {turns.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>就这本书提问</Text>
                <Text style={styles.hint}>
                  回答只依据书内原文；会先检索、核对引用，再给出答案。{availability?.index.detail ?? ''}
                </Text>
                {configMissing ? (
                  <Pressable accessibilityRole="button" onPress={() => router.push('/ai-settings')} style={styles.actionButton}>
                    <Text style={styles.actionText}>去设置 AI 服务</Text>
                  </Pressable>
                ) : null}
                {indexMissing && availability?.index.detail ? <Text style={styles.errorText}>{availability.index.detail}</Text> : null}
              </View>
            ) : null}
            {turns.map((turn) =>
              turn.role === 'user' ? (
                <View key={turn.id} style={styles.userRow}>
                  <View style={styles.userBubble}>
                    <Text style={styles.userText}>{turn.text}</Text>
                  </View>
                </View>
              ) : (
                <View key={turn.id} style={styles.assistantCard}>
                  {turn.reasoning ? (
                    <View style={styles.reasoningBox}>
                      <Text style={styles.reasoningLabel}>思考</Text>
                      <Text style={styles.reasoningText}>{turn.reasoning}</Text>
                    </View>
                  ) : null}
                  {turn.tools.length > 0 ? (
                    <View style={styles.toolsBox}>
                      {turn.tools.map((tool) => (
                        <Text key={tool.callId} style={styles.toolText}>
                          {tool.status === 'running' ? '…' : tool.status === 'error' ? '!' : '✓'} {toolLabel(tool.name)}
                          {tool.detail ? `（${tool.detail}）` : ''}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                  {turn.text ? <FormattedText text={turn.text} style={styles.assistantText} /> : turn.status === 'streaming' ? (
                    <Text style={styles.hint}>正在回答…</Text>
                  ) : null}
                  {turn.status === 'cancelled' ? <Text style={styles.hint}>已取消</Text> : null}
                  {turn.error ? <Text style={styles.errorText}>失败：{turn.error}</Text> : null}
                  {turn.warnings.length > 0 ? (
                    <Text style={styles.warningText}>{turn.warnings.join('；')}</Text>
                  ) : null}
                  {turn.citations.length > 0 ? (
                    <View style={styles.citations}>
                      {turn.citations.map((citation) => (
                        <Pressable
                          key={citation.id}
                          accessibilityRole="button"
                          accessibilityLabel={`查看引用 ${citation.id}`}
                          onPress={() => router.push({ pathname: '/reader/[id]', params: { id: bookId, locator: citation.locator } })}
                          style={styles.citationCard}
                        >
                          <Text style={styles.citationMeta} numberOfLines={1}>
                            [{citation.id}] {citation.chapter ?? '原文'}
                            {citation.page ? ` · 第 ${citation.page} 页` : ''}
                          </Text>
                          <Text style={styles.citationQuote} numberOfLines={4}>{citation.quote}</Text>
                          <Text style={styles.citationJump}>查看原文 ›</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              ),
            )}
          </ScrollView>
          <View style={styles.composer}>
            <TextInput
              value={question}
              onChangeText={setQuestion}
              placeholder="围绕这本书提问…"
              placeholderTextColor={colors.ink3}
              multiline
              editable={!running && Boolean(availability?.book)}
              style={styles.input}
            />
            {running ? (
              <Pressable accessibilityRole="button" onPress={cancel} style={[styles.sendButton, styles.cancelButton]}>
                <Text style={styles.actionText}>停止</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="发送"
                onPress={() => void send()}
                disabled={!canSend}
                style={[styles.sendButton, !canSend && styles.disabled]}
              >
                <Text style={styles.actionText}>发送</Text>
              </Pressable>
            )}
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  flex: { flex: 1 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  backButton: { paddingVertical: 6, paddingRight: 4 },
  backText: { fontSize: 15, color: colors.lamp },
  title: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.ink },
  chip: { borderRadius: radius.field, backgroundColor: colors.paperDeep, paddingHorizontal: spacing.xs, paddingVertical: 3 },
  chipText: { fontSize: 11, color: colors.ink2 },
  selection: {
    marginHorizontal: spacing.sm,
    marginTop: spacing.xs,
    padding: spacing.xs,
    borderRadius: radius.field,
    backgroundColor: colors.lampWash,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  selectionLabel: { fontSize: 10, color: colors.ink2, marginBottom: 2 },
  selectionText: { fontSize: 12, lineHeight: 17, color: colors.ink },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: spacing.lg },
  errorTitle: { fontSize: 15, fontWeight: '600', color: colors.ink },
  hint: { fontSize: 12, lineHeight: 18, color: colors.ink3, textAlign: 'center' },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.sm, gap: spacing.xs, paddingBottom: spacing.lg },
  empty: { padding: spacing.md, gap: 8, alignItems: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.ink },
  userRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  userBubble: {
    maxWidth: '84%',
    borderRadius: radius.field,
    backgroundColor: colors.lamp,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  userText: { fontSize: 14, lineHeight: 20, color: colors.ink },
  assistantCard: {
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.sm,
    gap: 6,
    maxWidth: '94%',
  },
  reasoningBox: { borderLeftWidth: 2, borderLeftColor: colors.line, paddingLeft: 8, gap: 2 },
  reasoningLabel: { fontSize: 10, color: colors.ink3, textTransform: 'uppercase' },
  reasoningText: { fontSize: 12, lineHeight: 18, color: colors.ink2 },
  toolsBox: { gap: 2 },
  toolText: { fontSize: 11, lineHeight: 16, color: colors.ink3 },
  assistantText: { fontSize: 14, lineHeight: 21, color: colors.ink },
  errorText: { fontSize: 12, lineHeight: 18, color: colors.danger },
  warningText: { fontSize: 11, lineHeight: 16, color: colors.ink3 },
  citations: { gap: 6, marginTop: 2 },
  citationJump: { marginTop: 4, fontSize: 11, color: colors.lamp, fontWeight: '600' },
  citationCard: {
    borderRadius: radius.field,
    backgroundColor: colors.lampWash,
    padding: spacing.xs,
    gap: 3,
  },
  citationMeta: { fontSize: 11, color: colors.ink2, fontWeight: '600' },
  citationQuote: { fontSize: 12, lineHeight: 18, color: colors.ink },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.paper,
  },
  input: {
    flex: 1,
    minHeight: 38,
    maxHeight: 110,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: radius.field,
    backgroundColor: colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.ink,
  },
  sendButton: {
    borderRadius: radius.field,
    backgroundColor: colors.lamp,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
  },
  cancelButton: { backgroundColor: colors.paperDeep },
  actionButton: {
    marginTop: 4,
    borderRadius: radius.field,
    backgroundColor: colors.lamp,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  actionText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  disabled: { opacity: 0.5 },
});
