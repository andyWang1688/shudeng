import { useCallback, useLayoutEffect, useRef, type ElementRef } from 'react';
import { AccessibilityInfo, FlatList, View } from 'react-native';
import type { CitationTarget, QuestionPresentation, QuestionScroll } from '../reader-question/session';
import { useQuestionAppearance } from '../reader-question/ReaderQuestionProvider';
import type { ChatLayoutCheckpoint } from './usePreparedChatTurns';
import type { ChatTurn } from './types';

type Frame = { y: number; height: number };
type Restoration = { done: boolean; tracking: boolean; baseApplied: boolean; measuring: boolean; attempts: number;
  layout: boolean; positioned: boolean; corrections: number; lastCorrectionOffset?: number | undefined; settled?: (() => void) | undefined };
const restoring = (scroll: QuestionScroll, layout = false): Restoration => ({
  done: !layout && scroll.offset === 0 && !scroll.anchorId, tracking: Boolean(scroll.anchorId),
  baseApplied: false, measuring: false, attempts: 0, layout, positioned: !layout && !scroll.anchorId && scroll.offset === 0, corrections: 0,
});
// A detached native view must not leave a capture or presentation pending forever.
function measureWindow(node: ElementRef<typeof View>, signal?: AbortSignal): Promise<Frame | null> {
  return new Promise(resolve => {
    let finished = false;
    const timer = setTimeout(() => done(null), 1000);
    const cancel = () => done(null);
    function done(frame: Frame | null) {
      if (finished) return;
      finished = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); resolve(frame);
    }
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    else node.measureInWindow((_x, y, _width, height) => done({ y, height }));
  });
}

