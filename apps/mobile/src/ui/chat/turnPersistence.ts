/** Serializes partial/final writes, so a slow partial save cannot overwrite the final answer. */
export function createTurnPersistence<T>(
  save: (snapshot: T) => Promise<void>,
  onBackgroundError: (error: unknown) => void,
  intervalMs = 750,
) {
  let pending: T | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let tail: Promise<void> = Promise.resolve();

  const flush = (snapshot?: T): Promise<void> => {
    if (snapshot !== undefined) pending = snapshot;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (pending === undefined) return tail;
    const next = pending;
    pending = undefined;
    const write = tail.catch(() => undefined).then(() => save(next));
    tail = write;
    return write;
  };

  return {
    schedule(snapshot: T): void {
      pending = snapshot;
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        void flush().catch(onBackgroundError);
      }, intervalMs);
    },
    flush,
  };
}
