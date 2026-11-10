# 当前 RN 产品的成熟组件复用盘点

状态：只读源码审计与建议，2026-11-09 归档。建议尚未实施；本轮没有构建、模拟器或真机操作，不构成设备验收。

结论：**成熟基础已经在用；需要收敛的是阅读引擎外围的补偿代码、通用确认/动作菜单，以及部分标准选择控件。** 书籍归属、原文位置、保存与生成生命周期应该继续由书灯实现。当前固定页头、搜索和底栏来自已确认的视觉基准，不能仅因它们是自定义组件，就认定为缺陷或要求整体改回系统外观。

## 范围与判断依据

审计以当前工作区为准，包含大量尚未提交的产品接线；不把 HEAD、旧 Swift 或 Demo 的状态代替当前源码。入口已核对：`apps/mobile/package.json:6` 使用 `expo-router/entry`；书架 `apps/mobile/app/(tabs)/(shelf)/index.tsx:1`；对话 `apps/mobile/app/(tabs)/conversations/index.tsx:1`；阅读 `apps/mobile/app/reader/[id].tsx:210,232` 分别进入 `ImportedPdfReader` 和 `ReaderShell`；问答由 `apps/mobile/app/book-chat/` 承载。

已阅读当前产品、架构、设计和文档维护规范，及 ADR-0019/0020。设计规范 `docs/design/ui-development-standard.md:84-93` 要求先复用成熟交互，允许有限样式和业务组合；它不要求把 RN 改写为 SwiftUI。`apps/mobile/src/ui/visual-demo/README.md:24-29,42` 记录了获确认的固定页头、搜索、底栏及分组方向；本报告保留该边界。

| 源码范围 | 本次如何处理 | 不由本次证明的内容 |
| --- | --- | --- |
| `apps/mobile/app/`、`src/ui/`、`src/reader/` 的当前入口及主要消费者 | 核对导航、书架、对话、单书标注、问答、设置和 EPUB/PDF 阅读路径 | 全部操作与失败路径、视觉一致性、可访问性实测、大库性能 |
| `components/assistant-ui/`、实际安装依赖的实现/类型 | 核对来源、真实挂载及现成 API，区分 registry 源码与自行重写 | 上游最新版与本地全部差异、升级兼容性 |
| `packages/reader-web/`、EPUB/PDF Expo 原生模块及 Foliate patch | 核对引擎、资源、选文、分页和补偿层边界 | 所有原生线程/内存路径、全部第三方内部实现 |
| `src/ui/visual-demo/`、`ios/Shudeng/`、`spikes/` | 识别为示例、Swift 基线或实验，不计入当前重复实现数量 | 不因退出产品路径就判定可以删除 |
| 存储/Agent/迁移实现 | 只检查 UI 所依赖的合同与消费位置；不做完整数据或 Agent 审计 | 检索质量、模型执行质量、迁移与事务的完整正确性 |

依赖核对来自 `apps/mobile/package.json:25-75` 与 `packages/reader-web/package.json:16-21`：Expo Router 58.0.29、Expo UI 58.0.26、assistant-ui RN 0.1.51、Gorhom 5.2.14、RN 0.88.1、RNGH 3.3.0、react-native-marked 8.3.3、Foliate 1.0.1。存在 `patches/foliate-js@1.0.1.patch`，下文明确区分现成能力与本地 patch。

## 已复用、应保留与可减少的边界

下表中的源码路径从仓库根目录计算；冒号后为本轮查阅的一基行号，后续编辑可能改变行号。

