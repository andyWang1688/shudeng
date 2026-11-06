# RN 与原生 iOS 对照验收

状态：本轮聚焦非问答功能，仍未通过当前范围验收；AI 问答另行计划，未记为通过。

## 验收合同

2026-11-03 用户要求：使用 RN 新架构重构现有原生 iOS，功能、UI、交互和效果一致；允许重构不符合要求的既有 RN 代码。由统筹者独立运行和检查，不能用实现者测试代替产品验收。该要求取代 ADR-0019 原先对阅读器界面差异的豁免。

RN/Expo 负责应用界面，TypeScript/LangChain 负责共享业务；原生模块仅提供 PDFKit、选字、卷页视觉等平台能力。原生 `ios/` 基线保留。

## 当前范围（用户最新决定）

用户明确：“除了问答其他功能搞定就行了，AI问答计划基于LangChain生态重做”。本轮以书架导入、EPUB/PDF 阅读、书内搜索与定位、标注笔记及导出、通用设置和持久性为交付范围，继续要求与原生相同的功能、UI、交互和效果。

AI 问答及其 MCP、气泡、F1 首帧、F2 行距、F3 identity、标题/输入区、问答历史相关视觉与流程验收移出本轮。问答服务配置/发送、工具授权和问答引用返回也不进入当前运行队列。旧未通过项、候选、源码、数据与证据保留，状态为“本轮移出，未通过”；LangChain 重做是后续计划，本次不据此启动实现或删除旧问答。

当前范围分为以下四类；设备执行顺序以本文最新 r17 增量和运行计划为准。混合用例只执行非问答部分，既有问答数据仍须保护。

1. EPUB/PDF 阅读与定位：巨章首屏及 A/B、真实翻页/取消、目录/书签/搜索、尾部与重开位置、主题/字号、缩放及旧锚点。
2. 标注、笔记与导出：完整选文、高亮改色、笔记新增/编辑/取消/删除、列表搜索/折叠/排序/回原文、筛选导出。
3. 书架、导入与文件生命周期：取消/排序/重复与异内容导入、移除重导、失败重试、中断恢复；永久删除继续遵守独立授权门槛。
4. 通用设置与持久性：应用外观、关于/隐私/许可、非问答导航与小屏/键盘；阅读位置、笔记、偏好及本地模型下载/receipt 的保留与重启恢复。

下方完整矩阵、历史记录及 r16a/r16b 问答结论仍作为历史证据保留；其中问答阻断和旧“下一步”不再决定本轮排期。当前非问答通过不代表 AI 问答通过或整个应用迁移完成。

## 最新增量：A/B 实测与 r17 源码冻结（2026-11-04）

本节覆盖后文历史快照中“EPUB A/B 尚未运行”等旧状态，以及历史轮次的“执行顺序/下一步”。最新安装核对截至 `2026-11-04T08:58:26.354Z`：**r17 Release 构建成功、已保留数据安装，功能/UI 尚未验收**；下列 A/B 实测属于此前的指定 A/B 包，不能转记为 r17 通过。问答/MCP/F1/F2/F3 及其历史失败仍全部移出本轮。

### 已保存的真实 A/B 边界

| 已执行项 | 原件支持的事实 | 仍未证明 |
| --- | --- | --- |
| 巨章首个正文画面 | [A 独立图像报告](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/nonchat-epub-acceptance/A-independent-review/REPORT.md)：88 张原图逐张复核，A70 空白、A71 首次正文，区间 `(142.220109, 144.685165]` 秒。[B 独立图像报告](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/nonchat-epub-acceptance/B-independent-review/REPORT.md)：81 次采样、78 次成功，B39 为最后成功空白、B42 为首次成功正文，区间 `(85.700925, 101.490659]` 秒；B38/B40/B41 超时，B41 不完整画面不晋级 | 原点是点击前 request marker，不是精确触摸或 first paint。只有 A/B 各一轮顺序观察，不能证明稳定性能收益、因果或与 Native 等效；内存改善未证 |
| 同首部正文 | A71 与 B42 的 `(0,190,750,1180)` 正文裁剪逐像素相同，SHA256=`2d5b23ac1a9d83c2044899d6224bd64b086f6beab189a991d01692197ec9f9fd` | 只证明这两张同状态正文，不代表全书、交互、整屏或后续 r17 相同 |
| B 普通分页与窗口往返 | [交互原件](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/nonchat-epub-acceptance/B/interaction-verdict.json)：前 2 次实际 XCTest 右点，再 4 次工具 swipe，key 从 `0:1:28390` 到 `0:7:28390`；反向 6 次逐页回到每个原 CFI/key/signature，最终回 P0。窗口起点依次 `0→347→694→1041→1388→1735`，反向回 0 | 是指定 B 包的首部普通分页局部实证，不是仿真卷页、尾部/全书或 r17 产品通过 |
| B 收起 chrome | 在 F2 的 `0:3:28390` 实际收起后，CFI/key/signature 保持，windowStart=347；[收起前](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/nonchat-epub-acceptance/B/B-F2-page.json)与[收起后](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/nonchat-epub-acceptance/B/B-F2-chrome-hidden-page.json)均有保存读态 | 不外推到普通书全链、其他主题/字号/flow 或 r17 |
| B 尾搜索真实失败 | 唯一查询 `PARITYGIANTTAIL24MZQJH` 命中 `...:c1:9434294-9434316`，实际点中一次后仍为 P0/key `0:1:28390`、fraction=0；[原图](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/nonchat-epub-acceptance/B/B-tail-invalid-location-alert.jpg)为“无法定位原文 / 目标位置无效，请选择其他记录。”。[尾部 DOM/CFI 原件](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/nonchat-epub-acceptance/B/B-tail-live-probe.json)可只读解析 22 字符非折叠范围及 `epubcfi(/6/2!/4/49792[tail],/1:0,/1:22)` | 命中及可解析范围不等于定位成功；尾正文、尾部重开、重排及坐标均未关闭 |

上述 A、B 独审报告 SHA256 分别为 `5bcbca55a60fed7747b3e6d66d3a1a834b4c29940d13990926fd923e71e83c8e`、`2712f2b41f736d6f73e38f888c28e6690aa0b3fffdfa451aae70d0f7075221fa`；交互原件 SHA256=`c2e894b7c28b4e3f65984b77867e5cfffaee0fec48b1bfb17ae493c32f8ab13b`。这些原件及旧失败不改写。

### r17 七条源码集成，均未替代设备验收

[最终源码冻结](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/nonchat-integration-r17/freeze/r17-source-freeze.json)时间为 `2026-11-04T08:47:18.002Z`，SHA256=`143ef56ce8446879d531a0765aee66edc8e36f7d6299b92d49723e5da09ba326`：456 项源码、4 项原生构建配置，记录状态 `SOURCE_IDENTITIES_FROZEN_NOT_BUILT_OR_DEVICE_ACCEPTED`。冻结不包含生成的 `readerWebHtml.ts`、`readerFixtures.ts`；构建与安装还需各自的真实产物身份。以下七条记录的集成时状态均为 `SOURCE_INTEGRATED_NOT_BUILT_OR_DEVICE_VERIFIED`，这里只登记源码准入。

| 集成记录 | 已集成源码范围 / 补丁 SHA256 | 集成记录 SHA256 |
| --- | --- | --- |
| [stage1](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/nonchat-integration-r17/integration-stage1.json) | 可见点击区域 `975124535507dbd3dfcdddb1af5b751dafa5adaf90d9b1ad4520762a60613a64`、点击区域回归 `c1e1cc8fdbd963418273799ca129f560d6354a9d79572cb3f3a03babea9d23dd`、书架 order-r1 `861d71c2dfe998e610c37b17f517494c6af3aa8e4b07ddb9a762e9915dc1dc23` | `455fec420095370163d052327e427605a210cd3a72e39cab58bb84fa89f2904e` |
| [notes-r2](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/nonchat-integration-r17/integration-notes.json) | 标注/笔记持久化候选 `75eadc04783e371ee82c846215627b2db9b1168afb33dd23fad63464a4421ea2` | `83451ad71cc83219dbb4523b258df70dc4bfd1548c1c6a4103780cffe9700c3d` |
| [PDF import-r2](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/nonchat-integration-r17/integration-pdf.json) | PDF 导入/错误分类/Modal 回执候选 `45e5c5898742401801ec2b5ac8ca634f36feccac9dd7e642c6c8c692e9f0c152` | `10fcc048cc141103222f3386b1e992db834fdbd5c2fbf8dfee70254005a0f1e6` |
| [appearance-r2](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/nonchat-integration-r17/integration-appearance.json) | 应用 window 外观、system/auto、hydration 修订及新 EPUB 默认浅色 `749d83b48d647dfb113401a9494000144b77fbc9a42d172e592493f6e80644f9` | `23d9925d46efe80834b168d2c41ab7b2be21fe39f8d09b142353416438073121` |
| [PDF viewer 取消](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/nonchat-integration-r17/integration-viewer.json) | viewer 打开取消候选 `e2047d2d8d69e32cdb2880a5dc3f594e9e0274ddad5195b5ccc3163684197384` | `9255ca773c223962eb547872b1d974657edb191a701a0d9b6abcd2d2895c51b5` |
| [PDF inspect 取消](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/nonchat-integration-r17/integration-inspect.json) | inspection 取消候选 `317ef726629f35318ba5e9b295b6c90c2a6b0330a897ac12fb74e0ee758e6451` | `e52dc3da4906ea33b09f79559c9a315d67be552ed1306033be878a7c8396847b` |
| [EPUB tail-r2](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/nonchat-integration-r17/integration-tail-r2.json) | 尾搜索生命周期候选 `5aff20b2f81068c2a1882e15302f6df1f6dcbd8a3055abdd3682a32a10576f38` | `de249d2f2c6e9e7331836bb4181b6623a0c0a8133e902b95be4fd9aca47bae4f` |

尾搜索 r1 补丁 `3efdef283665f5c8a61ba1ce43a8c3bdcf79c67b42c1e15be8a8ae0ade3743be` 经[独审](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/nonchat-epub-tail-independent-review/REPORT.md)阻断：旧事件可能清除新 pending、关闭面板/弹窗，重复原生 dismiss 也可能提前完成。r2 [独审结论](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/nonchat-epub-tail-independent-review-r2/REPORT.md)为 `SOURCE_PASS_DEVICE_UNVERIFIED`（报告 SHA256=`4bba223b14169a0ae8e2e2fd9776720a363af652be2de8209c9213715db3d047`），已按上表精确集成；没有尾部真实重试结果，不能撤销 B 的红项。PDF viewer 与 inspect 也分别仅源码准入，未证明真实 PDFKit/UIKit 取消、快速重开或资源回落。

### r17 构建与保留数据安装（功能/UI 未验）

[Release 构建原日志](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/nonchat-integration-r17/release-build.log)末尾为 `BUILD SUCCEEDED`、`exit=0`，产物 182M；日志 SHA256=`58962b8c3d6b05e03fdecc49becefa791697358441aca78f49705000b27e8b9b`。上文 freeze 与七条集成记录的 NOT_BUILT 状态是各自生成时的历史状态，此处构建原件更新了构建事实，没有更新设备功能结论。

