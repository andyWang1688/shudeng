import assert from 'node:assert/strict';
import test from 'node:test';
import { TextMetricsState, explicitSystemRNTextProps, type PlainTextInput, type TextMeasureEvent } from './textMetricsState.ts';
import { plainUserTextBubbleWidth, usesPlainUserTextMetrics } from '../../ui/chat/plainUserTextLayout.ts';

const input: PlainTextInput = { text: 'Trailing spaces   ', maxContentWidth: 222.4,
  typography: { face: { kind: 'system', weight: 'regular' }, basePointSize: 15, metricsStyle: 'body', lineSpacing: 4 } };
const environment = (category: string) => ({ category, displayScale: 2, rightToLeft: false,
  legibilityWeight: 0, boldText: false, preferredLanguages: ['en'] });
const measured = (revision: number, epoch: number, work: number, size: number, width: number): TextMeasureEvent => ({
  bindingID: 'mount', revision, hostID: 'actual-host', environmentEpoch: epoch, workRevision: work,
  type: 'measured', environment: environment(size === 42 ? 'AXXXL' : 'L'),
  metrics: { width, height: size === 42 ? 104.5 : 18, resolvedPointSize: size, resolvedFontName: '.SFUI-Regular' },
});

test('late old text, host, work and pending events cannot replace the newest result', () => {
  const state = new TextMetricsState('mount');
  const first = state.begin(input);
  assert.equal(state.accept(measured(first.revision, 1, 1, 15, 114.5)), true);
  const second = state.begin({ ...input, text: 'New question' });
  assert.equal(state.snapshot().previousSameInput, undefined);
  assert.equal(state.accept(measured(first.revision, 1, 1, 15, 114.5)), false);
  assert.equal(state.accept({ ...measured(second.revision, 1, 3, 15, 90), bindingID: 'retired-mount' }), false);
  assert.equal(state.accept({ ...measured(second.revision, 1, 3, 15, 90), hostID: 'other-host' }), false);
  assert.equal(state.accept(measured(second.revision, 1, 3, 15, 90)), true);
  assert.equal(state.accept({ type: 'pending', bindingID: 'mount', revision: second.revision, hostID: 'actual-host', environmentEpoch: 1, workRevision: 3 }), false);
  assert.equal(state.accept(measured(second.revision, 1, 2, 15, 500)), false);
  assert.equal(state.snapshot().current?.metrics.width, 90);
  state.dispose();
  assert.equal(state.accept(measured(second.revision, 2, 4, 42, 136.5)), false);
});

test('trait invalidation keeps only an entire old font/size pair until a new pair is ready', () => {
  const state = new TextMetricsState('mount');
  const request = state.begin(input);
  state.accept(measured(request.revision, 1, 1, 15, 114.5));
  state.accept({ type: 'pending', bindingID: 'mount', revision: request.revision, hostID: 'actual-host', environmentEpoch: 2, workRevision: 2 });
  assert.equal(state.snapshot().current, undefined);
  assert.equal(state.snapshot().previousSameInput?.metrics.resolvedPointSize, 15);
  assert.equal(state.snapshot().previousSameInput?.metrics.width, 114.5);
  assert.equal(state.accept(measured(request.revision, 1, 1, 15, 114.5)), false);
  state.accept(measured(request.revision, 2, 2, 42, 136.5));
  const value = state.snapshot().current!;
  assert.equal(value.environment.category, 'AXXXL');
  assert.equal(value.metrics.width, 136.5);
  const props = explicitSystemRNTextProps(value);
  assert.equal(props.allowFontScaling, false);
  assert.equal(props.adjustsFontSizeToFit, false);
  assert.equal(props.style.fontSize, 42);
  assert.equal(props.style.lineSpacing, 4);
  assert.equal(value.request.text, 'Trailing spaces   ');
});

test('plain-only branch and independent UIKit trailing-spaces counterexample', () => {
  assert.equal(usesPlainUserTextMetrics('ios', false), true);
  assert.equal(usesPlainUserTextMetrics('ios', true), false);
  assert.equal(usesPlainUserTextMetrics('android', false), false);
  assert.equal(usesPlainUserTextMetrics('web', false), false);
  // External foreground UIKit evidence, not the rejected raw-line result179.
  assert.equal(plainUserTextBubbleWidth(280, 136.5, 2), 160.5);
  assert.equal(plainUserTextBubbleWidth(335, 271, 2), 294.8);
});
