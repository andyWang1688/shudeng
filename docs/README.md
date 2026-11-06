# 开发文档导航

从本页选择本次任务的阅读路径。导航帮助找到依据，主题正文保留正确开发所需的背景、合同、异常与验证方法；根据任务继续展开，不要求每轮通读所有资料。

## 当前范围与阅读路径

书灯已完成独立示例 Demo 的整体视觉确认，进入产品 UI 与既有业务接线阶段；功能范围保持冻结。以 [Demo](../apps/mobile/src/ui/visual-demo/README.md)为展示基准，保留现有阅读、保存与执行合同。产品范围获准、源码已经实现、验收通过和正式发布是不同状态。

| 本次任务 | 主要正文 | 按需要继续读取 |
| --- | --- | --- |
| 理解或改变产品行为 | [产品范围与行为规范](product-scope.md) | [领域术语](../GLOSSARY.md)、[决策索引](adr/README.md)；有分歧先区分需求与实现现状。 |
| 业务、数据、迁移或平台接线 | [架构与模块边界](architecture.md) → [开发与验证](agents/development.md) | 所涉模块 README；EPUB 文件通道读[资源合同](architecture/epub-resources.md)。 |
| 阅读 Agent、RAG、上下文或 AI 配置 | [Agent 开发契约](architecture/reading-agent.md) | 按契约加载项目 LangChain 技能，核对对应的[验收记录](validation/README.md)。 |
| 页面、组件、交互或视觉 Demo | [跨端界面设计规范](design/ui-development-standard.md) | [Demo 运行与边界](../apps/mobile/src/ui/visual-demo/README.md)，平台官方规则按当前主题查询。 |
| 构建、清理或发布 | [资源规则](agents/resources.md)，发布再读[发布流程](agents/release.md) | [版本记录](releases/)与 delivery 中对应交付材料。 |

根 [AGENTS.md](../AGENTS.md)是协作入口。[文档维护规范](agents/documentation.md)说明术语、规格、ADR 与历史资料的分工；操作 GitHub 任务读 [Issue 约定](agents/issue-tracker.md)，分诊再读[标签](agents/triage-labels.md)。

## 这些资料分别证明什么

| 资料 | 用途与边界 |
| --- | --- |
| 当前产品、架构、设计和工程规范 | 应当实现的行为、模块合同与执行约束；已确认例外必须完整保留。 |
| [GLOSSARY](../GLOSSARY.md)与 [ADR](adr/README.md) | 术语定义，以及重要选择的背景、理由与取代关系；不是操作流程全集。 |
| [validation/](validation/README.md) | 指定版本、平台和环境下的实际结果、失败与未验证项。 |
| [archive/](archive/README.md) | 旧方案、研究来源、原型与已完成过程。仍有效的约束应在当前正文可找到，历史内容按需追溯。 |
| [website/doc/](../website/doc/index.md)与 [releases/](releases/) | 已发布版本的用户行为与交付记录，不自动描述开发分支能力。 |

规范与源码冲突时先查明原因，不能因为代码存在就把它视为获准行为；历史证据也不能自动证明新改动。发现正文仍缺少必要合同，先补齐该主题，不以缩短入口替代完整规范。
