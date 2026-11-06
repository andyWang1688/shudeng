import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const mobileRoot = new URL('../', import.meta.url);

/** Keep both existing runners covered, and fail rather than silently skip an unknown test. */
export function collectTests() {
  const tests = { node: [], vitest: [] };
  for (const directory of ['src', 'plugins']) {
    for (const entry of readdirSync(new URL(directory, mobileRoot), { recursive: true })) {
      if (!/\.test\.(?:[cm]?[jt]s|tsx)$/.test(entry)) continue;
      const path = join(directory, entry);
      const source = readFileSync(new URL(path, mobileRoot), 'utf8');
      const imports = [...source.matchAll(/(?:from\s*|require\(\s*)['"](node:test|vitest)['"]/g)];
      const runners = new Set(imports.map(match => match[1] === 'node:test' ? 'node' : 'vitest'));
      if (runners.size !== 1) throw new Error(`Test must use exactly one runner: ${path}`);
      tests[[...runners][0]].push(path);
    }
  }
  for (const files of Object.values(tests)) files.sort();
  return tests;
}
