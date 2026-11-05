import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '../../../../../..');
const { build } = await import(pathToFileURL(resolve(repo, 'packages/reader-web/node_modules/vite/dist/node/index.js')).href);
await build({ configFile: false, root: here,
  resolve: { alias: { 'foliate-js': resolve(repo, 'packages/reader-web/node_modules/foliate-js') } },
  build: { target: 'es2022', outDir: resolve(repo, '.build/epub-resources/probe'), emptyOutDir: true,
    lib: { entry: resolve(here, 'probe.ts'), formats: ['es'], fileName: () => 'probe.js' } },
});
