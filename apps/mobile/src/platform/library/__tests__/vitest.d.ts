/**
 * 移动端没有独立的 vitest 依赖（测试统一用 workspace 内的 vitest 运行），
 * 这里只声明测试文件用到的最小 API，保证 `pnpm typecheck` 能覆盖到测试。
 */
declare module 'vitest' {
  interface Matchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeNull(): void;
    toBeTruthy(): void;
    toContain(expected: unknown): void;
  }
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void): void;
  export function expect(actual: unknown): Matchers;
}
