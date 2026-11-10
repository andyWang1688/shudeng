# EPUB 整书连续滚动：现状与可复用方案

研究日期：2026-11-09。状态：固定 Readest Foliate fork 已接入书灯，Small 独立开发包的 Release 已部署；双向连续跨章、旧高亮与书签回跳后继续滑动、字号调整、横排分页/仿真和受控引用到达已通过，完整边界见[本轮验收](../../validation/2026-11-09/continuous-epub.md)。选型部分只使用 Apple 官方说明、项目上游源码、维护者仓库中的提交与合并记录；浏览器原型与 Small 操作结果由主任务回传。本研究维护者没有操作浏览器、Apple Books、模拟器或真实设备。

## 结论

**用户所说的滚动是连续阅读整本书：上一章末尾与下一章开头可以同时出现在屏幕中，一次拖动或惯性可以跨章，回滚时原文不突然整屏替换。研究开始时书灯使用的 Foliate 1.0.1 单文档滚动不能满足这一点。**

书灯现已采用 **Readest 维护的 MIT 版 `foliate-js` fork**。研究选择它的依据是已有多文档排列、相邻章预载、向前插章位置补偿及跨章可见位置计算；2026-03-28 合并的“单章节滚动”开关也确认，多章连续已经存在。主仓与 fork 的 README 都可能还保留“no support for continuous scrolling”，必须以对应源码为准。

正式依赖已锁定完整源码包提交 `b34a0aa63163d19cd13e2ecd19b678394c32fee5`，配套渲染模块来自同一提交，经现有书灯 adapter 接入。隔离原型先取得新旧引擎的浏览器红绿反馈，随后进入产品部署与 Small 验证。没有复制 Readest 应用：应用本身是 AGPL，独立 `readest/foliate-js` 源码仓库是 MIT，二者许可与复用范围不同。[R1][R2][R3]

## Apple Books 能确认到什么程度

Apple 的 iPhone iOS 15 官方用户指南明确写：

> “Turn off pagination: Turn Vertical Scrolling on to scroll continuously through a book or PDF.”

现行 iPhone 指南仍明确提供 vertical scrolling，入口为书内 Themes & Settings。公开说明足以确认“连续滚动读书”是 Apple Books 的用户层能力；现行页面没有把每个 EPUB spine 接缝的帧行为写成规范。[A1][A2]

因此可以把“整书连续”作为书灯的验收目标，但本研究没有当前版本 Apple Books 的跨章实录，不能声称已实测其接缝、性能或所有书型，也不能推断 Apple 使用一个 WebView、多个 iframe、拼接 DOM 或某种虚拟列表。

## Foliate：单章 scrolled 与跨章 continuous 的区别

### 研究开始时的书灯 1.0.1 与 johnfactotum 主仓

研究开始时，本地依赖为 `packages/reader-web/package.json` 的 `foliate-js: 1.0.1`，并应用 `patches/foliate-js@1.0.1.patch`。该版 paginator 的结构仍然是一个 `#view`：创建新 View 时销毁并移除旧 View；章节导航卸载旧 section；`getContents()` 返回单个当前文档。`flow="scrolled"` 改变的是当前章节内的布局与滚动方向，没有把相邻章同时放进一个连续滚动容器。原有的章末自动下一章，可以减少额外点击，但仍是更换文档。后续正式依赖变更与接入状态看对应实施和验收记录，本节保留研究基线。

johnfactotum 主仓截至本次核查的提交为 `78914aef4466eb960965702401634c2cb348e9b1`（2026-05-01）。官方 README 同时写有 `flow: scrolled` 和 “currently there is no support for continuous scrolling”；源码仍使用单 `#view`。所以“已有 scrolled 参数”与“整书连续”不能画等号。[F1][F2]

### Readest fork 已实现什么

下列行号来自 GitHub Contents API 返回的原始 `paginator.js`，锁定提交为 `b34a0aa63163d19cd13e2ecd19b678394c32fee5`，不是浮动 main 的推测：

