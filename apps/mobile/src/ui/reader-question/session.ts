import type { StoredReaderLocator } from '../../platform/library/types';

export type ReaderOwner = Readonly<{ id: string; routeKey: string; bookId: string; format: 'epub' | 'pdf' }>;
export type CitationTarget = Readonly<{ locator: StoredReaderLocator; quote: string; ordinal: number; id: string }>;
export type ReferenceCommand = CitationTarget & Readonly<{ operationId: string; citation: boolean }>;
export type NavigationReceipt = Readonly<{ operationId: string; status: 'arrived' | 'failed'; message?: string }>;
export interface ReaderReferencePort {
  navigate(command: ReferenceCommand): Promise<NavigationReceipt>;
  flushProgress(): Promise<boolean>;
  documentFailed(): boolean;
}
export type QuestionScroll = Readonly<{ offset: number; anchorId?: string; anchorOffset?: number }>;
export type QuestionTheme = 'light' | 'dark';
export type QuestionAppearance = Readonly<{ kind: 'application' }> | Readonly<{ kind: 'reader'; theme: QuestionTheme }>;
type AppearanceParams = Readonly<{ appearance?: string | string[] | undefined; theme?: string | string[] | undefined }>;

/** PDF follows the application; EPUB keeps the theme of its owning reader. */
export function resolveQuestionAppearance(appearance: QuestionAppearance, applicationMode: QuestionTheme): QuestionTheme {
  return appearance.kind === 'application' ? applicationMode : appearance.theme;
}

export function questionAppearanceParams(appearance: QuestionAppearance): { appearance: 'application' } | { appearance: 'reader'; theme: QuestionTheme } {
  return appearance.kind === 'application' ? { appearance: 'application' } : { appearance: 'reader', theme: appearance.theme };
}

/** Theme-only links retain their fixed theme; unknown policy tokens use that legacy contract. */
export function questionAppearanceFromParams(params: AppearanceParams): QuestionAppearance {
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  if (first(params.appearance) === 'application') return { kind: 'application' };
  const theme = first(params.theme);
  return theme === 'light' || theme === 'dark' ? { kind: 'reader', theme } : { kind: 'application' };
}
export type QuestionViewState = Readonly<{
  draft: string;
  selection: Readonly<{ start: number; end: number }>;
  selectionConsumed: boolean;
  initialQuestionConsumed: boolean;
  scroll: QuestionScroll;
  expandedSelection: readonly string[];
  expandedReasoning: readonly string[];
  expandedTools: readonly string[];
  reasoningStatus: Readonly<Record<string, string>>;
  reasoningManual: readonly string[];
  sheetDetent: number;
  referenceFocus: string | null;
  restoreReferenceFocus: boolean;
}>;

/** This is transient presentation state, separate from persisted messages and Agent runs. */
export class QuestionPresentation {
  private view: QuestionViewState;
  readonly appearance: QuestionAppearance;
  private readonly listeners = new Set<() => void>();
  bindings = 0;
  holds = 0;
  pendingPresentations = 0;
  readonly routeKeys = new Set<string>();
  constructor(
    readonly id: string,
    readonly conversationId: string,
    readonly bookId: string,
    readonly title: string,
    theme: QuestionTheme,
    readonly origin: StoredReaderLocator | null,
    readonly source: ReaderOwner | null,
    readonly selectionQuote: string | undefined,
    readonly initialQuestion: string | undefined,
    appearance: QuestionAppearance = { kind: 'reader', theme },
  ) {
    this.appearance = Object.freeze({ ...appearance });
    this.view = { draft: initialQuestion ?? '', selection: { start: 0, end: 0 }, selectionConsumed: false, initialQuestionConsumed: false, scroll: { offset: 0 }, expandedSelection: [], expandedReasoning: [], expandedTools: [], reasoningStatus: {}, reasoningManual: [], sheetDetent: 0, referenceFocus: null, restoreReferenceFocus: false };
  }
  appearanceParams(): ReturnType<typeof questionAppearanceParams> { return questionAppearanceParams(this.appearance); }
  getSnapshot = (): QuestionViewState => this.view;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  update(patch: Partial<QuestionViewState>, notify = true): void {
    this.view = { ...this.view, ...patch };
    if (notify) for (const listener of this.listeners) listener();
  }
  toggle(field: 'expandedSelection' | 'expandedReasoning' | 'expandedTools', turnId: string): void {
    const current = this.view[field];
    this.update({ [field]: current.includes(turnId) ? current.filter(id => id !== turnId) : [...current, turnId],
      ...(field === 'expandedReasoning' ? { reasoningManual: [...new Set([...this.view.reasoningManual, turnId])] } : {}) });
  }
}

