import type { ChatTurn } from './types';

export interface ConversationRunSnapshot {
  readonly turn: ChatTurn;
  readonly running: boolean;
}

type RuntimeTurn = {
  readonly [Key in keyof ChatTurn]: ChatTurn[Key] extends Array<infer Item> ? readonly Readonly<Item>[] : ChatTurn[Key];
};

export interface ConversationRuntimeRecord {
  readonly turn: RuntimeTurn;
  readonly running: boolean;
  readonly conversationId: string;
  readonly bookId: string;
  readonly bookTitle: string;
  readonly updatedAt: number;
}

type Listener = (snapshot: ConversationRunSnapshot) => void;
const active = new Map<string, ConversationRunSnapshot>();
const listeners = new Map<string, Set<Listener>>();
const records = new Map<string, ConversationRuntimeRecord>();
const runtimeListeners = new Set<() => void>();
let runtimeSnapshot: readonly ConversationRuntimeRecord[] = Object.freeze([]);

function readonlyTurn(turn: ChatTurn): RuntimeTurn {
  return Object.freeze({ ...turn,
    tools: Object.freeze(turn.tools.map(tool => Object.freeze({ ...tool }))),
    citations: Object.freeze(turn.citations.map(citation => Object.freeze({ ...citation }))),
    ...(turn.webSources ? { webSources: Object.freeze(turn.webSources.map(source => Object.freeze({ ...source }))) } : {}),
    ...(turn.webSearchStatus ? { webSearchStatus: Object.freeze({ ...turn.webSearchStatus }) } : {}),
    warnings: Object.freeze([...turn.warnings]),
    ...(turn.contextUsage ? { contextUsage: Object.freeze({ ...turn.contextUsage }) } : {}),
    ...(turn.contextEstimate ? { contextEstimate: Object.freeze({ ...turn.contextEstimate }) } : {}),
    ...(turn.sentMaterials ? { sentMaterials: Object.freeze(turn.sentMaterials.map(material => Object.freeze({ ...material }))) } : {}),
  });
}

function publishRuntime(): void {
  runtimeSnapshot = Object.freeze([...records.values()]);
  for (const listener of runtimeListeners) listener();
}

/** Stable snapshots include runs that have not reached durable storage yet. */
export function getConversationRuntimeSnapshots(): readonly ConversationRuntimeRecord[] {
  return runtimeSnapshot;
}

export function subscribeConversationRuntime(listener: () => void): () => void {
  runtimeListeners.add(listener);
  return () => { runtimeListeners.delete(listener); };
}

export function discardConversationRun(id: string): void {
  active.delete(id);
  if (records.delete(id)) publishRuntime();
}

/** Runs belong to conversations, so dismissing a sheet does not discard or cancel them. */
export function activeConversationRun(id: string): ConversationRunSnapshot | undefined {
  return active.get(id);
}

export function hasUnsavedConversationTurn(id: string, turns: readonly ChatTurn[] = []): boolean {
  return Boolean(active.get(id)?.turn.saveError) || turns.some(turn => Boolean(turn.saveError));
}

export function mergeConversationRun(
  turns: readonly ChatTurn[],
  snapshot: ConversationRunSnapshot,
): ChatTurn[] {
  const turn = snapshot.turn;
  if (turns.some((item) => item.id === turn.id))
    return turns.map((item) => (item.id === turn.id ? turn : item));
  const user: ChatTurn = {
    id: turn.id + ':user',
    role: 'user',
    text: turn.sourceQuestion ?? '',
    reasoning: '',
    tools: [],
    citations: [],
    warnings: [],
    status: 'done',
    ...(turn.selectionQuote ? { selectionQuote: turn.selectionQuote } : {}),
  };
  return [...turns, ...(turns.some((item) => item.id === user.id) ? [] : [user]), turn];
}

export function publishConversationRun(
  id: string, turn: ChatTurn, book?: { readonly bookId: string; readonly bookTitle: string },
): void {
  const retained = active.get(id);
  if (retained?.turn.saveError && retained.turn.id !== turn.id) return;
  const snapshot = { turn, running: true };
  active.set(id, snapshot);
  const previous = records.get(id);
  if (previous || book) {
    records.set(id, Object.freeze({
      ...snapshot, turn: readonlyTurn(turn), conversationId: id, bookId: previous?.bookId ?? book!.bookId,
      bookTitle: previous?.bookTitle ?? book!.bookTitle, updatedAt: Date.now(),
    }));
    publishRuntime();
  }
  for (const listener of listeners.get(id) ?? []) listener(snapshot);
}

export function finishConversationRun(id: string, turn: ChatTurn): void {
  const retained = active.get(id);
  if (retained && retained.turn.id !== turn.id) return;
  if (turn.saveError) active.set(id, { turn, running: false });
  else active.delete(id);
  const previous = records.get(id);
  if (previous) {
    if (turn.saveError) records.set(id, Object.freeze({ ...previous, turn: readonlyTurn(turn), running: false, updatedAt: Date.now() }));
    else records.delete(id);
    publishRuntime();
  }
  for (const listener of listeners.get(id) ?? []) listener({ turn, running: false });
}

export function subscribeConversationRun(id: string, listener: Listener): () => void {
  const observers = listeners.get(id) ?? new Set<Listener>();
  observers.add(listener);
  listeners.set(id, observers);
  return () => {
    observers.delete(listener);
    if (observers.size === 0) listeners.delete(id);
  };
}