| 产品部分与源码证据 | 已经复用的成熟能力 | 书灯自己负责的部分与判断 |
| --- | --- | --- |
| 路由与 Tab：`apps/mobile/app/_layout.tsx:46-91`、`app/(tabs)/_layout.tsx:10-30` | Expo Router Stack/Tabs 管理路由、转场、分栏状态 | `src/ui/BottomBar.tsx:35-89` 自绘图标、标签、安全区和触控；不是自造导航栈。固定视觉获准，当前保留；未来如要系统栏，现有依赖有 NativeTabs，无需新写平台导航 |
| 主页面标题/搜索：`src/ui/components/PageChrome.tsx:7-67`；`ShelfScreen.tsx:454-482`；`conversations/ConversationsScreen.tsx:158-170` | RN TextInput、Pressable；父级仍是 Router Stack | PageHeading/PageSearch 只组合固定布局和清除操作，没有另写文本输入引擎。原生大标题/搜索被隐藏，但固定页头是已确认选择，属于可复用备选而非现有缺陷 |
| 书架：`src/ui/ShelfScreen.tsx:166-188,411-447,479-493`；`components/BookCover.tsx:2,60-67` | FlatList 网格虚拟列表、Expo UI MenuView 排序菜单、Expo Image 图片缓存 | 书名/作者匹配、排序、按字体/窗口改列数、移除/彻底删除的区别是业务。没有证据表明应换整套书架库；封面回退图和进度表现是产品呈现 |
| 按书分组的对话：`conversations/ConversationsScreen.tsx:40-76,166-255`；`conversations/model.ts:46-64` | RN SectionList、LayoutAnimation；没有把整组条目堆在自制 ScrollView 里 | 分组 ID、搜索匹配、折叠、预览 2/3 条和原地“查看全部”是产品规则。SectionHeader 只是行组合；不是必须引入 Accordion 库的问题。大库全量载入/查询策略另属数据审计 |
| 左滑管理：`conversations/ConversationsScreen.tsx:18-20,364-456`；`annotations/BookAnnotationsContent.tsx:15-17,462-605` | RNGH `ReanimatedSwipeable` 负责手势、阻尼、开关和滚动协调 | 右侧操作、一次只开一行、隐藏操作的读屏状态及删除确认是应用组合。两处可视为小范围公共行壳候选，但不是手搓左滑；不值得为“统一”再换原生列表 |
| 单书标注：`annotations/BookAnnotationsContent.tsx:226-236,283,323`；`src/reader/EpubNavigationPanel.tsx:134-145`；`src/reader/pdf/PdfReaderPanels.tsx:17-24` | Gorhom FlatList/TextInput；EPUB、PDF 与书架捷径共同消费 BookAnnotationsContent | 按当前书过滤、原文位置排序、完整搜索、导出全部记录、按 ID 合并写入结果属于书灯。不是让 UI 库接管标注保存或定位 |
| 问答展示与输入：`chat/ReaderAssistantThread.tsx:3-18,33-73`；`components/assistant-ui/elements/thread.aui.tsx:30-47` | 官方 assistant-ui ExternalStoreRuntime、Thread、消息/工具/推理 primitives、composer、send/stop 等 | 书籍绑定、选文、真实来源、保存、关闭仍生成与明确停止继续由应用处理。`components/assistant-ui/registry-manifest.json:1-9,66-72` 有上游 URL/源路径/下载 hash；源码位于项目内是官方 registry 的交付方式，不等于重复造聊天库 |
| 问答与阅读弹层：`components/AppSheet.tsx:9-16,66-117`；`chat/ChatSheet.tsx:23-37,63-87`；`reader/ReaderPanel.tsx:37-59` | Gorhom BottomSheet、Backdrop、Handle、Footer、两档 snap points、键盘协调 | AppSheet 的配色/圆角和顶部安全区插值是适配；ReaderPanel 的 Modal 用于覆盖底栏，非另一套吸附算法。NoteSheet 关闭丢弃、ChatSheet 关闭保留执行不同，不能为了复用合并为一个保存状态机 |
| 弹层里的聊天适配：`chat/AssistantSheetAdapter.tsx:18-32,63-100`；`chat/useChatListScroll.ts:26-39,89-121,137-157` | 用 BottomSheetScrollView/TextInput 接入库自己的滚动/键盘；assistant-ui 仍拥有消息和输入状态 | 页内引用跳转后恢复消息锚点与焦点，是书灯合同，当前无已核实的库 API 能完整代替。可将基础自动滚底交给库，但不能连恢复逻辑一起删掉 |
| Markdown：`components/assistant-ui/elements/markdown-text.tsx:18-25,38-64,154-168,270-307` | react-native-marked 的 Lexer、Tokenizer、Renderer、useMarkdown；不是自行实现 Markdown 语法解析 | 本地 task checkbox 适配、代码复制、字体主题和流式分块可维护为有限差异。文件明确说明跨块 reference link 不解析（270-272）；若它成为需求，应先核对上游整文解析或新版能力，不写更多正则补丁 |
| 通用提醒/确认/动作选择：`components/BookNotice.tsx:33-107`、`BookActionSheet.tsx:30-103`、`conversations/ConversationRenamePrompt.tsx:6-46` | 仅使用 RN Modal/Animated 等底层原语 | 三处各自维护 visible/closing/pending action、入退场、减少动效、卸载、dismiss 后调度；这里确有超出业务的重复基础设施。标准场景可委托 RN Alert/ActionSheetIOS；不能丢掉当前关闭后才能打开下一层的时序保证 |
| 设置：`settings/SettingsParts.tsx:13-57,59-79,112-151,164-238`；`settings/AIServiceEditor.tsx:3-12,123-140` | 已用 RN TextInput、Switch、Alert 与 ActionSheetIOS；showSettingsChoices 已有平台分支 | SettingsHeader/Section/Row 自绘导航和分组；不是全部表单从零造。服务验证、密钥、发送同意和保存失败保留内容属于业务，不能交给系统 Form 就删掉 |
| 标准分段选择：`reader/ReaderNavigation.tsx:14-48`；`reader/ReaderPanels.tsx:63-89,131-151` | 当前是 Pressable/Text 手绘选中状态，底层未用 SegmentedControl | 目录/书签/标注、明暗主题等适合现成分段控件；阅读方式有“仿真不可用时只禁用一项”的特殊情况，不能忽略控件 API 限制直接替换 |
| EPUB 引擎：`packages/reader-web/src/epub-reader.ts:1-4,74-76,100-132,313-320,692-705,863-894` | Foliate EPUB/view/paginator、CFI、prev/next、flow、annotation/Overlayer；WebKit DOM 选区 | 主引擎已经复用。书灯的 locator 兼容、来源核验、笔记波浪线和持久化是业务适配；外围零尺寸恢复、静态补画、bounded viewport patch、快照协调应单独收敛，不能据目录体积声称自研整个阅读器 |
| EPUB 原生呈现与资源：`src/reader/NativeEpubSurface.tsx:14-16`；`modules/shudeng-epub/ios/ShudengEpubModule.swift:151-176,237-252`；`EpubResourceScheme.swift:10,31-37,89-100` | WKWebView、WKURLSchemeHandler、UIKit UIPageViewController.pageCurl；归档模块也保留 Readium 来源声明 | 文件按资源供应、会话身份、释放顺序、取消和 Curl 快照的 CFI 对齐没有 RN 通用控件可直接取代。把正式文件交给 WebView 的整档 Blob/base64 会丢失现有资源合同 |
| PDF 引擎：`src/reader/ImportedPdfReader.tsx:125-145`；`pdf/NativePdfSurface.tsx:26-28`；`modules/shudeng-pdf/ios/ShudengPdfModule.swift:2,57-96,247-253,491-493` | PDFKit 的 PDFDocument/PDFView、选区、缩放、页面和 selection(for:)；搜索匹配委托 NSString | PDF 的原文坐标、扫描页判断、取消/异步失效是适配。装有 react-native-pdf 不表示当前 iOS 在使用它；未找到当前 TS 产品代码导入该包，不把它当作可立即替代 PDFKit 的证明 |
| 选文动作菜单：`src/ui/ReaderShell.tsx:229,271-281`；`ui/reader/SelectionBar.tsx:17-47`；`modules/shudeng-pdf/ios/ShudengPdfModule.swift:491-549,887-921` | EPUB 实际选区来自 WebKit；PDF 选区和矩形来自 PDFKit | EPUB RN 气泡与 PDF UIView 气泡各自算避让、位置、按钮与外观；PDF 还屏蔽系统 canPerformAction。这是通用菜单呈现的自研。高亮/笔记/提问的业务回调应保留，平台菜单可评估委托 UIEditMenuInteraction，但接入并非即插即用 |