export type QuestionLaunch = Readonly<{
  bookId: string; title?: string | undefined; theme: 'light' | 'dark'; origin: StoredReaderLocator | null;
  appearance?: QuestionAppearance | undefined;
  selection?: Readonly<{ quote: string; locator: StoredReaderLocator }> | undefined;
  conversationId?: string | undefined; initialQuestion?: string | undefined; selectionQuote?: string | undefined;
}>;
export interface QuestionNavigation {
  dismissQuestion(questionRouteKey: string, readerRouteKey: string, signal: AbortSignal): Promise<boolean>;
  presentQuestion(presentation: QuestionPresentation): void;
  presentReference(presentation: QuestionPresentation, target: CitationTarget, visitId: string, questionRouteKey: string): void;
}
export type ReferenceRoute = Readonly<{ presentationId: string; visitId: string }>;
type ReferenceVisit = { id: string; questionRouteKey: string; readerRouteKey: string | null };
type ReaderState = Readonly<{ reference: QuestionPresentation | null; busy: boolean }>;
const IDLE: ReaderState = { reference: null, busy: false };
type ReaderRegistration = {
  owner: ReaderOwner; port: ReaderReferencePort; state: ReaderState; activeQuestion: string | null;
  epoch: number; abort: AbortController | null; listeners: Set<() => void>;
};
export type ReferenceResult = Readonly<{ status: 'opened' | 'returned' | 'busy' | 'save-failed' | 'failed'; message?: string }>;
/** Root-owned, explicitly injected registry. There is no module singleton or route-name inference. */
export class ReaderQuestionRegistry {
  private readonly readers = new Map<string, ReaderRegistration>();
  private readonly presentations = new Map<string, QuestionPresentation>();
  private readonly referenceVisits = new Map<string, ReferenceVisit>();
  private readonly drafts = new Map<string, Pick<QuestionViewState, 'draft' | 'selection'> & { ownerId: string }>();
  private readonly draftSubscriptions = new Map<string, () => void>();
  constructor(readonly makeId: () => string, private readonly navigation: QuestionNavigation) {}