[构建包身份](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/nonchat-integration-r17/built-bundle-identity.json)和[安装包身份](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/nonchat-integration-r17/installed-bundle-identity.json)各有 241 项 entry、158 个常规文件，content SHA256 均为 `2c34e3ed1e5c19008d7769505e32625167eef0c33fc99c18cda731859ce785cd`，`contentTreeEqual=true`。`fullTreeEqual=false` 保留：仅 `ExpoModulesJSI.framework/ExpoModulesJSI`、`hermesvm.framework/hermesvm` 的 mode 0755→0644，字节相同。两份身份原件 SHA256 分别为 `ab916e79386bb8ae08dc40dcf304f5824e6863e66f4ee233d2d4c9e025dc8f7f`、`9f8c410b0fbcd19c6715ee5da66759b6d417d5d1a35ba07d45c6a27914880126`，不能写为全树相等或 framework 加载已验。

[安装 reconciliation](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/nonchat-integration-r17/install-reconciliation.json) SHA256=`a0b3b674ddebcdd9d486094947441d0540f5c0c7e278d34ad4a2908f56228966`。其[安装前](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/nonchat-integration-r17/data-before-install.json)与[安装后](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/nonchat-integration-r17/data-after-install.json)只读回执中 books=7、anchors=43、annotations=5、reading_progress=6，各表有序记录 SHA 及 owned note `annotation-mw1dfimb-4` 完全不变。只证明此次安装的数据与 bundle 字节边界，不替代从 UI 重开笔记、跨进程阅读恢复、文件生命周期或任何 r17 功能验收。

### 当前设备顺序与下一动作

以[非问答 r17 运行计划](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/nonchat-r17-runtime-plan/REPORT.md)的五组为顺序：①巨章尾部真实红项与剩余性能；②普通 EPUB/PDF 阅读、外观、缩放/完整选文及混合 PDF；③标注笔记、列表/筛选导出与跨进程保留；④书架/导入与文件生命周期；⑤通用设置、模型文件与 reader 资源。计划中早先“tail 待准入 / inspect 待独审”的源码前置已由上表更新，设备结论仍为空。已证的全量导出、索引 checkpoint、完整模型下载不整套重做；S05 永久删除不进入默认队列。

**当前下一步：按上述 r17 安装身份登记本轮字号/外观/flow 与保留书 hash，再搜索唯一尾 marker → 实际点中一次 → 核尾正文/CFI → 关闭重开仍在尾部。** 两分钟内可先核对安装原件与当前只读前置，不沿用旧包 PID、容器、计数或旧 launcher 的产品身份。

## 固定基线与环境

| 项目 | 原生基线 | RN 目标 |
| --- | --- | --- |
| 代码 | `main` / `origin/main` 的 `2db9fc0045195508ccfe441d0b4f5ce3015382e6`，`ios/` tree `85708e9789c5ce1060f057108ab7fe403e4c1657` | `feat/ios-rn-migration`，任务开始于 `2daa385`，本次未提交改动 |
| 安装包 | `delivery/releases/v0.4.8/Shudeng-v0.4.8-ios-simulator.zip` | 统一经 `scripts/build-ios-rn.sh Release` 构建 |
| 设备 | Shudeng Native Baseline，iPhone SE 3 / iOS 26.5 | Shudeng Small，同机型/系统 |
| UDID | `BD5568C9-141B-4E75-BB68-25A10DFDB847` | `1B9B9A35-F2D7-4D87-AB31-6B07D1B27D66` |
| Bundle | `dev.shudeng.app` | `dev.shudeng.mobile` |

原生可执行文件 SHA256：`f817951cd7f9e45fc568fd981c2e5f14e5661365d1a939d225a8cae5d429fcf6`。原生设备已安装并成功进入书架和 AI 服务页。测试数据为旧书库副本，未读取或复制 Keychain。

证据目录：`.scratch/parity-review-20261103/`。`native-shelf-initial.png` 实际为启动前主屏，不能作为书架证据；`rn-current.png` 是旧构建且滚动位置不同。`native-shelf-pdf-continue.png` 已滚动，真正顶部基准为 `native-shelf-top-pdf.png`。

Small 原 Dynamic Type 为 XXXL，基线为 Large。标准字号截图已临时将 Small 统一为 Large 并重启；`rn-r5-shelf-large-reload.png` 才是有效对照，早先未重启的截图不能用于判断字体。结束对照后须恢复 Small 原字号，并另验大字号布局。

## 验收矩阵

每次运行记录输入、操作、预期、禁止行为和证据。未完成的操作明确保留为“未验证”。以下是原完整矩阵；问答/对话历史及设置中的 AI/MCP 子项按上方最新范围移出本轮，原状态不作通过处理。

| 范围 | 必须覆盖的操作与预期 | 禁止行为 | 当前状态 |
| --- | --- | --- | --- |
| 书架/导入/删除 | 同一 EPUB/PDF 导入、真实封面、排序、取消、混合扫描提示、移除后笔记保留、重导恢复、永久删除；在文件操作各阶段中止后重启恢复 | 假封面按书名写死、丢失唯一原书、孤立文件阻止重导、删除后索引残留 | 105MiB EPUB已真实导入并打开；r9自动恢复原失败PDF/EPUB索引且正式chunks/vectors一致，文件生命周期与中断恢复仍未验证 |
| EPUB/PDF 阅读 | 目录/书签/搜索/字号/主题/翻页方式、全文覆盖布局、选字、高亮改色、笔记编辑/删除、缩放、重新打开定位、旧 Readium/PDF 锚点 | 收起工具栏导致正文重排、取消跳页仍写进度、用普通分页冒充仿真卷页 | r9图片书前前后后通过；r10英文首屏与原生逐行一致，第二页待验。r11 PDF完整搜索/回页和纸卡视觉2/2通过；选字、旧锚点与缩放仍待验 |
| 笔记/对话列表 | 全文搜索、阅读顺序、分组折叠、左右滑动、编辑/删除/导出、回到原文 | 移除原书后记录消失、首轮词搜不到、保存失败却关闭编辑器、双重删除确认 | r11笔记导航/纸卡/原样正文已冻结，设备待验。独立审计确认对话列表页头/搜索空态/改名删除弹层尚与原生不同，进入r12修复 |
| 阅读问答 | 新对话/追问/恢复/重试、选文和当前位置、Markdown/复制、用量/压缩、引用跳转、收起继续生成并重开订阅、显式取消 | 关闭sheet误取消、重试丢原选文、保存错误被吞、无依据伪造来源 | r10真实收起继续生成/重开通过，r11显式取消/重试通过。完整引用链在验；更多实际发送材料/上下文构成/已配置服务入口尚有缺失，进入r12修复 |
| 设置/平台 | 多服务独立保存/测试、发送说明、SecureStore、MCP工具授权、模型下载/哈希/取消/替换、系统/明暗外观、关于/隐私/许可、键盘与小屏 | 明文密钥、目的地变化跳过确认、推理时替换模型导致崩溃、界面遮挡 | 类型检查及8项逻辑测试通过；移动端运行未验证 |

## 当前实现记录

- 持久化迁移 `0003` 已冻结；跨文件操作意图与恢复新增为 `0004`。
- 问答任务已移到会话级运行服务，sheet卸载不取消；不能据此宣称 iOS 系统后台保活通过。
- PDF 使用独立 Expo PDFKit 模块，保留原页色彩及左下原点/cropBox标注坐标；新增原子落盘缩略图。
- EPUB 定位保留旧 selector/text/Readium 信息；folio 页尾进度错误已改为页首进度，未重置已有用户阅读状态掩盖差异。
- EPUB 仿真卷页使用 UIKit UIPageViewController；TS 负责探测、恢复、取消和提交事务。真实 WKWebView 回归中，取消不写进度，完成仅写一次；iOS 手势仍需验收。
- EPUB 当前解压内存上限、大文件内存和真实手势均需后续对照验收，不能降低验收标准。

## 构建与验证记录

