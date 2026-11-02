# @shudeng/reader-web

task-87 WebView 阅读器 spike：EPUB 用 foliate-js、PDF 用 pdf.js，作为 React Native WebView 的阅读器页面。只为 spike 验证，未接 `apps/mobile`（按 Lead 要求不改 UI 组文件）。

## 运行

```bash
pnpm --filter @shudeng/reader-web typecheck
pnpm --filter @shudeng/reader-web build
pnpm --filter @shudeng/reader-web preview   # http://127.0.0.1:4173
# 验证（headless Chrome + CDP，不依赖 Playwright）：
pnpm --filter @shudeng/reader-web verify
```

dev 直接打开：

- `/?format=epub&fixture=search-fixture&title=...`
- `/?format=pdf&fixture=text&title=...`

fixture 来自 `ios/ShudengTests/Fixtures/search-fixture.epub` 与 `delivery/pdf-samples/01-文字型-正文.pdf`；大文件验证临时复制 `02-扫描型-正文.pdf` 为 `public/fixtures/large.pdf`（`.gitignore`，验证结束自动清理）。

## 消息协议（`src/protocol.ts`）

原生 → WebView（`window.postMessage` / `window.__readerHost` 直接调用）：

```json
{"type":"reader:open","payload":{"format":"epub","url":"/fixtures/search-fixture.epub","title":"红楼梦"}}
{"type":"reader:goTo","payload":{"locator":"epubcfi(...)"}}
{"type":"reader:theme","payload":{"theme":"dark"}}
{"type":"reader:fontSize","payload":{"fontSize":22}}
{"type":"reader:flow","payload":{"flow":"scrolled"}}
{"type":"reader:zoom","payload":{"scale":1.5}}
{"type":"reader:annotation:add","payload":{"id":"a1","format":"epub","locator":{...},"color":"yellow"}}
{"type":"reader:annotation:remove","payload":{"id":"a1"}}
{"type":"reader:next"} / {"type":"reader:prev"}
```

WebView → 原生（优先 `window.ReactNativeWebView.postMessage(JSON.stringify(message))`，dev 模式回落到 `parent.postMessage`）：

```json
{"type":"reader:ready","payload":{"format":"epub","title":"红楼梦","flow":"paginated"}}
{"type":"reader:selection","payload":{"text":"...","locator":{"type":"epub","cfi":"epubcfi(...)"},"rects":[...]}}
{"type":"reader:progress","payload":{"fraction":0.23,"locator":{"type":"epub","cfi":"..."},"chapter":"..."}}
{"type":"reader:annotation","payload":{...}}
{"type":"reader:annotationSelected","payload":{...}}
{"type":"reader:state","payload":{"annotations":1}}
{"type":"reader:error","payload":{"message":"..."}}
```

### 锚点

- EPUB：`locator = {type:'epub', cfi, href?, chapter?}`；CFI 由 `foliate-view.getCFI(index, range)` 生成，选中/标注/恢复都用 CFI。进度用 `relocate` 事件的 CFI+fraction。
- PDF：`locator = {type:'pdf', page, rects:[{x,y,width,height}]}`；`rects` 是相对页面的归一化坐标（0..1，左上原点）。文本坐标可由 `reader:pageText` 后续扩展暴露（当前验证脚本调用内部 `getTextCoordinates(page)`）。

## RN WebView 最小壳（待接）

```tsx
const html = `<!doctype html><html><head>
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <link rel="stylesheet" href="${assetBase}/assets/index.css">
</head><body>
  <div id="root"></div>
  <script>window.__readerNativeBase = ${JSON.stringify(assetBase)}</script>
  <script type="module" src="${assetBase}/assets/index.js"></script>
</body></html>`

<WebView
  source={{ html, baseUrl: assetBase }}
  originWhitelist={['*']}
  javaScriptEnabled
  allowingReadAccessToURL={assetBase}
  injectedJavaScript={`window.__readerHost && window.__readerHost(${JSON.stringify({type:'reader:open', payload:{...}})})`}
  onMessage={(event) => {
    const message = JSON.parse(event.nativeEvent.data) // reader:ready / selection / progress / annotation
  }}
/>
```

`ReaderWebView` 建议：

1. 把 `dist/` 作为本地静态资源（`baseUrl` 指向本地 http 服务/自定义 scheme）；ES module 与 pdf.js worker 在 `file://` 下受 WKWebView 限制，优先本地 http。
2. 收到 `reader:ready` 后再注入后续命令；`selection` 用 `rects` 定位原生浮层，`locator` 用于高亮/保存。
3. `reader:annotation:add` 只传锚点和显示信息，不把整本书内容传给原生。

## 验证结果（2026-11-02）

`pnpm --filter @shudeng/reader-web verify` 在 headless Chrome 430×932（DPR2）跑通 9 个场景，证据 `.scratch/impl/rn-langchain-reader/`：

| 场景 | 结果 |
| --- | --- |
| EPUB 打开/progress CFI | PASS，cfi `epubcfi(/6/2!/4,...)`，fraction 0.236 |
| EPUB 翻页 | PASS，next 后 CFI 变化 |
| EPUB 选字 | PASS，返回 CFI + 3 个矩形 |
| EPUB 标注锚点 add/remove | PASS，annotationCount 1→0 |
| EPUB 深色/字号 24/滚动 | PASS |
| PDF 打开/文本坐标 | PASS，2 页 / 51 个文本块，归一化坐标 0..1 |
| PDF 选字/标注/annotationSelected | PASS，选区 rect 1 个，点击标注回传消息 |
| PDF 缩放/深色 | PASS，zoom 1.6 后恢复 1.0，dark 生效 |
| PDF 大文件（12MB 扫描 2 页） | PASS，JS heap 约 7.1→4.7MB，逐页渲染/可翻页 |

## 限制 / 未验证

1. **PDF 是逐页单页渲染**，未实现连续滚动/infinite scroll；大文件内存优先（只保留当前页 canvas/text layer）。PDF `reader:flow=scrolled` 仍是单页语义（spike 未做纵向连续）。
2. PDF 文本层是 spike 自绘 span（未用 pdf.js TextLayer），英文/旋转/多栏排版下选区矩形可能与视觉有偏差；PDF 文本坐标提取按 `getTextContent` transform 归一化，复杂字体/空格精度未逐字验证。
3. EPUB 的 CFI 由 foliate-js 生成，已能存取；跨章节/跨页标注的 CFI 兼容性未做旧数据迁移测试。
4. PDF worker 用 Vite `?url` 打包（dist 约 2.2MB worker）；WKWebView `file://` 下 worker/ESM 需要本地 http 或打包成 inline/blob，未在 iOS WebView 实测。
5. 深色 PDF 使用 canvas CSS `invert+hue-rotate`，扫描页/彩色图会偏色；不是重新渲染。
6. 12MB 扫描样本仅 2 页，不能代表 500 页书籍；JS heap 不含 PDF.js 的 ArrayBuffer/WASM 外部内存，需真机 Instruments 复测。
7. 未接 RN `apps/mobile`（按 Lead 要求），未验证 Android WebView/iOS WKWebView 手势、文件选择、离线缓存。
8. foliate-js 1.0.1 不是稳定 API；`create-overlay/draw-annotation` 事件行为后续版本可能变。

## 依赖

- `foliate-js@1.0.1`（MIT，EPUB 解析/分页/CFI/overlayer）
- `pdfjs-dist@6.5.438`（Apache-2.0，PDF 解析/渲染/文本层数据）
- `vite@8` + `typescript@6`（构建/类型检查）
