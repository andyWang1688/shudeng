<!-- 审计快照：2026-11-01 13:52，HEAD 30341c9；并行 task-77 修复的 SSE 空 data 心跳已随后提交。原始证据见 .scratch/impl/agent-audit/（本地未发布）。 -->

# 书灯原生 Agent × LangChain / LangGraph 能力对照审计

- 任务：task-76（只读审计，不改源码/测试、不跑构建、不 commit）
- 基线：`HEAD 30341c9`（v0.4.5 native in-book agent）+ 审计期间工作区未提交改动
- 快照时间：2026-11-01 13:52（Asia/Shanghai）
- 范围：`ios/Shudeng/Sources/Agent/` 全部、`ReadingQuestion.swift` Agent 接入、`AgentRuntimeTests.swift`、`docs/archive/legacy-ios/native-agent-runtime.md`
- **注意**：审计期间另有并行任务（task-77，同目录 `report.md`/`logs/`）在改 `Agent/AgentSSE.swift`（+20/−6：空 `data:` 心跳 P0 修复）并新增 30 个对抗测试（+749 行）；其报告称 `AgentRuntimeTests` **64 tests / 0 failures**（`logs/03-adversarial-post-fix-GREEN.log`、`logs/04-full-agent-runtimetests.log`），但改动**未提交**。本文不重复其结论，只把它作为已修复项引用；状态按 13:52 工作区快照，行号可能随后续编辑轻微漂移；证据与差异见 `EVIDENCE.md`。

## 结论（先看这里）

1. **不需要 LangChain / LangGraph 框架本身，也不需要服务端** 才能达到本产品需要的 Agent 能力。现有内核已按 LangChain 概念完成分层（ChatModel / Tool / Memory / Context / Executor / Checkpoint / Event），覆盖单用户、只读书内工具、离线可用场景的主要能力；缺口都是可靠性、安全与可观测性的工程项，原生补的成本低于引入无成熟 Swift 版本、且会增加包体与维护面的框架。
2. **必须服务端/外部平台的只有四类非目标能力**：hosted tracing/eval（LangSmith 类）、远程 MCP 代理与密钥托管、云同步/多用户/计费、大规模 provider 路由。设计文档已把多数列为非目标（`docs/archive/legacy-ios/native-agent-runtime.md:81-84`），因此当前无需为此引入后端。
3. **Top 5 差距**（均为原生可补）：checkpoint/resume 语义不完整（P1）、MCP 安全边界（P1）、无重试/退避/限流（含工具调用级超时，P1）、无 tracing/评测（P1）、工具循环治理（P2）。**HEAD 基线有 1 个 P0（SSE 空 `data:` 心跳导致整次运行 invalidResponse），已由并行 task-77 修复并跑出 64 tests/0 failures，尚未提交；本审计未新发现其他 P0。**

## 状态与优先级定义

- 状态：**已有**=实现+测试基本覆盖；**部分**=有实现但缺关键分支/验证/接线；**缺失**=无实现；**未验证**=有实现但本轮无法运行验证（无构建、无网络/真机、测试未跑）。
- 优先级：**P0**=阻断发布/数据安全（HEAD 基线 1 项：SSE 空 `data:` 心跳，已由并行 task-77 修复、64 tests 0 failures，待提交；本审计未新增）；**P1**=影响可靠性、安全承诺或验收；**P2**=体验/成本/可维护性。
- “必须框架/服务端”判断：**原生可补**=Swift 内可完成；**框架非必须**=LangChain 可作参照或适配层来源；**需服务端**=hosted 能力或跨设备/多用户。

## 一、能力矩阵

### A. 模型与流式协议

