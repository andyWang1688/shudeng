#!/usr/bin/env node
/**
 * 构建自包含 reader-web HTML，供 RN WebView `source={{ html }}` 使用。
 * 产出：
 *  - packages/reader-web/dist-inline/index.html（可直接浏览器打开/调试）
 *  - apps/mobile/src/reader/readerWebHtml.ts（生成文件，TypeScript 字符串）
 *  - apps/mobile/src/reader/readerFixtures.ts（生成文件，EPUB/PDF fixture base64）
 *
 * 为什么要自包含：WKWebView 的 source={{html}} 没有可解析的 base URL，相对 URL 会失败。
 * native 只走 EPUB（foliate）；PDF 由 RN PDFKit 渲染，不 import pdf.js。
 * Web 开发/预览入口（src/main.ts）仍保留 PDF.js。
 * JS/CSS 全部内联后，WebView 只加载一个 html 字符串，不依赖本地静态服务器。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const READER = resolve(HERE, '..')
const ROOT = resolve(READER, '../..')
const DIST = resolve(READER, 'dist-inline')
const MOBILE_READER = resolve(ROOT, 'apps/mobile/src/reader')

execFileSync(
  'pnpm',
  ['--filter', '@shudeng/reader-web', 'exec', 'vite', 'build', '--config', 'vite.inline.config.ts'],
  { cwd: ROOT, stdio: 'inherit' },
)

const indexHtml = readFileSync(resolve(DIST, 'index.html'), 'utf8')
const assets = readdirSync(resolve(DIST, 'assets'))
const jsName = assets.find((name) => /^index-.*\.js$/.test(name))
const cssName = assets.find((name) => /^index-.*\.css$/.test(name))
if (!jsName || !cssName) throw new Error('inline build assets missing')
const js = readFileSync(resolve(DIST, 'assets', jsName), 'utf8')
const css = readFileSync(resolve(DIST, 'assets', cssName), 'utf8')
const escapeScript = (code) => code.replace(/<\/script/gi, '<\\/script')

let html = indexHtml
  .replace(/<link rel="icon"[^>]*>/i, '')
  .replace(/<link rel="stylesheet"[^>]*>/i, `<style>${css}</style>`)
  .replace(
    /<script type="module"[^>]*><\/script>/i,
    () => `<script type="module">${escapeScript(js)}</script>`,
  )

if (!html.includes('__readerHost')) throw new Error('reader js not inlined')
if (/pdf\.worker|PDFDocument|pdfjs-dist/.test(html)) {
  throw new Error('inline build must not contain pdf.js（native PDF 不走 reader-web）')
}

writeFileSync(resolve(DIST, 'index.html'), html)

mkdirSync(MOBILE_READER, { recursive: true })
writeFileSync(
  resolve(MOBILE_READER, 'readerWebHtml.ts'),
  `// 由 packages/reader-web/scripts/build-inline.mjs 生成；勿手改。\nexport const readerWebHtml = ${JSON.stringify(html)};\n`,
)

const epubBase64 = readFileSync(resolve(READER, 'public/fixtures/search-fixture.epub')).toString('base64')
const pdfBase64 = readFileSync(resolve(READER, 'public/fixtures/text.pdf')).toString('base64')
writeFileSync(
  resolve(MOBILE_READER, 'readerFixtures.ts'),
  `// 由 packages/reader-web/scripts/build-inline.mjs 生成；勿手改。\n` +
  `// 来源：ios/ShudengTests/Fixtures/search-fixture.epub 与 delivery/pdf-samples/01-文字型-正文.pdf（spike fixture）。\n` +
  `export const readerFixtures = {\n` +
  `  epub: {\n` +
  `    title: '红楼梦 · 搜索夹具',\n` +
  `    mimeType: 'application/epub+zip',\n` +
  `    base64: ${JSON.stringify(epubBase64)},\n` +
  `  },\n` +
  `  pdf: {\n` +
  `    title: '书灯 PDF 示例',\n` +
  `    mimeType: 'application/pdf',\n` +
  `    base64: ${JSON.stringify(pdfBase64)},\n` +
  `  },\n` +
  `} as const;\n`,
)

console.log(
  `inline reader-web (EPUB only, no pdf.js): ${(html.length / 1024 / 1024).toFixed(2)}MB html ` +
  `(js ${(js.length / 1024 / 1024).toFixed(2)}MB)`,
)
