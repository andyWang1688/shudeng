import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentRunSession, VerifiedCitation } from '@shudeng/core';
import {
  BookChatConfigError,
  BookChatIndexError,
  getBookChatAvailability,
  startBookChatTurn,
  type BookChatAvailability,
} from '../../platform/ai';
import { appendBookChatTurn } from '../../platform/library';
import { friendlyError, serviceName } from './format';
import type { ChatTurn, ToolLine } from './types';

export interface UseBookChatOptions {
  readonly bookId: string;
  readonly bookTitleParam?: string | undefined;
  readonly selectionQuote?: string | undefined;
  readonly initialQuestion?: string | undefined;
}

export interface UseBookChatResult {
  readonly availability: BookChatAvailability | null;
  readonly loadError: string | null;
  readonly loading: boolean;
  readonly question: string;
  readonly setQuestion: (value: string) => void;
  readonly turns: ChatTurn[];
  readonly running: boolean;
  readonly title: string;
  readonly format: 'epub' | 'pdf';
  readonly configMissing: boolean;
  readonly indexMissing: boolean;
  readonly canSend: boolean;
  readonly placeholder: string;
  readonly service: string;
  readonly selectionPending: boolean;
  readonly indexDetail: string;
  readonly send: (override?: string) => Promise<void>;
  readonly retry: (turn: ChatTurn) => void;
  readonly cancel: () => void;
}

let turnSequence = 0;
function nextTurnId(): string {
  turnSequence += 1;
  return `turn-${Date.now()}-${turnSequence}`;
}

type TurnUpdate =
  | { readonly kind: 'reasoning'; readonly delta: string }
  | { readonly kind: 'text'; readonly delta: string }
  | { readonly kind: 'toolStarted'; readonly callId: string; readonly name: string }
  | { readonly kind: 'toolFinished'; readonly callId: string; readonly isError: boolean; readonly durationMs: number }
  | { readonly kind: 'citation'; readonly citation: VerifiedCitation }
  | { readonly kind: 'patch'; readonly patch: Partial<ChatTurn> };

/** 把一帧内累积的流式增量合成一次 turn 更新；只在原 assistant turn 上改。 */
function applyTurnUpdates(turn: ChatTurn, updates: readonly TurnUpdate[]): ChatTurn {
  let text = turn.text;
  let reasoning = turn.reasoning;
  let tools: ToolLine[] = turn.tools;
  let citations = turn.citations;
  let warnings = turn.warnings;
  let status = turn.status;
  let error = turn.error;
  let sourceQuestion = turn.sourceQuestion;
  for (const update of updates) {
    switch (update.kind) {
      case 'reasoning':
        reasoning += update.delta;
        break;
      case 'text':
        text += update.delta;
        break;
      case 'toolStarted':
        tools = [...tools, { callId: update.callId, name: update.name, status: 'running' }];
        break;
      case 'toolFinished':
        tools = tools.map((tool) =>
          tool.callId === update.callId
            ? { ...tool, status: update.isError ? 'error' : 'done', detail: `${Math.round(update.durationMs)}ms` }
            : tool,
        );
        break;
      case 'citation':
        if (!citations.some((citation) => citation.id === update.citation.id)) {
          citations = [...citations, update.citation];
        }
        break;
      case 'patch': {
        const patch = update.patch;
        if (patch.text !== undefined) text = patch.text;
        if (patch.citations !== undefined) citations = patch.citations;
        if (patch.warnings !== undefined) warnings = patch.warnings;
        if (patch.status !== undefined) status = patch.status;
        if (patch.error !== undefined) error = patch.error;
        if (patch.sourceQuestion !== undefined) sourceQuestion = patch.sourceQuestion;
        break;
      }
    }
  }
  return {
    ...turn,
    text,
    reasoning,
    tools,
    citations,
    warnings,
    status,
    ...(error !== undefined ? { error } : {}),
    ...(sourceQuestion !== undefined ? { sourceQuestion } : {}),
  };
}

