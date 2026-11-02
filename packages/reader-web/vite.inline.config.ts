import { defineConfig } from 'vite'

// 单文件构建：内联 JS/CSS/worker，供 RN WebView 的 source={{ html }} 使用。
export default defineConfig({
  base: './',
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
