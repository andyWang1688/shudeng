// Throwaway engine compatibility spike. Reuses the existing Vite installation.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const upstream = resolve(root, '.build/continuous-epub-20261109/upstream/foliate-js-b34a0aa63163d19cd13e2ecd19b678394c32fee5')
if (!existsSync(resolve(upstream, 'paginator.js'))) throw new Error('先按 spikes/continuous-epub/README.md 下载固定提交。')
const requireReader = createRequire(resolve(root, 'packages/reader-web/package.json'))
const { createServer } = await import(requireReader.resolve('vite'))
const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL('./', import.meta.url)),
  // The three-chapter reflowable book never loads PDF/FXL/TTS branches.
  // Avoid scanning those optional upstream integrations during this spike.
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: { alias: {
    '@continuous-upstream': upstream,
    '@current-upstream': resolve(root, '.build/continuous-epub-20261109/upstream/current-foliate-js-1.0.1-projectpatch'),
  } },
  server: { host: '127.0.0.1', port: 5189, strictPort: true, fs: { allow: [root] } },
})
await server.listen()
server.printUrls()
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0) })
