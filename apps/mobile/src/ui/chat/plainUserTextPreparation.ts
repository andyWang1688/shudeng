import { textMetricsEnvironmentKey, type CommittedTextMeasure, type PlainTextInput } from '../../platform/text/textMetricsState';
import { maximumTextMetricsBatchCount, type CommittedTextBatch, type TextMetricsBatchEntry } from '../../platform/text/textMetricsBatchState';
import { plainPreparationKey, plainUserTextKey, plainUserTextContentCap, plainUserTextBubbleWidth, plainUserTextTypography, type PlainUserTextLayout } from './plainUserTextLayout';

type Entry = Readonly<{ id: string; key: string; input: PlainTextInput; bubbleWidth?: number }>;
type Task = Readonly<{ serial: number; phase: 'cap' | 'final' | 'observe'; entries: readonly Entry[]; inputs: readonly TextMetricsBatchEntry[] }>;
type Identity = Readonly<{ hostID: string; environmentEpoch: number }>;
type Snapshot = Readonly<{ inputKey: string; rowWidth: number; ready: boolean; task: Task | undefined;
  layouts: ReadonlyMap<string, PlainUserTextLayout>; failure: string | undefined }>;

/** Presentation-local, bounded bridge batches. TS alone owns cap/padding/final-width policy. */
export class PlainUserTextPreparation {
  private listeners = new Set<() => void>();
  private texts: readonly string[] = [];
  private rowWidth = 0;
  private inputKey = '';
  private identity: string | undefined;
  private environment: string | undefined;
  private font: string | undefined;
  private layouts = new Map<string, PlainUserTextLayout>();
  private task: Task | undefined;
  private serial = 0;
  private consumed = -1;
  private failure: string | undefined;
  private snapshot: Snapshot = { inputKey: '', rowWidth: 0, ready: false, task: undefined, layouts: new Map(), failure: undefined };
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = () => this.snapshot;
  configure(texts: readonly string[], rowWidth: number) {
    const key = plainPreparationKey(texts, rowWidth);
    if (key === this.inputKey) return;
    if (rowWidth !== this.rowWidth) { this.layouts.clear(); this.task = undefined; }
    this.texts = [...new Set(texts)]; this.rowWidth = rowWidth; this.inputKey = key; this.failure = undefined;
    const required = new Set(this.texts.map(text => plainUserTextKey(text, rowWidth)));
    this.layouts = new Map([...this.layouts].filter(([key]) => required.has(key)));
    if (this.task?.entries.some(entry => !required.has(entry.key))) this.task = undefined;
    this.advance(); this.publish();
  }
  observeIdentity(identity: Identity | undefined) {
    if (!identity) return;
    const key = JSON.stringify([identity.hostID, identity.environmentEpoch]);
    if (this.identity === key) return;
    const known = this.identity !== undefined; this.identity = key;
    if (known) this.restart();
  }
  accept(serial: number, value: CommittedTextBatch) {
    const task = this.task;
    if (!task || task.serial !== serial || task.phase === 'observe' || this.consumed === serial || this.failure) return;
    if (task.entries.some(entry => { const measured = value.entries.get(entry.id);
      return !measured || measured.request.text !== entry.input.text || measured.request.maxContentWidth !== entry.input.maxContentWidth;
    })) return;
    const environment = textMetricsEnvironmentKey(value.environment);
    const fonts = new Set([...value.entries.values()].map(v => JSON.stringify([v.metrics.resolvedFontName, v.metrics.resolvedPointSize])));
    const font = [...fonts][0];
    if (fonts.size !== 1 || (this.environment !== undefined && this.environment !== environment) || (this.font !== undefined && this.font !== font)) {
      this.restart(); return;
    }
    this.environment = environment; this.font = font; this.consumed = serial;
    const final: Entry[] = [];
    for (const entry of task.entries) {
      const measured = value.entries.get(entry.id)!;
      const width = entry.bubbleWidth ?? plainUserTextBubbleWidth(this.rowWidth, measured.metrics.width, value.environment.displayScale);
      const contentWidth = width - 24;
      if (contentWidth < 0 || !Number.isFinite(width)) { this.fail(serial, 'invalid-content-size'); return; }
      if (task.phase === 'cap' && contentWidth > 0 && Math.abs(contentWidth - entry.input.maxContentWidth) > 0.0001) {
        final.push({ ...entry, bubbleWidth: width, input: { ...entry.input, maxContentWidth: contentWidth } });
      } else this.commit(entry.key, width, measured);
    }
    if (final.length) this.task = this.makeTask('final', final);
    else this.advance();
    this.publish();
  }
  fail(serial: number, reason: string) {
    if (this.task?.serial !== serial || this.failure === reason) return;
    this.failure = reason; this.publish();
  }
  retry = () => { this.restart(); };
  private commit(key: string, width: number, value: CommittedTextMeasure) {
    const scale = value.environment.displayScale;
    this.layouts.set(key, { key, width, minimumHeight: Math.ceil((value.metrics.height + 20) * scale) / scale, measurement: value });
  }
  private restart() {
    this.layouts.clear(); this.task = undefined; this.failure = undefined; this.environment = undefined; this.font = undefined;
    this.advance(); this.publish();
  }
  private makeTask(phase: Task['phase'], entries: readonly Entry[]): Task {
    return { serial: ++this.serial, phase, entries, inputs: entries.map(({ id, input }) => ({ id, ...input })) };
  }
  private advance() {
    if (this.task && this.task.phase !== 'observe' && this.consumed !== this.task.serial) return;
    const cap = plainUserTextContentCap(this.rowWidth);
    if (cap === undefined) return;
    const missing = this.texts.filter(text => !this.layouts.has(plainUserTextKey(text, this.rowWidth))).slice(0, maximumTextMetricsBatchCount);
    if (missing.length) this.task = this.makeTask('cap', missing.map((text, index) => ({
      id: String(index), key: plainUserTextKey(text, this.rowWidth), input: { text, maxContentWidth: cap, typography: plainUserTextTypography },
    })));
    else if (!this.task && this.texts.length) {
      // Removing a completed batch can leave only already-measured rows. Keep an
      // exact retained input mounted so the host can still report trait changes.
      // Its ready payload is observational and never republishes row geometry.
      const key = plainUserTextKey(this.texts[0]!, this.rowWidth);
      const { text, maxContentWidth, typography } = this.layouts.get(key)!.measurement.request;
      this.task = this.makeTask('observe', [{ id: '0', key, input: { text, maxContentWidth, typography } }]);
    }
    // Otherwise retain the final completed probe for actual trait invalidation.
  }
  private publish() {
    const ready = this.rowWidth > 0 && !this.failure && this.texts.every(text => this.layouts.has(plainUserTextKey(text, this.rowWidth)));
    this.snapshot = { inputKey: this.inputKey, rowWidth: this.rowWidth, ready, task: this.task, layouts: new Map(this.layouts), failure: this.failure };
    for (const listener of this.listeners) listener();
  }
}
