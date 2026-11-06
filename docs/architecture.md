# 架构与模块边界

本文说明当前模块如何协作、数据由谁拥有，以及改动时必须保护的边界。技术路线来自 [ADR-0019](adr/0019-react-native-langchain-architecture.md)，业务后果来自[产品规范](product-scope.md)；实现与验收状态不由本页推定。

## 架构背景

共享应用层采用 React Native/Expo + TypeScript；LangChain/LangGraph 承担设备内阅读 Agent 编排。当前 iOS 优先，不引入协调 AI 服务器，模型请求直达用户配置的服务。iOS 的阅读、选文、PDF 与文件能力允许原生适配；未来平台复用业务合同，各自实现平台端口。

旧 Swift App 保留为行为基线、回退包与数据迁移参照。架构重构应让业务进入共享层，不能将旧 App 整体包装成 RN 页面充当迁移完成；也不能因目录名旧就删除仍被消费的兼容实现。

## 模块职责与依赖方向

| 位置 | 职责 | 改动边界 |
| --- | --- | --- |
| [apps/mobile/app/](../apps/mobile/app/) | Expo Router 路由、页面与导航栈组合。 | 不在路由内实现检索、存储或模型协议。 |
| [apps/mobile/src/ui/](../apps/mobile/src/ui/) | 产品 UI、页面状态与业务适配。chat 管选文/引用/上下文展示，navigation 管同类页面导航搜索。 | 组件接入业务操作，不直接拥有模型密钥或实现检索算法。 |
| [assistant-ui 组件](../apps/mobile/components/assistant-ui/README.md) | 官方 registry 的通用聊天交互及有限 RN 适配。 | 本地差异与来源有记录，书灯业务扩展留在 src/ui/chat。 |
| [apps/mobile/src/platform/](../apps/mobile/src/platform/) | 本机文件、密钥、数据库初始化、执行器及平台接线。library 管书籍/会话，settings 管配置，ai 绑定当前书与 Core。 | 将运行时能力注入共享层，维护异步失效和资源生命周期。 |
| [packages/core/src/](../packages/core/src/) | 领域类型、Agent、RAG、数据库策略与迁移。 | 共享策略不依赖 UI/移动端；Node/Expo 专属执行器走独立驱动或明确子路径，不能泄漏到共享入口。 |
| [packages/reader-web/](../packages/reader-web/README.md) | EPUB/Foliate 内容渲染、位置与宿主消息协议。 | 正文渲染和产品窗口分开，不负责密钥、对话或书库持久化。 |
| [原生模块](../apps/mobile/modules/)与 [Expo 插件](../apps/mobile/plugins/) | ZIP 资源、PDF、选文与平台阅读效果，声明可再生成的原生接线。 | 平台能力通过显式接口承载；不手改 Pods/prebuild 产物作为正式修复。 |
| ios/、spikes/、patches/ | Swift 基线、隔离实验、已声明依赖补丁。 | 实验与正式入口分清；补丁需保留原因和升级验证路径。 |

依赖关系是 UI/路由 → 应用接线 → 共享领域与端口；平台执行器实现端口并由应用装配。运行时 SDK 类型封装在模块内，UI 通过应用定义的 AgentEvent 与会话适配层消费状态，存储也不直接依赖某版 SDK 的完整对象形状。

## 两条主要数据路径

### 导入与阅读

文件导入先取得可校验的本机书籍，再准备正文、位置及可用索引；阅读不以整书语义索引完成为前提。EPUB 正式文件通道遵守[逐资源合同](architecture/epub-resources.md)，不把整档 base64 或 Blob 当大书方案；iOS 正式 PDF 走原生 PDFKit，reader-web 的 PDF.js 实验不代表正式 PDF 引擎。

阅读器输出的选文、位置、书签和标注通过宿主与共享数据层关联。字号、窗口和阅读模式改变显示页数时，以原文位置恢复；相同文字、同名章节、相同屏幕页码均不能独立证明定位正确。精确度不足须保留近似/章节级说明，不静默声明精确。

### 提问与回答

应用固定当前书、提问选文、对话和配置快照，注入 BookSource、模型与本机持久化能力。Agent 按规则调用有界查书工具，事件经适配进入聊天 UI；上下文压缩、工具预算、取消和引用核对属于执行链，不能由页面可见性替代。

