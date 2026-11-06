---
status: accepted
date: 2026-11-02
---

# 以 React Native/Expo + TypeScript + LangChain 重建多端架构

## 背景

书灯当前的 iOS 版本是 Swift/UIKit 原生应用，约 16,800 行生产代码和 13,700 行测试。阅读器、PDF、标注、书内索引和原生 Agent 都绑定在 Swift 上，Agent 的工具循环、流式思考、上下文压缩和引用核对是项目自研实现。

继续在单端 Swift 上叠加 Agent 能力，会让每新增一层能力都增加未来多端的迁移成本。GitHub issue #57 决定启动架构重构，目标是：

1. 一套业务代码覆盖 iOS/Android，减少多端重复实现。
2. Agent 骨架使用成熟的 LangChain/LangGraph 生态，而不是继续扩写自研循环。

现有 Swift 版保持不动，作为行为基线、回退包和旧数据迁移参照。

2026-11-02 调整：产品决定 **iOS 优先**，Android 暂时搁置；架构方向不变，本文的 Android 证据保留为历史，不作为当前阻塞。用户已批准本 ADR，正式 iOS 迁移按 `docs/design/ios-rn-migration-plan.md` 执行。

## 决定（草案，待双端验收）

- 采用 **React Native/Expo + TypeScript** 作为共享应用层。
- Agent 使用 **LangChain.js + LangGraph.js**，在设备 Hermes 内运行；不引入 AI 服务器，模型请求仍由用户配置的供应商直连。
- `packages/core` 只放纯 TypeScript 领域、Agent、RAG、DB schema；禁止 import React Native/Node 专属运行时。
- UI 与平台能力通过注入的端口访问；`packages/core` → 无平台反向依赖。
- 阅读器业务与定位沿用 TypeScript；EPUB 使用 WebView + foliate-js，PDF 使用原生 PDFKit 平台能力。2026-11-03 用户明确要求 RN 版本在 iOS 上与原生基线具有相同功能、UI、交互和效果，取代原先“阅读器允许平台差异”的验收豁免。平台模块可以承载选字、PDF 和卷页视觉，但不能把旧 App 包装成 RN 页面代替架构重构。
- 界面只消费自定义 `AgentEvent`；LangChain 类型不出 Agent 模块。
- 旧数据使用版本化 `Anchor` 迁移，不直接用 CFI/新坐标覆盖旧 Readium Locator/PDF 坐标。

### 书架入口简化

用户明确取消 RN 书架的“继续阅读”卡片及其最近一本书偏好读写。搜索下方直接展示书籍网格，点书封打开；各书阅读进度的保存、恢复与展示继续保留。此项取代旧设计中对继续阅读卡片的要求，是用户确认的原生对照差异；旧原型、已发布版本的用户文档与原生基线保留为历史记录。

书架与笔记、对话统一使用 Expo Router 原生 Stack 的大标题和系统搜索栏（`placement: stacked`、`hideWhenScrolling: false`），让系统处理标题收缩及搜索交互。书架不再把页头、搜索框放进网格的滚动头部，也不新增手写吸顶动画；内容仍为两列书籍网格，导入置于系统导航工具栏。书架独立导航栈保持根路径 `/` 及 `/(tabs)` 的默认书架入口，取消搜索清空查询并恢复搜索前位置。

### 阅读问答前端（2026-11-04 用户确认）