## 只保留五个优先项

### 1. 先验证连续跨章引擎，同时收敛外围补偿层

**优先级：P1，先做有证据的复现和对照，暂不自动替换引擎。** Foliate 已经负责翻页、滚动与 CFI；`epub-reader.ts:313-320` 的 next/prev 已直接委托它，不能再提一次“改用 Foliate next/prev”充当改造。

当前单章替换未达到用户要的连续跨章体验。[配套研究](2026-11-09-continuous-epub-scroll.md)已核验 Readest 的独立 MIT Foliate 分支具有多文档连续排列和预加载；先锁定提交做独立原型，再决定接入范围。该候选与当前主仓能力分开判断，书灯的 CFI、资源通道、标注、内存与原生 curl 仍需逐项验证。

真正值得收敛的是 `epub-reader.ts:170-254` 与 `epub-viewport.ts:57-135` 的零尺寸修补和最多 260 字静态恢复层，及 `patches/foliate-js@1.0.1.patch:11-75` 修改 paginator 的 bounded viewport 实验。后者通过 `epub-viewport.ts:1-2` 的构建开关与 `epub-reader.ts:876-883` 启用，不能把候选开关默认当成正式全量启用，也不能把自定义 attribute 称为 Foliate 官方能力。

可核实现成接口在安装的 `foliate-js/view.js:418-458,500-510`：getCFI、resolveCFI、goTo、goToFraction、prev/next、goLeft/goRight；`paginator.js:935-975` 有自己的分页触摸与吸附，`paginator.js:1138-1192` 有跨章节移动。书灯滚动边缘手势 `epub-reader.ts:717-756` 只检测章边界并调用引擎 next/prev；Foliate 的 `#onTouchEnd` 在 scrolled 下直接返回（968），现有证据不能证明这个适配完全多余。