| 记录 | 结果 |
| --- | --- |
| `pod-install.log` | 成功，包含 ShudengPdf 与 ExpoClipboard |
| `build-release.log` | Swift `compactMap(.string)` 编译失败，已修为闭包 |
| `build-release-r2.log` | Swift 已编译；JS bundle 因新增 `fflate` 未安装失败；统一安装已完成 |
| `typecheck-all-r2.log` | 全工作区类型检查通过；后续新编辑须再次检查 |
| `build-release-r5.log` | Release 构建成功，已保留数据安装 Small 并实际启动 |
| `rn-r5-epub-curl-error.png` / `rn-r5-runtime.log` | EPUB 实际打开失败：WebKit 宿主函数尚未就绪、无参 abort 引用了 page。已加 hostReady 握手并修正参数；尚待下一包复验 |
| `epub-wk-regression.log` | 真实 macOS WKWebView 重现修复前故障，修复后打开、准备、恢复、无参取消、提交回归通过；不代替 iOS 设备验证 |
| `rn-r5-pdf-reader-p40.png` | 514 页 PDF 实际可读；工具栏/页码/问答入口与原生有差异，已实现 PDF 专用平台展示层，等待新版 |
| `rn-r5-notes-expanded.png` | 发现 Swipeable 操作底色从圆角外泄；已修裁剪，等待新版 |
| `rn-r5-profile.png` / `native-profile.png` | 发现内容下移、行高/图标/描边差异；已修，等待新版 |
| `rn-r5-ai-advanced.png` | 实际操作名称和模型草稿，返回再进入均保留；取消后未保存。未输入 Key，未调用真实服务 |
| 设置导航对照 | 原生 Profile 内 push 保留底部 tab，RN 根 Stack 会隐藏；正在迁移为 Profile 内 Stack 和问答内独立设置 Stack |
| `build-release-r6.log` | 成功并保留数据安装 Small，版本与 iPhone/横屏声明已对齐原生；新增平台展示层已编译 |
| `rn-r6-epub-open.png` | EPUB 已实际打开，旧高亮/波浪线可见；标题及正文换行仍有显著差异。真实 WebKit 对照确定字号换算/标题归一化原因，修复等待 r7 |
| `rn-r6-epub-settings.png` | 新大面板可开，字号100%；Done蓝色及整体10pt偏移有差异，已修 tint/呈现策略，等待 r7 |
| `rn-r6-pdf-reader.png` | PDF底栏可见、顶栏缺失；新增一次几何诊断等待r7。连续滚动来自已有RN偏好，未改数据，须通过UI切分页后做同状态对照 |
| `rn-r6-notes.png` | 圆角外操作底色外泄已修，截图与原生列表结构对齐；滑动手势/编辑保存仍未验证 |
| `rn-r6-profile.png` / `rn-r6-ai-services.png` | 新版布局可见，实际走通“我的→AI→MCP→返回”，底栏保留；切书架后回我的仍在AI页面，导航状态保留 |
| `provider-redirect-final.log` | 最终代码本机HTTP9项通过：OpenAI/DeepSeek/Anthropic各正常/307/308；sourceHits9、targetHits0、targetBytes0、targetAuthHeaders0。属于Node传输验证，移动端原生拒绝仍待验 |
| 授权边界独立复审 | MCP17项竞态及Provider54项定向回归通过，核实Expo原生在跟随前拒绝重定向；不代替真实iOS请求验收 |
| `rn-r6-pdf-lldb-hierarchy.json` | LLDB证实PDF chrome根视图为 `(0,667,375,0)`，顶栏在屏幕外；真实RN属性序列化复现自定义`position=[page,total]`覆盖`style.position=absolute`。已改名`pagePosition`，待r7运行复验 |
| 导入/删除独立复审 | 27项定向回归与3个独立失败反例修后通过：保留书即时恢复进度、迁移DB提交后文件marker失败不删除重导新书、旧embedding失败不降级同hash新一代索引。旧索引7表清理对照原生DDL；真实Expo文件操作及杀进程仍待验 |
| r6本机问答 | 通过UI添加并切换`本机验收`服务（假Key、仅`127.0.0.1:8765`），实际`read_page`工具调用后返回带引用回答；点击引用打开原文，再返回原会话，内容保留。未调用外部真实服务。隐私行显示协议名OpenAI而非配置名称，修复在staging |
| r7构建前检查 | iOS bundle export通过；全工作区typecheck通过，导入最终补修另由owner执行mobile/core typecheck。PDF诊断日志先因SDK重命名、再因Root替换语法失败，精确修正后做完整Swift类型检查；不将失败构建安装到设备 |
| r7 Release运行 | 构建成功，保留Small数据安装并启动；`rn-r7-pdf-reader-scrolled.png`确认PDF顶栏恢复。仍是现有连续滚动偏好，分页切换尚未实际成功 |
| r7 EPUB排版 | `rn-r7-epub-reader.png`与`native-epub-reader.png`在标准字号下标题、正文逐字换行对齐；不能据此推定其他书籍、字号或横屏通过 |
| r7 EPUB设置 | `rn-r7-epub-settings.png`仍整体上移10pt；实际100→125%→取消→重开恢复100%通过。Cancel颜色和根reader fullScreenModal已修，待下一包验证几何 |
| r7 iOS重定向 | OpenAI与Anthropic的307/308均由UI检查连接；本机最终计数source17、307为9、308为8，targetHits/targetBytes/targetAuthHeaders均0。旧SDK重试令22秒总截止覆盖拒绝提示，不能把source17解释成单请求通过 |
| 重定向错误修复 | 公开AsyncCaller接口适配、Expo拒绝原因归一、连接检查截止文案已合入；独立复审和91项真实SDK定向回归通过。下一包须验证source1、准确拒绝、取消和临时故障恢复 |
| 新资源/后台索引接线 | EPUB按资源ZIP端口、opaque同源scheme及按spine导入/分批checkpoint索引正在合入。完整产品reader的两轮macOS WK资源探针通过；iOS/Hermes、大书峰值内存、取消与重启仍未验证 |
| 同书系统导入 | 两端均通过系统Files选择仓库`pride-and-prejudice.epub`并打开封面；RN r7独立XCTest导入至可读57.8秒（旧流程仍等待语义准备）。原生导入后显示自定义“已加入书架/知道了”卡，r7只有inline提示；新RN确认卡已接入，待下一包 |
| 多章节首屏对照 | `native-pride-reader.png`与`rn-r7-pride-reader.png`封面及chrome几何对齐；原生章节/页脚为书名，RN为“正文”，已交修真实title fallback。新资源路径图片封面CFI/curl恢复探针尚未通过，须实际设备复验 |
| 独立UI自动化 | 新临时`.scratch/parity-ui`XCTest能实际操作现有App，不依赖Device Hub前台坐标；设置打开/取消、RN系统导入已通过。原生导入测试在成功确认卡/集合卡查询处失败，不将这些脚本断言失败归因为产品导入失败；实际App已导入并经辅助功能打开 |
| 问答收起重开 | r7实际输入受控问题、生成中收起、重开看到受控回答；本机请求已完成、断连0。脚本在流式回答首字后过早断言取消按钮消失而失败，已改为等待终态；完整重跑仍待下一包 |
| 大书独立复审 | 逐章导入/checkpoint、分批向量/精确搜索、版本/source/generation护栏已复核。新增0005仅两条查询索引；独立7项反例、28项核心和4项迁移通过，10万chunks首后页无临时排序。均是源码/Node证据，不能替代Hermes/RSS/杀进程恢复 |
| 资源安全独立复验 | 发现并修复书内脚本触shell/bridge；独立四轮真实WK攻击未执行，相对CSS/PNG正常，7项导航/5项引用均过，close后leases/blobURLs均0。离线runner的未跟踪/ignored源注入已拒绝，连续两轮及失败清理通过 |
| 统一r8预检查 | 全工作区typecheck通过、core159项通过/9项跳过、iOS export通过。EPUB后续标题/引用菜单与问答细分行为仍在收尾，构建须等最终冻结；临时UI测试2.2GiB副本已逐次清理，结果包和日志保留 |
| r8 Release运行 | `build-release-r8.log`成功，197MiB，保留Small数据安装并启动。EPUB设置sheet顶边40pt、取消颜色实机对照通过；封面章节/页脚已从“正文”恢复书名，但两侧新增14pt白边 |
| r8真实图片书翻页 | `r8-curl-xctest.log`及`r8-curl-attachments/`记录真实拖动；前翻后屏幕空白，数分钟后`rn-r8-curl-current.png`仍空白。原生同书封面后两页均有正文（`native-pride-forward-attachments/`），属于明确缺陷，不能由XCTest动作成功宣称翻页通过 |
| r8真实105MiB导入 | 夹具110275954bytes，SHA256 `ca0df7bd428921f579f6748f02d7a679d0ff0f9f8d7fb17f90f0a0bfc28deffa`，正常Pride章节加104MiB未使用资源，不是巨单章测试。系统Files导入到新确认卡2.538秒，已打开图片封面，证据`r8-large-xctest-retry.log`与`r8-large-attachments/` |
| r8大书内存采样 | `r8-large-rss.jsonl`在13:20:10—13:23:15 UTC每约2秒采样90次；App349952—520704KiB、WebContent278400—308480KiB、Networking92944—97120KiB。未捕获连续峰值，多个进程不能分别最大值相加当同时峰值；不证明全书/巨单章预算 |
| r8后台索引失败 | 只读真实数据库显示105MiB EPUB和514页PDF均`failed`，detail=`Cannot read property 'nextChapter' of undefined`，正式chunks均0，保留checkpoint。已定位Expo exclusive transaction忽略callback返回值的真实契约与本地fake不一致；修复与独立复验进行中 |
| r8 PDF实际五项 | `r8-pdf-cases-xctest.log`中5/5通过、0跳过：设置即时生效且还原原偏好；目录/搜索关闭留第41页；同页书签唯一、滑删仅测试书签；实际搜索“价值投资”跳第3页再回41；扫描说明关闭留原页。截图`r8-pdf-attachments/`；不证明无多余进度写入、旧笔记、选字或缩放通过 |
| PDF视觉补修 | r8截图完成按钮系统蓝、扫描说明系统Alert，与原生棕色/BookAlert纸卡不一致。已改nav真实加载后配色、复用BookNotice、搜索栏几何及全文扫描判定，15项定向测试/mobile typecheck通过，待r9实际截图；书签摘要从页码改为原生页首非空行160字素，9项定向检查通过，待设备 |
| 原生PDF设置对照 | `native-pdf-settings-fixed-xctest.log`确认正确`dev.shudeng.app`，真实设置即时切换、关闭保留、恢复原偏好通过；截图`native-pdf-settings-fixed-attachments/`。前序`native-pdf-open*`因集合AX类型/可见列表假设失败；`native-pdf-cases-xctest.log`的scheme环境继承错误激活RN，已中止、无效；不得当原生产品结果 |
| 原生PDF其余对照 | `native-pdf-remaining-fixed-xctest.log`中其余4/4通过、0跳过；与RN相同查询实际跳第3页再回原第39页，临时书签滑删清理。截图`native-pdf-fixed-attachments/`确认原生自定义纸卡与棕色导航按钮；搜索结果片段保留原换行，r8 RN压缩换行差异正在修正 |
| r9索引修复独立复审 | 直接transpile已安装Expo原始transaction代码并接真实SQLite两连接；旧driver在独立反例准确复现undefined，新driver等待commit与close后返回业务值。独立2/2，driver/checkpoint/0005回归14/14；未改迁移或真实数据，设备恢复待新包 |
| r9 EPUB冻结复审 | 图片CFI恢复需兼顾空白Range到唯一`img/0`及多图首媒体边界；中间收窄过严曾让Pride原回归失败，最终规则同时通过。Pride交易、浅深背景、旧导航/5引用/隔离各两轮，closeJoined/oldSessionRejected、leases/blob0；独立真实多图重排旧版红/新版绿、6项DOM及12项产品通过。Mobile inline SHA256=`80585d320aea8f03d6102989f536634e641ce3bc2a5711385b1e5227ec8c065f`，UIKit实际快照/拖动待新包 |
| r9 PDF冻结复审 | Foundation原始算法oracle与Swift平台scanner核11组含260命中、360UTF16分段、重叠/变音/emoji/换行/200B；public端口候选页一次读及三阶段取消独立16/16，PDF产品30/30。书签字素/关闭owner独立7/7；保留已授权落盘、关闭后无晚弹窗/刷新。统一新包后复验，不能仅热更新r8旧native |
| r8问答再次打开失败 | 首次`r8-chat-background-xctest.log`停在服务提示AX类型断言，实际空问答呈现、未发请求。修测试后`r8-chat-background-retry-xctest.log`真实点击却未重开；已用真实Provider hooks+Expo StackRouter复现POP后bindings仍在阻止重开，产品修复及独立复审中。不能算问答收起重开通过 |
| r9问答重开修复 | `openQuestion`/`reopenActiveQuestion`两处改用真实routeKeys与pending决定是否呈现；bindings继续管理React资源，但不阻止已无路由的重开。真实Provider+StackRouter回归31/31，涵盖退出scene未cleanup、旧cleanup/transitionEnd不影响新visit，mobile typecheck通过，独立复审及实际iOS重开待验 |
| r8选字初验 | `r8-note-card-xctest.log`真实press+drag成功形成选文、打开NoteSheet并读到quote；后续安全检查关闭reader遇多层深链reader前置，未到笔记tab即失败。未写marker/未改旧笔记，不证明高亮、保存或键盘/拖动通过；下一包从单reader前置重跑 |
| r9 Release实际启动 | `build-release-r9.log`成功，197MiB，free59GiB；保留Small数据安装并实际启动PID20608，容器`F050BFCD-E57C-47FD-895D-06C1ACC76125`。typecheck/export最终版均通过；全源码冻结hash见`r9-source-sha256.txt`（后续新改动不能沿用r9结论） |
| r9索引实际恢复 | 原失败PDF与105MiB EPUB在启动后自动完成，分别3233/8583正式chunks且同数vectors，status=ready；Pride8583。`rag-index-build:%`无残留。只读真实DB验证，无重导/清库掩盖；不等于中途杀进程/内存峰值已验 |
| r9实际卷页 | `r9-pride-curl-retry-xctest.log`真实前前后后1/1通过；`r9-curl-attachments/`五图与`r9-curl-current.png`肉眼确认正文首两页、返回封面且白边消失。前序`r9-pride-curl-xctest.log`实际0测试，为无效runner结果。英文自动断字与native仍有差异，继续修，不能写整书视觉一致 |
| r9问答再次设备失败 | `r9-chat-background-fast-xctest.log`真实本机请求6完成，close后实际ask不呈现sheet；4秒延迟不证明关闭期间仍在生成。独立真实Expo createSeededRootState/原始Hook/React探针自然复现常驻`__root:0`被误绑，POP后仍阻止push；实际应用Stack边界修复同探针旧红新绿，证据`.scratch/chat-root-independent-review/ROOT-EVIDENCE.md`，40项定向测试及typecheck通过，r10设备待验 |
| r9 PDF设备复验 | `r9-pdf-cases-xctest.log`实际5项中4通过、1失败、0跳过。设置即时生效/恢复原偏好、导航关闭留41页、仅自建书签滑删、扫描纸卡关闭留页通过；最后搜索输入“价值投资”实际变“价资”，失败在逐字输入前置，不能称搜索跳转通过。`r9-pdf-attachments/`保存截图；棕色完成按钮和纸卡已出现，纸卡标题字重/消息断行仍与native有差异 |
| r10 PDF输入补修 | Swift原生编辑递增eventCount，TS原子保存query及ack count，原生只接受不落后的文本回写，避免旧桥接echo覆盖新输入。源码独立复审无阻断、mobile typecheck通过；真实UIKit旧红新绿与设备完整输入仍待验 |
| r10源码准入 | EPUB新增原生Readium断字与精确语言分支、Shelf移除确认纸卡、设置四节发送说明与v2确认范围/纸卡、notes移除书隐藏和准确搜索空态均已冻结且独立源码复审无阻断。不得将该准入作为产品UI通过；Shelf移除失败重试卡、notes导航/手势/导出等差异仍待处理 |
| r10 Release启动 | `build-release-r10.log`成功，197MiB，free59GiB；Small保留数据安装启动PID38522，6本书仍在，当前容器`C399A227-C0B0-49C2-B062-40CF6F21517E`。全工作区typecheck/iOS export通过，冻结源码见`r10-source-sha256.txt` |
| r10问答后台实际通过 | `r10-chat-background-xctest.log`执行1项104.965秒、0失败；同请求在真实收起后仍active=1，重开等待完整终态且不重发，终态再开答案保留。截图`r10-chat-background-attachments/`。本机requests6→7/completed6→7、disconnected0；仅固定127.0.0.1假Key受控服务，不代替真实外部provider |
| r10英文首屏断字 | 独立对照`r10-chat-background-attachments/F0495A38-446A-432D-BE86-4A600B200CB2.png`与原生`native-pride-forward-attachments/65DFD5BE-993E-4240-A3BA-33A01F7FA471.png`，逐行与首处License in-/cluded对齐。第二页for-/mats与其他书/方向仍待验 |
| r10取消与AX差异 | `r10-chat-cancel-retry-xctest.log`真实点击取消后，mock requests8/completed7/disconnected1/active0；`r10-chat-cancel-current.png`可见取消文案及重试入口。但真实AX为`refresh, 重试回答`，脚本exact按钮前置失败，后续重试尚未验。已补精确已观测alias，产品4组件显式中文标签与装饰图标隐藏等待r11；不能把此脚本失败报告为取消失败 |
| r10书架输入差异 | `r10-setup-local-xctest.log`已实际完成本机服务v2确认，随后快速`Pride\n`输入变`Pe`，exact书卡前置失败；`r10-setup-open-pride-xctest.log`清空查询并真实滚动打开唯一原Pride，1/1通过。普通RN输入最小真实React环正常、负控红，尚未定位真实丢字原因；已准备三种设备输入对照，不无证据改产品 |
| r11 Release启动 | `build-release-r11.log`成功，197MiB、free59GiB；保留数据安装Small启动PID53726，容器`90A776A4-8F0E-4FA8-A6AA-09FAC317ED27`。6本书和6份ready索引保留。全workspace typecheck/iOS export通过；`r11-source-sha256.txt`固定本包源码。原生`ios/`仍无改动 |
| r11 PDF实际修复 | `r11-pdf-input-help-xctest.log`2/2真实通过、0跳过：价值投资完整输入、真实第3页命中/跳转/回原41页；扫描说明关闭留页。`r11-pdf-input-help-attachments/`肉眼对照确认纸卡标题字重/消息断行及搜索片段换行/导航布局与native对齐。r9失败搜索创建且留在41页的测试书签annotation-mw0s5goa-8已以DB创建时间/锚点确认归属，再由UI取消，仅原27页旧书签保留 |
| r11模型/笔记源码复审 | 原生compressed-only完整v1 receipt支持本机安全prepare后加载；真实75,546,406bytes gzip解出118,412,398bytes、原生SHA一致的独立20项/真实React MCP14项通过。Notes嵌套native导航/失败重试纸卡/原样正文保存/中文AX已独立准入。本机当前手seed模型目录无receipt，严格状态应未下载；不能将旧ready向量当本包ORT或下载验证。真实UI/Expo IO/下载/模型推理仍待验 |
| r11显式取消重试 | `r11-chat-cancel-retry-correct-reader-xctest.log`真实1/1通过、91.218秒、0跳过：取消后显示取消卡，收起重开保留同问题，重试只新增1请求并收到完整终态，无重复用户消息。前序r11同名用例停在PDF前置且无请求，为无效产品结果 |
| r11书架快速输入 | `r11-shelf-search-input-xctest.log`实际3种输入全部通过、50.048秒；快速Pride与Return同调用、分开调用、逐字输入均逐字保持，收起键盘后仍正确，收尾清空查询。导航准备另1/1通过；未修改产品输入逻辑。r10的Pe现象本轮未复现，不能宣称已定位根因 |
| r11引用初验前置失败 | `r11-chat-citations-xctest.log`1/1失败，工具固定答案和真实引用已产生，但短sheet把答案文字裁出ScrollView可见区，脚本在全文hittable等待处终止，未走引用跳转。临时用例改为真实展开sheet后限定本轮全文/引用/终态，重验进行中 |
| 原生本机服务前置 | `native-local-provider-setup-xctest.log`1/1通过、225.650秒，仅通过正常UI新建/选中本机验收，地址127.0.0.1:8765/v1、模型local-mock、假Key。未检查连接或发送问题；原DeepSeek配置保留且原选择UUID/名称已记录于`native-local-provider-setup-attachments/CA652B71-0C4F-4367-97E2-DFD7D0C40E1E.json`，完整对照后恢复原选择 |
| r12新增入口差异 | 独立审计确认对话列表的大标题/搜索/改名删除纸卡、问答实际发送材料/上下文明细/服务入口、外观系统ActionSheet与原生自绘纸卡有确定差异。分别交owner补修，尚未构建安装，不沿用r11设备结果作为r12结论 |
| r11模型真实下载 | `r11-model-real-download-xctest.log`1/1通过、388.125秒、0跳过。真实正进度后取消，正常未下载且3秒无晚到状态；再次从公开源完整下载、出现自定义成功纸卡、关闭重进已下载。14份截图/状态附件位于`r11-model-real-download-attachments/`。真实v2 receipt及压缩文件75,546,406bytes、ONNX118,412,398bytes、两个tokenizer文件的SHA全部匹配，staging/previous残留0，报告`r11-model-installed-file-verification.json`。尚不证明本包ORT实际推理 |
| r11笔记真实选字前置 | `r11-annotation-chinese-setup-xctest.log`1/1打开原红楼梦通过。`r11-note-card-drag-keyboard-xctest.log`1/1停止于写入前安全检查：真实选文“灯把书页”已对应legacy-note:C7A61C49-17B1-4229-9627-6DC52FB3BC18，未创建/修改记录。须换未标注原文重验；不能把该停止算拖动或键盘通过 |
| r12设置视觉补修 | 实际安装后AI列表额外显示RN“书内语义准备”区，原生固定四段无此区；已移除该UI及observer，后台准备与删除前取消仍保留，最终AISettingsScreen SHA=`11ba59bbc56ee2c049ae1ef76a72388d1fe88e25918fcb75807c0c57ec5577e5`，独立当前合同复核无阻断。另按UIKit UILabel默认standard给设置footer显式设置同策略，未猜改字体/宽度；r12实际断行效果待验 |
| r12问答最终独立复审 | 初始26文件冻结撤回；独立反例发现并修复跨轮选文消失、SSE心跳假超时与RN whatwg Response(stream)丢流，最终27/27 hash核对通过。独立provider/idle/边界64项、作者core94项/chat17项通过；保存失败覆盖、原生预算/摘要/历史生命周期及实际发送材料已核。证据`r12-chat-{sha256.txt,delivery.md}`；不代替Hermes/Expo实际网络和UI验收 |
| r12笔记排序/导出修订 | 原生总进度→局部进度→0、position→0、章节空白原样及PDF显示page→position已对齐；5文件冻结`.scratch/notes-native-contract-check/frozen.json`。4新增反例旧红新绿，Root独立NotesRoute21/21，另pure17/17。独立SQL字节oracle对当前query“灯把书页”预期224bytes、SHA`aa9f8c369b1d915b1e43527228d3df2f7ac3fa1f5060ca11005a50879fb93093`；实际Files输出尚未比对 |
| 原生问答视觉基线 | `native-chat-visual-cellfix-01.log`真实1/1通过147.180秒、0跳过；同一Pride可见正文、空draft零旧轮、本机固定回答、小/大sheet/思考展开、关闭后原文几何与0%恢复。请求恰+1/completed+1、errors/disconnected不增。截图`native-chat-visual-cellfix-01-attachments/`；导航Cell类型修正另1/1通过，前序Button类型失败不算产品故障 |
| r11真实24MiB单章导入/模型/中断 | SHA`2786a4a681dfe21d0686b53bb79a54db2e86c9f4ff6b2fbada728b88480a287a`，XHTML25,165,824bytes、24,895段、单spine无未用资源。`r11-giant-files-fixed-import`实际Files导入成功并显示纸卡；脚本因重复标题AX节点超时，未伪造导入用例通过。新夹具26,800chunks/vectors检查点后实际terminate/launch，PID53726→90331，同generation0续增34,784乃至54,832、semanticFailure=null，证明当前包ORT实际推理和中断续跑；正式索引尚未晋级，不能写ready |
| r11巨章节首屏阻塞 | 同一保留导入后`r11-giant-after-interruption-xctest.log`实际开书，截图`r11-giant-reader-loading-current.png`数分钟仍“正在打开书籍”。WK PID91439的层级查询70.29s报AX IPC timeout，验收333.743秒后中断，尾搜索/位置恢复未执行。`r11-giant-rss-v2.jsonl`采集Small专属App/WebKit/Networking/GPU；不能以App内存代替WK，也不能把此中断称完整用例失败通过。整章DOM/分页和重复重排风险源码已定位，原生同夹具比较待验 |
| r12集成检查 | 新requestContext事件令eval两个日志switch缺分支，已补仅估算数与材料数量的输出；最终`r12-workspace-typecheck-final.log`全workspace通过，`r12-ios-export.log`实际export成功。产品Release按统一脚本构建中，尚未安装，不能沿用r11设备结论 |
| r12 Release实际启动 | `build-release-r12.log`实际成功，197MiB、free58GiB；保留数据安装Small并启动PID96472，当前容器`25C65117-8FD7-4B51-BBBC-2AAD49B347FA`。7书/4标注/6份ready索引保留，巨章pending62,160chunks/vectors且无semanticFailure续跑。最终373源文件hash见`r12-source-sha256.txt`，原生`ios/`无改动 |
| 巨章内存采样边界 | `r11-giant-rss-summary.json`共431个约2秒快照，UTC16:31:42—16:46:43；App采样最高1,015,728KiB，WK2,339,152KiB，同一快照相关进程RSS和最高3,085,184KiB。不是连续峰值或physical footprint，包含导入/中断/重开；不能与未采样的Native作数值优劣比较 |