- 采用 **assistant-ui 的 `@assistant-ui/react-native`** 作为阅读问答界面的基础，复用通用聊天组件与交互状态；应用框架仍为 React Native/Expo，范围不扩展到书架、阅读器和其他页面。
- 保留现有阅读内问答弹层，以及上拉展开到全屏、下拉收回和关闭返回阅读的交互；原生导航维护路由生命周期，窗口交互采用成熟的 Bottom Sheet 组件，assistant-ui 嵌入其内容区域。弹层内部的标题、消息、输入区、工具过程和引用布局允许重做。切换窗口高度不得重建对话、清空输入或中断回答；关闭面板仍不等于取消生成。
- 通过原生包导出的 `useExternalStoreRuntime` 适配设备内 Agent：将 `AgentEvent` 和已保存消息转换为界面状态，并连接发送、取消等操作。LangChain 类型继续封装在 Agent 模块内，不因采用 UI 库增加 AI 服务器或更换模型请求路径。
- 书灯负责提问选文、当前书绑定、书内依据与网页来源展示、引用回到原文，以及本地 SQLite 会话持久化。组件展示的操作必须由实际执行层支持；UI 能力不代表已经实现执行恢复或存储语义。
- 已接入原生包 0.1.51，采用官方 React Native Elements registry 的完整 `Thread`，保留消息、Markdown、Reasoning、工具展示、输入、发送与停止。2026-11-05 用户选择 Claude 风格，外观根据官方 Claude Web 示例适配 RN 手机：暖色主题、中文提示、固定底部多行输入和触控操作；这是本地原生适配，不是官方另行提供的 RN Claude 主题。源码与来源摘要位于 `apps/mobile/components/assistant-ui/`；书内选文、引用和设置通过附加插槽接入。
- 2026-11-05 用户截图确认 UIKit `formSheet` 的最大档仍露出阅读器工具栏，并明确要求复用现成组件。该选择取代上一轮系统卡片方案：采用 **`@gorhom/bottom-sheet@5.2.14`**，`['76%', '100%']` 固定两档、关闭动态增档，由组件处理松手吸附、回弹、把手、遮罩、滚动协作和键盘。透明全屏路由仅作为宿主，不编写自定义 Pan 手势、吸附阈值或键盘几何算法。最大档背景到容器顶部，安全区只用于内部把手与内容；不使用 `topInset` 给窗口保留外部空白。灯泡和品牌标题行移除，只留紧凑关闭入口与组件把手。输入和列表通过官方 `BottomSheetTextInput/BottomSheetScrollView` 接入，关闭 Thread 内部重复键盘避让；设备边界与手势验收记录在开发验收文档。