下一轮应使用已知失败书和原始 locator，在相同 WKWebView、窗口、字体和 flow 下比较原版能力与本地补偿，并同时验证可见文字、选文、标注和引用回跳。静态补画层能显示文字不等于原文 DOM 已可交互；替代成功证据必须包含真实触控。当前没有核实某个上游版本已解决这些边界，因此本报告不推荐直接升级、删除补偿或换 Readium。

### 2. 收敛通用确认与菜单，业务条件留在调用者

**优先级：P1，标准场景先行。** BookNotice、BookActionSheet 和 ConversationRenamePrompt 重复维护关闭/动画/待执行动作。`settings/SettingsParts.tsx:59-79` 已示范现成选择器的使用，不需要引入一套新 Dialog 库。

候选 API 是 RN `Alert.alert`、iOS `Alert.prompt` 和 `ActionSheetIOS.showActionSheetWithOptions`；动作选择也可复用已经在书架排序使用的 `@expo/ui/community/menu` MenuView。Alert 负责提示与确认，ActionSheet 负责选择动作，菜单不代替彻底删除的二次确认。选文方面单独做 iOS 小范围验证：复用 `UIEditMenuInteraction` 呈现自定义业务 actions，并保留 PDFKit/WebKit 的原选区和准确来源。

真实限制：Alert.prompt 仅 iOS；Android Alert 最多三个按钮；iPad ActionSheet 需要 anchor；RN Alert 的 JS 回调不自动等同于当前 Modal.onDismiss 所代表的 UIKit 完整关闭时点。BookNotice 的 onShow/onCloseStart/onDismiss、MCP/AI 同意弹层的宿主深度和一次执行合同都不能直接删。选文的 WKWebView 文档坐标到宿主坐标、跨页 PDFSelection、旋转、长选文、系统菜单与正文手势冲突，需要平台测试。标准 API 会改变部分纸卡外观，因此本项是具体场景替换建议，不是宣布现有基准无效。

### 3. 用已安装的原生选择控件替代小块标准手绘状态

