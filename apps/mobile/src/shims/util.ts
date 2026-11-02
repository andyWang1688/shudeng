/** 最小 util shim：覆盖 LangChain 打包时用到的少量函数。 */
export function debuglog(_section: string): (...args: unknown[]) => void {
  return () => {};
}
export function format(input: unknown, ...args: unknown[]): string {
  let index = 0;
  const text = typeof input === 'string' ? input : String(input);
  return text.replace(/%[sdifjoO%]/g, (token) => {
    if (token === '%%') return '%';
    const value = args[index];
    index += 1;
    if (token === '%d' || token === '%i') return String(Number(value));
    if (token === '%f') return String(Number(value));
    if (token === '%j') {
      try {
        return JSON.stringify(value);
      } catch {
        return '[Circular]';
      }
    }
    return typeof value === 'string' ? value : inspect(value);
  });
}
export function inspect(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
export function inherits(constructor: unknown, superConstructor: unknown): void {
  if (typeof constructor !== 'function') return;
  Object.setPrototypeOf(constructor.prototype, (superConstructor as { prototype: object }).prototype);
  Object.setPrototypeOf(constructor, superConstructor as object);
}
export function promisify<T>(fn: (...args: unknown[]) => void): (...args: unknown[]) => Promise<T> {
  return (...args: unknown[]) =>
    new Promise<T>((resolve, reject) => {
      fn(...args, (error: unknown, value: T) => (error ? reject(error) : resolve(value)));
    });
}
export function deprecate<T>(fn: T): T {
  return fn;
}
export const types = {
  isDate: (value: unknown): value is Date => value instanceof Date,
  isRegExp: (value: unknown): value is RegExp => value instanceof RegExp,
  isNativeError: (value: unknown): value is Error => value instanceof Error,
};
export default { debuglog, format, inspect, inherits, promisify, deprecate, types };
