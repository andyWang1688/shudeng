/** Pure geometry shared by the card's keyboard, rotation and drag paths. Units are points. */
export const NOTE_SHEET = {
  initialRatio: 0.54,
  minimumRatio: 0.44,
  maximumRatio: 0.92,
  expandedThreshold: 0.66,
  dismissVelocity: 1.2, // PanResponder reports points per millisecond.
  topGap: 8,
  dragOvershoot: 24,
} as const;

export interface NoteSheetBounds {
  readonly height: number;
  readonly safeTop: number;
  readonly keyboardOverlap: number;
}

export function noteSheetKeyboardHeight({
  height,
  safeTop,
  keyboardOverlap,
}: NoteSheetBounds): number {
  return Math.min(
    height * NOTE_SHEET.initialRatio,
    Math.max(
      0,
      height - keyboardOverlap - Math.max(0, safeTop) - NOTE_SHEET.topGap,
    ),
  );
}

export function noteSheetRestingHeight(
  bounds: NoteSheetBounds,
  ratio: number,
): number {
  return bounds.keyboardOverlap > 0
    ? noteSheetKeyboardHeight(bounds)
    : bounds.height * ratio;
}

/** Normalize the two iOS keyboard hide notifications into one layout transition. */
export function noteSheetKeyboardTransition(
  bounds: NoteSheetBounds,
  ratio: number,
  keyboardTop: number | null,
): { readonly height: number; readonly keyboardOverlap: number; readonly ratio: number } | null {
  const keyboardOverlap = keyboardTop === null ? 0 : Math.max(0, bounds.height - keyboardTop);
  if (keyboardOverlap === bounds.keyboardOverlap) return null;
  const nextRatio = keyboardOverlap === 0 ? NOTE_SHEET.initialRatio : ratio;
  return {
    height: noteSheetRestingHeight({ ...bounds, keyboardOverlap }, nextRatio),
    keyboardOverlap,
    ratio: nextRatio,
  };
}

export function noteSheetDragHeight(
  startHeight: number,
  dy: number,
  bounds: NoteSheetBounds,
): number {
  const available =
    bounds.keyboardOverlap > 0
      ? Math.max(
          0,
          bounds.height -
            bounds.keyboardOverlap -
            bounds.safeTop -
            NOTE_SHEET.topGap,
        )
      : bounds.height * NOTE_SHEET.maximumRatio + NOTE_SHEET.dragOvershoot;
  return Math.min(Math.max(startHeight - dy, 0), available);
}

export function settleNoteSheetDrag(
  currentHeight: number,
  velocityY: number,
  bounds: NoteSheetBounds,
):
  | { readonly dismiss: true }
  | {
      readonly dismiss: false;
      readonly height: number;
      readonly ratio: number;
    } {
  if (
    velocityY > NOTE_SHEET.dismissVelocity ||
    (bounds.keyboardOverlap === 0 &&
      currentHeight < bounds.height * NOTE_SHEET.minimumRatio)
  ) {
    return { dismiss: true };
  }
  const ratio =
    currentHeight > bounds.height * NOTE_SHEET.expandedThreshold
      ? NOTE_SHEET.maximumRatio
      : NOTE_SHEET.initialRatio;
  const requested =
    ratio === NOTE_SHEET.maximumRatio
      ? bounds.height * ratio
      : noteSheetRestingHeight(bounds, ratio);
  // Keep the header reachable even after an upward drag with a tall software keyboard.
  const height =
    bounds.keyboardOverlap > 0
      ? Math.min(
          requested,
          Math.max(
            0,
            bounds.height -
              bounds.keyboardOverlap -
              bounds.safeTop -
              NOTE_SHEET.topGap,
          ),
        )
      : requested;
  return { dismiss: false, height, ratio };
}
