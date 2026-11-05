import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { useNativeTextMetricsBatch } from '../../platform/text/NativeTextMetrics';
import { PlainUserTextPreparation } from './plainUserTextPreparation';
import { plainPreparationKey } from './plainUserTextLayout';

/** One persistent actual-trait probe; no pending rows enter the visible list. */
export function usePreparedUserText(texts: readonly string[], rowWidth: number) {
  const preparation = useMemo(() => new PlainUserTextPreparation(), []);
  const snapshot = useSyncExternalStore(preparation.subscribe, preparation.getSnapshot, preparation.getSnapshot);
  const key = plainPreparationKey(texts, rowWidth);
  useLayoutEffect(() => { preparation.configure(texts,rowWidth); }, [preparation,key]);
  const task = snapshot.task;
  const metrics = useNativeTextMetricsBatch(task?.inputs,task?.serial);
  useLayoutEffect(() => { preparation.observeIdentity(metrics.identity); }, [preparation,metrics.identity?.hostID,metrics.identity?.environmentEpoch]);
  useLayoutEffect(() => {
    if (!task) return;
    if (metrics.failure) preparation.fail(task.serial,metrics.failure);
    else if (metrics.current) preparation.accept(task.serial,metrics.current);
  }, [preparation,task,metrics.current,metrics.failure]);
  // A native transport that never answers must not leave a permanent spinner.
  useLayoutEffect(() => {
    if (!task || snapshot.ready || snapshot.failure) return;
    const timer = setTimeout(() => preparation.fail(task.serial,'measurement-timeout'),5000);
    return () => clearTimeout(timer);
  }, [preparation,task,snapshot.ready,snapshot.failure]);
  return {...snapshot,ready:snapshot.inputKey === key && snapshot.ready,probe:metrics.probe,retry:preparation.retry};
}
