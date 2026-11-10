import { defineConfig } from 'vite'
import { foliateEpubOnly } from './foliate-build.ts'

export default defineConfig({
  base: './',
  plugins: [foliateEpubOnly()],
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
})