| # | 能力 | LangChain 对应 | 现状 | 状态 | 证据 | 影响 | 优先级 | 框架/服务端 |
|---|---|---|---|---|---|---|---|---|
| A1 | Provider tool calling（流式文本 + 工具参数；工具结果回填） | BaseChatModel / bind_tools | OpenAI Chat Completions 与 Anthropic Messages 两条适配器；assistant tool_calls/tool_use 与 tool/tool_result 双向编码；未支持 tools 的网关映射为回退信号 | 已有 | `OpenAIChatModel.swift:18-44,48-99`；`AnthropicChatModel.swift:18-44,48-128`；`AgentSSE.swift:225-296,304-414` | 自定义网关/模型兼容性；目前仅 2 种协议（无 Google/Bedrock） | P2 | 原生可补（新增适配器）；框架非必须 |
| A2 | SSE 解析边界：空行、CRLF、多行 data、无 `[DONE]`、注释/keep-alive、任意分块（UTF-8/JSON 跨块）、空 `data:` 心跳、流内 error、HTTP 错误映射 | 回调/event stream 解析 | 自写按 0x0A 切行状态机，空行派发、多行 `\n` 拼接、`finish()` flush；**空 `data:` 心跳 P0 已由 task-77 修复（工作区 +20/−6，64 tests/0 failures）**；HTTP 429/5xx/400 映射 `AIError`；**无中途断线重连** | 已有（P0 修复待提交） | `AgentSSE.swift:12-42,151-221,225-296,304-414`；task-77 `report.md`、`logs/03-adversarial-post-fix-GREEN.log`；测试见 `AgentRuntimeTests.swift:1214-1450` | 特定网关（空心跳、无 DONE、分块）曾会中断整次回答，已修复；主要剩重连缺失 | P2（含提交/回归验证） | 原生可补；框架非必须 |
| A3 | 并行 / 重复 / 畸形工具调用 | ToolNode / parallel tool executor | 可接收一步多个 tool call 并按顺序串行执行；单步最多 6 个，超出部分回填错误结果保证协议完整；重复调用会重复执行（仅证据按 locator+quote 去重）；畸形 JSON 参数→工具错误结果，循环继续；未知工具→错误结果；并行 index 解码正确 | 部分 | `AgentRuntime.swift:270-308`；`AgentToolRegistry.swift:21-43`；`AgentSSE.swift:225-300`；测试 `AgentRuntimeTests.swift:1266-1291,1525-1597` | 串行增加延迟（移动端可接受）；重复调用浪费 token/时间；无并行取消/超时 | P2 | 原生可补；LangChain 并行执行器可作参照，非必须 |
| A4 | 工具 schema 校验（JSON Schema / 参数类型与范围） | StructuredTool + Pydantic/JSON Schema | 工具 schema 以 JSON 字符串交给 provider；参数在工具内手写校验（requiredString/integer 范围/长度）；无通用 JSON-Schema 校验器；MCP 工具 schema 原样透传，不本地校验 | 部分 | schema：`AgentTypes.swift:83-94`、`BookAgentTools.swift:193-218`；手写校验：`AgentTypes.swift:97-148`；MCP 透传：`MCPAgentTool.swift:30-37`；测试 `AgentRuntimeTests.swift:755-768` | 参数错误可被工具拒绝，但 schema 与执行校验可能漂移；MCP 依赖外部 server 校验 | P2 | 原生可补轻量校验器；框架非必须 |
| A5 | 结构化输出与解析失败处理 | OutputParser / OutputFixingParser / with_structured_output | 自定义 JSON `{answer,citations[]}`；无效 JSON 降级为纯文本+警告（不伪造引用）；空 answer 判失败；**无解析失败自动重试/修复** | 部分 | `AgentRuntime.swift:329-398`；固定提示词 `AgentTypes.swift:374-403`；测试 `AgentRuntimeTests.swift:1615-1626,1543-1562` | 模型偶发格式错误时答案可用但引用缺失；无自修复重试 | P2 | 原生可补（低成本重试/修复提示）；框架非必须 |

### B. 循环、上下文与状态