**优先级：P2，先做目录分栏或主题选择这一类小控件。** `@expo/ui@58.0.26` 已导出 `@expo/ui/community/segmented-control`；实际 `types.tsx:21-43` 有 values、selectedIndex、enabled、onChange/onValueChange。`SegmentedControl.ios.tsx:15-63` 使用 Host + SwiftUI Picker(segmented)，Android 有本地实现，Web/default 有 vendored 实现，无需新增依赖。

适合替代 `ReaderNavigationTabs` 和无特殊禁用项的主题选择；业务仍传入稳定值和回调。当前 community API 只有整体 enabled，没有每项 disabled，所以“分页/滚动/仿真”中仿真单独不可用（ReaderPanels.tsx:65）需要继续适配或用支持子项 disabled 的平台 Picker；不能盲目对齐样式后丢掉功能边界。Gorhom 中的搜索与编辑仍应使用 BottomSheetTextInput，普通原生 TextField 不自动接上它的键盘协议。

### 4. 设置先减少重复壳，平台 Form 作为局部候选

**优先级：P2/P3，按页面逐步评估。** SettingsParts 已做一次公共组合，其体积本身不是换库理由。高价值边界是通用 header/section/row 与业务 draft/save/consent 分开；不应在每个设置页再写一套返回、分隔线、选择器和确认动画。

当前 Expo UI 确有 SwiftUI Host、Form、Section、LabeledContent、Picker、SecureField/Toggle 等导出。可以选择一个纯设置分组比较系统 Form 的效果，但 SwiftUI Form 属于 iOS 端口，不能称作所有端共享的替代；Host 的尺寸、安全区和键盘也要核对。`Host/index.tsx:11-67` 明确提供 matchContents/useViewportSizeMeasurement/ignoreSafeArea，不是把 RN Children 原样包进 Form 就完成。当前输入、开关、服务测试等已用成熟原语；并不建议为了设置分组外观重写整个表单或新增表单依赖。

### 5. 保留已确认页面视觉与已接入的成熟骨架，限制后续分叉

**优先级：维护规则，当前不做整体 UI 替换。** PageHeading、PageSearch、BottomBar、ReaderChrome 的有限布局/主题是产品呈现；FlatList/SectionList、Swipeable、assistant-ui、Gorhom、Markdown、Foliate/PDFKit 已在工作，优先保持它们的责任。

未来明确需要系统大标题、原生搜索或系统 Tab 时，当前依赖足够：Expo Router 的 `native-stack/types.d.ts:213-223,378-383` 有 headerLargeTitleEnabled/headerSearchBarOptions，要求滚动容器正确使用 contentInsetAdjustmentBehavior；SDK 58 的稳定入口是 `expo-router/native-tabs`。`native-tabs/types.d.ts:533-562` 支持 disablePopToTop、disableScrollToTop、disabled，能表达当前重复点击与导入锁的一部分规则；disabled 仅拦原生点击，JS 导航仍需业务守卫。切换会改变已确认固定页头及底栏外观，应作为明确设计调整，不是“成熟组件优先”推出的自动结论。

assistant-ui 采用 registry 源码本就允许本地编辑，后续把上游通用差异留在 manifest/README，把书籍来源与选文扩展留在 `src/ui/chat/`，不要重新另写聊天消息、composer 或 Markdown 引擎。

## 未用、兼容和生成路径的区别

| 路径 | 当前结论 | 后续处理边界 |
| --- | --- | --- |
| `src/ui/visual-demo/` | 独立入口、示例状态、无正式数据库/AI；README:15-19 明确边界 | 用于视觉基准；不能把示例的自绘交互数量算进当前产品重复基础设施 |
| `ios/Shudeng/`、Vendor/Readium | Swift 基线、回退和迁移参照 | 不因为 RN 已接入就清理；本报告未做旧 App 全量可达性分析 |
| EPUB/PDF 的旧原生 Chrome/Navigation/Panel | 当前 TS 包装接线已删除，当前阅读进入 RN ReaderChrome/ReaderPanel；Swift 模块仍注册这些 view（ShudengEpubModule.swift:35-57；ShudengPdfModule.swift:109-131） | 可作为后续定向可达性/包体审计对象；不能声称两套当前同时挂载，也不能仅搜索不到 TS import 就直接删除整个原生文件 |
| `packages/reader-web/src/main.ts:1-7`、`pdf-reader.ts` | Web 开发入口注册 PDF.js；移动端 `main-inline.ts:1-6` 只加载 EPUB | 不把 PDF.js 与正式 iOS PDFKit 算作双引擎重复生产路径 |
| `readerWebHtml.ts`、`readerFixtures.ts` | build:inline 生成物，README:9-17 有生成入口 | 不手工整理大段生成源码，也不按重复行数推断自研程度 |

