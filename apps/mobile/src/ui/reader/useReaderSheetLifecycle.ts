import { useEffect, useRef, useState } from "react";
import { Keyboard } from "react-native";
import type BottomSheet from "@gorhom/bottom-sheet";

export interface ReaderPanelActions {
  readonly blocked: boolean;
  /** Check inside the callback: disabled controls cannot revoke an already queued event. */
  readonly canInteract: () => boolean;
}

/** A close belongs to one presentation and locks its content before animation starts. */
export function useReaderSheetLifecycle({
  visible,
  busy,
  onClose,
  onBeginClose,
}: {
  readonly visible: boolean;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onBeginClose?: () => void;
}) {
  const sheet = useRef<BottomSheet>(null);
  const mounted = useRef(true);
  const presentation = useRef({ visible, token: {}, openIndex: 0 as 0 | 1 });
  if (presentation.current.visible !== visible)
    presentation.current = { visible, token: {}, openIndex: 0 };
  const token = presentation.current.token;
  const [closingToken, setClosingToken] = useState<object | null>(null);
  const closing = useRef<{
    token: object;
    onClose: () => void;
    completed: boolean;
  } | null>(null);
  const latest = useRef({ visible, busy, onClose, onBeginClose });
  latest.current = { visible, busy, onClose, onBeginClose };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      closing.current = null;
    };
  }, []);

  const isCurrent = () =>
    mounted.current &&
    latest.current.visible &&
    presentation.current.token === token;
  const canInteract = () =>
    isCurrent() && !latest.current.busy && closing.current?.token !== token;
  const beginClose = () => {
    if (!isCurrent()) return false;
    // Repeated native animation/completion callbacks retain the accepted owner,
    // even when a later busy prop would reject a new close request.
    if (closing.current?.token === token) return true;
    if (!canInteract()) return false;
    closing.current = {
      token,
      onClose: latest.current.onClose,
      completed: false,
    };
    setClosingToken(token);
    latest.current.onBeginClose?.();
    return true;
  };
  const close = () => {
    if (!canInteract() || !beginClose()) return;
    Keyboard.dismiss();
    sheet.current?.close();
  };
  const onAnimate = (from: number, to: number) => {
    if (!isCurrent()) return;
    if (to >= 0) presentation.current.openIndex = to === 1 ? 1 : 0;
    if (to === -1) {
      presentation.current.openIndex = from === 1 ? 1 : 0;
      if (!beginClose())
        sheet.current?.snapToIndex(presentation.current.openIndex);
    }
  };
  const didClose = () => {
    if (!isCurrent()) return;
    // A queued gesture can reach native code after busy disables the controls.
    // Restore its last detent instead of leaving an invisible modal over the book.
    if (!beginClose()) {
      sheet.current?.snapToIndex(presentation.current.openIndex);
      return;
    }
    const request = closing.current;
    if (request && !request.completed) {
      request.completed = true;
      request.onClose();
    }
  };

  return {
    sheet,
    close,
    onAnimate,
    didClose,
    isCurrent,
    canInteract,
    blocked: busy || closingToken === token,
  };
}
