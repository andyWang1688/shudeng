/** Observe the original Expo/Fetch response without constructing RN's legacy Response. */
export function observeResponseActivity(response: Response, onActivity: () => void): Response {
  const streams = new WeakMap<ReadableStream<Uint8Array>, ReadableStream<Uint8Array>>();
  const observeReader = (reader: ReadableStreamDefaultReader<Uint8Array>) => new Proxy(reader, {
    get(target, property) {
      if (property === 'read') return async () => {
        const item = await target.read();
        if (!item.done && item.value.byteLength) onActivity();
        return item;
      };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const observeBody = (source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> => {
    const previous = streams.get(source);
    if (previous) return previous;
    const body = new Proxy(source, {
      get(target, property) {
        if (property === 'getReader') return () => observeReader(target.getReader());
        if (property === Symbol.asyncIterator) return async function* () {
          const reader = observeReader(target.getReader());
          let finished = false;
          try {
            for (;;) {
              const item = await reader.read();
              if (item.done) { finished = true; return; }
              yield item.value;
            }
          } finally {
            if (!finished) await reader.cancel();
            reader.releaseLock();
          }
        };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    streams.set(source, body);
    return body;
  };
  return new Proxy(response, {
    get(target, property) {
      // clone() can tee and replace the original response's stream. Read it live.
      if (property === 'body') return target.body ? observeBody(target.body) : null;
      if (property === 'clone') return () => observeResponseActivity(target.clone(), onActivity);
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
