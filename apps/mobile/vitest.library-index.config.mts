/** Node/SQLite evidence for platform lifecycle and prepared-text consumers; no device claims. */
export default {
  root: new URL('../../', import.meta.url).pathname,
  test: {
    include: ['apps/mobile/src/platform/library/__tests__/*.test.mts', 'apps/mobile/src/platform/ai/__tests__/*.test.mts'],
    environment: 'node',
  },
  resolve: { alias: { vitest: new URL('../../packages/core/node_modules/vitest/dist/index.js', import.meta.url).pathname } },
};
