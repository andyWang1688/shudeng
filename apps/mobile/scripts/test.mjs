import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectTests } from './test-files.mjs';

const tests = collectTests();
const cwd = new URL('../', import.meta.url);
const commands = [
  [process.execPath, ['--experimental-transform-types', '--test', ...tests.node]],
  [process.execPath, [fileURLToPath(import.meta.resolve('vitest/vitest.mjs')), 'run']],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}