| # | 能力 | LangChain 对应 | 现状 | 状态 | 证据 | 影响 | 优先级 | 框架/服务端 |
|---|---|---|---|---|---|---|---|---|
| B1 | 多步 Agent 循环、步数/预算/取消/超时/最大回答长度 | AgentExecutor / LangGraph recursion_limit | 最多 8 步；最后一步不再给工具并提示收尾；整次运行 240s、单次模型请求空闲 90s；每步工具结果回填；超步/超时/取消均保存 checkpoint 并显式失败；回答 6000 字截断 | 已有 | `AgentRuntime.swift:28-39,131-327`；`AgentTypes.swift:183-194,259-330`；测试 `AgentRuntimeTests.swift:401-660,1704-1740,1830-1846` | 设计契约核心已满足 | P2 | 原生可补；框架非必须 |
| B1b | **单次工具调用级超时** | tool timeout / asyncio.wait_for | 运行器只在“步与步之间”检查 `runTimeout`；`tool.call` 本身无超时，非协作工具（异常 MCP/网络挂起）可一直阻塞到用户取消。task-77 同结论并列为已知缺口 | 部分 | `AgentRuntime.swift:194-197`（步间检查）、`:280`（tool.call 无超时）；task-77 `report.md`「已知缺口 1」 | 一个挂起的工具会拖住整次回答；runTimeout 无法兜底 | **P1** | 原生可补（withTimeout 包裹 + 取消传播，注意 detached task 泄漏）；框架非必须 |
| B2 | 上下文 token 估算 / 工具结果裁剪 / 旧轮摘要 / 预算事件 | BaseMemory / trim_messages | 启发式 token 估算（CJK 1 字≈1 token、其他 4 字符≈1）；单条工具结果 >4000 字符先裁剪；超预算按整轮摘要（失败降级裁剪）；固定 10000 token 上限 + 预留 1600；每次动作发 context 事件，不静默截断 | 部分 | `AgentContextManager.swift:4-17,58-83,100-183,185-197`；`AgentRuntime.swift:206-213`；测试 `AgentRuntimeTests.swift:335-397,1742-1812` | 固定上限不按模型窗口配置；无 provider usage/精确 tokenizer；摘要每步重算且不落盘 → 长对话成本偏高 | P2 | 原生可补（模型窗口表 + usage 字段 + 摘要缓存）；框架非必须 |
| B3 | Checkpoint / resume | LangGraph checkpointer / interrupt | 每步 JSON 原子写；状态 running/completed/failed/cancelled；已完成可直接回放；续跑前修复缺失工具结果的半截历史；**但产品路径未接线**：中断/重启一律标 incomplete 让用户重试，`resume()` 无调用方；**证据分配器（E1/E2…）不在 checkpoint 中**，续跑后旧引用全部核验失败；checkpoint 按 turn id 存而 resume 按 conversationID 读，语义不一致；无版本迁移 | 部分 | `AgentCheckpointStore.swift:3-25,39-96`；`AgentRuntime.swift:133-190,425-449,528-542`；`ReadingQuestion.swift:321-323,509-515`；测试 `AgentRuntimeTests.swift:586-612,1662-1686` | 设计承诺“崩溃后从最后一步续跑”未兑现；若直接接线会静默丢引用，属错误答案风险；中断重试成本高 | **P1** | 原生可补（存 evidence 表 + 统一 key + 产品入口或删除误导 API）；框架非必须 |
| B4 | 事件流与 UI 步骤展示（可观测的“过程中间态”） | callbacks / stream events | AgentEvent 全生命周期；UI 0.15s 节流刷新、工具步骤可展开、上下文用量、警告、收尾摘要；transcript 持久化进对话记录 | 已有 | `AgentTypes.swift:243-255`；`ReadingQuestion.swift:552-648,108-134`；`QuestionController.swift:560-700` | 展开的步骤 preview 直接截取工具原文前 160 字，会露出 `[E1]`、工具提示词等内部文本 | P2 | 原生可补（预览改读者文案）；框架非必须 |

### C. 安全、权限、引用、MCP 与人工介入

