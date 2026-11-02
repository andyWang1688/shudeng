export const performance = globalThis.performance ?? { now: () => Date.now() };
export function now(): number {
  return performance.now();
}
export class PerformanceObserver {
  observe(): void {}
  disconnect(): void {}
}
export default { performance, now, PerformanceObserver };
