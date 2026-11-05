# 书灯项目技能索引

本目录收录书灯项目使用的 Agent Skills，当前共 **22** 个，全部来自 [langchain-ai/langchain-skills](https://github.com/langchain-ai/langchain-skills)。本文按技能列出：**作用 → 依赖 → 调用方式**。

## 安装范围与使用

- **项目级安装**：技能位于本项目的 `.agents/skills/`，Codex 在书灯仓库内发现并按需加载；安装来源及内容校验值记录在根目录的 [skills-lock.json](../../skills-lock.json)。
- **开发入口**：LangChain / LangGraph / Deep Agents 任务先读 [ecosystem-primer](ecosystem-primer/SKILL.md)，再按任务选择对应技能。Deep Agents 进阶能力先读 [deep-agents-core](deep-agents-core/SKILL.md)。
- **调用方式**：“自动”表示模型可根据任务选用，也可以显式点名，例如“使用 `$langchain-rag` 评估书灯的整书检索”。

## LangChain 官方套件（22）

整套安装；`ecosystem-primer` 是路由入口。表中“—”表示没有额外的技能前置要求，外部工具或环境单独标注。技能的具体流程以各自 `SKILL.md` 为准。

| 技能 | 作用 | 依赖的技能或环境 | 调用 |
| --- | --- | --- | --- |
| [ecosystem-primer](ecosystem-primer/SKILL.md) | 生态入口：选择 LangChain / LangGraph / Deep Agents，确定后续技能 | 按任务路由到本套件技能 | 自动 |
| [langchain-dependencies](langchain-dependencies/SKILL.md) | Python / TypeScript 包版本、安装与依赖管理 | — | 自动 |
| [langchain-fundamentals](langchain-fundamentals/SKILL.md) | 创建 Agent、定义工具、结构化输出与中间件基础 | — | 自动 |
| [langchain-middleware](langchain-middleware/SKILL.md) | 自定义中间件、人工确认、恢复执行与结构化输出 | — | 自动 |
| [langchain-rag](langchain-rag/SKILL.md) | 文档加载、切分、Embedding 与向量检索 | — | 自动 |
| [langchain-python-quickstart](langchain-python-quickstart/SKILL.md) | 搭建最小可运行的 Python LangChain Agent | — | 自动 |
| [langchain-typescript-quickstart](langchain-typescript-quickstart/SKILL.md) | 搭建最小可运行的 TypeScript LangChain Agent | — | 自动 |
| [langgraph-fundamentals](langgraph-fundamentals/SKILL.md) | 状态图、节点、边、Command / Send 与流式执行 | — | 自动 |
| [langgraph-persistence](langgraph-persistence/SKILL.md) | Checkpoint、thread_id、跨对话记忆与历史恢复 | — | 自动 |
| [langgraph-human-in-the-loop](langgraph-human-in-the-loop/SKILL.md) | 中断、人工审核、恢复和错误处理 | — | 自动 |
| [langgraph-cli](langgraph-cli/SKILL.md) | 脚手架、本地开发、构建部署与 langgraph.json | — | 自动 |
| [langgraph-decision-models](langgraph-decision-models/SKILL.md) | 用 TypeSafe Jev / SemIf 决策模型处理图中的路由 | langgraph-fundamentals（参考） | 自动 |
| [langgraph-python-quickstart](langgraph-python-quickstart/SKILL.md) | 搭建最小可运行的 Python LangGraph 图 | — | 自动 |
| [langgraph-typescript-quickstart](langgraph-typescript-quickstart/SKILL.md) | 搭建最小可运行的 TypeScript LangGraph 图 | — | 自动 |
| [deep-agents-core](deep-agents-core/SKILL.md) | Deep Agents 骨架、createDeepAgent、配置与 SKILL.md | — | 自动 |
| [deep-agents-memory](deep-agents-memory/SKILL.md) | 虚拟文件、State / Store Backend 与跨会话记忆 | deep-agents-core（前置） | 自动 |
| [deep-agents-orchestration](deep-agents-orchestration/SKILL.md) | 子代理委派、任务规划与人工确认 | deep-agents-core（前置） | 自动 |
| [deepagents-python-quickstart](deepagents-python-quickstart/SKILL.md) | 搭建 Python Deep Agent，使用供应商原生联网搜索 | — | 自动 |
| [deepagents-typescript-quickstart](deepagents-typescript-quickstart/SKILL.md) | 搭建 TypeScript Deep Agent，使用供应商原生联网搜索 | — | 自动 |
| [managed-deep-agents](managed-deep-agents/SKILL.md) | LangSmith 托管 Agent：SDK、MCP、React 流式界面与部署 | deep-agents-core（参考）；LangSmith 托管环境 | 自动 |
| [eval-engineering](eval-engineering/SKILL.md) | 编写并审核 Agent 评测规格、Harbor 任务与验证器 | 运行评测需 Harbor 环境 | 自动 |
| [swarm](swarm/SKILL.md) | 将独立任务按表格行并行分发给子代理并汇总 | @langchain/quickjs 与 swarm_task PTC 工具 | 自动 |

共 22 个，其中仅手动 0 个。Python / TypeScript quickstart 用于新项目入门；现有书灯 RN 项目按实际改动选择基础、检索、中间件、持久化与 Deep Agents 技能。

## 维护

新增、移除或更新项目技能时，同步核对本索引的数量、技能名称、依赖与链接，以及根目录 `skills-lock.json`。全局技能在用户级技能索引中维护。