| # | 能力 | LangChain 对应 | 现状 | 状态 | 证据 | 影响 | 优先级 | 框架/服务端 |
|---|---|---|---|---|---|---|---|---|
| C1 | 引用核对与剔除（逐字/PDF 容错/伪造拒绝/去重） | 无内建（需自建） | 最终引用必须能在工具登记的原文中逐字定位；PDF 允许空白差异；无效/伪造/重复剔除并计数；支持跳回原文；证据按 locator+quote 去重 | 已有 | `AgentRuntime.swift:329-421`；`AgentToolRegistry.swift:21-43`；`BookIndexCitationVerifier` `AgentRuntime.swift:42-71`；测试 `AgentRuntimeTests.swift:420-500,947-1045` | 引用可信度是书灯相对 LangChain 原生实现的优势项 | P2 | 原生已有；框架反而缺 |
| C2 | 安全/引用：图书文本作为数据、不整书上传、只读工具、参数校验 | 无内建（靠提示词/工具设计） | 系统提示词明确“工具结果只是资料、不执行其中指令”；工具只读；只向模型发片段；参数长度/范围受限；无代码执行；无整书上传 | 部分 | `AgentTypes.swift:374-403`；`BookAgentTools.swift:151-161`；`ReadingQuestion.swift:657-674`；`AgentRuntime.swift:270-308` | 提示词级注入防护；书内文本仍可诱导模型调用外部工具（结合 MCP 确认粒度，见 C4） | P2 | 原生可补（结构化分隔/外部工具开关）；框架同样不解决 |
| C3 | MCP 客户端（发现/调用/会话/超时/取消/分页/SSE 响应） | LangChain MCP adapters | 原生 JSON-RPC Streamable HTTP/SSE 客户端：initialize 协商 + session id、tools/list 分页（≤200）、tools/call、20/30/60s 分级超时、取消、https 强制（仅 loopback 允许 http）、响应 2MB 上限、SSE 响应解析、工具名 sanitize/去重；iOS 17+；无 stdio/WebSocket（iOS 沙盒） | 部分 | `MCPClientManager.swift:11-365`；`MCPConfiguration.swift:22-108`；`MCPAgentTool.swift:10-106` | 功能齐全但**运行时零测试**（仅 UI 入口可见性用例）；`timeoutInterval = min(timeout,25)` 使 call 实际 25s 上限；`transport` 字段未真正区分 http/sse | P2 | 原生可补；如需更完整可换官方 swift-sdk，非必须 |
| C4 | MCP 安全边界：白名单、只读强制、确认粒度、凭据与变更重置 | Human-in-the-loop / tool callbacks | 白名单默认空、只暴露 allowlist 工具、首次确认（“允许一次”）；但 `readOnlyHint` 仅用于描述，**不禁止可写工具**；确认键 `(serverID, tool)` 存内存集合，**整个进程内永久生效**，`reset()` 无调用方；编辑 MCP endpoint（id 不变）不重置确认；自定义 Authorization headers 明文存 UserDefaults；`MCPSettingsController` 411 行无调用方（死代码） | 部分 | 白名单/暴露：`MCPAgentTool.swift:39-59,66-97`；确认：`MCPConfiguration.swift:162-200`；headers：`MCPConfiguration.swift:33-34,112-135`、`MCPSettingsController.swift:108-122`；无调用方：全仓 grep 无 `MCPSettingsController(` | 被污染的书内文本可诱导模型调用已确认的外部工具；可写工具未强制只读；跨 endpoint 的旧批准仍有效；凭据落 UserDefaults | **P1** | 原生可补（强制 readOnly、确认绑定 endpoint+schema、编辑/禁用时 reset、headers 移 Keychain、补 URLProtocol 测试）；框架非必须 |
| C5 | Human-in-the-loop / 审批中断 | LangGraph interrupt / 人工审批节点 | 仅 MCP 外部工具首次使用确认；书内只读工具无审批；无暂停/恢复/改工具参数的审批节点；无“先给方案再执行”模式 | 部分 | `MCPConfiguration.swift:162-200`；`MCPAgentTool.swift:39-59` | 只读书内问答无需审批；一旦开放写工具/更危险 MCP，粒度不足 | P2 | 原生可补（工具级 policy）；框架 interrupt 可作参照，非必须 |
| C6 | MCP 设置入口 | — | AI 服务页第 3 段（iOS 17+ 才显示）内联管理 server/开关/白名单；另有未接线的完整设置控制器 | 部分 | `AISettingsController.swift:47,108,166-230`；`MCPSettingsController.swift:1-411`；UI 测试 `ios/ShudengUITests/ReadingUITests.swift:6574-6588` | 入口存在；死代码增加维护面；无运行时端到端测试 | P2 | 原生可补（删死代码或接线） |

