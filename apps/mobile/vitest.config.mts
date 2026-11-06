import { collectTests } from './scripts/test-files.mjs';

/** Pure platform/runtime regressions; native UI behavior still needs device acceptance. */
export default {
  test: { include: collectTests().vitest, environment: 'node' },
};
