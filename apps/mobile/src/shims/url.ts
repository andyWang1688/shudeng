export class URL extends globalThis.URL {}
export class URLSearchParams extends globalThis.URLSearchParams {}
export function fileURLToPath(value: string): string {
  return value;
}
export function pathToFileURL(value: string): globalThis.URL {
  return new globalThis.URL(`file://${value}`);
}
export const parse = (value: string): globalThis.URL => new globalThis.URL(value);
export default { URL, URLSearchParams, fileURLToPath, pathToFileURL, parse };
