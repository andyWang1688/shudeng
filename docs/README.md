# 书灯文档

书灯是一款以阅读为中心的个人阅读应用：读者遇到不懂的内容，可以直接提问、查看书内依据，并留下能继续讨论的问答记录。

**当前版本：v0.3.0。** 下载、安装、更新内容和验证边界见[新版说明](releases/v0.3.0.md)；[首版说明](releases/v0.1.0.md)保留历史证据。当前提供 Apple Silicon 的 iOS 模拟器包，真机与商店分发尚未验证。

## 从这里开始

| 你想了解什么 | 阅读文档 |
| --- | --- |
| 当前已经确定了什么 | [首发已确认决策](first-release-decisions.md) |
| 书灯是什么，适合谁 | [认识书灯](introduction.md) |
| AI 怎样结合整本书回答，RAG 和提示词是什么关系 | [阅读问答如何工作](how-reading-ai-works.md) |
| 首发做什么、不做什么 | [产品范围](product-scope.md) |
| 界面保留什么、优化什么 | [界面设计方向](interface-review.md) |
| 下一版界面按什么原则调整 | [阅读优先与渐进披露](adr/0010-reading-first-progressive-disclosure.md) · [#34 设计施工范围](https://github.com/andyWang1688/shudeng/issues/34) · [UIKit 开发规范](design/ui-development-standard.md) |
| 选文、对话、问答记录分别指什么 | [领域用语](../GLOSSARY.md) |

推荐先读“认识书灯”，再读“阅读问答如何工作”；理解产品不需要先理解向量数据库。

## 设计与技术

| 文档 | 内容与状态 |
| --- | --- |
| [阅读问答设计](reading-ai-design.md) | 当前有效：内置 multilingual MiniLM、本地向量与关键词候选合并、一次最终生成；[实施与验收 #21](https://github.com/andyWang1688/shudeng/issues/21) |
| [问答架构与开源项目对照](reading-ai-comparison.md) | 历史研究：当前只借鉴本地混合思路；旧补查等建议不属于首发要求 |
| [iPhone 本地检索候选](ios-rag-options.md) | 历史研究：模型、存储和中文检索的资料核验，不代表当前选型或验收结果 |

## 调研依据

以下报告基于固定源码快照，不等于运行验证，也不代表对应产品商店版本的能力。调研用于理解设计，没有将旧项目代码、提示词或资源导入书灯。

- [Anx Reader](research-anx-ai.md)：模型按需查目录、读章节和搜索原文。
- [Readest](research-readest-ai.md)：选文释义与整书聊天的区别，混合检索与可选工具路径。
- [Librum](research-other-reader-ai.md)：直接解释选文的实现及局限。

## 重要决策

决策记录保留“为什么这样选”，不替代当前产品范围。

| 决策 | 状态 |
| --- | --- |
| [独立实现](adr/0001-independent-implementation.md) | 当前有效：不复制旧项目实现，第三方组件分别审核 |
| [本机保存与完整备份](adr/0002-local-data-and-backup.md) | 已被下一条替代，不再作为首发要求 |
| [完整备份移后](adr/0003-defer-full-backup.md) | 当前有效：首发保留本机可靠保存，完整备份与云同步移后 |
| [Readium 与卷页适配](adr/0004-readium-reader.md) | 当前有效：成熟内核加独立适配，接受补丁维护成本 |
| [整书问答](adr/0005-book-question-answering.md) | 已被 ADR0007 取代，保留历史正文 |
| [收窄首发后台范围](adr/0006-bounded-background-generation.md) | 当前有效：支持几十秒目标，完整后台路线移后 |
| [简单本地 RAG](adr/0007-simple-local-rag.md) | 已被 ADR0008 取代，保留纯向量历史正文 |
| [本地混合检索](adr/0008-local-hybrid-retrieval.md) | 当前有效：本地向量与关键词合并，保持单次生成，不承诺完整概括全书；#21 技术验收通过 |
| [原生界面设计基准](adr/0009-native-ui-design-baseline.md) | 已被 ADR-0010 取代，保留历史正文和验收记录 |
| [阅读优先与渐进披露](adr/0010-reading-first-progressive-disclosure.md) | 当前有效：一页一件事、内容优先、长说明渐进披露；阅读控件收起时全屏 |
| [移除“仅已读”](adr/0011-remove-only-read-scope.md) | 当前有效：所有问答参考当前整本书，不再保存阅读范围元数据 |
| [AI 发送说明在配置时确认](adr/0012-confirm-ai-send-scope-on-setup.md) | 当前有效：保存或更换服务时提示，普通问答不逐次弹窗 |
| [固定正文与覆盖式阅读控件](adr/0013-fixed-reading-viewport-overlay-controls.md) | 当前有效：正文始终满屏，控件淡入淡出，点击不重新分页；取代 ADR-0010 的阅读控件显隐方式 |

## 怎样阅读文档里的承诺

- **已确认目标**：确定要解决的问题或首发范围，不表示功能已经完成。
- **方案建议／待确认**：正在讨论的交互或实现，不表示已批准选型。
- **源码事实**：在指定项目和提交中查到的行为，不表示运行效果已验证。
- **待验证**：需要真实书籍、模型或手机测试；在取得证据前不写成“支持”或“通过”。

当前决定汇总见[首发已确认决策](first-release-decisions.md)，功能范围见[产品范围](product-scope.md)；效果以实际验证记录为准。入门文档用于解释，不另行扩大承诺。

历史文档中的 `.scratch/` 路径指本地原始验收证据，不随公开源码或应用包上传；公开结论以关联的 GitHub Issue 及版本说明为准。