/** Shared reference/geometry anchor. Every async correction belongs to one layout and interaction. */
export function useChatListScroll(presentation: QuestionPresentation, onOpenCitation: (target: CitationTarget) => void) {
  const list = useRef<FlatList<ChatTurn>>(null);
  const viewport = useRef<ElementRef<typeof View>>(null);
  const rows = useRef(new Map<string, ElementRef<typeof View>>());
  const citations = useRef(new Map<string, ElementRef<typeof View>>());
  const data = useRef<ChatTurn[]>([]);
  const live = useRef(true);
  const appeared = useRef(false);
  const finalReady = useRef(false);
  const viewable = useRef<readonly string[]>([]);
  const offset = useRef(presentation.getSnapshot().scroll.offset);
  const saved = useRef<QuestionScroll>(presentation.getSnapshot().scroll);
  const restoration = useRef(restoring(saved.current));
  const interaction = useRef(0);
  const captureRevision = useRef(0);
  const scheduled = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    live.current = true;
    return () => { live.current = false; captureRevision.current += 1;
      if (scheduled.current !== undefined) cancelAnimationFrame(scheduled.current); };
  }, []);
  const restoreFocus = useCallback(() => {
    const state = presentation.getSnapshot();
    const target = state.referenceFocus && citations.current.get(state.referenceFocus);
    if (!live.current || !appeared.current || !finalReady.current || !restoration.current.done || !restoration.current.positioned
      || !state.restoreReferenceFocus || !target) return;
    presentation.update({ restoreReferenceFocus: false }, false);
    AccessibilityInfo.sendAccessibilityEvent(target, 'focus');
  }, [presentation]);
  const measure = useCallback(async (ids: readonly string[], signal?: AbortSignal) => {
    const frame = viewport.current;
    if (!frame) return null;
    const measuredViewport = await measureWindow(frame, signal);
    if (!measuredViewport) return null;
    const measured = await Promise.all(ids.map(async id => {
      const row = rows.current.get(id), frame = row && await measureWindow(row, signal);
      return frame ? { id, ...frame } : null;
    }));
    return { viewportY: measuredViewport.y, rows: measured.filter(value => value !== null) };
  }, []);
  const readScroll = useCallback(async (signal?: AbortSignal) => {
    const measured = await measure(viewable.current, signal);
    const first = measured?.rows.filter(row => row.y + row.height > measured.viewportY).sort((a, b) => a.y - b.y)[0];
    return first && measured
      ? { offset: offset.current, anchorId: first.id, anchorOffset: first.y - measured.viewportY }
      : { offset: offset.current };
  }, [measure]);
  const capture = useCallback(async () => {
    const revision = ++captureRevision.current, drag = interaction.current;
    const scroll = await readScroll();
    if (!live.current || revision !== captureRevision.current || drag !== interaction.current) return;
    saved.current = scroll; presentation.update({ scroll }, false);
  }, [presentation, readScroll]);
  const restoreRef = useRef<() => void>(() => {});
  const scheduleRestore = useCallback(() => {
    if (scheduled.current !== undefined) cancelAnimationFrame(scheduled.current);
    scheduled.current = requestAnimationFrame(() => { scheduled.current = undefined; if (live.current) restoreRef.current(); });
  }, []);
  const finish = useCallback((state: Restoration, positioned = true) => {
    state.done = true; state.positioned = positioned; state.lastCorrectionOffset = undefined; state.corrections = 0;
    if (state.layout) state.tracking = false;
    const settled = state.settled; state.settled = undefined; settled?.(); restoreFocus();
  }, [restoreFocus]);
  const restore = useCallback(() => {
    const state = restoration.current;
    if (!live.current || (state.done && !state.tracking) || !list.current) return;
    if (!state.baseApplied) {
      state.baseApplied = true; list.current.scrollToOffset({ offset: saved.current.offset, animated: false });
    }
    const anchorId = saved.current.anchorId;
    if (anchorId && !rows.current.has(anchorId)) {
      const index = data.current.findIndex(turn => turn.id === anchorId);
      if (index >= 0 && state.attempts < 3) {
        state.attempts += 1; list.current.scrollToIndex({ index, animated: false }); scheduleRestore(); return;
      }
      // The anchor was removed; retain the physical offset rather than invent a row.
    }
    if (state.measuring) return;
    state.measuring = true;
    void measure(anchorId ? [anchorId] : []).then(measured => {
      state.measuring = false;
      if (!live.current || state !== restoration.current || (state.done && !state.tracking)) return;
      const row = measured?.rows[0];
      if (!row || !measured) { finish(state, Boolean(measured && !anchorId)); return; }
      const delta = row.y - measured.viewportY - (saved.current.anchorOffset ?? 0);
      const next = Math.max(0, offset.current + delta);
      if (Math.abs(delta) < 1 || Math.abs(next - offset.current) < 1) { finish(state); return; }
      // Native scrolling can clamp at an edge. Do not loop forever if the last
      // correction could not move the physical offset, or the content keeps moving.
      if ((state.lastCorrectionOffset !== undefined && Math.abs(offset.current - state.lastCorrectionOffset) < 1)
        || state.corrections >= 3) { finish(state); return; }
      state.lastCorrectionOffset = offset.current; state.corrections += 1;
      // Increasing the content offset moves the anchor up in the viewport.
      list.current?.scrollToOffset({ offset: next, animated: false }); scheduleRestore();
    });
  }, [finish, measure, scheduleRestore]);
  useLayoutEffect(() => { restoreRef.current = restore; }, [restore]);
  const captureLayout = useCallback(async (signal: AbortSignal): Promise<ChatLayoutCheckpoint> => {
    const drag = interaction.current, revision = ++captureRevision.current;
    // Preserve the reference return anchor on first presentation.
    const scroll = data.current.length && !presentation.getSnapshot().restoreReferenceFocus ? await readScroll(signal) : saved.current;
    return { activate: settled => {
      if (!live.current) return () => {};
      // The delivery hook checked abort before accepting this checkpoint. Its
      // capture effect is now retired; activation still owns this exact revision.
      const eligible = revision === captureRevision.current && drag === interaction.current;
      const state = restoring(eligible ? scroll : { offset: offset.current }, true);
      saved.current = eligible ? scroll : { offset: offset.current };
      state.settled = settled; restoration.current = state; scheduleRestore();
      return () => { if (restoration.current === state) { state.settled = undefined; state.done = true; state.tracking = false; } };
    } };
  }, [presentation, readScroll, scheduleRestore]);
  useQuestionAppearance(presentation, () => {
    appeared.current = true;
    if (presentation.getSnapshot().restoreReferenceFocus) {
      const previous = restoration.current;
      saved.current = presentation.getSnapshot().scroll;
      restoration.current = { ...restoring(saved.current, previous.layout && !previous.done), settled: previous.settled };
    }
    restore(); restoreFocus();
  });
  const update = useCallback((turns: ChatTurn[], ready: boolean) => {
    data.current = turns; finalReady.current = ready; restoreFocus();
  }, [restoreFocus]);
  const registerCitation = useCallback((key: string, element: ElementRef<typeof View> | null) => {
    if (element) citations.current.set(key, element); else citations.current.delete(key); restoreFocus();
  }, [restoreFocus]);
  const openCitation = useCallback((target: CitationTarget) => {
    appeared.current = false; void capture().then(() => { if (live.current) onOpenCitation(target); });
  }, [capture, onOpenCitation]);
  const beginDrag = useCallback(() => {
    interaction.current += 1; captureRevision.current += 1;
    presentation.update({ restoreReferenceFocus: false }, false);
    const state = restoration.current; state.tracking = false; finish(state);
  }, [finish, presentation]);
  return { list, viewport, rows, saved, captureLayout, update, restore, registerCitation, openCitation, beginDrag,
    onContentSizeChange: restore,
    onViewableItemsChanged: useRef(({ viewableItems }: { viewableItems: readonly { item: ChatTurn }[] }) => {
      viewable.current = viewableItems.map(item => item.item.id);
    }).current,
    onScroll: useCallback((y: number) => {
      offset.current = Math.max(0, y);
      if (!appeared.current) return;
      if (restoration.current.done && !restoration.current.tracking)
        presentation.update({ scroll: { ...presentation.getSnapshot().scroll, offset: offset.current } }, false);
      else restore();
    }, [presentation, restore]),
    endDrag: useCallback(() => { if (restoration.current.done) void capture(); }, [capture]),
  };
}
