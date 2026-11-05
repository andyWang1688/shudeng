import { requireNativeView, requireOptionalNativeModule } from 'expo';
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, type ViewProps } from 'react-native';
import { TextMetricsState, type PlainTextInput, type PlainTextRequest, type TextMeasureEvent } from './textMetricsState';
import { TextMetricsBatchState, type TextMetricsBatchEntry, type TextMetricsBatchEvent, type TextMetricsBatchRequest } from './textMetricsBatchState';

interface Props extends ViewProps {
  readonly request: string;
  readonly onMetrics: (event: { readonly nativeEvent: TextMeasureEvent }) => void;
  readonly batchRequest?: string;
  readonly onBatchMetrics?: (event: { readonly nativeEvent: TextMetricsBatchEvent }) => void;
}
const ignoreSingleMetrics = () => {};
export function useNativeTextMetricsBatch(entries: readonly TextMetricsBatchEntry[] | undefined, refreshKey: number = 0) {
  const bindingID = useId();
  const state = useMemo(() => new TextMetricsBatchState(bindingID), [bindingID]);
  const live = useRef(true);
  const [issued, setIssued] = useState<{ request: TextMetricsBatchRequest; key: string; refreshKey: number }>();
  const [, render] = useState(0);
  const key = entries ? JSON.stringify(entries) : undefined;
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useLayoutEffect(() => {
    if (entries && key !== undefined) setIssued({ request: state.begin(entries), key, refreshKey });
    else setIssued(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshKey, state]);
  const onBatchMetrics = useCallback(({ nativeEvent }: { readonly nativeEvent: TextMetricsBatchEvent }) => {
    if (live.current && state.accept(nativeEvent)) render(value => value + 1);
  }, [state]);
  const snapshot = state.snapshot();
  const active = issued?.key === key && issued?.refreshKey === refreshKey;
  const current = active && snapshot.current?.request === issued?.request ? snapshot.current : undefined;
  const probe = NativeView ? <NativeView request="" onMetrics={ignoreSingleMetrics}
    batchRequest={issued ? JSON.stringify(issued.request) : ''} onBatchMetrics={onBatchMetrics}
    style={style.anchor} collapsable={false} pointerEvents="none" accessible={false}
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants" /> : null;
  return { current, probe, identity: snapshot.identity,
    failure: active && snapshot.status === 'failed' && snapshot.request === issued?.request ? snapshot.failure : undefined };
}
const NativeView = Platform.OS === 'ios' && requireOptionalNativeModule('ShudengTextMetrics')
  ? requireNativeView<Props>('ShudengTextMetrics', 'TextMetricsView') : undefined;
export const hasNativeTextMetrics = Boolean(NativeView);
const style = StyleSheet.create({ anchor: { position: 'absolute', width: 0, height: 0, top: 0, left: 0 } });
const inputKey = (value: PlainTextInput) => JSON.stringify([value.text, value.maxContentWidth, value.typography]);

/** Mount the returned probe in the same actual-trait presentation as the RN Text. */
export function useNativeTextMetrics(input: PlainTextInput | undefined, refreshKey: number = 0) {
  const bindingID = useId();
  const state = useMemo(() => new TextMetricsState(bindingID), [bindingID]);
  const live = useRef(true);
  const [issued, setIssued] = useState<{ request: PlainTextRequest; key: string; refreshKey: number }>();
  const [, render] = useState(0);
  const key = input ? inputKey(input) : undefined;
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useLayoutEffect(() => {
    if (input && key !== undefined) setIssued({ request: state.begin(input), key, refreshKey });
    else setIssued(undefined);
    // Input is immutable; identity follows all original text/style/width fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshKey, state]);
  const onMetrics = useCallback(({ nativeEvent }: { readonly nativeEvent: TextMeasureEvent }) => {
    if (live.current && state.accept(nativeEvent)) render((value) => value + 1);
  }, [state]);
  const snapshot = state.snapshot();
  // A same-input retry has a new owner before its layout effect issues a request.
  // Never let the previous render's ready result satisfy that new owner.
  const active = issued?.key === key && issued?.refreshKey === refreshKey;
  const current = active && snapshot.current?.request === issued?.request ? snapshot.current : undefined;
  const probe = NativeView ? <NativeView request={issued ? JSON.stringify(issued.request) : ''} onMetrics={onMetrics}
    style={style.anchor} collapsable={false} pointerEvents="none" accessible={false}
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants" /> : null;
  return { current, probe, identity: snapshot.identity,
    failure: active && snapshot.status === 'failed' && snapshot.request === issued?.request ? snapshot.failure : undefined };
}
