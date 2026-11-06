import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Alert, Keyboard } from 'react-native';
import { useRootNavigationState, useRouter } from 'expo-router';
import { createBookConversationId } from '../../platform/library/conversations';
import type { StoredReaderLocator } from '../../platform/library/types';
import { QuestionPresentation, ReaderQuestionRegistry, type CitationTarget, type QuestionLaunch, type ReaderReferencePort, type ReferenceRoute } from './session';

type Transition = Readonly<{ target?: string; data: Readonly<{ closing: boolean }> }>;
type PendingTransition = { finish: (completed: boolean) => void };
type RootSnapshot = Readonly<{ keys: readonly string[]; activeKey: string | undefined }>;
type QuestionReturn = Readonly<{ questionKey: string; coveringRouteKey: string }>;
type ReaderStackRoute = Readonly<{ key: string; name: string; params?: unknown; state?: unknown }>;
type ReaderStackState = Readonly<{ index: number; routeNames: readonly string[]; routes: readonly ReaderStackRoute[] }>;
type QuestionContext = Readonly<{
  registry: ReaderQuestionRegistry;
  transitionEnd: (event: Transition) => void;
  subscribeAppearance: (presentationId: string, listener: () => void) => () => void;
}>;
const Context = createContext<QuestionContext | null>(null);

export function ReaderQuestionProvider({ children }: { readonly children: ReactNode }) {
  const router = useRouter();
  const rootState = readerQuestionStackFromRoot(useRootNavigationState());
  const current = useRef({ router, rootState });
  current.current = { router, rootState };
  const pending = useRef(new Map<string, PendingTransition>());
  const appearances = useRef(new Map<string, Set<() => void>>());
  const appearedQuestion = useRef<string | null>(null);
  const previousRoot = useRef<RootSnapshot | null>(null);
  const returningQuestion = useRef<QuestionReturn | null>(null);
  const active = rootState?.routes[rootState.index];
  const keys = rootState?.routes.slice(0, rootState.index + 1).map(route => route.key) ?? [];
  const previous = previousRoot.current;
  if (active?.key !== previous?.activeKey) {
    appearedQuestion.current = null; returningQuestion.current = null;
    // A closing event can only reveal this question if the preceding root stack
    // actually popped its covering route(s). The exact previous top must close;
    // unrelated or late events cannot stand in for the current return transition.
    if (active?.name === 'book-chat' && previous?.activeKey &&
        previous.keys.length > keys.length && keys.every((key, index) => previous.keys[index] === key)) {
      returningQuestion.current = { questionKey: active.key, coveringRouteKey: previous.activeKey };
    }
  }
  if (active?.name !== 'book-chat') appearedQuestion.current = null;
  previousRoot.current = { keys, activeKey: active?.key };
  const [registry] = useState(() => new ReaderQuestionRegistry(createBookConversationId, {
    dismissQuestion: (questionRouteKey, readerRouteKey, signal) => {
      const state = current.current.rootState;
      if (!state || state.routes[state.index]?.key !== questionRouteKey || state.routes[state.index - 1]?.key !== readerRouteKey || signal.aborted) return Promise.resolve(false);
      appearedQuestion.current = null; returningQuestion.current = null;
      return new Promise<boolean>(resolve => {
        const finish = (completed: boolean) => {
          if (pending.current.get(questionRouteKey)?.finish !== finish) return;
          pending.current.delete(questionRouteKey);
          signal.removeEventListener('abort', cancel);
          resolve(completed);
        };
        const cancel = () => finish(false);
        pending.current.set(questionRouteKey, { finish });
        signal.addEventListener('abort', cancel, { once: true });
        Keyboard.dismiss();
        current.current.router.back();
      });
    },
    presentQuestion: presentation => {
      appearedQuestion.current = null; returningQuestion.current = null;
      current.current.router.push({ pathname: '/book-chat', params: {
        questionPresentationId: presentation.id, bookId: presentation.bookId, bookTitle: presentation.title,
        conversationId: presentation.conversationId, ...presentation.appearanceParams(),
      } });
    },
    presentReference: (presentation, target, visitId, questionRouteKey) => {
      const state = current.current.rootState;
      const route = state?.routes[state.index];
      if (route?.name !== 'book-chat' || route.key !== questionRouteKey) throw new Error('原问答已关闭');
      appearedQuestion.current = null; returningQuestion.current = null;
      Keyboard.dismiss();
      current.current.router.push({ pathname: '/reader/[id]', params: {
        id: presentation.bookId, locator: JSON.stringify(target.locator), quote: target.quote,
        questionPresentationId: presentation.id, questionReferenceVisitId: visitId,
      } });
    },
  }));
  const hasCurrentAppearance = useCallback((presentationId: string) => {
    const state = current.current.rootState;
    const route = state?.routes[state.index];
    if (route?.name !== 'book-chat' || route.key !== appearedQuestion.current) { appearedQuestion.current = null; return false; }
    return questionPresentationIdFromRoute(route) === presentationId || registry.get(presentationId)?.routeKeys.has(route.key);
  }, [registry]);
  const transitionEnd = useCallback((event: Transition) => {
    if (event.target && event.data.closing) pending.current.get(event.target)?.finish(true);
    const state = current.current.rootState;
    const active = state?.routes[state.index];
    // A history reader carries the presentation token too, but is not the question.
    if (active?.name !== 'book-chat' || !event.target) return;
    if (event.data.closing) {
      const returning = returningQuestion.current;
      if (returning?.questionKey !== active.key || returning.coveringRouteKey !== event.target) return;
    } else if (event.target !== active.key) return;
    returningQuestion.current = null;
    appearedQuestion.current = active.key;
    for (const [presentationId, listeners] of appearances.current) {
      if (hasCurrentAppearance(presentationId)) for (const listener of listeners) listener();
    }
  }, [hasCurrentAppearance]);
  const subscribeAppearance = useCallback((presentationId: string, listener: () => void) => {
    let listeners = appearances.current.get(presentationId);
    if (!listeners) { listeners = new Set(); appearances.current.set(presentationId, listeners); }
    listeners.add(listener);
    // The thread can mount after availability/history reads outlast the native
    // transition. Replay its current appearance, never a hidden question's event.
    if (hasCurrentAppearance(presentationId)) listener();
    return () => { listeners.delete(listener); if (listeners.size === 0) appearances.current.delete(presentationId); };
  }, [hasCurrentAppearance]);
  useEffect(() => {
    if (!rootState?.routes.length) return;
    const questionRoutes = new Map<string, string>();
    const referenceRoutes = new Map<string, ReferenceRoute>();
    for (const route of rootState.routes) {
      const presentationId = questionPresentationIdFromRoute(route);
      if (route.name === 'book-chat' && presentationId) questionRoutes.set(route.key, presentationId);
      const visitId = questionReferenceVisitIdFromRoute(route);
      if (route.name === 'reader/[id]' && presentationId && visitId) referenceRoutes.set(route.key, { presentationId, visitId });
    }
    registry.prune(new Set(rootState.routes.map(route => route.key)), questionRoutes, referenceRoutes);
  }, [registry, rootState]);
  useEffect(() => () => {
    for (const transition of pending.current.values()) transition.finish(false);
    registry.dispose();
  }, [registry]);
  return <Context.Provider value={{ registry, transitionEnd, subscribeAppearance }}>{children}</Context.Provider>;
}