## 当前设备验收缺口

2026-11-03 续验补充（本节后续结果优先于上方旧状态）：

- r12 真实 Hermes/Expo provider：`r12-provider-redirect-xctest.log` 1/1、`r12-provider-retry-deadline-xctest.log` 2/2，均零跳过。本机假 Key 的 OpenAI/Anthropic 307/308 源端各 1 请求、目标端 0 字节/0 授权；OpenAI 503 后成功、取消后 5 秒不再请求及 22 秒期限在 UI 23.33 秒终止均有实际证据。Anthropic 重试/取消和真实外部服务仍未验证。
- r12 同一巨章正式索引已晋级：112,018 chunks/vectors，384 维，pending manifest 为零；首/中/尾抽样有限值且范数约 1。证据 `r12-giant-real-index-verification.json`，抽样不等于穷举向量内容验证。
- 原生同一巨章 Files 导入 1.9946 秒；`native-giant-firstscreen-20261103-1702.log` 实际执行 1 项，约 181 秒出现 AX snapshot 超时，未在窗口内取得 ready/首段证据，随后停止 runner。超时后 Root 只读截图 `native-giant-after-bounded-failure-current.png` 已出现首段 marker 与 0%，证明最终可见；首次可见时间未知，不记 180 秒内通过，也不记永久打不开。
- `r12-note-card-real-drag-xctest.log` 的两次实际选文日志均为“当下地下”，先前“选文变化”推测撤回。独立 macOS XCTest 复现临时 helper 的 1 秒 predicate 首次求值约 1.008—1.015 秒，导致真条件也超时；仅加立即求值修复，保留逐字选文、零旧匹配和归属检查，实际笔记写入/拖动仍待复验。
- 笔记导出 oracle 已更新为 r12 当前容器，7 书/4 标注，查询“灯把书页”仍为 1 条/1 组、224 UTF-8 字节，预期 SHA 未变；实际 Files 保存字节待核。

