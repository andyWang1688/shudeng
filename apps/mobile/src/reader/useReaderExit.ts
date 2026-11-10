import { useEffect, useRef } from "react";
import { Alert } from "react-native";

export function useReaderExit({
  bookId,
  flushProgress,
  onExit,
}: {
  readonly bookId: string;
  readonly flushProgress: () => Promise<boolean>;
  readonly onExit: () => void;
}) {
  const mounted = useRef(true);
  const owner = useRef({ bookId });
  if (owner.current.bookId !== bookId) owner.current = { bookId };
  const session = owner.current;
  const pending = useRef<{ owner: object; completed: boolean } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current = null;
    };
  }, []);
  return async () => {
    if (
      !mounted.current ||
      owner.current !== session ||
      pending.current?.owner === session
    )
      return;
    const request = { owner: session, completed: false };
    pending.current = request;
    const current = () =>
      mounted.current &&
      owner.current === session &&
      pending.current === request &&
      !request.completed;
    const cancel = () => {
      if (current()) pending.current = null;
    };
    const leave = () => {
      if (!current()) return;
      request.completed = true;
      onExit();
    };
    let saved = false;
    try {
      saved = await flushProgress();
    } catch {
      saved = false;
    }
    if (!current()) return;
    if (saved) leave();
    else
      Alert.alert(
        "位置与设置尚未保存",
        "返回后，未保存的阅读位置或设置可能丢失。",
        [
          { text: "留在阅读页", style: "cancel", onPress: cancel },
          { text: "仍然返回", style: "destructive", onPress: leave },
        ],
        { onDismiss: cancel },
      );
  };
}
