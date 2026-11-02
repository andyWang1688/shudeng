const env: Record<string, string | undefined> = {};
export const platform = 'react-native';
export const version = 'v22.0.0';
export const arch = 'arm64';
export const argv: string[] = [];
export const versions = { node: '22.0.0' };
export function cwd(): string {
  return '/';
}
export function nextTick(callback: (...args: unknown[]) => void, ...args: unknown[]): void {
  setTimeout(() => callback(...args), 0);
}
export function exit(code: number): void {
  throw new Error(`process.exit(${code})`);
}
export const envProxy = env;
export default { env, platform, version, arch, argv, versions, cwd, nextTick, exit };