- r9 EPUB图片封面跨章真实卷页及背景白边修复已验；r10英文首屏逐行及首处断字已对齐，第二页/其他书籍与方向待验。r11 PDF搜索与提示纸卡修复已实际通过。
- 同书系统导入、原失败后台索引自动恢复、问答收起继续生成/重开、显式取消/重试已验；索引中杀进程恢复、卷页取消、选字/标注/笔记/回原文等完整操作仍未验证。
- 真实移动端本机 provider 拒绝重定向、OpenAI 重试/取消/期限已验；MCP 实际网络全流程仍未验证。模型下载/取消/重试/文件hash、ORT推理及112,018巨章正式向量晋级已验，不能推定巨章阅读首屏、尾搜索或定位恢复通过。
- 独立复核发现的旧书回填、removal状态迁移、索引残留/晚到写回、迁移半文件、重导代际等问题已修并通过代码复审；不能替代真实文件生命周期验收。
- 用户已解锁Mac，辅助功能操作恢复。Device Hub坐标仍不可靠，已改用实际XCTest通道；系统文件选择已通过，长按与连续拖动还未验证。普通tap报告成功仍可能无变化，以实际状态/截图为准。
- 新EPUB端口移除旧100MiB压缩/16MiB条目/128MiB全书累计限制，改为按资源读取和session预算；128MiB是单session租约预算，不能当成整个App或WK内存上限。真实iOS大书与并发session峰值尚未验证。
- r12普通问答初始卡片截图与原生约差30pt：原生首档为screenHeight×0.76，RNScreens按maximumDetentValue×0.76；输入区底色和禁用发送按钮也有可见差异，进入实际UI修复。`r12-chat-basic-ui-v2.log`停在发送前几何门槛，没有本次问答请求；不能把源码准入当视觉通过。
- 空query全量笔记分享已显示“文本文稿 · 367 字节”；`r12-notes-export-all-files.log`实际1项skipped于系统caption类型前置，尚未保存到Files。当前系统caption是Other/LP.CaptionBar.TopCaption，保存动作是“保存到“文件””，已取得AX证据后修临时selector，不能把测试日志TEST EXECUTE SUCCEEDED计作导出通过。
- 本机全量笔记实际导出已补齐：`r13-files-save-once.log`真实1/1通过25.253秒，UI将原日期名改为唯一UUID后仅保存一次，未覆盖。Root独立读取本机Files真实TXT，367字节/2条非书签，SHA`a44725a3c4e03d937a5b622a3b834874842f845b5a070ff450fc4d7ceed75a21`，与保留原始Readium的原生合同及RN预期逐字节一致；源DB/源码/预期文件hash均未变。`notes-export-oracle-all/comparison.json`的actualSavedFilesVerified=true。保存发生于r12安装包，文件名以r13临时runner命名，不能据此冒称r13导出重验或真实原生当前库导出。

## 交付条件

r13 源码与构建准入：

- 阅读器初始theme/font/flow在第一次layout前统一应用，删去init后的重复styles及无变化setter恢复；独立读取Foliate缓存与load路径确认后续spine仍重放当前styles。稀疏Text区间映射保持四次归一化和quote独立过滤合同；独立真实旧源码同DOM的144组/30,057完整区间、等量错误quote、1,728非法端点、17组quote零差异，源码hash运行前后固定。证据`.scratch/reader-independent-oracle/frozen-2782d9e2.json`。24MiB宿主新算法9,434,316 UTF-16单元对应49,791区间；不能代替WK首屏/CFI/设备RAM验收。
- 问答首档使用显式point基准`sheetDetentReferenceHeight`贯通Expo内嵌native-stack与Screen/Modal Fabric，resolver按screen×0.76并裁剪maximum；省略prop与1最大档语义保留，屏幕变化更新。补丁持久登记并离线锁验证；独立codegen与146项真实header计算、Composer事件/selection/AX属性通过。输入底色、44pt输入、禁用按钮及header边距按实际原生截图修正，设备效果待验。
- 显式离线codegen已刷新生成Props，Screen/Modal恰两处新Double属性；实际构建日志确认ReactCodegen Props和RNScreens重编译。`r13-workspace-typecheck.log`、`r13-reader-inline-build.log`、`r13-ios-export.log`均通过；`build-release-r13.log`成功197MiB、free54GiB。363源文件冻结清单`r13-source-sha256.txt`已复验全部匹配。尚未安装，不沿用r12设备结果。
- r13已保留数据安装Small并实际启动PID21991，容器`B8C2A32A-52CC-48D0-8D61-5E651ADBF3C8`，7书/4标注保留；r13普通Pride前置已真实打开。`r13-reader-tests.log`18/18通过、无跳过；后续双模拟器UI/大章验收仍进行中。
- r13问答自动验收暂停复核合同：初始76%几何门槛与零轮容量已过；服务列表因嵌套同frame双StaticText标题使原唯一性假设失败（实际本机验收仍Selected），修正后从同一自有未发草稿续跑。返回实际保留完整草稿并恢复键盘/最大卡片，续跑强制无键盘的前置不满足，随后AX waiter中断；未发送请求。截图`r13-service-return-keyboard-current.png`。连续前置失误后停止重试，先核原生服务返回键盘合同，不将上述脚本失败写成草稿丢失或问答产品失败。

- 原生键盘实际合同已补：`native-service-keyboard-continuation.log` 实际1/1通过27.200秒、0跳过，从已选本机服务列表仅返回一次，原自有草稿逐字保留、零轮，sheet `[0,40,375,627]`、keyboardCount=1。截图显示系统首次键盘引导，Root随后通过实际Continue关闭引导；`native-service-return-keyboard-after-system-continue.png`仍有输入焦点与完整键盘。因此撤回测试强制“服务返回后无键盘/小卡片”的假设，未按该假设改产品焦点行为。结果附件中tearDown过早取得的`xctestSucceeded=false`不是最终测试状态，最终以Executed1/0fail及结果包为准。
- PDF菜单/调色盘五文件已独立复审：纸卡四动作、选区定位、颜色与底部取消、160ms淡出且等待真实onDismiss后执行捕获动作；取消/重复点击/owner关闭不晚执行。跨页选文旧实现截断第二页，现按原生完整selection.string外缘trim，首page/归一化geometry不变。独立host25/25、8640组实际定位公式一致、6组真实PDFKit旧红新绿；证据`.scratch/pdf-selection-independent-review/review-result.json`及冻结清单。尚未进入新产品包，Fabric实际层级、菜单命中、旋转、动画、缩放、旧标注回跳仍待设备验收。
- 同SE3最大问答卡片截图发现图标仍小：原生xmark墨迹30×30像素、RN24×24；lamp原生20×35、RN15×27。当前expo-symbols的size只定方框，Swift仍用默认17pt生成后缩放，与原生显式15pt且intrinsic居中不同；正在补可选pointSize并保留默认行为，未据源码数值相同宣称一致。输入光标原生继承BookDesign.lamp，RN蓝色差异已补`selectionColor={palette.lamp}`，待下一包截图。
- 上条图标默认点数更正：实际iOS26.5离屏运行的`UIFont.systemFontSize`是14，源码variant名称中的point17不准确；现有size方框与pointSize语义差异仍成立。`native-symbol-point-metrics.log`和`symbol-render-route.log`均实际1/1，候选point15+fullbox.center未像素匹配，未作为视觉通过。lamp配置图片后intrinsic AutoLayout居中已与原生离屏逐RGBA字节一致；system UIButton默认preferred配置含body textStyle+large scale，关闭图标仍需验证large/intrinsic路径。
- r13保留回答续验已完成：首次single-send使本机计数22/16→23/17，errors/disconnected均不增；完整答案已显示。`r13-basic-text-frames.log`只读1/1确认question/answer各两份StaticText逐字且CGRect完全相同，脚本仅对此等读态重复去重，按钮保持唯一。`r13-completed-basic-continuation-no-parens.log`实际1/1、129.656秒，大小卡片/思考展开/容量详情/本机服务往返/关闭回正文通过，续跑0新请求。带括号selector的前一包执行0项无效，未算通过。Root对原始与关闭截图排除顶部80像素系统时钟后，750×1254区域RGBA零差异，证据`r13-basic-reader-restored-pixel-comparison.json`；是RN自身位置恢复证据，不是与原生正文对齐。
- 并排opaque问答内容仍发现安全说明位置/纸底、思考标题chevron方向、正常顶序与倒置贴底的差异，已进入AssistantTurn/ChatList/UserTurn修复。原生context过程字数来自本地估算、步数来自模型result.steps，RN先前完成轮遗漏步数元数据，现加可选modelSteps的完成→保存→重开链，三文件旧r12冻结结论撤回，以新freeze复审为准。未改DB schema/migrations或模型执行；实际新包行为尚未验。

2026-11-03 后续独立验收：

- r13 同一保留巨章（SHA `2786a4a…a287a`、ready112018）只点击一次，外部每约2秒截图、无点击后正文AX。90张原图中，frame41仍空、frame42完整首marker与正文可见且无spinner；Root逐图核对前42张，首屏可见区间为点击请求后80.145—82.311秒（包括截图取得及点击框架同步，不是精确touch-down计时）。证据`r13-giant-visual-run2/`与`r13-giant-visual-review.json`。采样器遗漏bare `launchd_sim`的WebKit归属，只记录App RSS，不能声称总内存或与Native作内存比较。后续右侧翻页action实际1/1，但调用53.681秒，排除时钟后前后RGBA零差异，翻页未验证。
- 原生同巨章外部计时action实际1/1、点击后零显式AX，但App在加载时退出；`Shudeng-2026-11-04-025902.ips`故障栈为Apple `XCTAutomationSupport`的`XCTAutomationSession`初始化，不能据此判产品崩溃或首屏性能。随后Device Hub坐标fallback报`windowNotFoundAtPosition`，未完成点击。两次采样均明确停止；未重导、未清库、未拿action-only的PASS冒充reader ready。
- 问答过程与legacy Native元数据共14文件已独立通过：真实React52+7、Foundation16、metadata34、滚动，以及13组真实迁移入口→Drizzle/store→SQLite(FK ON)→hydrate→React。单独SQL reviewer13/13覆盖9种已有details原字节保留、17类身份/RN同ID重试保护、缺assistant/缺updated/删除会话不复活、删书重导墓碑、原生取消/四类中断/失败、真实SQLite ABORT回滚和幂等。证据`.scratch/chat-process-independent-review-20261103/frozen-c3accadc/`与`.scratch/legacy-metadata-independent-sql/`。未改schema或0003/4/5；设备尚未安装新元数据链。原材料页、多段选文及service/model等字段已安全保留但部分界面未接，不能称历史问答完全一致。
- symbols可选`contentLayout`的新intrinsic/systemButton路线已独立clean replay和190组/969断言通过，默认路径与原包逐字节一致。真实Expo SymbolView子类（真实Expo/React框架，无替身）离屏运行，两图RGBA与Native均相同、默认回归通过，但路由循环后“全部root constraints为空”的断言两次失败；正在保留断言并记录约束身份，不删失败证据、不提前记整体通过。
- UserTurn固定25行高与原生只加4行间距的实测单/双行25/50对18/40不同；新增通用iOS `lineSpacing`完整Fabric属性链，保持默认NaN与原测量体系。持久Expo插件强制ReactCore及相关消费者源码构建，避免TextAttributes ABI与旧预编译二进制混用。revision2补丁`b7be3012…`经独立旧源码8文件重放、123项断言、4个SDK语法探针通过；实际C++/UIKit用例与源码产物/设备frame待验。UserTurn旧c3冻结哈希结论撤回，以`.scratch/text-line-spacing/frozen-files.json`及独立`.scratch/text-lines-independent-review-20261103/conclusion.json`为准。