export function useReaderQuestionRegistry(): ReaderQuestionRegistry {
  const context = useContext(Context);
  if (!context) throw new Error('ReaderQuestionProvider is missing');
  return context.registry;
}
export function useQuestionTransitionEnd(): (event: Transition) => void {
  const context = useContext(Context);
  if (!context) throw new Error('ReaderQuestionProvider is missing');
  return context.transitionEnd;
}

/** Equivalent to native viewDidAppear, including return from a history reference reader. */
export function useQuestionAppearance(presentation: QuestionPresentation, listener: () => void): void {
  const context = useContext(Context);
  if (!context) throw new Error('ReaderQuestionProvider is missing');
  const latest = useRef(listener); latest.current = listener;
  useLayoutEffect(() => context.subscribeAppearance(presentation.id, () => latest.current()), [context.subscribeAppearance, presentation.id]);
}

export type ReaderQuestionOptions = Readonly<{
  bookId: string; format: 'epub' | 'pdf'; title?: string | undefined; theme: 'light' | 'dark';
  getLocator: () => StoredReaderLocator | null;
  navigate: ReaderReferencePort['navigate'];
  flushProgress: ReaderReferencePort['flushProgress'];
  documentFailed: boolean;
}>;

/** A reader route owns its source session. Native view detach/retry does not dispose it. */
export function useReaderQuestions(options: ReaderQuestionOptions) {
  const registry = useReaderQuestionRegistry();
  const state = readerQuestionStackFromRoot(useRootNavigationState());
  const latest = useRef(options); latest.current = options;
  const [owner] = useState(() => {
    const routeKey = state?.routes[state.index]?.key;
    if (!routeKey) throw new Error('阅读器缺少路由标识');
    return { id: registry.makeId(), routeKey, bookId: options.bookId, format: options.format };
  });
  // Register before useSyncExternalStore subscribes. Route removal, not effect cleanup,
  // controls disposal: React Activity can clean effects while a sheet covers the reader.
  const [port] = useState<ReaderReferencePort>(() => ({
    navigate: command => latest.current.navigate(command),
    flushProgress: () => latest.current.flushProgress(),
    documentFailed: () => latest.current.documentFailed,
  }));
  useLayoutEffect(() => { registry.register(owner, port); }, [owner, port, registry]);
  const subscribe = useCallback((listener: () => void) => registry.subscribeReader(owner.id, listener), [owner.id, registry]);
  const getSnapshot = useCallback(() => registry.readerSnapshot(owner.id), [owner.id, registry]);
  const reference = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const returnToQuestion = useCallback(async (): Promise<boolean> => {
    const result = await registry.returnToQuestion(owner.id);
    if (result.status === 'save-failed') {
      Alert.alert('位置与设置尚未保存', result.message, [
        { text: '留在阅读页', style: 'cancel' },
        { text: '仍然返回问答', style: 'destructive', onPress: () => {
          void registry.returnToQuestion(owner.id, true).then(value => {
            if (value.status === 'failed') Alert.alert('无法返回问答', value.message);
          });
        } },
      ]);
    } else if (result.status === 'failed') Alert.alert('无法返回问答', result.message);
    return result.status === 'returned';
  }, [owner.id, registry]);
  const ask = useCallback((selection?: Readonly<{ quote: string; locator: StoredReaderLocator }>) => {
    const snapshot = registry.readerSnapshot(owner.id);
    if (snapshot.busy) return;
    if (snapshot.reference && owner.format === 'epub') {
      // askCurrentBook preserves questionOrigin and the citation page; only the
      // explicit backToQuestion action restores origin and clears reference mode.
      if (!selection) registry.reopenActiveQuestion(owner.id);
      return;
    }
    if (snapshot.reference && !selection) { void returnToQuestion(); return; }
    if (!selection && registry.reopenActiveQuestion(owner.id)) return;
    const value = latest.current;
    const origin = selection?.locator ?? value.getLocator();
    if (!origin) { Alert.alert('尚未取得阅读位置', '正文就绪后再提问。'); return; }
    registry.openQuestion(owner.id, { bookId: owner.bookId, title: value.title, theme: value.theme, origin, selection });
  }, [owner, registry, returnToQuestion]);
  return { ask, referenceMode: owner.format === 'epub' && reference.reference !== null, busy: reference.busy, returnToQuestion, readerSessionId: owner.id };
}

