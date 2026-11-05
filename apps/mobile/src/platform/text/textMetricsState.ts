/** Platform-neutral text metric request/result ordering. */
export type PlainTextTypography = Readonly<{
  face: Readonly<{ kind: 'system'; weight: 'regular' | 'medium' | 'semibold' | 'bold' }>
    | Readonly<{ kind: 'named'; postScriptName: string }>;
  basePointSize: number;
  metricsStyle: 'body' | 'caption1' | 'footnote';
  lineSpacing: number; // Fixed points; never scaled twice.
}>;
export type PlainTextInput = Readonly<{
  text: string; // Original string, including spaces/newlines/Unicode sequences.
  maxContentWidth: number; // CONTENT only. No bubble padding, percentage or turnID.
  typography: PlainTextTypography;
}>;
export type PlainTextRequest = PlainTextInput & Readonly<{
  bindingID: string; // A fresh internal hook/anchor-mount identity.
  revision: number; // Increases for input changes and final-width requests.
}>;
export type TextEnvironment = Readonly<{
  category: string; // Actual UIKit host category, never derived from RN fontScale.
  displayScale: number;
  rightToLeft: boolean;
  legibilityWeight: number;
  boldText: boolean;
  preferredLanguages: readonly string[];
}>;
export type PlainTextMetrics = Readonly<{
  width: number; height: number; // Raw UILabel.sizeThatFits, no padding or policy.
  resolvedPointSize: number;
  resolvedFontName: string; // Diagnostic only; do not pass '.SFUI-*' as RN fontFamily.
}>;
export function textMetricsEnvironmentKey(value: TextEnvironment) {
  return JSON.stringify([value.category, value.displayScale, value.rightToLeft, value.legibilityWeight,
    value.boldText, value.preferredLanguages]);
}
type EventIdentity = Readonly<{
  bindingID: string; revision: number; hostID: string; environmentEpoch: number;
  workRevision: number; // Native invalidation sequence, including same-trait jobs.
}>;
export type TextMeasureEvent = EventIdentity & (
  | Readonly<{ type: 'pending' }>
  | Readonly<{ type: 'measured'; environment: TextEnvironment; metrics: PlainTextMetrics }>
  | Readonly<{ type: 'failed'; code: 'invalid-input' | 'unavailable-font' | 'invalid-resolved-font' }>
);
export type CommittedTextMeasure = Readonly<{
  request: PlainTextRequest;
  environment: TextEnvironment;
  environmentEpoch: number;
  metrics: PlainTextMetrics;
}>;

/**
 * The platform hook owns one gate + one mounted native measurement anchor.
 * Same Interface for initial preferred size and final-width remeasurement.
 * Callers publish font + all affected TS geometry in one commit.
 */
export class TextMetricsState {
  private revision = 0;
  private request: PlainTextRequest | undefined;
  private inputKey = '';
  private hostID: string | undefined;
  private minimumEnvironmentEpoch = -1;
  private minimumWorkRevision = -1;
  private lastPhaseRank = -1;
  private committed: CommittedTextMeasure | undefined;
  private committedInputKey = '';
  private status: 'idle' | 'pending' | 'ready' | 'failed' | 'disposed' = 'idle';
  private failure: string | undefined;

  private readonly bindingID: string;
  constructor(bindingID: string) { this.bindingID = bindingID; }

  begin(input: PlainTextInput): PlainTextRequest {
    if (this.status === 'disposed') throw new Error('Measurement mount disposed');
    if (!Number.isFinite(input.maxContentWidth) || input.maxContentWidth <= 0
      || !Number.isFinite(input.typography.basePointSize) || input.typography.basePointSize <= 0
      || !Number.isFinite(input.typography.lineSpacing) || input.typography.lineSpacing < 0) {
      throw new Error('Invalid plain text measurement input');
    }
    // Copy nested fields so asynchronous work cannot observe later mutations.
    const typography = Object.freeze({ ...input.typography, face: Object.freeze({ ...input.typography.face }) });
    const stableInput = Object.freeze({ text: input.text, maxContentWidth: input.maxContentWidth, typography });
    this.inputKey = JSON.stringify(stableInput);
    this.request = Object.freeze({ ...stableInput, bindingID: this.bindingID, revision: ++this.revision });
    this.status = 'pending'; this.failure = undefined;
    return this.request;
  }

  accept(event: TextMeasureEvent): boolean {
    if (this.status === 'disposed' || !this.request || event.bindingID !== this.bindingID
      || event.revision !== this.request.revision) return false;
    if (this.hostID !== undefined && event.hostID !== this.hostID) return false;
    if (!Number.isSafeInteger(event.environmentEpoch) || event.environmentEpoch < 0 || event.environmentEpoch < this.minimumEnvironmentEpoch) return false;
    if (!Number.isSafeInteger(event.workRevision) || event.workRevision < 0 || event.workRevision < this.minimumWorkRevision) return false;
    const phaseRank = event.type === 'pending' ? 0 : 1;
    if (event.workRevision === this.minimumWorkRevision && phaseRank < this.lastPhaseRank) return false;
    this.lastPhaseRank = event.workRevision === this.minimumWorkRevision ? Math.max(this.lastPhaseRank, phaseRank) : phaseRank;
    this.minimumWorkRevision = event.workRevision;
    this.hostID = event.hostID;
    this.minimumEnvironmentEpoch = event.environmentEpoch;
    if (event.type === 'pending') {
      this.status = 'pending'; return true;
    }
    if (event.type === 'failed') {
      this.status = 'failed'; this.failure = event.code; return true;
    }
    const m = event.metrics;
    if (![m.width, m.height, m.resolvedPointSize, event.environment.displayScale].every(Number.isFinite)
      || m.width < 0 || m.height < 0 || m.resolvedPointSize <= 0 || event.environment.displayScale <= 0) {
      this.status = 'failed'; this.failure = 'invalid-native-result'; return true;
    }
    this.committed = Object.freeze({ request: this.request, environment: event.environment,
      environmentEpoch: event.environmentEpoch, metrics: m });
    this.committedInputKey = this.inputKey;
    this.status = 'ready'; this.failure = undefined;
    return true;
  }

  snapshot() {
    return Object.freeze({ status: this.status, failure: this.failure,
      identity: this.hostID === undefined ? undefined : { hostID: this.hostID, environmentEpoch: this.minimumEnvironmentEpoch },
      request: this.request,
      current: this.status === 'ready' ? this.committed : undefined,
      // Only the complete old pair for IDENTICAL inputs may be retained during
      // trait-only invalidation. Never give new text/width an old measured width.
      previousSameInput: this.committedInputKey === this.inputKey ? this.committed : undefined });
  }

  dispose() {
    this.status = 'disposed'; this.request = undefined; this.committed = undefined;
  }
}

/** Typography resolution changes with system traits, never to make UI fit. */
export function explicitSystemRNTextProps(value: CommittedTextMeasure) {
  if (value.request.typography.face.kind !== 'system') throw new Error('Named RN font mapping remains unverified');
  const weights = { regular: '400', medium: '500', semibold: '600', bold: '700' } as const;
  return Object.freeze({
    allowFontScaling: false, // This ONE Text already receives UIFontMetrics output.
    adjustsFontSizeToFit: false,
    style: { fontSize: value.metrics.resolvedPointSize,
      fontWeight: weights[value.request.typography.face.weight],
      lineSpacing: value.request.typography.lineSpacing },
    // Keep RN natural alignment and inherited direction; no fixed lineHeight,
    // extra letterSpacing, max multiplier or numberOfLines=1 is introduced.
  });
}