  register(owner: ReaderOwner, port: ReaderReferencePort): void {
    for (const reader of this.readers.values()) {
      if (reader.owner.routeKey === owner.routeKey && reader.owner.id !== owner.id) this.disposeReader(reader.owner.id);
    }
    const existing = this.readers.get(owner.id);
    if (existing) { existing.port = port; return; }
    this.readers.set(owner.id, { owner, port, state: IDLE, activeQuestion: null, epoch: 0, abort: null, listeners: new Set() });
  }
  readerSnapshot = (id: string): ReaderState => this.readers.get(id)?.state ?? IDLE;
  subscribeReader(id: string, listener: () => void): () => void {
    const reader = this.readers.get(id);
    if (!reader) return () => {};
    reader.listeners.add(listener);
    return () => { reader.listeners.delete(listener); };
  }
  private publish(reader: ReaderRegistration, state: ReaderState): void {
    reader.state = state;
    for (const listener of reader.listeners) listener();
  }
  get(id: string | undefined): QuestionPresentation | undefined { return id ? this.presentations.get(id) : undefined; }
  createHistory(input: QuestionLaunch): QuestionPresentation { return this.create(input, null); }
  private create(input: QuestionLaunch, source: ReaderOwner | null): QuestionPresentation {
    const appearance: QuestionAppearance | undefined = source
      ? source.format === 'pdf' ? { kind: 'application' } : { kind: 'reader', theme: input.theme }
      : input.appearance;
    const presentation = new QuestionPresentation(this.makeId(), input.conversationId ?? this.makeId(), input.bookId, input.title ?? '书内问答', input.theme, input.selection?.locator ?? input.origin, source, input.selection?.quote ?? input.selectionQuote, input.initialQuestion, appearance);
    const draftKey = JSON.stringify([presentation.bookId, presentation.conversationId]);
    const remembered = this.drafts.get(draftKey);
    if (!source && input.initialQuestion === undefined && remembered) {
      presentation.update({ draft: remembered.draft, selection: remembered.selection }, false);
    }
    const { draft, selection } = presentation.getSnapshot();
    this.drafts.set(draftKey, { ownerId: presentation.id, draft, selection });
    // Observe while mounted too: native exit transitions may retain an old binding
    // until after the same conversation has already reopened. The newest owner wins.
    this.draftSubscriptions.set(presentation.id, presentation.subscribe(() => {
      const current = this.drafts.get(draftKey);
      if (current?.ownerId !== presentation.id) return;
      const next = presentation.getSnapshot();
      if (current.draft !== next.draft || current.selection !== next.selection) {
        this.drafts.set(draftKey, { ownerId: presentation.id, draft: next.draft, selection: next.selection });
      }
    }));
    this.presentations.set(presentation.id, presentation);
    return presentation;
  }
  private present(presentation: QuestionPresentation): void {
    presentation.holds += 1; presentation.pendingPresentations += 1;
    try { this.navigation.presentQuestion(presentation); }
    catch (cause) { presentation.holds -= 1; presentation.pendingPresentations -= 1; throw cause; }
  }
  openQuestion(readerId: string, input: QuestionLaunch): QuestionPresentation {
    const reader = this.readers.get(readerId);
    if (!reader || reader.owner.bookId !== input.bookId) throw new Error('阅读会话已关闭');
    let presentation = input.selection?.quote.trim() ? undefined : this.get(reader.activeQuestion ?? undefined);
    if (!presentation) {
      const old = reader.activeQuestion && this.get(reader.activeQuestion);
      reader.activeQuestion = null;
      if (reader.state.reference) this.publish(reader, IDLE);
      if (old) this.collect(old);
      presentation = this.create(input, reader.owner);
      reader.activeQuestion = presentation.id;
    }
    // Native exit transitions and React Activity may retain a removed scene's
    // effects. Bindings own resource lifetime; only routes/pending pushes prove
    // that a question is already presented and should suppress another push.
    if (presentation.pendingPresentations === 0 && presentation.routeKeys.size === 0) this.present(presentation);
    return presentation;
  }
  /** Native askCurrentBook re-presents activeQuestion without changing citation/origin state. */
  reopenActiveQuestion(readerId: string): QuestionPresentation | undefined {
    const reader = this.readers.get(readerId);
    const presentation = reader && this.get(reader.activeQuestion ?? undefined);
    if (!reader || reader.state.busy || !presentation) return undefined;
    presentation.update({ restoreReferenceFocus: true }, false);
    if (presentation.pendingPresentations === 0 && presentation.routeKeys.size === 0) this.present(presentation);
    return presentation;
  }
  bind(presentation: QuestionPresentation, routeKey?: string): () => void {
    if (routeKey) presentation.routeKeys.add(routeKey);
    if (presentation.pendingPresentations > 0) { presentation.pendingPresentations -= 1; presentation.holds -= 1; }
    presentation.bindings += 1;
    return () => { presentation.bindings -= 1; this.collect(presentation); };
  }
  private collect(presentation: QuestionPresentation): void {
    const owner = presentation.source && this.readers.get(presentation.source.id);
    if (presentation.bindings === 0 && presentation.holds === 0 && presentation.routeKeys.size === 0 && owner?.activeQuestion !== presentation.id) {
      this.presentations.delete(presentation.id);
      this.draftSubscriptions.get(presentation.id)?.();
      this.draftSubscriptions.delete(presentation.id);
      const key = JSON.stringify([presentation.bookId, presentation.conversationId]);
      const saved = this.drafts.get(key);
      if (saved?.ownerId === presentation.id && saved.draft.length === 0) this.drafts.delete(key);
    }
  }
  prune(routeKeys: ReadonlySet<string>, questionRoutes?: ReadonlyMap<string, string>, referenceRoutes?: ReadonlyMap<string, ReferenceRoute>): void {
    // Root observes a push before the question's layout effect can bind. Once its
    // actual route is known, the route replaces the provisional presentation hold.
    for (const [routeKey, presentationId] of questionRoutes ?? []) {
      const presentation = this.get(presentationId);
      if (!presentation || !routeKeys.has(routeKey)) continue;
      presentation.routeKeys.add(routeKey);
      presentation.holds -= presentation.pendingPresentations;
      presentation.pendingPresentations = 0;
    }
    for (const [routeKey, route] of referenceRoutes ?? []) {
      const visit = this.referenceVisits.get(route.presentationId);
      if (visit?.id === route.visitId && visit.readerRouteKey === null && routeKeys.has(routeKey)) visit.readerRouteKey = routeKey;
    }
    for (const [presentationId, visit] of this.referenceVisits) {
      // Before mount, retain the visit until its question disappears or the reader
      // route binds. Once bound, only that exact route's removal releases it.
      if (visit.readerRouteKey ? routeKeys.has(visit.readerRouteKey) : routeKeys.has(visit.questionRouteKey)) continue;
      this.referenceVisits.delete(presentationId);
      const presentation = this.get(presentationId);
      if (presentation) { presentation.holds -= 1; this.collect(presentation); }
    }
    for (const reader of this.readers.values()) if (!routeKeys.has(reader.owner.routeKey)) this.disposeReader(reader.owner.id);
    for (const presentation of this.presentations.values()) {
      for (const key of presentation.routeKeys) if (!routeKeys.has(key)) presentation.routeKeys.delete(key);
      this.collect(presentation);
    }
  }
  disposeReader(id: string): void {
    const reader = this.readers.get(id);
    if (!reader) return;
    reader.epoch += 1; reader.abort?.abort();
    this.readers.delete(id);
    for (const listener of reader.listeners) listener();
    for (const presentation of this.presentations.values()) if (presentation.source?.id === id) {
      if (presentation.routeKeys.size === 0 && presentation.bindings === 0) {
        presentation.holds -= presentation.pendingPresentations;
        presentation.pendingPresentations = 0;
      }
      this.collect(presentation);
    }
  }
  dispose(): void {
    for (const id of this.readers.keys()) this.disposeReader(id);
    for (const unsubscribe of this.draftSubscriptions.values()) unsubscribe();
    this.draftSubscriptions.clear(); this.drafts.clear();
    this.referenceVisits.clear(); this.presentations.clear();
  }
  private valid(reader: ReaderRegistration, epoch: number): boolean { return this.readers.get(reader.owner.id) === reader && reader.epoch === epoch; }
  private async navigate(reader: ReaderRegistration, command: ReferenceCommand, signal: AbortSignal): Promise<NavigationReceipt> {
    let abort!: () => void;
    const cancelled = new Promise<NavigationReceipt>(resolve => {
      abort = () => resolve({ operationId: command.operationId, status: 'failed', message: '阅读会话已关闭' });
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    try { return await Promise.race([reader.port.navigate(command), cancelled]); }
    finally { signal.removeEventListener('abort', abort); }
  }
  async openReference(presentation: QuestionPresentation, questionRouteKey: string, target: CitationTarget): Promise<ReferenceResult> {
    const reader = presentation.source && this.readers.get(presentation.source.id);
    if (!reader || reader.owner.routeKey !== presentation.source?.routeKey || reader.owner.bookId !== presentation.bookId || reader.activeQuestion !== presentation.id || reader.owner.format !== target.locator.type) {
      if (this.referenceVisits.has(presentation.id)) return { status: 'busy' };
      const visit: ReferenceVisit = { id: this.makeId(), questionRouteKey, readerRouteKey: null };
      this.referenceVisits.set(presentation.id, visit);
      presentation.holds += 1;
      try {
        this.navigation.presentReference(presentation, target, visit.id, questionRouteKey);
        presentation.update({ restoreReferenceFocus: true }, false);
        return { status: 'opened' };
      } catch (cause) {
        this.referenceVisits.delete(presentation.id); presentation.holds -= 1; this.collect(presentation);
        return { status: 'failed', message: cause instanceof Error ? cause.message : String(cause) };
      }
    }
    const previousReference = reader.state.reference;
    if (reader.state.busy || (previousReference && (previousReference !== presentation || !presentation.routeKeys.has(questionRouteKey)))) return { status: 'busy' };
    const epoch = ++reader.epoch;
    const abort = new AbortController(); reader.abort = abort;
    presentation.holds += 1;
    this.publish(reader, { reference: presentation, busy: true });
    let dismissed = false;
    try {
      dismissed = await this.navigation.dismissQuestion(questionRouteKey, reader.owner.routeKey, abort.signal);
      if (!dismissed || !this.valid(reader, epoch)) {
        return { status: 'failed', message: '原阅读会话不可用，问答已保留' };
      }
      const operationId = this.makeId();
      const receipt = await this.navigate(reader, { ...target, operationId, citation: true }, abort.signal);
      if (!this.valid(reader, epoch)) return { status: 'failed', message: '原阅读会话已关闭' };
      if (receipt.operationId !== operationId || receipt.status !== 'arrived') return { status: 'failed', message: receipt.message ?? '未能定位引用，可返回问答后重试' };
      return { status: 'opened' };
    } catch (cause) { return { status: 'failed', message: cause instanceof Error ? cause.message : String(cause) }; }
    finally {
      presentation.holds -= 1;
      if (this.valid(reader, epoch)) this.publish(reader, { reference: dismissed ? presentation : previousReference, busy: false });
      this.collect(presentation);
    }
  }
  async returnToQuestion(readerId: string, allowUnsaved = false): Promise<ReferenceResult> {
    const reader = this.readers.get(readerId);
    const presentation = reader?.state.reference;
    if (!reader || !presentation) return { status: 'failed', message: '原问答不可用' };
    if (reader.state.busy) return { status: 'busy' };
    const epoch = ++reader.epoch;
    const abort = new AbortController(); reader.abort = abort;
    this.publish(reader, { reference: presentation, busy: true });
    try {
      if (reader.owner.format === 'epub' && !allowUnsaved && !await reader.port.flushProgress()) return { status: 'save-failed', message: '返回问答后，未保存的阅读位置或设置可能丢失。' };
      if (!this.valid(reader, epoch)) return { status: 'failed', message: '阅读会话已关闭' };
      // Native PDF reopens activeQuestion at the citation page. Only EPUB restores origin.
      if (reader.owner.format === 'epub' && presentation.origin && !reader.port.documentFailed()) {
        const operationId = this.makeId();
        const receipt = await this.navigate(reader, { operationId, locator: presentation.origin, quote: '', ordinal: 0, id: '', citation: false }, abort.signal);
        if (!this.valid(reader, epoch)) return { status: 'failed', message: '阅读会话已关闭' };
        if (receipt.operationId !== operationId || receipt.status !== 'arrived') return { status: 'failed', message: receipt.message ?? '未能恢复提问位置，请重试' };
        // Arrival must update the port's current locator before resolving its receipt.
        if (!allowUnsaved && !await reader.port.flushProgress()) return { status: 'save-failed', message: '提问位置尚未保存。' };
      }
      if (!this.valid(reader, epoch)) return { status: 'failed', message: '阅读会话已关闭' };
      presentation.update({ restoreReferenceFocus: true }, false);
      this.present(presentation);
      this.publish(reader, IDLE);
      return { status: 'returned' };
    } catch (cause) { return { status: 'failed', message: cause instanceof Error ? cause.message : String(cause) }; }
    finally { if (this.valid(reader, epoch) && reader.state.busy) this.publish(reader, { reference: presentation, busy: false }); }
  }
}