export function useQuestionPresentation(input: QuestionLaunch & Readonly<{ presentationId?: string | undefined }>): QuestionPresentation {
  const registry = useReaderQuestionRegistry();
  const state = readerQuestionStackFromRoot(useRootNavigationState());
  const [routeKey] = useState(() => state?.routes[state.index]?.key);
  const [presentation] = useState(() => {
    const existing = registry.get(input.presentationId);
    return existing?.bookId === input.bookId && (!input.conversationId || existing.conversationId === input.conversationId)
      ? existing : registry.createHistory(input);
  });
  useLayoutEffect(() => registry.bind(presentation, routeKey), [presentation, registry, routeKey]);
  return presentation;
}

export function useOpenQuestionCitation(presentation: QuestionPresentation): (target: CitationTarget) => void {
  const registry = useReaderQuestionRegistry();
  const state = readerQuestionStackFromRoot(useRootNavigationState());
  const [questionRouteKey] = useState(() => state?.routes[state.index]?.key ?? '');
  return useCallback((target: CitationTarget) => {
    void registry.openReference(presentation, questionRouteKey, target).then(result => {
      if (result.status === 'failed') Alert.alert('无法定位原文', result.message);
    });
  }, [presentation, questionRouteKey, registry]);
}

/** Root params may wrap the explicit token inside the nested book-chat/index state. */
export function questionPresentationIdFromRoute(route: unknown): string | undefined {
  return questionParamFromRoute(route, 'questionPresentationId');
}

export function questionReferenceVisitIdFromRoute(route: unknown): string | undefined {
  return questionParamFromRoute(route, 'questionReferenceVisitId');
}

/** Expo Router wraps app/_layout's Stack in its persistent __root navigator.
 * Scope route ownership and transitions to the Stack declaring our two screens,
 * before descending into book-chat's or a tab's nested navigator. */
export function readerQuestionStackFromRoot(root: unknown): ReaderStackState | undefined {
  const visited = new Set<unknown>();
  let candidate = root;
  while (candidate && typeof candidate === 'object' && !visited.has(candidate)) {
    visited.add(candidate);
    const state = candidate as Partial<ReaderStackState>;
    const index = state.index;
    if (!Array.isArray(state.routes) || !Array.isArray(state.routeNames) ||
        typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= state.routes.length ||
        !state.routes.every(route => route && typeof route.key === 'string' && typeof route.name === 'string')) return undefined;
    if (state.routeNames.includes('reader/[id]') && state.routeNames.includes('book-chat')) return state as ReaderStackState;
    candidate = state.routes[index]?.state;
  }
  return undefined;
}

function questionParamFromRoute(route: unknown, name: string): string | undefined {
  if (!route || typeof route !== 'object') return undefined;
  const node = route as { params?: Record<string, unknown>; state?: { routes?: unknown[]; index?: number } };
  if (typeof node.params?.[name] === 'string') return node.params[name];
  if (node.params?.params) return questionParamFromRoute({ params: node.params.params }, name);
  const routes = node.state?.routes;
  return routes?.length ? questionParamFromRoute(routes[node.state?.index ?? routes.length - 1], name) : undefined;
}
