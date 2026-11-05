import { useLayoutEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { hasNativeTextMetrics } from '../../platform/text/NativeTextMetrics';
import { plainPreparationKey, usesPlainUserTextMetrics, type PlainUserTextLayout } from './plainUserTextLayout';
import { usePreparedUserText } from './usePreparedUserText';
import type { ChatTurn } from './types';

export type ChatLayoutCheckpoint = { activate: (settled: () => void) => () => void };
type Committed = {
  turns: ChatTurn[]; layouts: ReadonlyMap<string, PlainUserTextLayout>; rowWidth: number;
  checkpoint: ChatLayoutCheckpoint; settled: boolean;
};
const emptyLayouts: ReadonlyMap<string, PlainUserTextLayout> = new Map();
const sameLayouts = (a: ReadonlyMap<string, PlainUserTextLayout>, b: ReadonlyMap<string, PlainUserTextLayout>) =>
  a.size === b.size && [...a].every(([key, value]) => b.get(key) === value);

/** Presentation-local delivery. Business turns keep flowing while new rows prepare. */
export function usePreparedChatTurns(turns: ChatTurn[], rowWidth: number,
  captureLayout: (signal: AbortSignal) => Promise<ChatLayoutCheckpoint>) {
  const enabled = hasNativeTextMetrics && Platform.OS === 'ios';
  const texts = enabled ? turns.filter(turn => turn.role === 'user'
    && usesPlainUserTextMetrics(Platform.OS, turn.selectionAttached ?? Boolean(turn.selectionQuote))).map(turn => turn.text) : [];
  const prepared = usePreparedUserText(texts, enabled ? rowWidth : 1);
  const inputKey = plainPreparationKey(texts, enabled ? rowWidth : 1);
  const latest = useRef({ turns, inputKey });
  const [committed, setCommitted] = useState<Committed>();
  const hasPresented = useRef(false);
  useLayoutEffect(() => { if (committed?.settled) hasPresented.current = true; }, [committed]);
  useLayoutEffect(() => { latest.current = { turns, inputKey }; });
  useLayoutEffect(() => {
    if (!enabled || !prepared.ready || (committed && sameLayouts(committed.layouts, prepared.layouts)
      && committed.rowWidth === rowWidth)) return;
    const controller = new AbortController();
    void captureLayout(controller.signal).then(checkpoint => {
      if (controller.signal.aborted || latest.current.inputKey !== inputKey) return;
      setCommitted({ turns: latest.current.turns, layouts: prepared.layouts, rowWidth, checkpoint, settled: false });
    });
    return () => controller.abort();
  }, [enabled, prepared.ready, prepared.layouts, inputKey, rowWidth, captureLayout, committed]);
  useLayoutEffect(() => {
    if (!committed || committed.settled) return;
    return committed.checkpoint.activate(() => {
      setCommitted(current => current === committed ? { ...current, settled: true } : current);
    });
  }, [committed]);
  const current = committed && prepared.ready && sameLayouts(committed.layouts, prepared.layouts)
    && committed.rowWidth === rowWidth;
  return {
    data: !enabled || current ? turns : committed?.turns ?? [],
    layouts: committed?.layouts ?? emptyLayouts, rowWidth: committed?.rowWidth ?? rowWidth,
    hasCommitted: Boolean(committed),
    loading: enabled && !hasPresented.current && !committed?.settled && !prepared.failure,
    // Only first presentation waits behind the existing loader for its saved anchor.
    // Appends and trait/viewport replacements keep the complete visible presentation.
    hidden: enabled && !hasPresented.current && Boolean(committed && !committed.settled),
    finalLayoutReady: !enabled || Boolean(current && committed?.settled),
    failure: enabled ? prepared.failure : undefined, retry: prepared.retry, probe: prepared.probe,
  };
}
