import { TextMetricsState, type CommittedTextMeasure, type PlainTextInput, type PlainTextMetrics, type TextEnvironment, type TextMeasureEvent } from './textMetricsState';
export const maximumTextMetricsBatchCount = 64;
export type TextMetricsBatchEntry = PlainTextInput & Readonly<{ id: string }>;
export type TextMetricsBatchRequest = Readonly<{ bindingID: string; revision: number; entries: readonly TextMetricsBatchEntry[] }>;
type Identity = Pick<TextMeasureEvent, 'bindingID' | 'revision' | 'hostID' | 'environmentEpoch' | 'workRevision'>;
export type TextMetricsBatchEvent = Identity & (
  | Readonly<{ type: 'pending' }>
  | Readonly<{ type: 'failed'; code: 'invalid-input' | 'unavailable-font' | 'invalid-resolved-font' }>
  | Readonly<{ type: 'measured'; environment: TextEnvironment; entries: readonly Readonly<{ id: string; metrics: PlainTextMetrics }>[] }>
);
export type CommittedTextBatch = Readonly<{ request: TextMetricsBatchRequest; environment: TextEnvironment;
  environmentEpoch: number; entries: ReadonlyMap<string, CommittedTextMeasure> }>;

/** One ordering gate for an atomic batch; the single-request contract stays unchanged. */
export class TextMetricsBatchState {
  private readonly gate: TextMetricsState;
  private request: TextMetricsBatchRequest | undefined;
  private committed: CommittedTextBatch | undefined;
  private invalidResult = false;
  constructor(bindingID: string) { this.gate = new TextMetricsState(bindingID); }
  begin(entries: readonly TextMetricsBatchEntry[]) {
    if (!entries.length || entries.length > maximumTextMetricsBatchCount || entries.some(entry => !entry.id)
      || new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('Invalid text measurement batch');
    const stable = entries.map(entry => Object.freeze({ ...entry, typography: Object.freeze({
      ...entry.typography, face: Object.freeze({ ...entry.typography.face }),
    }) }));
    // The representative request owns version/host/trait ordering, not per-entry policy.
    const first = this.gate.begin(stable[0]!);
    this.request = Object.freeze({ bindingID: first.bindingID, revision: first.revision, entries: Object.freeze(stable) });
    this.invalidResult = false; return this.request;
  }
  accept(event: TextMetricsBatchEvent) {
    const request = this.request;
    if (!request) return false;
    if (event.type !== 'measured') {
      const accepted = this.gate.accept(event);
      if (accepted) this.invalidResult = false;
      return accepted;
    }
    const results = new Map(event.entries.map(entry => [entry.id, entry.metrics]));
    const valid = results.size === request.entries.length && event.entries.length === request.entries.length
      && request.entries.every(entry => results.has(entry.id))
      && event.entries.every(({ metrics: m }) => [m.width, m.height, m.resolvedPointSize].every(Number.isFinite)
        && m.width >= 0 && m.height >= 0 && m.resolvedPointSize > 0 && Boolean(m.resolvedFontName));
    if (!valid) {
      const accepted = this.gate.accept({ ...event, type: 'failed', code: 'invalid-input' });
      if (accepted) this.invalidResult = true;
      return accepted;
    }
    const first = results.get(request.entries[0]!.id)!;
    if (!this.gate.accept({ ...event, metrics: first })) return false;
    if (this.gate.snapshot().status !== 'ready') return true;
    this.invalidResult = false;
    this.committed = Object.freeze({ request, environment: event.environment, environmentEpoch: event.environmentEpoch,
      entries: new Map(request.entries.map(({ id, ...input }) => [id, Object.freeze({
        request: Object.freeze({ ...input, bindingID: request.bindingID, revision: request.revision }),
        environment: event.environment, environmentEpoch: event.environmentEpoch, metrics: results.get(id)!,
      })])),
    });
    return true;
  }
  snapshot() {
    const gate = this.gate.snapshot();
    return { status: gate.status, identity: gate.identity, request: this.request,
      failure: this.invalidResult ? 'invalid-native-result' : gate.failure,
      current: gate.status === 'ready' && this.committed?.request === this.request ? this.committed : undefined };
  }
  dispose() { this.gate.dispose(); this.request = undefined; this.committed = undefined; }
}