### D. 观测、评测与成本

| # | 能力 | LangChain 对应 | 现状 | 状态 | 证据 | 影响 | 优先级 | 框架/服务端 |
|---|---|---|---|---|---|---|---|---|
| D1 | Tracing（span/trace id、耗时、token/cost、工具成功率、调试回放） | LangSmith / callbacks / tracing | 只有 AgentEvent 与 UI transcript；DEBUG 测试环境另有 question-lifecycle JSONL（仅 DEBUG + 测试参数）；无 trace id、无每步耗时聚合、无 token/cost、无外部导出 | 缺失 | `AgentTypes.swift:243-255`；`ReadingQuestion.swift:297-309`；`Agent` 目录内无 trace/usage 实现 | 线上问题只能靠用户日志/复现；无法量化延迟与成本；与 LangSmith 差距最大 | **P1** | hosted tracing 需服务端；轻量本地 trace/eval 原生可补 |
| D2 | 评测（真实书问题集、指标、回归） | LangSmith datasets/evals | 59~64 个 XCTest（含工作区新增对抗测试）覆盖解析/循环/引用/工具/边界，但无真实书问题集自动评测，无引用有效率/工具成功率/延迟/token 指标；设计“验收”章节未自动化 | 缺失（仅部件级单测） | `AgentRuntimeTests.swift:1-1846`（10 个测试类）；`docs/archive/legacy-ios/native-agent-runtime.md:86-90` | 质量回归靠人工；无法对比模型/提示词改动 | **P1** | hosted eval 需服务端；本地 fixture + 指标脚本原生可补 |
| D3 | Token / cost 用量计量 | usage_metadata | 未解析 provider 流中的 usage；仅启发式估算上下文；无费用/请求数统计 | 缺失 | `AgentSSE.swift:225-414`（未取 usage）；`AgentContextManager.swift:19-30,58-83` | 无法向用户展示成本或做预算告警 | P2 | 原生可补（解析 usage chunk） |
| D4 | Provider 生态 | 多 provider 集成 | 仅 OpenAI 兼容 / Anthropic 两种格式 | 部分 | `AIService.swift:4-7`；`AgentRuntime.swift:481-485` | 用户自定义服务范围受限；LangChain 生态优势 | P2 | 原生可补；框架非必须 |
| D5 | 多 Agent / Graph / 状态机 / time-travel | LangGraph | 单 AgentExecutor 循环，无 graph 编排、子图、多 Agent、时间旅行 | 缺失（设计非目标） | `AgentRuntime.swift:94-127`；`docs/archive/legacy-ios/native-agent-runtime.md:81-84` | 书内单 Agent 场景不需要；未来复杂工作流才需要 | P2 | 原生可补；引入 LangGraph 反而需服务端/Python |

### E. 产品接线与边界

| # | 能力 | 参考 | 现状 | 状态 | 证据 | 影响 | 优先级 | 框架/服务端 |
|---|---|---|---|---|---|---|---|---|
| E1 | 产品路径：Agent 优先 → 失败/不支持 tools 回退单次 RAG → 流式 UI/步骤/引用/持久化 | AgentExecutor + fallback | `state.ready` 且非本地时先跑 Agent；toolsUnsupported 回退单次 RAG 并提示；普通失败映射读者文案；对话记录持久化 agent transcript；旧 JSON 兼容 | 已有 | `ReadingQuestion.swift:418-433,469-648,636-641,740-766`；`ReadingQuestion.swift:66-134` | 单测有回退信号；**QuestionStore 级回退链路无 UI/集成测试**（状态可视为部分验证） | P2 | 原生已有 |
| E2 | 中断/后台行为 | — | 后台时间耗尽会 interrupt：保留半成品答案/步骤，状态标 incomplete 让用户主动重试；不自动 resume checkpoint | 部分 | `ReadingQuestion.swift:245-300`；`ReadingQuestion.swift:321-323` | 用户需整题重跑；成本与等待重复 | P1（并入 B3） | 原生可补 |
| E3 | 包体/性能/并发约束 | — | Agent 源码约 158KB（184KB 目录）；设计上限 +2MB；本轮未构建测量；模型/工具运行在后台 Task、UI 事件回主线程；无全局请求并发限制 | 未验证 | `du -sh ios/Shudeng/Sources/Agent`=184K、`wc -c`=157,626B；`AgentRuntime.swift:119-127` | 包体预计达标但未验证；多对话并发无节流 | P2 | 原生可补 |

