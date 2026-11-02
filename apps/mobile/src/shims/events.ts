type Handler = (...args: unknown[]) => void;
export class EventEmitter {
  private readonly listeners = new Map<string | symbol, Handler[]>();
  on(event: string | symbol, handler: Handler): this {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
    return this;
  }
  addListener(event: string | symbol, handler: Handler): this {
    return this.on(event, handler);
  }
  once(event: string | symbol, handler: Handler): this {
    const wrapper: Handler = (...args) => {
      this.removeListener(event, wrapper);
      handler(...args);
    };
    return this.on(event, wrapper);
  }
  off(event: string | symbol, handler: Handler): this {
    return this.removeListener(event, handler);
  }
  removeListener(event: string | symbol, handler: Handler): this {
    const list = this.listeners.get(event);
    if (!list) return this;
    const index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
    return this;
  }
  removeAllListeners(event?: string | symbol): this {
    if (event === undefined) this.listeners.clear();
    else this.listeners.delete(event);
    return this;
  }
  emit(event: string | symbol, ...args: unknown[]): boolean {
    const list = this.listeners.get(event);
    if (!list || list.length === 0) return false;
    for (const handler of [...list]) handler(...args);
    return true;
  }
  listenerCount(event: string | symbol): number {
    return this.listeners.get(event)?.length ?? 0;
  }
  setMaxListeners(_count: number): this {
    return this;
  }
  getMaxListeners(): number {
    return 10;
  }
}
export default EventEmitter;
export const captureRejectionSymbol = Symbol.for('nodejs.rejection');