/** 书内问答的所有数据/Agent 生命周期；视图只消费状态与回调。 */
export function useBookChat(options: UseBookChatOptions): UseBookChatResult {
  const { bookId, bookTitleParam, selectionQuote, initialQuestion } = options;
  const [availability, setAvailability] = useState<BookChatAvailability | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState(initialQuestion ?? '');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [running, setRunning] = useState(false);
  const sessionRef = useRef<AgentRunSession | null>(null);
  const historyRef = useRef<Array<{ question: string; answer: string }>>([]);
  const selectionUsedRef = useRef(false);
  const initialSentRef = useRef(false);

  // 流式增量按帧合并：一次 rAF 最多一次 setTurns，避免每个 delta 重渲染整棵列表。
  const pendingUpdatesRef = useRef<TurnUpdate[]>([]);
  const pendingAssistantIdRef = useRef<string | null>(null);
  const frameRef = useRef<number | null>(null);

  const flushPending = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const updates = pendingUpdatesRef.current;
    const assistantId = pendingAssistantIdRef.current;
    if (!assistantId || updates.length === 0) return;
    pendingUpdatesRef.current = [];
    pendingAssistantIdRef.current = null;
    setTurns((current) => {
      let changed = false;
      const next = current.map((turn) => {
        if (turn.id !== assistantId || turn.role !== 'assistant') return turn;
        changed = true;
        return applyTurnUpdates(turn, updates);
      });
      return changed ? next : current;
    });
  }, []);

  const scheduleUpdate = useCallback(
    (assistantId: string, update: TurnUpdate) => {
      pendingAssistantIdRef.current = assistantId;
      pendingUpdatesRef.current.push(update);
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        flushPending();
      });
    },
    [flushPending],
  );

  const resetPending = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    pendingUpdatesRef.current = [];
    pendingAssistantIdRef.current = null;
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
      resetPending();
    };
  }, [bookId, resetPending]);

  const runTurn = useCallback(
    async (turnOptions: {
      displayQuestion: string;
      agentQuestion: string;
      attachSelection: boolean;
      appendUser: boolean;
    }): Promise<void> => {
      if (running || !availability?.book || !availability.index.available || !availability.config) return;
      const assistantId = nextTurnId();
      resetPending();
      setRunning(true);
      if (turnOptions.appendUser) {
        const userTurn: ChatTurn = {
          id: nextTurnId(),
          role: 'user',
          text: turnOptions.displayQuestion,
          reasoning: '',
          tools: [],
          citations: [],
          warnings: [],
          status: 'done',
          sourceQuestion: turnOptions.displayQuestion,
          agentQuestion: turnOptions.agentQuestion,
          ...(turnOptions.attachSelection && selectionQuote ? { selectionQuote } : {}),
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
          question: turnOptions.agentQuestion,
          history: historyRef.current,
        });
        sessionRef.current = started.session;
        for await (const event of started.session.events) {
          switch (event.type) {
            case 'reasoningDelta':
              scheduleUpdate(assistantId, { kind: 'reasoning', delta: event.delta });
              break;
            case 'textDelta':
              scheduleUpdate(assistantId, { kind: 'text', delta: event.delta });
              break;
            case 'toolStarted':
              scheduleUpdate(assistantId, { kind: 'toolStarted', callId: event.callId, name: event.name });
              break;
            case 'toolFinished':
              scheduleUpdate(assistantId, {
                kind: 'toolFinished',
                callId: event.callId,
                isError: event.isError,
                durationMs: event.durationMs,
              });
              break;
            case 'citation':
              scheduleUpdate(assistantId, { kind: 'citation', citation: event.citation });
              break;
            case 'completed': {
              const result = event.result;
              scheduleUpdate(assistantId, {
                kind: 'patch',
                patch: {
                  text: result.answer,
                  citations: result.citations,
                  warnings: result.warnings,
                  status: 'done',
                  sourceQuestion: turnOptions.displayQuestion,
                },
              });
              flushPending();
              historyRef.current.push({ question: turnOptions.displayQuestion, answer: result.answer });
              void appendBookChatTurn({
                bookId,
                question: turnOptions.displayQuestion,
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
              scheduleUpdate(assistantId, {
                kind: 'patch',
                patch: {
                  status: 'error',
                  error: friendlyError(`${event.code}：${event.message}`),
                  sourceQuestion: turnOptions.displayQuestion,
                },
              });
              flushPending();
              break;
            case 'cancelled':
              scheduleUpdate(assistantId, {
                kind: 'patch',
                patch: { status: 'cancelled', sourceQuestion: turnOptions.displayQuestion },
              });
              flushPending();
              break;
            case 'started':
              break;
          }
        }
        const result = await started.session.result;
        if (result === null) {
          scheduleUpdate(assistantId, {
            kind: 'patch',
            patch: { status: 'cancelled', sourceQuestion: turnOptions.displayQuestion },
          });
          flushPending();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof BookChatConfigError || error instanceof BookChatIndexError) setLoadError(message);
        scheduleUpdate(assistantId, { kind: 'patch', patch: { status: 'error', error: friendlyError(message) } });
        flushPending();
      } finally {
        flushPending();
        sessionRef.current = null;
        setRunning(false);
      }
    },
    [availability, bookId, flushPending, resetPending, running, scheduleUpdate, selectionQuote],
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
    if (
      initialSentRef.current ||
      !initialQuestion ||
      !availability?.book ||
      !availability.index.available ||
      !availability.config ||
      running
    ) {
      return;
    }
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
  const configMissing = availability !== null && availability.config === null;
  const indexMissing = availability !== null && !availability.index.available;
  const canSend = Boolean(
    availability?.book && availability.config && availability.index.available && !running && question.trim(),
  );

  return {
    availability,
    loadError,
    loading,
    question,
    setQuestion,
    turns,
    running,
    title,
    format: availability?.book?.format ?? 'epub',
    configMissing,
    indexMissing,
    canSend,
    placeholder: turns.length > 0 ? '继续问书灯…' : '问问书灯…',
    service: serviceName(availability?.config?.provider),
    selectionPending: Boolean(selectionQuote) && !selectionUsedRef.current,
    indexDetail: availability?.index.detail ?? '',
    send,
    retry,
    cancel,
  };
}