- 原生同巨章已改用绑定 NativeBaseline 的 serve-sim 浏览器镜像输入，避开 XCTest 的正文 AX。90 张每约 2 秒原图中，frame27 仍空、frame28 已完整显示首 marker、正文和可用 chrome，Root 已看全量 contact sheet 及两张原图。按实际 CUA 点击请求时间重新计算首屏区间为 41.805—43.972 秒；sampler 的提前 marker 不是点击时间。证据 `native-giant-visual-mirror-run3/` 与 `native-giant-visual-review-mirror-run3.json`。r13 RN 的 80.145—82.311 秒仍有明显差距，单轮样本不代表稳定分布。Native 右 tap 无变化，后续实际水平 swipe 已显示下一页正文；当时 curl 模式并未确证，撤回以 curl 解释 tap 无变化的推断，tap 翻页仍未验证。Native 相关进程 RSS 和采样最高 1,241,184 KiB，RN 的 WebKit 归属缺失，不能据此比较总内存。
- symbols v2 的真实 Expo SymbolView 最终离屏运行已通过 2/2、0 失败、0 跳过：Native 两图逐 RGBA 相同，默认行为、30 次路由/AX/尺寸变化与恢复通过。前两轮失败原因已保留：UIKit 自身的四条 autoresizing 约束不等于补丁残留的 center pins；最终只允许明确识别的系统约束，并验证无自身 center pins。证据 `.scratch/symbol-parity/actual-runtime-final.{log,xcresult}`；仍需新产品包中的 RN/Yoga 实际 UI 验收。
- r14 安装、全 workspace typecheck、reader inline、iOS export 与源码开关 prebuild 已通过；source Pods 安装因 CDN SocketRocket 公共规格 TLS 连接失败退出，尚无 r14 Release。旧 386 文件 freeze 因新授权的问答材料、选文、原位置与工具元数据接线撤回；新包必须在最终独立复审和重新冻结后构建。没有关闭 TLS，也没有恢复旧预编译 ReactCore。
- 新问答 12 文件补修已独立通过：实际请求 9 组、位置 11 组、React/材料路由 7 组、真实 LangGraph 两次模型调用和 4 个工具（含 schema error）以及 SQLite 保存重载；旧过程 52、context 7 和 Foundation 原函数标题/详情/预览/选区矩阵均通过。发现并修复损坏 CFI 尾部容忍、原首轮缺失或坏 ID 时误借后轮选文和位置两个边界。最终 hook `ee9b665f…`、helper `bddd283a…`，42 份实际加载/冻结源无漂移；证据 `.scratch/chat-continuation-independent-review-20261103/conclusion.json`。仍未部署新产品包，不替代像素/手势/动态字号验收。
- Small 单镜像 HID tap/drag 无变化已定位工具通道：真实 UIKit sendEvent 断点零命中，serve-sim event log 只有发送记录；镜像还曾停留旧帧。独立已有 XCTest 单次目录按钮动作 `r13-giant-contents-action-only` 实际 1/1、0 跳过，55.148 秒后真实 simctl 截图已显示目录，说明产品菜单可响应。Small `com.apple.coredevice.dtuhidd.active` 实读为 1，符合 serve-sim 的 Xcode27 Device Hub 已知占用问题；Root 按官方 `repair-input -d Small` 修复后标记 0，App 重启 PID45087，未 erase/uninstall/清库。已撤回当前产品吞输入的推断，重新连接镜像后还须实测手势。

- 修复 Small HID 后，同一 r13 巨章再次以真实镜像输入验收：frame35 空、frame36 正文完整，按实际点击请求时间计算首屏为 78.513—80.664 秒；一次水平 swipe 后真实 simctl PNG 已切换到下一页。证据 `r13-giant-visual-repaired-review.json` 和 `r13-giant-repaired-swipe-real.png`。同归属方法下相关 App/launchd_sim/WebKit 进程 RSS 和采样最高 2,731,408 KiB，Native 为 1,241,184 KiB；这是可能重复计共享页的单轮采样和，不是 physical footprint、连续峰值或稳定性能分布。正文延迟和占用差距仍未解决，动画逐帧耗时未测。
- CJK r3 已最终独立通过：522 组配置、108 组语言与实际 Foliate 顺序、120 组样式/语言/方向、27 组真实 Reader 首次加载链；非 CJK 288 组输出逐字节不变。作者样式缩进保留，无作者样式中文 2em、日韩 1em，Native 语言分类及优先级不扩展。四文件冻结 `.scratch/epub-cjk-typography/frozen.json` 已纳入 r14；尚未验证新包真实排版。
- r13 MCP 两条设备用例真实执行后均停于完整 MCP 分组 AX 前置，未新建配置、未发问或调用工具；不是 MCP 功能通过，也不能只凭截图将根因定为重复标题。临时 harness 仅允许 exact StaticText/label/frame/hittable 相同的只读标题折叠，保留按钮和名称唯一性，并新增 `MCP-section-boundaries` JSON。25 组纯矩阵和 Swift parse 通过，实际重跑待 r14 构建后串行进行。
- r14 source Pods 已完成安装（122 依赖/129 pods）；官方 Specs 路由只在本次进程内改走官方 raw 仓库，Hermes 官方 SHA/cache 核对通过，未改依赖版本或关闭 TLS。日志 `r14-source-pod-install-verified-routes.log` 明确 ReactNativeDependencies/Core 从源码构建且无 React-Core-prebuilt。最终 392 文件冻结 `r14-source-freeze-final3.json` 无漂移，workspace typecheck、reader inline、iOS export 均通过，统一 Release 正在编译；不能据此记安装或设备通过。
- r14 安装前使用 SQLite online backup 对只读源库备份成功：7 本书、4 条标注、8 个对话、39 条消息，备份 `r13-before-r14-db-backup.sqlite`，详见同名 JSON。未重导、未清库、未改变真实源数据。
- r14 首次完整源码构建真实失败（exit65）：ExpoRouter 的 Swift 导入 RNScreens umbrella 时，新增公开头 `RNSSheetDetentHeight.h` 的无条件 `<algorithm>` 被当作 Objective-C 导入。已仅给 C++ includes/namespace/函数加 `__cplusplus` 保护，卡片 detent 算法不变；offline pnpm 安装与 source Pods 接入成功（16 秒，122 依赖/129 pods），workspace typecheck 通过。相对 final3 冻结仅 screens patch 和锁文件两项变化，须重新冻结及构建，失败包未部署；真实 SDK 导入独立复审待完成。
- 头文件兼容保护已独立通过：13 文件完整补丁正向重放，真实 iOS SDK 旧 ObjC/Swift import 重现失败，新 replay/installed 的 ObjC、ObjC++、Swift 小模块均成功；独立新 146 组 detent 数值矩阵全部相等。续编已越过 ExpoRouter Swift 编译，随后在 EXConstants 的真实配置生成阶段失败，原因是上游 ONNX `app.plugin.js` 直接使用未声明的 `@expo/config-plugins`。已在 pnpm packageExtensions 显式补齐锁中现有 58.0.11，普通离线安装和冻结锁离线重装后，实际 `getAppConfig.js` 的 Release/production 路径均通过；source Pods 再次接入成功。最终 392 文件清单更新为 `r14-source-freeze-final5.json`；只增加上述 guard 与依赖声明/锁变更，统一源码 Release 续编中，尚未安装。
- r14 最终源码 Release 已成功：`build-release-r14-source-retry2.log`、181 MiB、free48GiB；392 源文件与 final5 冻结全部匹配，App SHA `89ef00c8…e5fbb`、main.jsbundle `c066ed12…f08be`。保留数据安装 Small 并实际启动，镜像已显示书架，真实库仍 7 书/4 标注/8 对话/39 消息，新容器 `28548ED1-9C8D-422E-B2A5-58C1C6B705D5`。source-built TextAttributes/BaseTextProps/iOS adapter 与 Fabric 消费代码均有真实编译记录，无旧 prebuilt ReactCore 混用。
- 真实 source RN C++/UIKit 行距测试已通过 3/3、0 失败、0 跳过，证据 `.scratch/text-line-spacing/actual-source-runtime-r14-search-path.{log,xcresult}`。默认/继承/hash、fast set/RawProps、iOS 属性及 Dynamic Type multiplier 下固定4pt，以及两宽度三文本的 UILabel 测量均通过：单行18、双行40，与原生适配器一致。首次临时工程链接缺少 .a 搜索目录的失败保留，修正仅在 scratch generator；未改产品。该结果不等于 RN 页面字体视觉通过。
- r14 MCP只读边界观察真实1/1：外部工具标题恰两份 StaticText(type48)、同 `[32,432,311,20.5]` 且 hittable；添加按钮恰一份(type9)。证据 `r14-mcp-boundary-observation-attachments/0BBA3AD6-9D82-441A-A668-DF955E7266DA.json`，没有创建配置或发请求；此前基于不完整AX的猜测不再沿用。随后开始真实本机发现/白名单/保存重开流程，结果待验。

- r14 独立 WK 巨章诊断真实 1/1、153.133 秒、两轮 fresh nonpersistent WebView 均 settled、CFI 对照相等。固定 375×647 视口；第二次 columnize/expand 包含约 42.4 秒重排，可见范围扫描约 22—26ms，不能归为首屏主瓶颈。另有约 30.5 秒位于 fonts.ready-after-goTo 窗口，尚未归因；最关键整 body Range 来自外层 realm，现有计数探针未覆盖。附件 `r14-epub-wk-phase-diagnostic-attachments/`；准备新增原调用点测时和空白 iframe 尺寸隔离实验，未改产品，也不替代真实 App 首屏。
- r14 MCP 发现流程第一次真实失败在地址输入后：键盘仍显示，脚本未找到“读取可用工具”，未读取工具、保存配置或发送 AI 请求，不能称产品缺按钮。证据 `r14-mcp-discovery-workflow-attachments/ED92A8DC-6DCA-4BBA-969F-2CAAF0516EFB.png`。临时脚本补上仅限本轮 UUID 草稿的 Return 收键盘及字段归属唯一编辑器 ScrollView；真实 Swift 类型检查和 59 项纯矩阵通过，冻结 SHA `1b103517…3b56d`。新 runner 已编译，真实重跑待结果。
- r14 已从对话列表重开保留问题 `turn-1793730264836-1`，未重发；截图 `r14-chat-existing-expanded.png`。与同问题原生截图相比，泡泡宽度、答案行距、复制图标和“更多”入口存在待核差异；expanded sheet 顶边及思考时长还需核同状态和历史数据。已交独立 UI 溯源，不能记为问答视觉通过。

