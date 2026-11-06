# reader-web

当前为 RN 阅读器提供 EPUB/Foliate 内容渲染及宿主消息协议，已接入正式移动端阅读路径。iOS PDF 使用原生 PDFKit；这里的 PDF.js 仅保留在 Web 开发/实验入口，不代表正式 PDF 能力。

## 修改与生成

从仓库根目录运行；完整脚本与依赖版本以 [package.json](package.json) 为准。

| 目的 | 命令 / 入口 |
| --- | --- |
| Web 调试 | pnpm --filter @shudeng/reader-web dev |
| 类型与定向测试 | 分别运行 `pnpm --filter @shudeng/reader-web typecheck`、`pnpm --filter @shudeng/reader-web test`。 |
| 生成移动端内联资源 | pnpm --filter @shudeng/reader-web build:inline |

build:inline 由[脚本](scripts/build-inline.mjs)生成 dist-inline/index.html、[readerWebHtml.ts](../../apps/mobile/src/reader/readerWebHtml.ts) 与 [readerFixtures.ts](../../apps/mobile/src/reader/readerFixtures.ts)，生成文件不手改。移动端入口为 [main-inline.ts](src/main-inline.ts)，构建检查会拒绝混入 PDF.js；Web 开发入口为 [main.ts](src/main.ts)。

## 接入边界

- 消息与数据字段以 [protocol.ts](src/protocol.ts)、[bridge.ts](src/bridge.ts) 及移动端 [ReaderWebView](../../apps/mobile/src/reader/ReaderWebView.tsx) 为准，不在 README 保存第二份协议代码。
- 正式 EPUB 通过原生归档会话逐资源读取；定位、资源身份与取消/错误约束遵守 [EPUB 资源合同](../../docs/architecture/epub-resources.md)。早期 fixture/base64 壳只是实验，不作为大书导入方案。
- 这里负责正文、位置与消息，产品 UI 和业务生命周期留给宿主；共享业务与平台边界见[架构](../../docs/architecture.md)。

## 验证范围

按修改运行相关测试；资源端口改动还需按合同做原生验证。浏览器 verify 不证明 WKWebView 手势、真机内存或正式 PDF 行为。历史 spike 的完整协议样例、测量与限制保存在[旧记录](../../docs/archive/planning/reader-web-spike.md)，当前实测从[验收索引](../../docs/validation/README.md)查询。
