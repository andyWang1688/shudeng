/** Hermes/RN 的同步上下文兼容层；异步业务上下文由显式参数传递。 */

export class AsyncLocalStorage<T = unknown> {
  private readonly values: T[] = [];
  run<R>(store: T, callback: (...args: unknown[]) => R, ...args: unknown[]): R {
    this.values.push(store);
    try {
      return callback(...args);
    } finally {
      this.values.pop();
    }
  }
  getStore(): T | undefined {
    return this.values[this.values.length - 1];
  }
  enterWith(store: T): void {
    this.values.push(store);
  }
  exit<R>(callback: () => R): R {
    this.values.pop();
    return callback();
  }
  disable(): void {
    this.values.length = 0;
  }
}

export class AsyncResource {
  constructor(_type: string, ..._args: unknown[]) {}
  runInAsyncScope<R>(callback: (...args: unknown[]) => R, thisArg?: unknown, ...args: unknown[]): R {
    return callback.apply(thisArg, args);
  }
  bind<F extends (...args: never[]) => unknown>(fn: F): F {
    return fn.bind(this) as F;
  }
  emitDestroy(): void {}
  asyncId(): number {
    return 0;
  }
  triggerAsyncId(): number {
    return 0;
  }
}

export function createHook(): { enable(): void; disable(): void } {
  return { enable() {}, disable() {} };
}

export default { AsyncLocalStorage, AsyncResource, createHook };