原文与网页来源按不同类型保存。窗口关闭不停止生成；执行结束、取消、中断、保存失败分别反映真实状态。详细工具与来源合同见[阅读 Agent](architecture/reading-agent.md)。

## 数据所有权与保存

| 数据 | 所有者与保护边界 |
| --- | --- |
| 书籍原档与派生资源 | platform/library 管文件，Core 管元数据与来源；原档、缓存、索引的可重建性不同，删除规则分别处理。 |
| 进度、标注、消息、引用 | 共享数据库 schema/store 与迁移维护一致性，平台层组合文件/数据库操作；UI 不能绕过既有保存、删除和串行边界。 |
| 模型与工具密钥 | 平台 SecureStore 管理，见 [aiConfig.ts](../apps/mobile/src/platform/aiConfig.ts)；不从 Documents 明文配置作为正式运行入口，不落日志或测试报告。 |
| 助手偏好与联网开关 | 分别由助手偏好和服务配置拥有，运行开始取快照；迁移范围与失败处理见 Agent 契约。 |
| LangGraph checkpoint | [checkpoint-saver](../packages/core/src/db/checkpoint-saver.ts)维护执行状态；有存档不等于支持强杀后自动恢复或后台继续。 |

保存、删除、旧迁移与异步回调可能竞争。沿用现有事务、操作序列、文件意图恢复和失效检查；已删除对象不能因较晚返回的请求、旧迁移标记或补写元数据复活。移除书籍与彻底删除的用户后果按产品规范区分。

## Swift 数据迁移

迁移以用户提供的旧数据副本为输入，不修改旧 App 原始数据或输入源文件，不写回旧 App。迁入 RN 沙盒的副本目录允许写入迁移状态标记（如 Documents/legacy/.imported），这不等于修改源书籍或旧 JSON。保留书籍、标注、问答及定位关联，不把旧 Readium locator/PDF 坐标直接覆写为新坐标；通过版本化 Anchor 与明确映射承接。

[legacyMigration](../apps/mobile/src/platform/library/legacyMigration.ts)组织数据库、文件和清理意图，[Core migration](../packages/core/src/migration/)解释旧数据。数据库事务是已完成写入的依据；文件复制校验与后续恢复仍需处理，不能仅凭一个 marker 假定全流程成功。重试不重复导入、不恢复用户已删除记录；部分成功和失败原因必须可诊断，原始副本保留。

旧索引、embedding 模型与来源位置需要兼容判断。相同向量维数不证明同一向量空间，重复原文不证明同一来源；可重建的索引允许重建，唯一用户数据不能按缓存重置。

## 复用、依赖与生成文件

组件围绕稳定职责和真实重复需求抽取，页面负责组合业务；保留不同任务的生命周期差异，不为复用把笔记保存、聊天草稿和生成取消合成一套状态。原生能力、共享策略和纯 UI 之间的接缝应能独立验证。

依赖版本以 package.json、pnpm-workspace.yaml 和锁文件为准；原生依赖及补丁升级须验证实际目标运行时。Node 测试通过不能证明 Hermes、Expo、WKWebView 或 PDFKit 的行为。开发检查、Node SQLite/ONNX 与实验路由不进入产品公共运行路径。

reader-web 的生成资源由模块脚本重建，不手改 readerWebHtml/readerFixtures。构建与磁盘配额读[资源规则](agents/resources.md)，改动步骤及验证选择读[开发规范](agents/development.md)。

## 改动时的核查场景

| 接缝 | 至少核查的风险 |
| --- | --- |
| 文件/数据库操作 | 删除与导入竞争、中途失败后恢复、重试是否重复或复活记录。 |
| 定位/索引 | 重复段落、不同内容版本、旧 locator、切换字号或模式后回跳。 |
| 平台/依赖 | 实际 Hermes/原生导出、资源释放、取消与插件重建；不能只看 Node 包可用。 |
| UI/执行 | 弹层切换与卸载、流式回答、输入保留、明确停止和保存失败。 |
| 旧数据/密钥 | 只读旧副本、可诊断部分失败、密钥位置与日志去敏。 |
