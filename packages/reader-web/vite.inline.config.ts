import { defineConfig } from 'vite'

// 单文件构建：内联 JS/CSS/worker，供 RN WebView 的 source={{ html }} 使用。
export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'reader-inline-entry',
      enforce: 'pre',
      transformIndexHtml: {
        order: 'pre',
        handler(html) {
          // native 内联入口不 import pdf.js；Web 入口仍使用 index.html + /src/main.ts。
          return html.replace('/src/main.ts', '/src/main-inline.ts')
        },
      },
    },
  ],
  build: {
    outDir: 'dist-inline',
    target: 'es2020',
    sourcemap: false,
    assetsInlineLimit: 0,
    rolldownOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