## 二、Top 5 差距（按优先级）

### 1. checkpoint/resume 语义不完整 — P1（原生可补）
- 现状：内核有完整 checkpoint + `resume()`，但**产品从不调用**（`resume` 无调用方）；中断/重启只标 incomplete 重试（`ReadingQuestion.swift:321-323`）。`AgentEvidenceAllocator` 只存在于内存（`AgentRuntime.swift:139`），不在 `AgentCheckpoint` 字段中（`AgentCheckpointStore.swift:9-25`）→ 若直接接 resume，历史里的 `[E1]` 已无法核验，最终引用会被全部剔除（静默丢引用，答案还在）。此外 checkpoint key 用 turn id（`ReadingQuestion.swift:509-515`），resume 用 conversationID，语义不一致；无版本迁移。
- 影响：设计契约第 6 条“崩溃后也能从最后一步续跑”未兑现；用户重跑成本；未来接线时会出现“引用消失”这类隐蔽错误。
- 修法（二选一）：
  - A. 补齐：checkpoint 增加 `evidence: [QuestionEvidence]`（id/locator/quote）快照与 `schemaVersion`；按 conversationID 或统一 turn/run id；启动时对 incomplete 显示“继续上次回答”并调 `resume`；复用 `repairedHistory` 补结果；加“续跑后引用仍可核验”测试。
  - B. 降级：删除 `resume/loadCheckpoint` 与注释中的续跑承诺，明确“只回看不续跑”，避免误用；checkpoint 仅作调试/崩溃取证。
- 不建议为此时引入 LangGraph：LangGraph checkpointer 同样要序列化自定义 state（含证据表），迁移成本高于原生补齐。

### 2. MCP 安全边界 — P1（原生可补，最优先安全项）
- 现状：`readOnlyHint` 只写进描述（`MCPAgentTool.swift:30-36`），call 不检查（`MCPAgentTool.swift:39-59`）；白名单可包含可写工具；确认中心“允许一次”实际在进程内记住 `(serverID, tool)` 直到重启（`MCPConfiguration.swift:177-196`），`reset()` 无调用方；编辑 server endpoint 保留 id 不重置确认；Authorization headers 明文进 UserDefaults（`MCPConfiguration.swift:33-34,112-135`）；MCP **没有任何运行时测试**（`ios/ShudengTests` 无 MCP 用例，仅 UI 入口可见性）。
- 影响：书内文本可诱导模型调用已获准的外部工具；可写工具未强制只读与设计“外部工具先只读”不符；server 地址变更后旧确认继续有效；凭据存储不合规；生产故障无回归网。
- 修法：v1 强制 `readOnlyHint == true` 才可暴露；确认绑定 `endpoint + 工具名 + schema hash`，编辑/禁用/失败时 `reset()`；写工具如要开放，改为每次调用确认或“本对话允许”；headers 移 Keychain（或删除未用 UI）；补 `URLProtocol` stub 的 initialize/tools-list/call/deny/timeout/写入拒绝测试。

### 3. 无自动重试 / 退避 / 限流，且无工具调用级超时 — P1（原生可补）
- 现状：HTTP 429/5xx/网络错误只映射为 `AIError.limited/network` 后直接失败（`AgentSSE.swift:54-77,206-210`），无重试、无 `Retry-After`、无指数退避/抖动、无全局并发上限；工作区对抗测试甚至断言“不重试”（`AgentRuntimeTests.swift:1300-1315`）。**单次工具调用无超时**：executor 只在步与步之间检查 `runTimeout`（`AgentRuntime.swift:194-197`），`tool.call` 本身（`:280`）没有超时，异常 MCP/网络挂起会一直阻塞到用户取消（task-77 同结论，见 `report.md` 已知缺口 1）。
- 影响：移动网络抖动或网关限流时用户看到一次失败即结束；长回答（多步工具）中途 429 整题重来；没有请求预算控制。
- 修法：模型请求层加指数退避+抖动（1/2/4s，上限 3 次，尊重 `Retry-After`，仅网络/429/5xx 且未发生工具副作用时）；工具已执行的步骤重试需幂等判断（只读工具可安全重试，MCP 写工具禁止）；全局并发 1～2；把“失败→重试中”作为 AgentEvent 展示；预算内（runTimeout）限制。
- 与 LangChain 对照：LangChain 的 `with_retry` 只是可选包装，非框架独有能力。

