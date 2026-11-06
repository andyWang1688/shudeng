import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { AgentContextEstimate, AgentContextUsage, AgentRunSession } from '@shudeng/core';
import { getBookChatAvailability, startBookChatTurn, type BookChatAvailability } from '../../platform/ai';
import {
  appendBookChatTurn,
  createBookConversationId,
  loadBookConversation,
  registerConversationRun,
  cancelConversationRun,
  isBookConversationDeleted,
} from '../../platform/library';
import { friendlyError, serviceName, streamingAnswer } from './format';
import { nativeToolDetail, nativeToolPreview, nativeToolSummary, nativeToolTitle } from './toolPresentation';
import { questionSelection, selectionFields, type QuestionSelection } from './selectionPresentation';
import { captureQuestionOrigin, resolveQuestionOrigin, type QuestionOriginSnapshot } from '../../platform/library/questionOrigin';
import type { ChatTurn } from './types';
import {
  activeConversationRun,
  mergeConversationRun,
  finishConversationRun,
  publishConversationRun,
  subscribeConversationRun,
  discardConversationRun,
  type ConversationRunSnapshot,
  hasUnsavedConversationTurn,
} from './conversationRuntime';
import { createTurnPersistence } from './turnPersistence';
import type { QuestionPresentation } from '../reader-question/session';

export interface UseBookChatOptions {
  readonly bookId: string;
  readonly conversationId?: string | undefined;
  readonly bookTitleParam?: string | undefined;
  readonly selectionQuote?: string | undefined;
  readonly initialQuestion?: string | undefined;
  readonly readingPosition?: string | undefined;
  readonly presentation?: QuestionPresentation | undefined;
}

let sequence = 0;
const nextId = () => `turn-${Date.now()}-${++sequence}`;

