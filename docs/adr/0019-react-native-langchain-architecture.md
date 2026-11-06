---
status: accepted
date: 2026-11-02
amends: ADR-0004、ADR-0007、ADR-0008 的架构与 Agent 限制
---

# 用 RN/Expo 与 LangChain 共享应用和 Agent 业务

Swift 单端实现把阅读、存储与自研 Agent 循环绑定在一起，新增多端能力会重复建设。决定采用 React Native/Expo + TypeScript 共享应用层，LangChain/LangGraph 在设备内编排阅读 Agent，保留必要原生端口且由用户配置模型服务直连；相比继续扩写 Swift，此方案降低共享业务的重复成本，相比远程 Agent 则保持无需协调 AI 服务器的产品边界。

## 取舍与约束

当前 iOS 优先、Android 暂缓；旧 Swift 保留为行为基线、回退与数据迁移参照。EPUB 采用 Foliate/WebView 与原生资源/选文/阅读效果适配，iOS PDF 采用 PDFKit；平台能力不等于包装整个旧 App。代价是 RN/ONNX 依赖、桥接、包体和升级回归成本，阅读手感、定位和真实设备性能仍需独立验证。

阅读 Agent 允许多步查书与原文读取，问答采用 assistant-ui React Native 和成熟弹层组件，联网采用服务商内置能力。模块职责与执行合同分别维护在[架构](../architecture.md)和[阅读 Agent](../architecture/reading-agent.md)，避免 ADR 兼作不断追加的功能规格。

## 取代与证据

本决定取代 ADR-0004 对 RN 的 Readium/Swift 绑定，以及 ADR-0007/0008 的单次最终生成、禁止工具 Agent 和逐章取材限制；本地混合检索与可靠来源的意图保留。原生功能/UI/交互对照要求，及用户后来明确调整的差异，按[产品规范](../product-scope.md)和 [ADR-0020](0020-cross-platform-design-principles.md)执行。

accepted 表示方向获准，不代表迁移、真机、双端或发行通过。实际结果见[验收记录](../validation/README.md)，完整讨论与 spike 数字见[历史记录](../archive/planning/0019-rn-langchain-history.md)，背景任务为 [#57](https://github.com/andyWang1688/shudeng/issues/57)。