### 4. 无 tracing / 评测 — P1（本地轻量可补；hosted 需服务端）
- 现状：事件流只服务 UI；无 trace id/span、每步耗时、token/cost、工具成功率、引用丢弃原因的结构化记录；DEBUG JSONL 仅测试参数下写（`ReadingQuestion.swift:297-309`）。测试是部件级 XCTest（解析/循环/引用/工具/边界），无真实书问题集与质量指标；设计“验收”未自动化（`docs/archive/legacy-ios/native-agent-runtime.md:86-90`）。
- 影响：线上只能靠用户日志复现；无法回答“哪个模型/提示词更好”“引用错误率多少”“平均几步/多少 token/多慢”；改动无法量化回归。
- 修法：本地 trace JSONL（runID/step/model/tool/duration/estimatedTokens/finishReason/citationsKept/Dropped/warnings），隐私字段默认关；基于现有 fixtures + 3~5 本真实书问题集跑脚本产出指标；评测结果进 CI 或发布清单。hosted 可视化/SaaS 才需要服务端（LangSmith/自建）。

### 5. 工具循环治理（并行/重复/单步上限）— P2（原生可补）
- 现状：多工具调用**串行**执行（`AgentRuntime.swift:270-308`）；单步 >6 截断并给错误结果；重复调用重复执行（仅证据去重）；单工具无独立超时/重试；无每轮工具 token 预算。新对抗测试已覆盖并行 index 解码、双调用执行、超限、重复证据等（`AgentRuntimeTests.swift:1266-1291,1549-1597`）。
- 影响：多步/多工具时延迟叠加；重复调用浪费成本；异常工具可能拖慢整步。
- 修法：重复 `(tool,args)` 去重/缓存；只读工具并行（BookIndex actor 本质串行，收益有限，可先不做）；单工具超时；每步工具结果总 token 预算；工具级成功率指标。
- LangChain 对照：ToolNode 并行执行器可借鉴，但本 App 只读书内工具、单用户场景串行已够用，不必为此上框架。

## 三、与设计契约逐条核对（`docs/archive/legacy-ios/native-agent-runtime.md`）

| 契约条目 | 结论 | 说明 |
|---|---|---|
| 1. OpenAI/Anthropic 原生 tool calling，流式，模型不支持时回退单次 RAG | 达成 | 两条适配器 + `toolsUnsupported` 回退（`ReadingQuestion.swift:418-433,636-641`） |
| 2. 多步 ≤8、每步结果回填、可取消、超时、最大回答长度 | 达成 | `AgentRuntimeConfiguration`（`AgentRuntime.swift:28-39`）+ 循环/收尾 |
| 3. 上下文：历史、摘要、工具结果裁剪、材料/步数显示、超预算先摘要不静默截断 | 部分 | 摘要/裁剪/事件都有；固定 10k、无 provider usage、摘要不持久化（`AgentContextManager.swift:4-17`） |
| 4. 书内 6 只读工具（search_book/read_page/read_chapter/book_toc/search_notes/current_location） | 达成 | `BookAgentTools.swift:151-161` |
| 5. 引用必须原文核对、无效剔除、可跳转 | 达成 | `AgentRuntime.swift:329-421`；UI `QuestionController.swift:491-520,880+` |
| 6. 持久化：步骤/工具/最终回答/引用/摘要；重开可回看不重新调用 | 部分 | 回看靠 `ReadingQuestion.agent` 已达成；checkpoint 语义未接线（B3） |
| 7. 权限：工具只读；MCP 单独开关+用户确认；不执行任意代码 | 部分 | 书内只读达成；MCP 确认粒度/只读强制不足（C4） |
| 8. 安全：书内文本视为数据、参数校验、不整书上传 | 部分 | 提示词与裁剪达成；无结构化隔离；MCP 外部注入路径存在（C2/C4） |
| 9. MCP：iOS 17+ 可选，接入官方 swift-sdk；不支持时隐藏入口 | 部分 | 自研原生客户端（非官方 SDK）+ 入口隐藏达成；无运行时测试；无 stdio（iOS 限制） |
| 非目标：远程服务、整书上传、跨书、多用户、云同步、任意代码 | 符合 | 设计明确不做（`docs/archive/legacy-ios/native-agent-runtime.md:81-84`） |
| 验收：真实书问题集、60 fixtures 与回归、包体 +2MB | 部分/未验证 | 60+ 单测在；真实书问题集自动评测缺失；包体未测（源 158KB，预计达标） |