依据：[LangChain 官方集成文档](https://docs.langchain.com/oss/javascript/langchain/frontend/integrations/assistant-ui)、[assistant-ui React Native 文档](https://www.assistant-ui.com/docs/react-native)、[官方 Native Elements](https://www.assistant-ui.com/docs/react-native/elements)与[原生 external-store 示例](https://www.assistant-ui.com/docs/react-native/testing)。LangChain 文档中的界面示例使用 Web 包，RN 应使用原生包完成对应适配。

### 内置联网搜索（2026-11-04 用户确认）

- 首版采用模型服务商的内置搜索，沿用所选模型服务的地址、密钥和模型配置，不要求额外配置搜索服务，不新增独立搜索 API 或 MCP 服务。搜索由模型服务商执行，LangChain 负责接入。
- 复用 LangChain 对应服务商的内置工具支持。例如 OpenAI 搜索走 Responses API，Anthropic 搜索使用其服务端搜索工具；不同服务商分别适配，不将“OpenAI 兼容”视为支持内置搜索。
- 联网默认关闭，由每个模型服务单独保存，在该服务的编辑页开启；阅读助手设置只维护用户自定义指令。切换服务使用该服务自己的联网偏好，每轮发问固定配置快照。旧全局联网偏好仅一次迁到当时选中的服务，已有服务级偏好优先，不扩散到其他或未来新增服务。官方 OpenAI/Anthropic 端点使用各自的服务端搜索协议；自定义地址或中转服务缺乏显式能力确认时仅进行书内问答，模型名称不作为能力凭证。明确搜索能力错误且尚未输出内容时，本轮移除联网工具后重试一次；已有正文后不重复请求。鉴权、额度或一般参数错误保留其真实失败。
- 复用模型密钥不代表免费；AI 服务配置说明应覆盖搜索可能产生的费用。回答继续区分书内依据与网页来源，网页引用可打开出处。
- 服务商真实 SDK 的受控协议测试已覆盖开关、工具混用、来源、调用预算和错误降级；来源保存与重开使用真实 SQLite 验证。真实外网搜索质量、服务端计费及端到端设备操作须单独验收。

依据：[LangChain 服务商内置工具说明](https://docs.langchain.com/oss/javascript/langchain/tools#server-side-tool-use)、[OpenAI 内置搜索](https://docs.langchain.com/oss/javascript/integrations/chat/openai#web-search)与[Anthropic 集成](https://docs.langchain.com/oss/javascript/integrations/chat/anthropic)。

### AI 设置分组

“我的”保留一个“AI 与助手”入口，统一管理模型服务、助手自定义指令、本地语义资料与扩展入口。联网开关跟随具体模型服务；第三方 MCP 是额外扩展，与内置搜索分开，在“外部工具”次级列表管理。调整入口不删除已有工具配置、白名单、授权、密钥或会话；模型服务发送说明及 MCP 首次调用确认继续生效。

### RAG 重构（2026-11-04 用户确认）

本次 AI 重构包含 RAG。以当前书为范围，采用 Agent 调用检索与原文工具的方向，复用 LangChain BaseRetriever/Document、官方 Agent 循环及 Deep Agents 的 Memory/Skills。书灯维护本地 SQLite/ONNX 混合检索、定位、引用核对和已有上下文压缩策略。工具、规则/Skills、兼容边界与验收状态集中记录于[阅读 Agent 与 RAG 重构](../design/reading-agent-rebuild.md)。

用户确认阅读 Agent 的基础行为与人设支持自定义，以产品配置承载用户级统一指令（可按 AGENTS.md 表达）；与开发助手的仓库规则分开。Skills 指导检索策略，允许根据实际依据多轮搜索和原文读取，权限和资源边界由代码执行。

本方向取代 ADR-0007/0008 中对本次重构的“不引入工具 Agent、仅一次最终生成、不展开逐章取材”的限制；旧首发验收继续作为历史记录，不代表新方案已经通过。整书概括需要相应章节覆盖，材料不足时明确范围。

## 当前证据

本节以下为 2026-11-02 spike 的历史证据，不能替代正式迁移验收。2026-11-03 起的双模拟器基线、当前差异和验收状态统一记录于 `docs/design/2026-11-03/rn-native-parity.md`。类型检查或实现者测试通过，不代表功能、UI 和效果已经与原生一致。

已完成（2026-11-02 更新）：

- **iOS 原生**：Agent 事件链、SQLite/LangGraph checkpoint、WebView EPUB/PDF 渲染/选字/高亮、native ORT embedding（cosine=1）。
- **Android 原生**：同一 Agent 事件链、SQLite/checkpoint、EPUB WebView、native ORT embedding（cosine=1）均在 Debug emulator 通过；Gradle 使用 Aliyun 镜像，ORT Android 需显式 autolink + Gradle 9 patch。
- **V5 Node 业务闭环**：脱敏旧库迁移 → SQLite → 真实 ONNX 索引 → LangChain Agent 3 题引用核对，11/11 PASS；1000 chunk 索引 median **9.73s**，进程 max RSS **707MB**，查询 FTS/vector/hybrid p50 0–5ms。
- **V5 双端原生闭环**：dev route 在 Android Debug 和 iOS Release 模拟器均执行 SQLite→真实 ONNX 索引→SqliteBookSource→LangChain Agent→引用 E1 核对→answer，PASS（iOS 用临时 QA 重定向绕过系统深链确认框）。
- **真实 provider（iOS Hermes）**：开发路由从 App Documents 读取临时配置；本机代理 iOS PASS（reasoning 612 字、3 步、2 条引用），随后用户提供官方 key，官方 `https://api.deepseek.com/v1` 直接请求也 PASS（reasoning 853 字、3 步、2 条引用、HTTP 200）。生产需 SecureStore。
- **Release 构建 smoke**：iOS Release simulator app **179MB**（可执行 115MB）；Android universal Release APK **240MB**（debug signing）。按发布架构补充采样：iOS `iphoneos` Release（未签名，加入 PDFKit 后）**95MB**，Android arm64+minify/shrink APK **74MB**；Android Release Agent 闭环可运行，冷启动单次约 **1.15s**。


- `packages/core` Node Agent：LangChain `createAgent` + LangGraph、书内工具、引用核对、AgentEvent、DeepSeek reasoning 工具轮回传；core 测试 22+，eval 3/3。
- Expo/Hermes 打包：iOS/Android/Web 导出成功；Web 运行时同一 core Agent 跑通 reasoning → search_book → citation → completed。
- reader-web：foliate-js EPUB、pdf.js PDF；选字、CFI/归一化 rect、标注、深色；Expo WebView 接线与 CDP 验证。
- SQLite/Drizzle：共享 schema、迁移、Expo/Node 驱动、异步 LangGraph checkpoint saver；Node 与 Expo bundle 验证。
- 真实 ONNX embedding（Node）：MiniLM int8、384 维、中英/跨语言召回 5/5；RAG FTS5 + vector 混合。
- Expo ONNX 适配器：onnxruntime-react-native 1.24.3 + 纯 JS tokenizer，三平台 bundle 通过。
- **iOS 原生 ONNX 已验证**：用本地 pnpm patch 修复 RN 0.88 New Architecture 下的 legacy bridge 兼容（`patches/onnxruntime-react-native@1.24.3.patch`），模拟器 tokenIds 全等、cosine=1（对 Node 1.31.1 基线，bit 级一致）。代价是每次升级 RN/ORT 需要重验 patch；Android 仍需对应补丁（#33081）或替代执行器。
- **Embedding 执行器决策（近期）**：采用 `onnxruntime-react-native` + 本地 patch（A）；`onnxruntime-web` 纯 WASM 在 WKWebView 已验证（tokenIds 全等、minCos 0.99966），保留为 fallback；Swift SPM/TFLite/ExecuTorch/CoreML 不作为当前主路线。`EmbeddingProvider` 端口保持可替换。

未验证：

- iOS/Android 原生运行（CocoaPods/React-Core-prebuilt 网络阻塞；Android 无 SDK）。
- Android Hermes 上 ORT/tokenizer 内存/首 token/Release 表现；Android Debug 的 tokenIds/cosine 已与 Node 参考一致。
- 旧数据迁移、PDF 大文件/连续滚动、真机手势/坐标换算、checkpoint 清理生命周期。
- 真实 DeepSeek/Anthropic 网络请求、Anthropic thinking blocks 回传。
- **移动端索引/推理耗时、内存峰值、真实书问题集**：当前只有 Node/PC 基线；Release 包体已采样，明显高于 Swift 版，需进一步裁剪/按需下载评估。
- **引用点击回跳阅读器**：`initialLocation` 已从 route→ReaderShell→ReaderWebView→`reader:open` 打通，iOS 打开 EPub CFI 验证；真实 locator→CFI 映射与点击按钮未做端到端。
- **大 PDF（514 页/28MB）**：WKWebView 文件 URL、localhost HTTP、base64 三种方式均失败；改用 **react-native-pdf（iOS PDFKit）** 后打开成功，顶栏显示第 1/514 页，正文渲染正常。正式 reader 采用原生 PDFKit 作为大 PDF 路线；WebView 继续负责 EPUB/小 PDF。
- **未验证**：PDFKit 真机手势/缩放/内存峰值、页码跳转、标注坐标、Release 商店签名。
- **Anthropic** 官方 endpoint/thinking 回传未验证；**真实手指手势**未验证（无 GUI 触控自动化）；大 PDF 已由原生 PDFKit 打开 514 页。

## 进入正式迁移的门槛

- V1：iOS + Android 真机跑通同一 Agent（流式思考、工具循环、取消、引用）。
- V2：端侧 embedding/检索可用（iOS 已验证 native ORT；Android 需补丁/替代执行器），中文/跨语言召回有固定问题集证据。
- V3：真实 EPUB/PDF、旧数据副本迁移、标注坐标与回跳通过真机验证。
- V4：取消/断网/杀进程后的 checkpoint 恢复明确。
- V5：完整业务闭环 + 与 Swift v0.4.8 的包体/启动/内存/交互对照。当前只有 Node 闭环、双端分段通过和 Release 体积采样；**Release 体积：** 发布架构采样约 iOS 93MB / Android arm64 74MB（未签名/未商店分发），仍高于 Swift 版 33MB；需在迁移前决定是否接受并继续裁剪 ORT/RN 资源。
- 汇总通过/失败/未验证项，锁定阅读器、推理、checkpoint 驱动和依赖版本后，本 ADR 才可从 proposed 改为 accepted。

## 后果

- 迁移期间需要双线维护；Swift 版继续作为回退。
- 阅读手感、PDF 大文件内存、包体/启动可能回退，必须在真机验收中量化。
- “一套代码”不等于 100% 共享；PDF/标注/分享/通知等平台模块允许原生。
- LangChain 节省 Agent 编排样板，但 provider reasoning/tool 细节仍需适配层。
- 不引入服务端；跨设备同步、账号、远程 MCP 代理仍为后续独立决策。

## 备选

- Flutter + Dart + LangChain Dart：更接近原生自绘，但 LangChain Dart 生态较小、WebView 阅读面仍需桥接。
- 原生客户端 + TypeScript LangGraph 服务端：Agent 统一，但需要服务器，且不满足共享 UI 代码。
- 维持 Swift 单端：阅读手感最稳，但多端与 Agent 能力重复实现，迁移成本继续上升。

## 关联

- GitHub issue #57
- `docs/design/rn-langchain-spike.md`
- 现有 Swift Agent 契约：`docs/design/native-agent-runtime.md`
- 对照审计：`docs/design/agent-parity-audit.md`
