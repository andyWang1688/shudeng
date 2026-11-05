/** Serializes inference and file replacement so an active ONNX session is never released. */
export function createRuntimeQueue() {
  let pending: Promise<unknown> = Promise.resolve();
  return function run<T>(work: () => Promise<T>): Promise<T> {
    const next = pending.then(work, work);
    pending = next.catch(() => undefined);
    return next;
  };
}