## 可复查的 API 来源

| 能力 | 官方来源 | 当前依赖核对与边界 |
| --- | --- | --- |
| Expo Stack、系统搜索 | [Expo Stack](https://docs.expo.dev/router/advanced/stack/) | `apps/mobile/node_modules/expo-router/build/react-navigation/native-stack/types.d.ts:213-223,378-383`；已核对真实导出。iOS 大标题与 inset 要联动，不能只改一个 boolean |
| Native Tabs | [Expo Native tabs](https://docs.expo.dev/router/advanced/native-tabs/) | 文档明确 SDK 58 用 `expo-router/native-tabs`，54-57 才用 unstable 入口；本地 `build/native-tabs/index.d.ts` 与 `types.d.ts:533-562` 匹配 |
| Alert 与 prompt | [React Native Alert](https://reactnative.dev/docs/alert) | `react-native/Libraries/Alert/Alert.js:94-109,173-188`；prompt 为 iOS；Android 最多三按钮 |
| 系统动作面板 | [React Native ActionSheetIOS](https://reactnative.dev/docs/actionsheetios) | `ActionSheetIOS.js:19-31,65-80`；支持 cancel/destructive/disabled 索引和 iPad anchor；不是跨端通用菜单 |
| Expo 原生控件 | [Expo UI](https://docs.expo.dev/versions/latest/sdk/ui/) | `@expo/ui/package.json` exports 与 `src/community/segmented-control/types.tsx:21-43`、`SegmentedControl.ios.tsx:15-63`、`swift-ui/Form/index.tsx:6-25`、`swift-ui/Host/index.tsx:11-67`；在线 latest 推荐 patch 版与本地 58.0.26 可能不同，以本地核对 API 为准 |
| assistant-ui registry | [React Native Elements](https://www.assistant-ui.com/docs/react-native/elements) | 官方说明以源码安装、允许编辑；本地 registry-manifest 有路径与来源 hash，hash 证明下载来源，不证明后续本地文件未改 |
| Gorhom 键盘接入 | [BottomSheetTextInput](https://gorhom.dev/react-native-bottom-sheet/components/bottomsheettextinput) | 本地 `AssistantSheetAdapter.tsx:63-100`、AppSheet:101-117 已接入；换普通输入框会丢掉预集成键盘协作 |
| iOS 编辑菜单候选 | [UIEditMenuInteraction](https://developer.apple.com/documentation/uikit/uieditmenuinteraction)、[其 delegate](https://developer.apple.com/documentation/uikit/uieditmenuinteractiondelegate) | Apple 页面本轮只获取到入口标题，未取得完整参考正文；因此列为需要原生小范围验证的候选，未证明可直接替代书灯完整菜单坐标与生命周期 |
| Foliate 阅读能力 | [Foliate 源码](https://github.com/johnfactotum/foliate-js)；当前安装 `view.js:418-458,500-510`、`paginator.js:935-975,1138-1192` | 本轮以安装实现核实能力，并对照本地 patch；未核验远程最新版是否修复长章/WebKit 问题，不据此提升级承诺 |

本次完成证据是入口、消费者、依赖实现/类型与官方资料的交叉核对。未运行类型检查、自动化测试、构建或设备操作；旧验收记录不自动变成本报告的通过结果。本次只新增此研究文件，没有修改生产代码、依赖、数据、模拟器或恢复资料。