- r14 MCP 新 runner 真实运行 13.905 秒后停止在名称输入后的属性读取：全树 AX 仍有 focused 名称和空地址，脚本的 ScrollView/index locator 后代查询却为空。地址、Return、发现/保存均未执行；后续暂停该流程，退出本轮未保存 UUID 草稿。独立复核确认持有 index locator 跨树变化的假设不安全，但未证明实际发生索引互换。日志 `r14-mcp-discovery-keyboard-workflow.log` 与同名附件保留；不能归因产品发现失败。
- r14 PDF 自动用例停在选字前全量 64 个 StaticText 的活 AX 读取，稳定 toolbar/footer ID 后续也失效，App 根查询连续重试。Root 在 146.307 秒后只中断本次 xcodebuild，结果 `TEST EXECUTE INTERRUPTED`/exit75；没有长按，不算 PDF 功能失败或通过。随后用真实镜像手动长按同处原文成功显示四动作和蓝色手柄，分别打开四颜色新建调色盘后取消、打开引用“来说”的空笔记（保存禁用、无删除）后关闭、直接取消选文，均返回 41/514 页。四份 `r14-pdf-selection-manual-*.png` 为真实 simctl 截图；库仍 7/4/8/39，未保存标注。当前仅 RN 单词选区流程实证；跨页完整选文和同 PDF 同页 Native 视觉对照仍待验。
- r14 问答独立像素审计确认问题与答案四行字形二值 mask 共 46,575 像素零差异，答案行起点间距却为 RN28pt/Native22.5pt；问题泡泡295pt/263.5pt。顶部品牌灯图形已相同；复制/身份灯/chevron/服务盾牌偏小。`chat-visual-r14-audit/REPORT.md` 已分清真实几何、sheet未隔离变量和元数据差异，用时/“更多”/上下文数字不能硬凑。已分派普通正文间距及逐宿主图标补修、气泡 intrinsic 根因验证；未重新构建。

- r14 load-ready 四轮真实 A/B 已完成 1/1、304.178 秒、两个最终接受对象完全一致。A 实证空白 iframe 曾写成 0px，首次真章误得 2291 页；guard 后首次即 28388 页。timing 全调用 A76.435/B73.135 秒，同步 expand43.853/41.212 秒；counts 全调用仅差0.343秒，不混用或承诺稳定收益。全 body Range 是38—41秒主同步成本，另约30秒在浏览器异步阶段；探针新增的 fonts.ready await 不是产品打开屏障。新假设有源码支持：Foliate iframe 展至9,850,636px，而 Native 保持屏幕宽、内部滚动；仅首屏固定视口反证实验已准备，未改产品。证据 `r14-epub-load-ready-ab-attachments/` 及 `epub-wk-phase-diagnostic/analysis/`。
- 问答 F2 普通段落实际 Text 的 lineSpacing5、段前距/footer 与 F3 copy/identity 已补修；独立19输入×双平台38链、8组断言通过，并修复行内 code 固定 leading 和 nested hardbreak 两反例。最终 AssistantTurn SHA `ed78a423…05c2`，final5 392文件仅此产品文件变化，schema/metadata 冻结不变；新包尚未构建，chevron/盾牌仍待逐宿主探针。
- 问答 sheet 四格 UIKit 矩阵真实1/1、27.686秒通过，page/form × systemLarge/customMaximum 全部展开与重开 frame=[0,30,375,637]，不能用这两个变量解释旧截图10pt。Root随后从Native历史重开已有同题、展开并收起思考；两张当前Native截图与r14 RN三列纸色顶边均60px=30pt，当前差0pt，撤销F4产品阻断。旧图80px仍保留，原因未证实，不作补margin或改patch依据。`chat-sheet-detent-isolation/f4-current-measurements.json` 为独立逐像素证据。
- 气泡 UIKit/TextKit 初轮真实1项失败：47/72 plain candidate mismatch，large24/24匹配，但两组大字号的Native host仍保持large宽高，trait前置可疑；另有尾空格的 TextKit usedRect 与 UILabel.sizeThatFits 相差18.5pt的独立反例。通用max line.usedRect候选暂不合入。保留原红断言，新增显式host trait及实际字体记录、UILabel平台测量对照variant，尚未运行；不能固定263.5pt凑图。

- r14 fixed-viewport A/B 真实实验已完成，但未证实固定 iframe 宽度能解决首屏等待。goTo 区间 A41.963/B41.770 秒，其后的 fonts.ready-after-goTo 区间仍为33.851/32.486秒；该区间名称不证明字体下载或浏览器空闲。4张 WK snapshot 均为750×1294的全透明空图，不是产品黑屏，也没有首屏可读证明；字段等价与 harness PASS 不代替可见内容验收。证据 `.scratch/epub-wk-phase-diagnostic/analysis/fixed-viewport-ab-conclusion.md`。本轮未合入固定视口产品修复。
- 气泡 trait/UILabel 新变体已真实运行并保持红：1项测试、3项失败。非large的48条字体前置全部仍读到large，created/attached/layout/attributed font均15pt；explicit override与legacy两组72/72观测相同。当前不能用47项平台候选偏差否定UILabel.sizeThatFits，也不能据此通过或合入；固定字体控制组的度量吻合不代替前台trait、动态字号或RN实际气泡验收。证据 `.scratch/chat-bubble-intrinsic/r14-failure-analysis/TRAIT-RUNTIME-REVIEW.md`；前台宿主小样本源仅通过类型检查，尚未运行，未作产品修复。
- 下一步先按 `.scratch/epub-wk-phase-diagnostic/analysis/product-profile-plan.md` 采实际产品前台时间线：首个可读像素、ready、curl prepare各边界，以及归属明确的App/WK CPU采样。现有离屏实验没有这些产品profile结果，不继续把其透明快照或未覆盖span作为产品优化依据；本轮仅补充确证状态，没有新增产品修复。

- r14 MCP 已通过真实手动操作完成禁用读取提示→启用→发现唯一 parity_echo→允许→保存→重开；重开 AX 确认 enabled/allow 仍为1。禁用读取后全部本机计数与基线相同；完成发现并重开后 initialize/list 均1→2、initialized0→1，calls、rejected及全部AI计数不变。证据 `.scratch/parity-review-20261103/r14-mcp-manual-device-evidence.json`、`r14-mcp-manual-after-disabled-status.json`、`r14-mcp-manual-after-reopen-status.json` 与 `r14-mcp-manual-reopened.png`。仅证明发现、白名单及保存重开；AI调用确认的取消、批准和复用尚未执行，旧自动harness红记录保留。
- 前台独立 UIKit 新宿主 smoke 真实1/1通过、1.914秒；随后完整72样本气泡度量与三档symbol宿主用例真实2/2通过、7.813秒，日志分别为 `.scratch/chat-bubble-intrinsic/r14-failure-analysis/foreground-host-first.log` 和 `foreground-full72-symbol-r1.log`。这些是独立宿主运行结果，结果及截图的独立复核仍待完成；不能写RN产品气泡/图标PASS，也不撤销旧离屏harness红记录，本轮未据此修改产品。

- r14 巨章真实产品采样已完成：实际点击计时后，最后空帧为 +81.439—82.013 秒，第一张正文帧为 +83.441—83.610 秒；前段观察器超时，没有补造前段帧。Time Profiler 已保存及导出，但只覆盖点击后 69.990 秒，缺首屏前最后约 13 秒。候选 WK 主线程 Running weight29.922秒、24.973秒经过 updateRendering；94.49% leaf 缺可用符号，WK 对 Small 的所有权尚未确证，不能细分为 layout/paint/JS。完整结论 `.scratch/epub-wk-phase-diagnostic/analysis/r14-product-time-profile-conclusion.md`；后备真实产品 sample 脚本已准备，未运行，未合入性能修复。
- r14 Native PDF 同书同页41已真实对照：分页/临时滚动两种模式下长按同一“来说”均出现四动作，空笔记引用相同且保存禁用。发现 RN 选区手柄系统蓝、Native lamp棕，已仅补 `pdfView.tintColor = PdfAppearance.lamp`，浅深 token 与原生一致；Swift parse通过，新包颜色/主题/重建仍待验。Native 已通过 UI 恢复原分页、第39页并返回书架；未保存笔记。证据 `native-r14-pdf-41-{paginated-selection,scrolled-selection,empty-note}.png` 与 `.scratch/r14-pdf-selection-tint-fix.md`。
- r14 MCP AI 续测未发问：新 AI 草稿名称/URL 的 bulk 输入发生首字符移尾，replace 又未可靠清空，连续三次不符后停止该输入假设并取消草稿。原选择现场确认为“本机验收 · 使用中”；既有 owned MCP 保存结果保留。尚不能区分工具聚焦/选择区、IME、RN同步或AX观察问题，未改产品输入逻辑；取消、批准及同scope复用仍未验证。只读下一方案 `.scratch/r14-ai-input-diagnostic-plan.md`。
- r15 聊天候选已冻结：F2普通iOS正文 lineSpacing5；F3按真实前台三档glyph宿主尺寸改 right/down/shield，并将 reasoning glyph tint对齐ink3。独立72PNG解码与真实React主题/两状态复核通过，Android及tools其他chevron保留。最终 AssistantTurn SHA `02d703f7…96a1d`、ChatComposer `41174bab…e700e2f`；不能据此关闭实际RN像素验收。
- r15 用户问题候选新增通用 Expo UIKit文字测量模块，只接iOS无附件plain分支，以实际traits解析UIFont并两阶段测量、原子提交字号/宽高；旧TextKit尾空格反例不撤销。实际产品engine直接参与的72组前台对照真实1/1、4.503秒、0失败，`.scratch/chat-bubble-intrinsic/r14-failure-analysis/product-engine72-r1.{log,xcresult}`；Pod安装17秒成功，123依赖/130pods。尚未Expo编译/部署/RN页面验收，首帧旧cap布局可能收窄跳动，附件/quote/Android及旋转等仍待验。

- r15 Release 已真实成功并保留数据安装启动 Small PID44723：402源文件及5工程文件冻结全匹配，App SHA `850a24bd…31b1c21`、bundle `8f96ef8d…e8f3e33` 与安装包一致，实际仍7书/4标注/8对话/39消息；容器 `D5400F41-87BA-44A8-AD78-77D6900201FB`。全workspace typecheck通过，Expo adapter/anchor/engine实际arm64及x86_64编译。证据 `r15-source-freeze.json`、`r15-build-provenance.json`、`r15-installed-provenance.json`；安装前另存只读online backup `r14-before-r15-db-backup.sqlite`。
- r15 同既有问题从两边对话列表重开，large/XXXL/AXXXL 三档真图已齐、没有重发问题。large问题泡泡均[183,236,527,120]px，F1最终宽高对齐；用户第二行ink位置仍差1px。right/down/copy/shield局部RGB平移后相同，identity仍有差异。正文large行起点距RN46/Native45px，XXXL为RN50/Native57px，F2仍未关闭。large输入区divider RN1041/Native1073px，差16pt；AXXXL标题明显偏大、divider差38pt并裁掉更多问题末行。当前两边暂为XXXL；Small原始XXXL，Native原始Large，收尾须恢复Native Large。新修复交r16候选，不以局部通过宣告整页一致。
- r15 首次重开真实录屏已保存 `r15-chat-existing-first-entry.mp4`，实际CUA点击epoch1793749687052ms，但没有精确录像起点epoch，禁止将视频CMTime当点击时延。独立样本中actual7.986666667秒仍加载无bubble，8.015秒首次见bubble/答案，仍在sheet动画中；时间抽样含重复actual frame，不等于全源帧或无跳变证明。`.scratch/chat-r15-frame-audit/` 正在独立整理。
- r15 PDF同书41页重开后同位置选字，真实手柄已为lamp棕，四动作仍显示，截图 `r15-pdf-selection-lamp-light.png`；深色与重建仍待验。溯源发现Native PDF继承app外观，而RN独立reader theme覆盖app且PDF无主题UI，此为确定功能差异，修复交r16；未直写DB伪造深色。PDF新笔记空编辑器已聚焦，镜像键盘输入无效且未保存；准备最小XCTest定向输入继续，不把空笔记关闭当保存/重开通过。