/** Owns one independent conversation, its durable history, and exactly one active run. */
export function useBookChat(options: UseBookChatOptions) {
  const { bookId, bookTitleParam, selectionQuote, initialQuestion } = options;
  const [conversationId] = useState(() => options.conversationId ?? createBookConversationId());
  const [availability, setAvailability] = useState<BookChatAvailability | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [configurationNotice, setConfigurationNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [question, setLocalQuestion] = useState(options.presentation?.getSnapshot().draft ?? initialQuestion ?? '');
  const setQuestion = useCallback((value: string) => {
    const selection = options.presentation?.getSnapshot().selection;
    options.presentation?.update({ draft: value, ...(selection ? { selection: {
      start: Math.min(selection.start, value.length), end: Math.min(selection.end, value.length),
    } } : {}) });
    setLocalQuestion(value);
  }, [options.presentation]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [running, setRunning] = useState(false);
  const [contextUsage, setContextUsage] = useState<AgentContextUsage | undefined>();
  const [contextEstimate, setContextEstimate] = useState<AgentContextEstimate | undefined>();
  const firstBookTitle = useRef<string | undefined>(undefined);
  const session = useRef<AgentRunSession | null>(null);
  const runningRef = useRef(false);
  const cancelRequested = useRef(false);
  const history = useRef<Array<{ id: string; question: string; answer: string }>>([]);
  const savingTurns = useRef(new Set<string>());
  const selectionUsed = useRef(options.presentation?.getSnapshot().selectionConsumed ?? false);
  const conversationSelection = useRef(questionSelection(selectionQuote !== undefined ? { selectionQuote } : {}));
  const conversationOrigin = useRef<QuestionOriginSnapshot | null | undefined>(undefined);
  const initialSent = useRef(options.presentation?.getSnapshot().initialQuestionConsumed ?? false);
  const mounted = useRef(true);
  const latestSnapshot = useRef<ConversationRunSnapshot | undefined>(undefined);
  const dismissConfigurationNotice = useCallback(() => setConfigurationNotice(null), []);
  useEffect(() => {
    if (availability?.config) setConfigurationNotice(null);
  }, [availability?.config]);

  useEffect(
    () =>
      subscribeConversationRun(conversationId, (snapshot) => {
        latestSnapshot.current = snapshot;
        const { turn, running: busy } = snapshot;
        if (!mounted.current) return;
        runningRef.current = busy;
        setRunning(busy);
        if (turn.contextUsage) setContextUsage(turn.contextUsage);
        if (turn.contextEstimate) setContextEstimate(turn.contextEstimate);
        setTurns((items) => mergeConversationRun(items, snapshot));
        if (!busy && !turn.saveError) {
          const entry = { id: turn.id, question: turn.sourceQuestion ?? '', answer: turn.text };
          const index = history.current.findIndex(item => item.id === turn.id);
          if (index >= 0) history.current[index] = entry;
          else history.current.push(entry);
        }
      }),
    [conversationId],
  );

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void (async () => {
      try {
        const next = await getBookChatAvailability(bookId);
        const saved = await loadBookConversation(conversationId);
        if (!active) return;
        setAvailability(next);
        const hasLegacyTurns = saved.some(message => message.details.legacyNative !== undefined || message.id.startsWith('legacy-q:'));
        // Missing Native first-turn identity must not turn another round's selection or location into conversation context.
        const firstAnswer = saved.find(message => message.isFirstLegacyTurn) ??
          (hasLegacyTurns ? undefined : saved.find(message => message.role === 'assistant'));
        conversationSelection.current ??= firstAnswer ? questionSelection(firstAnswer.details) : undefined;
        const bookFormat = next.book?.format ?? options.presentation?.source?.format ?? 'epub';
        if (firstAnswer && conversationOrigin.current === undefined) {
          conversationOrigin.current = resolveQuestionOrigin({ bookId, format: bookFormat,
            questionOrigin: firstAnswer.details.questionOrigin, legacyNative: firstAnswer.details.legacyNative }) ?? null;
        }
        firstBookTitle.current ??= saved.find(message => message.details.bookTitle)?.details.bookTitle ??
          next.book?.title ?? bookTitleParam ?? '书内问答';
        const restored: ChatTurn[] = saved.map((message, index) => {
          const answer = message.role === 'user' ? saved[index + 1] : message;
          const selected = questionSelection(message.role === 'user' && answer?.role === 'assistant' ? answer.details : message.details);
          const origin = message.role === 'assistant' ? resolveQuestionOrigin({ bookId, format: bookFormat,
            questionOrigin: message.details.questionOrigin, legacyNative: message.details.legacyNative }) : undefined;
          return {
            id: message.id,
            role: message.role,
            text: message.text,
            reasoning: message.reasoning,
            tools: [...(message.details.tools ?? [])],
            ...(message.details.toolSummary !== undefined ? { toolSummary: message.details.toolSummary } : {}),
            citations: message.citations,
            ...(message.details.webSources ? { webSources: message.details.webSources } : {}),
            ...(message.details.webSearchStatus ? { webSearchStatus: message.details.webSearchStatus } : {}),
            warnings: [...(message.details.warnings ?? [])],
            status: message.role === 'user' ? 'done' : message.details.status,
            ...(message.details.error ? { error: message.details.error } : {}),
            ...(message.details.agentQuestion ? { agentQuestion: message.details.agentQuestion } : {}),
            ...selectionFields(selected),
            ...(message.role === 'assistant' && (message.details.questionOrigin !== undefined || message.details.legacyNative)
              ? { questionOrigin: origin ?? null } : {}),
            ...(message.details.reasoningDurationMs !== undefined
              ? { reasoningDurationMs: message.details.reasoningDurationMs }
              : {}),
            ...(message.details.modelSteps !== undefined ? { modelSteps: message.details.modelSteps } : {}),
            ...(message.details.contextUsage ? { contextUsage: message.details.contextUsage } : {}),
            ...(message.details.contextSummary ? { contextSummary: message.details.contextSummary } : {}),
            ...(message.details.contextEstimate ? { contextEstimate: message.details.contextEstimate } : {}),
            ...(message.details.sentMaterials ? { sentMaterials: message.details.sentMaterials } : {}),
            ...(message.details.legacyNative ? { legacyNative: message.details.legacyNative } : {}),
            ...(message.details.bookTitle ? { bookTitle: message.details.bookTitle } : {}),
            ...(message.role === 'assistant' && index > 0
              ? { sourceQuestion: saved[index - 1]?.text ?? '' }
              : {}),
          };
        });
        // A run can finish during either read. Its subscriber snapshot remains newer even
        // after finish removes it from the active map, so never replace it with stale disk data.
        const live = activeConversationRun(conversationId) ?? latestSnapshot.current;
        const merged = live ? mergeConversationRun(restored, live) : restored;
        setTurns(merged);
        runningRef.current = live?.running ?? false;
        setRunning(live?.running ?? false);
        history.current = [];
        for (let i = 1; i < merged.length; i++) {
          const answer = merged[i];
          const user = merged[i - 1];
          if (answer?.role === 'assistant' && answer.status !== 'streaming' && !answer.saveError && user?.role === 'user') {
            history.current.push({
              id: answer.id,
              question: user.text,
              answer: answer.text,
            });
          }
        }
        const usage = [...merged].reverse().find((turn) => turn.contextUsage)?.contextUsage;
        setContextUsage(usage);
        setContextEstimate([...merged].reverse().find(turn => turn.contextEstimate)?.contextEstimate);
        if (!next.book) setLoadError('原书已移除，仍可查看对话；重新导入后可继续提问。');
        else if (!next.index.available) setLoadError(next.index.detail);
      } catch (error) {
        if (active) setLoadError(friendlyError(error instanceof Error ? error.message : String(error)));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [bookId, conversationId, options.conversationId]);

  useFocusEffect(
    useCallback(() => {
      if (loading) return;
      let active = true;
      void getBookChatAvailability(bookId)
        .then((next) => {
          if (!active) return;
          setAvailability(next);
          setLoadError(
            !next.book
              ? '原书已移除，仍可查看对话；重新导入后可继续提问。'
              : !next.index.available
                ? next.index.detail
                : null,
          );
        })
        .catch((error: unknown) => {
          if (active) setLoadError(friendlyError(String(error)));
        });
      return () => {
        active = false;
      };
    }, [bookId, loading]),
  );

  const persist = useCallback(
    async (turn: ChatTurn) => {
      await appendBookChatTurn({
        bookId,
        conversationId,
        assistantId: turn.id,
        question: turn.sourceQuestion ?? '',
        answer: turn.text,
        citations: turn.citations,
        details: {
          status: turn.status,
          reasoning: turn.reasoning,
          tools: turn.tools,
          ...(turn.toolSummary !== undefined ? { toolSummary: turn.toolSummary } : {}),
          warnings: turn.warnings,
          ...(turn.webSources ? { webSources: turn.webSources } : {}),
          ...(turn.webSearchStatus ? { webSearchStatus: turn.webSearchStatus } : {}),
          ...(turn.agentQuestion ? { agentQuestion: turn.agentQuestion } : {}),
          ...(turn.selectionQuote !== undefined ? { selectionQuote: turn.selectionQuote } : {}),
          ...(turn.selectionContextQuote !== undefined ? { selectionContextQuote: turn.selectionContextQuote } : {}),
          ...(turn.selectionAttached !== undefined ? { selectionAttached: turn.selectionAttached } : {}),
          ...(turn.questionOrigin !== undefined ? { questionOrigin: turn.questionOrigin } : {}),
          ...(turn.error ? { error: turn.error } : {}),
          ...(turn.reasoningDurationMs !== undefined
            ? { reasoningDurationMs: turn.reasoningDurationMs }
            : {}),
          ...(turn.modelSteps !== undefined ? { modelSteps: turn.modelSteps } : {}),
          ...(turn.contextUsage ? { contextUsage: turn.contextUsage } : {}),
          ...(turn.contextSummary ? { contextSummary: turn.contextSummary } : {}),
          ...(turn.contextEstimate ? { contextEstimate: turn.contextEstimate } : {}),
          ...(turn.sentMaterials ? { sentMaterials: turn.sentMaterials } : {}),
          ...(turn.legacyNative ? { legacyNative: turn.legacyNative } : {}),
          ...(turn.bookTitle ? { bookTitle: turn.bookTitle } : {}),
        },
      });
    },
    [bookId, conversationId],
  );

  const run = useCallback(
    async (input: { display: string; agent: string; selection?: QuestionSelection; questionOrigin?: QuestionOriginSnapshot | null; retryId?: string }) => {
      if (
        runningRef.current ||
        activeConversationRun(conversationId)?.running ||
        hasUnsavedConversationTurn(conversationId, turns) ||
        !availability?.book ||
        !availability.config ||
        !availability.index.available
      )
        return;
      runningRef.current = true;
      cancelRequested.current = false;
      setRunning(true);
      const unregister = registerConversationRun(conversationId, () => {
        cancelRequested.current = true;
        session.current?.cancel();
      });
      const id = input.retryId ?? nextId();
      let current: ChatTurn = {
        id,
        role: 'assistant',
        text: '',
        reasoning: '',
        tools: [],
        citations: [],
        warnings: [],
        status: 'streaming',
        sourceQuestion: input.display,
        agentQuestion: input.agent,
        bookTitle: firstBookTitle.current ?? availability.book.title,
        ...selectionFields(input.selection),
        ...(input.questionOrigin !== undefined ? { questionOrigin: input.questionOrigin } : {}),
      };
      setTurns((items) =>
        input.retryId
          ? items.map((item) => (item.id === id ? current : item))
          : [
              ...items,
              {
                id: id + ':user',
                role: 'user',
                text: input.display,
                reasoning: '',
                tools: [],
                citations: [],
                warnings: [],
                status: 'done',
                ...selectionFields(input.selection),
              },
              current,
            ],
      );
      let frame: number | null = null;
      const publishCurrent = () => publishConversationRun(conversationId, current, {
        bookId, bookTitle: current.bookTitle ?? availability.book!.title,
      });
      publishCurrent();
      const publish = () => {
        if (frame !== null) return;
        frame = requestAnimationFrame(() => {
          frame = null;
          publishCurrent();
        });
      };
      const reportSaveError = (error: unknown) => {
        current = {
          ...current,
          saveError: '对话保存失败：' + (error instanceof Error ? error.message : String(error)),
        };
        publish();
      };
      const writer = createTurnPersistence(persist, reportSaveError);
      const appState = AppState.addEventListener('change', (state) => {
        if (state !== 'active') void writer.flush(current).catch(reportSaveError);
      });
      let reasoningStart: number | null = null;
      let reasoningMs = 0;
      let rawText = '';
      const stopThinking = () => {
        if (reasoningStart !== null) {
          reasoningMs += Date.now() - reasoningStart;
          reasoningStart = null;
        }
        current = { ...current, reasoningDurationMs: reasoningMs };
      };
      try {
        // Persist the question before the request, so termination cannot lose the reader's input.
        await writer.flush(current);
        const started = await startBookChatTurn({
          bookId,
          question: input.display,
          ...(input.selection?.contextQuote ? { selectionQuote: input.selection.contextQuote } : {}),
          history: (input.retryId ? history.current.filter(entry =>
            turns.findIndex(turn => turn.id === entry.id) < turns.findIndex(turn => turn.id === input.retryId)) : history.current)
            .map(({ question, answer }) => ({ question, answer })),
          ...(input.questionOrigin ? { readingPosition: input.questionOrigin.readingPosition } : {}),
        });
        session.current = started.session;
        if (cancelRequested.current) started.session.cancel();
        let terminal = false;
        for await (const event of started.session.events) {
          switch (event.type) {
            case 'reasoningDelta':
              if (reasoningStart === null) reasoningStart = Date.now();
              current = { ...current, reasoning: current.reasoning + event.delta };
              break;
            case 'textDelta':
              stopThinking();
              rawText += event.delta;
              current = { ...current, text: streamingAnswer(rawText) };
              break;
            case 'toolStarted':
              stopThinking();
              current = {
                ...current,
                tools: [...current.tools, { callId: event.callId || nextId(), name: event.name, status: 'running',
                  title: nativeToolTitle(event.name), detail: nativeToolDetail(event.args), preview: '', durationMs: 0, finished: false }],
              };
              break;
            case 'toolFinished': {
              const callId = event.callId || current.tools[current.tools.length - 1]?.callId || nextId();
              const index = current.tools.map(tool => tool.callId).lastIndexOf(callId);
              const prior = index >= 0 ? current.tools[index] : undefined;
              const { durationMs: _previousDuration, ...base } = prior ?? { callId, name: event.name, title: nativeToolTitle(event.name), detail: '' };
              const finished = { ...base, status: event.isError ? 'error' as const : 'done' as const,
                preview: nativeToolPreview(event.content), finished: true,
                ...(Number.isFinite(event.durationMs) && event.durationMs >= 0 && event.durationMs <= Number.MAX_SAFE_INTEGER ? { durationMs: event.durationMs } : {}) };
              current = {
                ...current,
                tools: index >= 0 ? current.tools.map((tool, position) => position === index ? finished : tool) : [...current.tools, finished],
              };
              break;
            }
            case 'citation':
              current = {
                ...current,
                citations: [
                  ...current.citations.filter((citation) => citation.id !== event.citation.id),
                  event.citation,
                ],
              };
              break;
            case 'contextUsage':
              current = { ...current, contextUsage: event.usage };
              if (mounted.current) setContextUsage(event.usage);
              break;
            case 'webSource':
              current = { ...current, webSources: [
                ...(current.webSources ?? []).filter(source => source.id !== event.source.id), event.source,
              ] };
              break;
            case 'webSearchStatus':
              current = { ...current, webSearchStatus: { status: event.status,
                ...(event.message ? { message: event.message } : {}) } };
              break;
            case 'requestContext':
              current = { ...current, contextEstimate: event.estimate, sentMaterials: event.materials };
              if (mounted.current) setContextEstimate(event.estimate);
              break;
            case 'contextCompacted':
              current = { ...current, contextSummary: event.summary };
              break;
            case 'completed':
              terminal = true;
              stopThinking();
              current = {
                ...current,
                text: event.result.answer,
                citations: event.result.citations,
                ...(event.result.webSources ? { webSources: event.result.webSources } : {}),
                warnings: event.result.warnings,
                status: 'done',
                ...(Number.isSafeInteger(event.result.steps) && event.result.steps >= 0 ? { modelSteps: event.result.steps } : {}),
                ...(Number.isSafeInteger(event.result.steps) && event.result.steps >= 0
                  ? { toolSummary: nativeToolSummary(event.result.steps, event.result.citations.length, event.result.warnings) } : {}),
                ...(event.result.contextSummary ? { contextSummary: event.result.contextSummary } : {}),
                ...(event.result.contextEstimate ? { contextEstimate: event.result.contextEstimate } : {}),
                ...(event.result.sentMaterials ? { sentMaterials: event.result.sentMaterials } : {}),
              };
              break;
            case 'failed':
              terminal = true;
              stopThinking();
              current = { ...current, status: 'error', error: friendlyError(event.message) };
              break;
            case 'cancelled':
              terminal = true;
              stopThinking();
              current = { ...current, status: 'cancelled' };
              break;
            case 'started':
              break;
          }
          writer.schedule(current);
          publish();
        }
        await started.session.result;
        if (!terminal) {
          stopThinking();
          current = { ...current, status: 'error', error: 'AI 服务没有完成回答，请重试。' };
        }
      } catch (error) {
        stopThinking();
        current = {
          ...current,
          status: cancelRequested.current ? 'cancelled' : 'error',
          error: friendlyError(error instanceof Error ? error.message : String(error)),
        };
      } finally {
        appState.remove();
        if (frame !== null) cancelAnimationFrame(frame);
        if (current.webSearchStatus?.status === 'searching') {
          current = { ...current, webSearchStatus: current.status === 'done' && current.webSources?.length
            ? { status: 'complete' }
            : { status: 'failed', message: current.status === 'cancelled' ? '联网搜索已停止。' : '联网搜索未完成，可重试。' } };
        }
        try {
          await writer.flush(current);
          const { saveError: _, ...saved } = current;
          current = saved;
        } catch (error) {
          current = {
            ...current,
            saveError: '对话保存失败：' + (error instanceof Error ? error.message : String(error)),
          };
        }
        if (frame !== null) cancelAnimationFrame(frame);
        if (isBookConversationDeleted(conversationId)) discardConversationRun(conversationId);
        else finishConversationRun(conversationId, current);
        session.current = null;
        runningRef.current = false;
        unregister();
      }
    },
    [availability, bookId, conversationId, persist, turns],
  );

  const send = useCallback(
    async (override?: string) => {
      const text = (override ?? question).trim();
      if (!text || runningRef.current || hasUnsavedConversationTurn(conversationId, turns) ||
        !availability?.book) return false;
      if (!availability.config) {
        setConfigurationNotice('还没有配置 AI 模型，设置后即可发送。');
        return false;
      }
      if (!availability.index.available) return false;
      setConfigurationNotice(null);
      const selected = conversationSelection.current;
      const origin = options.readingPosition !== undefined
        ? captureQuestionOrigin({ bookId, format: availability.book.format, readingPosition: options.readingPosition }) ?? null
        : conversationOrigin.current;
      if (conversationOrigin.current === undefined) conversationOrigin.current = origin ?? null;
      selectionUsed.current = true;
      options.presentation?.update({ selectionConsumed: true });
      setQuestion('');
      await run({
        display: text,
        agent: selected?.contextQuote ? '我选中了书中这段原文：「' + selected.contextQuote + '」\n\n' + text : text,
        ...(selected ? { selection: selected } : {}),
        ...(origin !== undefined ? { questionOrigin: origin } : {}),
      });
      return true;
    },
    [availability, bookId, conversationId, options.presentation, options.readingPosition, question, run, setQuestion, turns],
  );

  useEffect(() => {
    if (
      loading ||
      initialSent.current ||
      !initialQuestion ||
      !availability?.config ||
      !availability.index.available
    )
      return;
    initialSent.current = true;
    options.presentation?.update({ initialQuestionConsumed: true });
    void send(initialQuestion);
  }, [availability, initialQuestion, loading, options.presentation, send]);

  const retry = useCallback(
    (turn: ChatTurn) => {
      if (runningRef.current) return;
      if (turn.saveError) {
        if (savingTurns.current.has(turn.id)) return;
        savingTurns.current.add(turn.id);
        void persist(turn)
          .then(() => {
            const { saveError: _, ...saved } = turn;
            finishConversationRun(conversationId, saved);
          })
          .catch((error: unknown) => setLoadError('对话保存失败：' + String(error)))
          .finally(() => { savingTurns.current.delete(turn.id); });
        return;
      }
      const agent = turn.agentQuestion ?? turn.sourceQuestion;
      const selected = questionSelection(turn) ?? conversationSelection.current;
      const origin = availability?.book ? resolveQuestionOrigin({ bookId, format: availability.book.format,
        questionOrigin: turn.questionOrigin, legacyNative: turn.legacyNative }) : undefined;
      if (agent)
        void run({
          display: turn.sourceQuestion ?? agent,
          agent,
          retryId: turn.id,
          ...(selected ? { selection: selected } : {}),
          ...(turn.questionOrigin !== undefined || turn.legacyNative ? { questionOrigin: origin ?? null } : {}),
        });
    },
    [availability, bookId, conversationId, persist, run],
  );

  return {
    availability,
    loadError,
    loading,
    question,
    setQuestion,
    turns,
    running,
    contextUsage,
    contextEstimate,
    hasExternalMaterials: turns.some(turn => turn.sentMaterials?.some(material => material.kind === 'external-tool')),
    conversationId,
    title: availability?.book?.title ?? bookTitleParam ?? '书内问答',
    format: availability?.book?.format ?? 'epub',
    configMissing: availability !== null && availability.config === null,
    configurationNotice,
    dismissConfigurationNotice,
    indexMissing: availability !== null && !availability.index.available,
    canSend: Boolean(
      !loading &&
        availability?.book &&
        (!availability.config || availability.index.available) &&
        !hasUnsavedConversationTurn(conversationId, turns) &&
        !running &&
        question.trim(),
    ),
    placeholder: turns.length > 0 ? '继续问书灯…' : '问问书灯…',
    service: serviceName(availability?.config),
    selectionPending: Boolean(selectionQuote) && !selectionUsed.current,
    indexDetail: availability?.index.detail ?? '',
    send,
    retry,
    cancel: () => {
      cancelConversationRun(conversationId);
    },
  };
}