| 源码入口 | 能确认的行为 | 实际边界 |
| --- | --- | --- |
| [`#createView`，2063–2088 行](https://github.com/readest/foliate-js/blob/b34a0aa63163d19cd13e2ecd19b678394c32fee5/paginator.js#L2063) | 用 `#views` Map 管理多个 View，按章节顺序插入同一容器；只替换同一 index 的旧 View。 | 多个独立 document，未拼成全书 DOM。 |
| [`#preloadNext`，3733–3765 行](https://github.com/readest/foliate-js/blob/b34a0aa63163d19cd13e2ecd19b678394c32fee5/paginator.js#L3733) | 前向预载，目标至少约 5 屏；本轮填充最多 8 个 View。 | `maxSections=8` 是该填充循环的门槛，不能解释为全局永远最多 8 个文档。 |
| [`#loadAdjacentSection`，3914–4005 行](https://github.com/readest/foliate-js/blob/b34a0aa63163d19cd13e2ecd19b678394c32fee5/paginator.js#L3914) | 相邻章独立加载、样式与 overlayer 接线；往前插章后补偿滚动位置。 | 加载失败被捕获并记录，产品仍需有真实失败反馈；不同 writing-mode 的相邻 View 会被销毁。 |
| [`#goTo`，4081–4189 行](https://github.com/readest/foliate-js/blob/b34a0aa63163d19cd13e2ecd19b678394c32fee5/paginator.js#L4081) | 目标已经加载时复用；连续 scrolled 不先隐藏容器，避免相邻导航白屏。 | 写作方向改变时重建；远距离跳转仍需要加载。 |
| [`getContents`，4362–4385 行](https://github.com/readest/foliate-js/blob/b34a0aa63163d19cd13e2ecd19b678394c32fee5/paginator.js#L4362) | 返回多个文档与 overlayer；同一长章可能有多个 chunk，保留原 spine index。 | 消费者不能再假设首个文档等于当前章，也不能只靠 `index` 唯一确定 chunk。 |

滚动处理在约 5 屏缓冲不足时向前及向后加载，预载与主文档切换有明确状态保护；可见位置计算会在多个 View 中选取真实可见 Range。`no-continuous-scroll` 只有在 scrolled 模式且显式设置时才生效，默认没有该属性。[R4]

Readest 应用 [PR #3668](https://github.com/readest/readest/pull/3668) 已于 2026-03-28 合并，说明打开单章节模式后停止相邻章加载，关闭后恢复；它还列出了 `#preloadNext`、`#fillVisibleArea`、`#display`、`#goTo` 这些多章入口，提供了超出 `scrolled` 参数名称的实现证据。[R3]

维护状态有直接证据：该 fork 的 2026-11-04 paginator 提交修复了整书最后半屏无法抵达的问题，11-05 仍有导航定位修复。活跃维护和应用侧通过记录提高复用可信度，**不能替代书灯的 iOS 验收**。[R1][R5]

## 研究时的候选比较

| 候选 | 整书连续滚动证据 | 定位、高亮和资源合同 | 维护、跨端及选型结论 |
| --- | --- | --- | --- |
| 历史基线 Foliate 1.0.1 / johnfactotum 主仓 | 单 `#view`；主仓明确未支持 continuous。 | 研究开始时已接书灯的 CFI、Range、overlayer 与逐资源 loader。 | MIT、浏览器模块；仅改参数或自动跳章达不到目标。 |
| Readest 的 Foliate fork（已选用） | 多 View 顺序排列、双向预载、位置补偿、已合并单章开关，见上表。 | 保留 `book.sections`、CFI、Range、事件与 overlayer；书灯已适配 `loadContent` 与多文档身份。 | 独立仓库 MIT，最新核查提交 2026-11-05。已固定提交接入并部署 Small Release，验收范围见本轮记录。 |
| epub.js continuous manager | `ContinuousViewManager.check()` 在边缘 append/prepend 相邻 section，`counter()` 补偿上方插入，`trim()/erase()` 回收远端。[E1] | EPUB CFI、selection、annotations、content hooks 已有；`requestMethod` 可适配资源读取，但不直接接受 Foliate book 接口。[E2] | BSD-2-Clause，网页 iframe 引擎；主仓核查提交 2026-03-24。有成熟结构，但迁移面比 Foliate fork 大，作为备选。 |
| Readium TS / `@readium/navigator` | 当前 reflowable `FramePoolManager` 会隐藏旧 current frame、显示新 frame；`ScrollSnapper` 滚动当前 document。预载池不等于同时可见的连续多章，不能仅因 `scroll` 或架构规范写 continuous 就认定已实现。[T1][T2] | Publication、positions、Locator、decorations 与 Resource/Fetcher 接口；不是当前 Foliate CFI/loader 的直接替换。[T3] | BSD-3-Clause；核查 `@readium/navigator` 为 2.15.0，2026-11-06 仍在维护。适合完整 Readium 选型，当前目标不优先。 |
| `@epubjs-react-native/core` | 对 epub.js 的 RN WebView 封装；公开 `manager="continuous"` 与 flow，真正连续能力仍来自 epub.js manager。[N1] | ReaderProvider、CFI/annotations 回调、文件系统 hook；模板 `ePub(file)`，默认写入 JSZip 与 epub.js 脚本及 HTML，需重做本机资源接线。[N2] | MIT；最新核查提交 2026-10-16，含 Expo 57 示例。可降低通用 RN 阅读器搭建成本，但书灯已有 WK 与原生逐资源通道，换包装层收益有限；Web/桌面覆盖未在本研究验证。 |

epub.js 必须同时检查 manager 与 flow。其 `Rendition.flow()` 会把 `scrolled`、`scrolled-doc`、`scrolled-continuous` 都归一为底层 `scrolled`；`requireManager()` 才选择 default 或 continuous manager。只设置 flow 名称没有证明相邻章节持续存在。[E2]

Readium 的通用架构描述确实把“整本出版物连续滚动”列为 navigator 可能处理多个资源的一种用途；这是一种架构能力描述，不是每个 TypeScript 实现的发布声明。本研究对照了具体 FramePool 的 hide/show 行为，因此未把 Readium TS 判为已经满足无缝跨章。[T4]

## 实际接入与复用边界

### 固定完整源码包，通过书灯现有 adapter 接入

`packages/reader-web/package.json` 使用上述 Git SHA 对应的 codeload tar URL，lockfile 固定完整性校验；view、paginator、CFI、overlayer、section-chunks 来自同一提交。引擎与 polyfill 的完整 MIT 许可已进入移动端第三方声明。只引入引擎模块，没有引入 Readest 应用 UI、状态与存储；构建和当前模块合同见 [reader-web README](../../../packages/reader-web/README.md)。

不推荐只替换新 `paginator.js`：它已经 import `section-chunks.js`，而配套 `view.js` 同样理解 chunk；CFI、overlayer 与长章目标解析相互依赖。无配套审计的混用会出现普通章节能滚、长章高亮却落到占位节点的情况。新 `view.js` 的 [`#getOverlayer`，443 行](https://github.com/readest/foliate-js/blob/b34a0aa63163d19cd13e2ecd19b678394c32fee5/view.js#L443) 已专门处理同 spine 的多个 chunk；[`getCFI/resolveCFI`，501 行](https://github.com/readest/foliate-js/blob/b34a0aa63163d19cd13e2ecd19b678394c32fee5/view.js#L501) 仍以原 section CFI 为基础。[R6]

长章切块不是改变持久化定位的许可。`section-chunks.js` 通过相同标签的隐藏占位保留原元素序号，目的是让 chunk 内 CFI 仍指向原章；需要用书灯已有 CFI、高亮、书签、引用和重复文字样例验证，不能因同为 CFI 就保证兼容。[R7]

### 资源通道继续遵守书灯合同

现有 [EPUB 资源合同](../../architecture/epub-resources.md)要求 `new EPUB(loader).init()` → `view.open(book)`，而不是整档 URL → fetch/Blob；原生 session、opaque resource ID、取消、lease 与 close 所有权也不能因更换 renderer 改变。

fork [`view.open(book)`，243–278 行](https://github.com/readest/foliate-js/blob/b34a0aa63163d19cd13e2ecd19b678394c32fee5/view.js#L243) 仍接受 book 对象；paginator 使用 `section.load()`。当前 adapter 已补接 `loadContent()`，按真实 document/目标 Range 识别可见内容与原文身份，不再用首个预载文档或同一 spine index 代替当前文档。长章 chunk 资源共用、并发预载及 unload/close 的原生生命周期仍须按资源合同独立验证。

历史 1.0.1 patch 包含书灯的有限视口与超长内容保护，现仅为技术对照保留，生产依赖已不再应用该 patch。旧保护与 fork 行为是否等效仍须以对应长章、分页与资源验证为准，替换依赖不等于原有性能修复自然继承。

### 尚未证明的硬边界

fork 的 `#preloadNext/#fillVisibleArea` 有 8 View 的循环门槛，但滚动事件中的额外加载、已读章节保留和 chunk cache 另有路径。特别是 [`#trimDistantViews`，4062–4076 行](https://github.com/readest/foliate-js/blob/b34a0aa63163d19cd13e2ecd19b678394c32fee5/paginator.js#L4062) 只移除主章节后方远端 View，以避免删除前方内容导致位置移动。因此不能声称它是完整的有界虚拟列表，也不能拿 8 直接当 App/WK 内存上限。

40 章浏览器原型的实际取样也显示：连续 15 次 `wheel deltaY=900` 后，live document 从 5 增至 16，已经读过的文档没有回收；`goTo` 后裁剪至约 3 章，`close()` 后原型 document/Blob 计数归零。这是原型资源计数，不是原生 session/lease 或 App/WK RSS 证据，也没有证明全局 8 章上限。

巨型 spine 的 chunk 占位会使上游 TOC 章节标题不可靠。当前书灯在 chunk 文档中保存书名作为章节标签后备，CFI 仍准确指向原书位置；精确章节标题仍有此限制。横排与竖排 writing-mode 不同的章节不能在该实现中混排连续；源代码会停止预载或重建。网络/资源加载失败、迟到字体与图片、快速连续跳转、选择状态、原生 curl 的快照/恢复等其余设备回归尚未完成。

## 隔离原型的通过门槛

下列五项均应记录实际输入、操作、可见结果、平台与版本。静态源码研究、类型检查、浏览器自动化、iOS 触控与真实 App/WK 内存各自记录，不能相互替代。

1. **接缝连续**：至少三章、长短章混合的 EPUB；前章末尾和后章开头同屏；一次拖动及一次惯性跨两处接缝；向前向后都无整屏替换、白屏或位置漂移。
2. **原文身份不变**：用升级前保存的 CFI、高亮、笔记、书签和问答引用回跳；覆盖重复文字、跨 chunk 目标及相邻章同时可见；引文、颜色、原书原章位置正确，保存内容不改写。
3. **重排与资源稳定**：接缝处调整字号/主题、旋转、迟到字体与图片；长章与巨单章；保持稳定原文锚点，取消/重试/关书后没有迟到跳转、失效资源与 session 残留。
4. **长期滚动资源有界**：实测连续遍历多章后的 live View、DOM、Blob、原生 lease、App/WK 峰值与关闭后回收；若需要补回收策略，独立验证前方卸载补偿及回滚恢复，不能以预载循环常数代替结果。
5. **现有模式不回归**：滚动↔分页↔原生 curl 往返，工具栏显隐、选文与已保存位置稳定；iOS 真机/模拟器触控单列；Android、桌面及未运行的设备写未验证。

## 浏览器原型与后续产品验证

用户批准继续后，创建了 [隔离原型](../../../spikes/continuous-epub/README.md)，使用完整锁定提交的 MIT 引擎与同一个三章 `book` 对象，通过 `?engine=current` 对照本地 1.0.1。主任务统一操作浏览器并核对截图，回传结果为：旧版 1 个 document、只见 `[0]`；fork 3 个 document、接缝同时可见 `[0,1]`；一次 wheel 500 沿同一容器跨入第 2 章（零基 `section.current=1`）。

浏览器结果回答了“有没有可直接复用的多章连续实现”。后续固定 fork 已进入产品 EPUB 路径，Small 独立开发包的 Release 已部署，并通过相邻章节双向手势与所列导航回归；完整输入、包身份与未验证项进入[本轮验收](../../validation/2026-11-09/continuous-epub.md)。这些结果不能扩展为真实大书内存、原生资源生命周期或全部兼容场景通过。

完整 `view.js` 的动态导入还包含可选 PDF/FXL。fork 的 `pdf.js` 使用宿主专属 `@pdfjs/pdf.min.mjs`、全局 `pdfjsLib` 与 `/vendor/pdfjs/` 资源路径；FXL 使用 `construct-style-sheets-polyfill`。隔离原型关闭 Vite 预扫描；正式构建已通过 `foliate-build.ts` 明确处理上游可选 PDF 分支，书灯 PDF 继续使用自己的适配器，native inline 保持不包含 PDF.js。

原型 README 保留固定源码、校验值与重建步骤；完成取样并停止服务后可清理 `.build/continuous-epub-20261109/upstream`，无需长期保留约 13 MiB 的展开源码及下载包。运行中的服务仍会读取该目录，清理须由主任务确认服务已停止后执行。

## 一手来源

| 编号 | 来源与核查内容 |
| --- | --- |
| A1 | [Apple iPhone iOS 15 用户指南](https://support.apple.com/en-us/guide/iphone/iphc1af7c57/15.0/ios/15.0)：原文 “scroll continuously through a book or PDF”。 |
| A2 | [Apple 当前 iPhone Books 指南](https://support.apple.com/guide/iphone/read-books-iphc1af7c57/ios)：vertical scrolling 设置入口。 |
| F1 | [johnfactotum README：The Paginator](https://github.com/johnfactotum/foliate-js/tree/78914aef4466eb960965702401634c2cb348e9b1#the-paginator)：scrolled 参数与不支持 continuous 的声明。 |
| F2 | [johnfactotum paginator.js](https://github.com/johnfactotum/foliate-js/blob/78914aef4466eb960965702401634c2cb348e9b1/paginator.js)：单 `#view`、`#createView`、`#goTo`、`getContents`。 |
| R1 | [Readest Foliate 锁定提交](https://github.com/readest/foliate-js/commit/b34a0aa63163d19cd13e2ecd19b678394c32fee5)、[LICENSE](https://github.com/readest/foliate-js/blob/b34a0aa63163d19cd13e2ecd19b678394c32fee5/LICENSE)、[package.json](https://github.com/readest/foliate-js/blob/b34a0aa63163d19cd13e2ecd19b678394c32fee5/package.json)：MIT、源码包版本为 0.0.0；不能当作 registry 1.0.1 的自动升级。 |
| R2 | [Readest 应用 LICENSE](https://github.com/readest/readest/blob/main/LICENSE)：应用 AGPL，与 MIT 引擎仓库区分。 |
| R3 | [Readest PR #3668](https://github.com/readest/readest/pull/3668)：2026-03-28 合并单章节滚动开关及恢复多章预载的测试记录。 |
| R4 | [锁定 paginator.js](https://github.com/readest/foliate-js/blob/b34a0aa63163d19cd13e2ecd19b678394c32fee5/paginator.js#L1748)：滚动预载、`noContinuousScroll`、可见 Range、多 View 与回收；本文源码行号来自对应 GitHub Contents API 原始文件。 |
| R5 | [paginator 修复提交 c14f30c](https://github.com/readest/foliate-js/commit/c14f30c83003ca05b9d2fd95148eff5bda9605df)：2026-11-04 最后半屏回归修复。 |
| R6 | [锁定 view.js](https://github.com/readest/foliate-js/blob/b34a0aa63163d19cd13e2ecd19b678394c32fee5/view.js#L443)：chunk-aware overlayer，CFI 与 book 对象接口。 |
| R7 | [锁定 section-chunks.js](https://github.com/readest/foliate-js/blob/b34a0aa63163d19cd13e2ecd19b678394c32fee5/section-chunks.js)：保留元素序号的切块与占位设计。 |
| E1 | [epub.js ContinuousViewManager](https://github.com/futurepress/epub.js/blob/eee359d0790002115a1156a9833c54f4bcd44c1d/src/managers/continuous/index.js)：`check`、`append/prepend`、`counter`、`trim/erase`。 |
| E2 | [epub.js Rendition](https://github.com/futurepress/epub.js/blob/eee359d0790002115a1156a9833c54f4bcd44c1d/src/rendition.js)、[Book 资源入口](https://github.com/futurepress/epub.js/blob/eee359d0790002115a1156a9833c54f4bcd44c1d/src/book.js)、[官方 README](https://github.com/futurepress/epub.js/tree/eee359d0790002115a1156a9833c54f4bcd44c1d#readme)：manager/flow 分工、requestMethod 与 hooks。 |
| T1 | [Readium FramePoolManager](https://github.com/readium/ts-toolkit/blob/561ced5b56d4eed9fdf0bc5e7f226d0f87afe15a/navigator/src/epub/frame/FramePoolManager.ts)：当前 frame 与隐藏预载池，`update` 的 hide/show。 |
| T2 | [Readium ScrollSnapper](https://github.com/readium/ts-toolkit/blob/561ced5b56d4eed9fdf0bc5e7f226d0f87afe15a/navigator-html-injectables/src/modules/snapper/ScrollSnapper.ts)：在当前 document 上滚动与报告 progression。 |
| T3 | [Readium EpubNavigator](https://github.com/readium/ts-toolkit/blob/561ced5b56d4eed9fdf0bc5e7f226d0f87afe15a/navigator/src/epub/EpubNavigator.ts)、[FrameBlobBuilder](https://github.com/readium/ts-toolkit/blob/561ced5b56d4eed9fdf0bc5e7f226d0f87afe15a/navigator/src/epub/frame/FrameBlobBuilder.ts)、[package.json](https://github.com/readium/ts-toolkit/blob/561ced5b56d4eed9fdf0bc5e7f226d0f87afe15a/navigator/package.json)：Publication/Locator/decoration 与资源接口、版本和 BSD-3-Clause。 |
| T4 | [Readium Navigator 架构](https://readium.org/architecture/navigator/)：continuous scroll 是可能处理多资源的用途。 |
| N1 | [epubjs-react-native README](https://github.com/victorsoares96/epubjs-react-native/tree/1a1387c2da64050cfe129f0e51acd51b2f5a6d5b#readme)：manager/flow、CFI、annotations、Expo 与 bare 安装。 |
| N2 | [RN Reader.tsx](https://github.com/victorsoares96/epubjs-react-native/blob/1a1387c2da64050cfe129f0e51acd51b2f5a6d5b/src/Reader.tsx)、[template.ts](https://github.com/victorsoares96/epubjs-react-native/blob/1a1387c2da64050cfe129f0e51acd51b2f5a6d5b/src/template.ts)：文件系统、内嵌引擎模板与 `ePub(file)`。 |