- r15 首帧独立审计已确认先宽后窄：actual8.015秒bubble为[127,763,564,114]px，8.031667秒为[188,703,504,114]px；同帧sheet横截面均718px、右侧留白均39px，不能用整体平移或统一缩放解释60px收窄。后21个unique样本宽504—505px。证据`.scratch/chat-r15-frame-audit/bubble-geometry/`，保留精确录像起点缺失限制。F1首帧仍阻断，r16正在实现批量最终测量后提交。
- r15 PDF笔记已真实保存并重开：定向XCTest只向card内唯一note-body输入一次marker、核值后只保存一次，真实1/1、389.023秒、0失败；巨大PDF背景TextView的AX读取占多数测试时间，不能当保存延迟。Root实际UI重开看到引用“来说”、完整`PARITY-R15-PDF-NOTE-20261103`和删除按钮；SQLite只读确认唯一annotation `annotation-mw1dfimb-4`落盘，当前7书/5标注/8对话/39消息。证据`r15-pdf-note-save-owned-input.{log,xcresult}`、`r15-pdf-note-reopened-marker.png`、`r15-pdf-note-persisted-marker.json`。尚未验证杀进程后重开；随后仅关闭编辑器并返回书架，未再次保存或删除。
- 巨章当前flow已只读确证两端普通分页：RN无本书reader_preferences/legacy记录，Native本书pageCurl键不存在且scroll=false；证据`.scratch/epub-wk-phase-diagnostic/analysis/r15-{giant-flow-current-readonly,native-giant-flow-current-readonly}.json`。当前状态不能倒推历史run3模式。产品sample与单PID归属检查仍待运行，未合入性能修复。

- r16问答外观策略已独立源码准入：PDF问答/材料跟app，EPUB保留reader主题，presentation决定同会话重开外观；合法旧theme固定，无/非法theme保持跟app的旧动态合同。初版旧链接回归由独立before/candidate对照发现并修正，最终62项重跑及28组合独立入口对照通过；证据`.scratch/question-appearance-independent-review/REPORT.md`。PDF原两文件SHA未变，真实设备主题切换仍待新包。
- F2真实字体探针v1因强制宋体存在、遗漏Native既有system fallback而失败，未测到段落；原红保留。v2真实2/2、9.210秒通过，但Native三档15/20/42、RCT均20，因局部host traits并未证明改变RCT所用应用级category，不能据此改产品字号。相同20pt字体时UILabel baseline间距29pt、localTextKit25pt，NO/YES六组geometry及RGB相同；支持继续核实际产品段落，不支持盲改全局leading。独立`.scratch/chat-r16-f2-independent-review/REPORT.md`。F3图标UIKit三路线真实1/1、18.293秒，均同19×32墨迹，未复现Native页面23×35，下一步读实际页面对象，不以probe替代产品。
- 巨章r15真实sample run2已完成：+35.198秒开始45秒/10ms采样，主线程3752样本中2996（79.85%）经过`ContentfulPaintChecker::qualifiesForContentfulPaint`触发的paint遍历，布局链684且与前组无交集；named leaf98.85%，仍有43未知leaf。五个关键runtime UUID匹配。Root独立看frame40/41原图确认+80.001—80.185秒正文空、+82.001—82.162秒完整marker与首段可见，这是截图边界而非精确firstpaint。报告`.scratch/epub-wk-phase-diagnostic/analysis/r15-product-sample-run2-analysis-v1/conclusion.md`。PID74524虽为Small基线外唯一新WK，其App responsible未证；非交互procinfo因需密码失败，未扩大权限查询。线程样本数不当CPU秒，巨型iframe因果及性能收益尚未证。
- 巨章采样run1在点击后约10.131秒收到marker，被原5秒运输门槛拒绝，未启动sample；v2仅把运输门槛放至25秒、显式核armed下界，仍以真实点击epoch为原点并在+35秒迟到超过2秒时拒绝。原脚本/红/marker均保留。有限iframe+内部滚动的产品候选正在准备；不拆DOM、不改CFI，逻辑页数/两sentinel、Range/overlay/选择/curl坐标必须保持。新候选未进入产品包，不承诺性能通过。

## r16a / r16b 本轮增量证据（截至 2026-11-04 04:46 UTC）

以下是截至本节标题时间的历史快照；其中 A/B 尚未运行等判断已被上方“最新增量”覆盖，不能作为当前状态或运行队列。前文各轮失败、当时的未验证边界及 r15 产品红证据全部保留。本次仅整理已保存的原件，没有新增构建、设备操作或请求。完整来源 SHA256 见 [剩余总账的本轮来源核对](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/parity-remaining-20261103.md)。

1. **r16a A 已构建安装，内容身份与完整树身份分开。** `r16a-source-freeze.json` SHA256 为 `e6b990b2a1cc3ff6cd87497d64fe136dd07311a8872ffd64d2f8edf688b08cf5`；本次只读重算 451 项源码及 4 项原生构建配置均无漂移。canonical Release run3 成功且 exit 0。安装 reconciliation 的 `contentTreeEqual=true`，158 个常规文件内容相同；`fullTreeEqual=false` 继续保留。仅 `ExpoModulesJSI.framework/ExpoModulesJSI` 和 `hermesvm.framework/hermesvm` 的 mode 由构建包 0755 变为安装后 0644，字节不变，不能写为“全树相等”或推定 framework 实际加载已验。证据：[build run3 原日志](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/r16-unified-source-evidence/r16a-release-build-run3.log)、[安装 reconciliation](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/r16-unified-source-evidence/r16a-A-install-reconciliation.json)、[独立安装报告](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/r16a-install-independent-review/REPORT.md)。

2. **MCP run2 取消与允许已有实测，同进程复用未完成。** 取消轮真实点的是 MCP 确认“取消”，不是取消生成；允许前/取消后 `calls` 增量均 0，11 样本稳定 2031ms。允许轮真实点击“允许一次”，独有新 turn 为 `turn-1793764406100-2`；允许前调用增量 0、允许后恰 +1，11 样本稳定 2041ms，本轮成功正文和复制入口可见；复制动作本身未验。两个独立报告分别保留其归属与 receipt 边界。reuse 问题**未发送、未验证**：前置观察 receipt 为 Failed / 1 failed / 0 passed，`Test crashed with signal term.`；CoreSimulator 在 SimRenderingServices `Connection reset by peer` 后明确主动关闭 Small，原进程/scope 连续性中断。最初断连原因未知，不能据此判产品 App crash、特定 600 秒 timeout 或整个 MCP 完成。最新 run3 v2 已有独立 `SOURCE_ADMITTED_FOR_ROOT_BUILD_ONLY`（freeze SHA `98c4670e97554120dca8b463468ff9aa0dcea14f9a1083aebff14924d70df416`），运行与发送仍未验证；构建示例须遵守独审的 fail-fast shell 包装边界。证据：[取消报告](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/r16a-mcp-confirmation-device-run2/cancel-report.md)、[允许报告](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/r16a-mcp-confirmation-device-run2/approve-report.md)、[平台中断诊断](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/r16a-mcp-confirmation-device-run2/reuse-receipt-platform-interruption/REPORT.md)、[run3 v2 源码独审](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/r16a-mcp-run3-independent-review/V2-REPORT.md)。

3. **F2 第一 paragraph-max 候选停止，产品行距仍未通过。** 真实 global Large / XXXL 隔离执行分别 11.394 / 11.922 秒，category/可见性及原断言通过；独立原图却否证 mixed-size challenge：候选相对 UILabel 多高 21.5 / 43pt，首行大字体的 paragraph-wide minimumLineHeight 撑高后续无大字行，不能以 XCTest PASS 关闭 F2。22 组 default-disabled 完整 JSON/PNG 与原路径精确相等；两档共 10 组显式约束负控亦保持输入/输出。原 RCT code 灰背景下边多 11px 属另一个 paint 差异，不能当文字 baseline 下移；Large mixed 末行的原 RCT/UILabel 墨迹 y 区间实际相同。第二个 per-line `originalFontLineMetrics` 仅在 scratch 准备源码/工程/语法，尚未构建、链接、设备运行或接 Fabric。证据：[F2 独立运行报告](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/chat-r16b-f2-runtime-review/REPORT.md)、[mixed 原图澄清](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/chat-r16b-f2-runtime-review/ADDENDUM-mixed-original-raster.md)、[第二候选交接](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/chat-r16b-f2-line-fragment-prototype/HANDOFF.md)。

4. **F3 v2 probe 源码准入与 host 停止分别登记。** v2 freeze SHA 为 `eb153dbc8dd9187b744972ab28c0a4f90a58bbf7c737bd9ba177288c8e27c6d9`，独审仅准入 Root 的隔离正负控和真实 global 字号 probe。新增 runtime host 的准备脚本在 Ruby 版本、selector 转义和补丁工具文本解析三次失败后 STOP；本包未准入，既有工程不可执行，未 build/link/设备运行。1 正控、13 负控、Large/XXXL 尚未因此执行；这不能判定产品 F3 失败，也不能把 UIKit mirror 源码准入写成 Expo 挂载或像素通过。证据：[F3 v2 源码独审](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/chat-r16b-f3-independent-review/V2-REPORT.md)、[host STOP 记录](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/chat-r16b-f3-runtime-host/STOPPED.md)。

5. **同 route overlay 和 EPUB A/B 仍是开放项。** 源码已确认：背景 Agent 可在关闭问答后请求 MCP，仍 focused 的 route host 可能已展示真实 NoteSheet 或包住原生 PDF controls 的 RN pageSheet；现有 route-host 没有 overlay 注册/原生 presentation ACK。此为真实源码路径风险，尚无现场证据，不能选择性写成已正确叠放、必然挂起或产品失败。EPUB A/B 现场链及 launcher 仍未运行；r16a A 的 inline 声明为 flag0/default off，未把 B/flag1 效果当作产品收益。首屏、前后页、窗口迁移、尾搜索/重开与坐标链继续未验证。证据：[overlay 源码报告](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/r16a-mcp-overlay-source-review/REPORT.md)、[EPUB A/B 现场准备方案](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/epub-bounded-r16a-field-plan/README.md)、[A 安装身份原件](/Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/r16-unified-source-evidence/r16a-A-product-installed-identity.json)。

历史下一步（已被最新 r17 顺序覆盖）：统筹者先核对非问答范围内的 EPUB/PDF 阅读、PDF 外观及 owned 笔记前置；本节 MCP/F2/F3 记录只保留证据，不作为当前运行队列。当前动作见上方“当前设备顺序与下一动作”。

本轮非问答通过需要：当前范围对应的新 RN 包部署到 Small；与固定原生基线同内容同状态的截图和操作证据；书架、阅读、搜索定位、标注笔记/导出、通用设置无未解决功能或视觉差异；大文件、取消及重启恢复逐项通过。真实网络与真机专属证据按实际能力标注。AI 问答保留为后续重做计划及未通过项，不阻塞本轮非问答交付，也不能因范围调整被记作通过。不得把打开文件、构建成功、类型检查或非问答验收通过写成“整个应用完全一致”。