## 四、结论：哪些必须 LangChain / 服务端，哪些原生可补

**必须服务端（或 hosted 平台）的，仅当产品要做以下非目标能力时：**
1. hosted tracing/eval（LangSmith 或自建云端）——需要跨用户/跨版本的 trace 存储、数据集、指标看板；
2. 远程 MCP 代理与密钥托管——若要把 Authorization/第三方服务凭据从设备移出、做企业级审计；
3. 云端 checkpoint/多设备同步、多用户/计费、大规模 provider 路由；
4. 需要 Python 生态的离线评测/批处理（LangChain 生态本身）——但这是研发侧，不是 App 运行时。

**不需要 LangChain/LangGraph 的，是产品运行时全部核心能力：** provider 适配、工具循环、上下文管理、引用核对、流式 UI、checkpoint、MCP、回退、安全边界，Swift 原生都已完成或可在现有抽象上小改。理由：
- 工程上没有成熟、可离线、可嵌入 iOS 的 LangChain Swift 运行时；引入 Python 服务违背“无服务器、隐私、轻量包体”的设计前提（`docs/archive/legacy-ios/native-agent-runtime.md:3`）。
- 现有协议分层就是为“未来可用适配器替换内核”准备的（`AgentChatModel`/`AgentTool`/`AgentContextManager`/`AgentExecutor`），真要用 LangChain 或官方 MCP swift-sdk，只需替换适配器，不必改 UI/工具（`docs/archive/legacy-ios/native-agent-runtime.md:23-31`）。
- LangChain/LangGraph 相对本项目的优势集中在：tracing/eval 平台、超大 provider 生态、并行/中断/图编排、结构化输出解析重试。其中除 tracing/eval 平台外，都能以很低成本在原生补齐；图编排对“书内单 Agent 问答”没有收益。

**建议的落地顺序（全部原生）：**
1. B3 checkpoint/resume 决策与一致性（P1，先决定“补”还是“砍”）；
2. C4 MCP 安全边界 + 运行时测试（P1）；
3. 重试/退避/限流（P1）；
4. 本地 trace + fixture 评测脚本（P1）；
5. 工具循环治理/结构化输出重试/上下文模型窗口（P2，按成本排）。

## 五、明确不审计 / 未验证

- 未运行任何构建/测试/网络请求；测试仅静态审读（且工作区测试文件审计期间持续增长）。
- 未验证真实 provider/网关行为（OpenAI 兼容代理差异、Anthropic 代理、MCP 真实 server）；MCP 无任何运行时测试。
- 未验证 iOS 17 真机/多窗口/后台切换下的 MCP 与 Agent 行为；未测包体增量、耗电、发热、长时运行内存。
- 未审计 UI 视觉/无障碍细节（仅到“步骤可展开/无技术词标题”层面）；未审计 AI 服务页完整交互。
- LangChain/LangGraph 侧能力基于公开文档与团队 `docs/archive/research/research-anx-ai.md` 调研；未在仓库内引入/运行 LangChain 做对照实验。
- 行号基于 2026-11-01 13:52 工作区快照；并行任务正在改 `AgentSSE.swift` 与 `AgentRuntimeTests.swift`，以 `EVIDENCE.md` 记录的 diff 为准。
