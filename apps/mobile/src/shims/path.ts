/** 最小 posix path shim（打包/演示用，不做 Windows 语义）。 */
export const sep = '/';
function normalize(parts: string[]): string {
  const joined = parts.join('/');
  const absolute = joined.startsWith('/');
  const segments: string[] = [];
  for (const part of joined.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') segments.pop();
      else if (!absolute) segments.push('..');
      continue;
    }
    segments.push(part);
  }
  return (absolute ? '/' : '') + segments.join('/');
}
export function join(...parts: string[]): string {
  return normalize(parts);
}
export function resolve(...parts: string[]): string {
  let result = '';
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index] ?? '';
    if (!part) continue;
    result = result ? `${part}/${result}` : part;
    if (part.startsWith('/')) break;
  }
  return normalize([result.startsWith('/') ? '' : '/', result]);
}
export function dirname(value: string): string {
  const normalized = normalize([value]);
  const index = normalized.lastIndexOf('/');
  if (index <= 0) return normalized.startsWith('/') ? '/' : '.';
  return normalized.slice(0, index);
}
export function basename(value: string, suffix?: string): string {
  const normalized = normalize([value]);
  const name = normalized.slice(normalized.lastIndexOf('/') + 1);
  return suffix && name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}
export function extname(value: string): string {
  const name = basename(value);
  const index = name.lastIndexOf('.');
  return index <= 0 ? '' : name.slice(index);
}
export function isAbsolute(value: string): boolean {
  return value.startsWith('/');
}
export function normalizePath(value: string): string {
  return normalize([value]);
}
export function relative(from: string, to: string): string {
  const fromParts = resolve(from).split('/').filter(Boolean);
  const toParts = resolve(to).split('/').filter(Boolean);
  let index = 0;
  while (index < fromParts.length && index < toParts.length && fromParts[index] === toParts[index]) index += 1;
  return [...Array(Math.max(0, fromParts.length - index)).fill('..'), ...toParts.slice(index)].join('/') || '.';
}
export const posix = { sep, join, resolve, dirname, basename, extname, normalize: normalizePath, isAbsolute, relative };
export default posix;
