---
status: accepted
date: 2026-11-09
---

# 用多文档 EPUB 引擎承载连续跨章滚动

原 Foliate registry 版本的滚动按单章节显示，在章尾手工调用 next/prev 会整屏替换，无法满足同一视口跨章的阅读合同。采用独立 MIT 的 Readest Foliate fork，固定整个提交，让成熟引擎负责邻章布局、预载、前插补偿与 CFI；书灯继续负责原生资源、保存、标注与交互适配。该选择扩展 [ADR-0019](0019-react-native-langchain-architecture.md) 的 Foliate 路线，没有引入 AGPL 的 Readest 应用代码。

相比自写连续排版，此方案减少自有基础设施；代价是整套引擎升级回归、srcdoc 平台适配，以及上游已读文档回收和超长章目录标题的限制。生产版本由包配置与锁文件固定；旧 patch 仅用于隔离原型对照。多文档使用边界见 [reader-web](../../packages/reader-web/README.md)，设备结果与未完成项见[验收](../validation/2026-11-09/continuous-epub.md)。
