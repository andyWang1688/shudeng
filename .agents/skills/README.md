# 书灯项目技能索引

技能仅安装在本项目；来源为 [langchain-ai/langchain-skills](https://github.com/langchain-ai/langchain-skills)，安装记录见根目录 [skills-lock.json](../../skills-lock.json)。具体流程与依赖以对应 SKILL.md 为准，本文只按任务路由，不重复官方说明。

## 按任务加载

LangChain / LangGraph / Deep Agents 开发先读 [ecosystem-primer](ecosystem-primer/SKILL.md)，再选择当前需要的能力；普通 UI 与文档任务无需加载整套技能。可显式点名，例如“使用 $langchain-rag 检查切分”。

| 本次任务 | 技能 |
| --- | --- |
| 依赖、版本与安装 | [langchain-dependencies](langchain-dependencies/SKILL.md) |
| Agent、工具与中间件 | [langchain-fundamentals](langchain-fundamentals/SKILL.md)；涉及中间件再读 [langchain-middleware](langchain-middleware/SKILL.md) |
| 加载、切分、embedding、检索 | [langchain-rag](langchain-rag/SKILL.md) |
| 状态图与恢复 | [langgraph-fundamentals](langgraph-fundamentals/SKILL.md) → 按需读 [persistence](langgraph-persistence/SKILL.md)、[human-in-the-loop](langgraph-human-in-the-loop/SKILL.md)、[decision-models](langgraph-decision-models/SKILL.md) |
| Deep Agents | [deep-agents-core](deep-agents-core/SKILL.md) → 按需读 [memory](deep-agents-memory/SKILL.md)、[orchestration](deep-agents-orchestration/SKILL.md) |
| 新建隔离实验 | LangChain [TypeScript](langchain-typescript-quickstart/SKILL.md) / [Python](langchain-python-quickstart/SKILL.md)；LangGraph [TypeScript](langgraph-typescript-quickstart/SKILL.md) / [Python](langgraph-python-quickstart/SKILL.md)；Deep Agents [TypeScript](deepagents-typescript-quickstart/SKILL.md) / [Python](deepagents-python-quickstart/SKILL.md) |
| 专项评测、批量工作或托管 | [eval-engineering](eval-engineering/SKILL.md)、[swarm](swarm/SKILL.md)、[langgraph-cli](langgraph-cli/SKILL.md)、[managed-deep-agents](managed-deep-agents/SKILL.md)，只在对应任务已纳入范围时使用 |

## 项目边界与维护

书灯的设备内执行、当前书范围、权限与来源规则见[阅读 Agent 契约](../../docs/architecture/reading-agent.md)。官方技能的通用示例不自动改变本项目架构，也不授权引入服务器、执行工具或产品子 Agent。

安装或更新后核对目录、链接与锁文件；第三方技能正文保持上游内容，项目差异维护在项目规范。不维护全局技能索引，也不为精简阅读删除上游技能。
