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

## EPUB 引擎来源

`foliate-js` 固定使用 [Readest 维护的 MIT fork](https://github.com/readest/foliate-js/tree/b34a0aa63163d19cd13e2ecd19b678394c32fee5)，Git commit `b34a0aa63163d19cd13e2ecd19b678394c32fee5`；其 package 版本为 `0.0.0`，准确身份以 `package.json` 的固定 tar URL 和 lockfile 的 integrity 为准。配套的 view、paginator、CFI、overlayer、section-chunks 来自同一提交，不引入 Readest 应用代码。引擎为 MIT，Readest 应用的 AGPL 许可不能用来描述这个独立依赖。

引擎及 `construct-style-sheets-polyfill@3.1.0` 的完整 MIT 声明收录在[移动端第三方许可](../../apps/mobile/src/ui/settings/thirdPartyNotices.json)，随“我的 → 关于”可查看。构建通过 [foliate-build.ts](foliate-build.ts) 处理上游可选 PDF 适配器，书灯 PDF 继续由自己的实现负责；开发原型关闭依赖预扫描不能替代正式 bundle 检查。

固定 fork 另应用 [pnpm 补丁](../../patches/foliate-js@0.0.0.patch)：上下滚动期间用真实触摸状态延后位置测量，松手或取消后补报最终位置；无触摸的连续滚动仍保留周期更新。滚动位移、惯性、排版与邻章预载继续由引擎处理。补丁随锁文件安装，升级引擎时须复核补丁与 [调度回归](scripts/foliate-scroll-scheduling.test.mjs)，不能直接沿用同为 `0.0.0` 的版本号。

## 接入边界

- 消息与数据字段以 [protocol.ts](src/protocol.ts)、[bridge.ts](src/bridge.ts) 及移动端 [ReaderWebView](../../apps/mobile/src/reader/ReaderWebView.tsx) 为准，不在 README 保存第二份协议代码。
- 正式 EPUB 通过原生归档会话逐资源读取；定位、资源身份与取消/错误约束遵守 [EPUB 资源合同](../../docs/architecture/epub-resources.md)。早期 fixture/base64 壳只是实验，不作为大书导入方案。
- 这里负责正文、位置与消息，产品 UI 和业务生命周期留给宿主；共享业务与平台边界见[架构](../../docs/architecture.md)。

## 验证范围

滚动正文由 Foliate 的原生滚动容器处理，书灯不接管逐帧位移或惯性。固定 fork 使用多个文档连续排列并预载相邻章节，书灯 adapter 按真实可见文档与目标 Range 识别选文、标注、书签与位置，不把预载文档当成当前页。不同 writing-mode 的章节不能据此承诺无缝混排。短末章不足一屏时没有可滚距离，不据此判断设置无效。滚动模式点按正文只显隐工具栏，避免误触左右区域突然翻页。

整书连续的门槛是相邻章节同屏、同一滚动动作跨章和回滚位置稳定，不能以旧版边缘手势成功整章切换代替。固定 fork 已接入并部署至 Small 独立开发包的 Release，双向连续跨章、旧高亮和书签回跳后继续滑动、字号调整、横排分页/仿真手势及受控引用到达已通过。具体输入、包身份和未验证范围见本次[验收记录](../../docs/validation/2026-11-09/continuous-epub.md)，选型证据见[研究](../../docs/archive/research/2026-11-09-continuous-epub-scroll.md)。

40 章浏览器原型中，连续 15 次 `wheel deltaY=900` 使 live document 从 5 增至 16，已读文档未被回收；`goTo` 后约为 3 章，`close()` 后原型 document/Blob 计数归零。预载循环的 8 章不是全局上限；这些计数不证明原生 session/lease 回收或真实 App/WK RSS 达标。巨型 spine 的 chunk 占位还会影响上游 TOC 章节标题：当前保存书名作为章节标签后备，CFI 仍准确，精确章节标题仍有限制。

验证滚动时须包含长章内上下拖动、章首/章尾衔接、短章、书籍起止，以及模式/字号切换后重开；同时核对实际位置。单独检查保存值或使用 JavaScript `next/scrollTo` 不能证明触摸滚动。移动端设置只发送变化项，避免无关设置重复清空原生卷页缓存。

标注、引用、搜索和书签回跳须与阅读模式交叉验证，到达后仍能真实拖动正文。零尺寸目标的静态恢复层和临时高度补救仅用于分页；滚动模式保留真实文档。切换模式时清理旧恢复层并还原书灯写入的高度，保留原有样式及后续外部修改；等待绘制中的旧恢复任务也必须失效。

书签状态自动刷新只检查已存书签的可见性；没有书签时宿主直接跳过请求。`captureLocation=false` 不得调用首字捕获或扫描正文；用户主动添加/取消才使用默认的精确位置捕获。回执按 requestId 匹配，只有最新状态请求更新按钮，不能用旧回执覆盖新位置；显式保存各自完成。滚动测量与已知剩余长帧见[本轮复查](../../docs/validation/2026-11-09/continuous-epub.md#后续阅读手感复查书签扫描)。

按修改运行相关测试；资源端口改动还需按合同做原生验证。浏览器 verify 不证明 WKWebView 手势、真机内存或正式 PDF 行为。历史 spike 的完整协议样例、测量与限制保存在[旧记录](../../docs/archive/planning/reader-web-spike.md)，当前实测从[验收索引](../../docs/validation/README.md)查询。
