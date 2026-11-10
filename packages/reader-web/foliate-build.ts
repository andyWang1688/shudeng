import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/** EPUB uses Foliate; PDF has its own reader and worker configuration. */
export const foliateEpubOnly = (): Plugin => ({
  name: 'foliate-epub-only',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === './pdf.js' && importer?.endsWith('/foliate-js/view.js')) {
      return fileURLToPath(new URL('./src/foliate-unsupported-pdf.ts', import.meta.url))
    }
  },
})
