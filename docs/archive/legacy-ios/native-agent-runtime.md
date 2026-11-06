# 原生 Agent Runtime 设计契约

状态：2026-10-31 开始实现。目标：在没有服务器、保持 iOS 原生阅读与轻量包体的前提下，提供完整的书内 AI 助手能力；所有编排代码用 Swift 实现，但接口按 LangChain 的核心概念划分，未来出现可用的原生 LangChain Swift 包时，用适配层替换内核而不改 UI/工具。

## 不在本设计内

- 远程 Agent 服务、上传整本书、跨书问答
- 多用户账号、云端同步
- 任意代码执行、任意网络工具（MCP 外部工具另行授权）

## 分层

```
QuestionController / AgentChatView
        │  AgentEvent 流
AgentExecutor（循环、步数、预算、取消、引用核对）
   ├── ChatModel（OpenAI / Anthropic 流式 tool calling）
   ├── ContextManager（历史、摘要、token/材料预算）
   ├── ToolRegistry → 书内工具 / MCP 工具
   └── CheckpointStore（每段对话的步骤与状态）
```

### LangChain 对应关系

| 本设计 | LangChain 概念 | 切换方式 |
| --- | --- | --- |
| `AgentChatModel` | `BaseChatModel` | 适配器包装 LangChain 实现 |
| `AgentTool` + `AgentToolSpec` | `Tool` / `StructuredTool` | 工具定义与执行分离 |
| `AgentContextManager` | `BaseMemory` | 可替换实现 |
| `AgentExecutor` | `AgentExecutor` / LangGraph | 只依赖协议，不依赖网络实现 |
| `AgentEvent` | `Runnable` stream events | UI 只消费事件 |

## 核心协议（实现时以 Swift 文件为准）

```swift
protocol AgentChatModel: Sendable {
    func stream(messages: [AgentMessage], tools: [AgentToolSpec], options: AgentModelOptions)
        -> AsyncThrowingStream<AgentModelEvent, Error>
}

protocol AgentTool: Sendable {
    var spec: AgentToolSpec { get }
    func call(_ arguments: AgentToolArguments) async throws -> AgentToolResult
}

enum AgentModelEvent: Sendable {
    case textDelta(String)
    case toolCall(AgentToolCall)
    case finished(AgentFinishReason)
}

struct AgentToolSpec: Sendable, Equatable {
    let name: String
    let description: String
    let inputSchemaJSON: String
}

struct AgentEvent: Sendable {
    // .started, .textDelta, .toolStarted, .toolFinished,
    // .citation, .completed, .failed, .cancelled
}
```

## 完整能力清单

1. OpenAI / Anthropic 原生 tool calling，流式文本与工具参数；模型不支持工具时自动回退到现有单次 RAG。
2. 多步 Agent：最多 8 步；每步工具结果进入下一轮；可取消；超时；最大回答长度。
3. 上下文：当前对话历史、摘要旧轮次、工具结果裁剪；显示本次材料/步数；超预算先摘要，不静默截断。
4. 书内工具（只读）：
   - `search_book(query, limit)`：当前书搜索，返回 quote/chapter/page/locator
   - `read_page(page)` / `read_chapter(href|title)`：读取局部原文
   - `book_toc()`：目录
   - `search_notes(query)`：当前书笔记
   - `current_location()`：当前阅读位置
5. 引用：最终回答必须经过书内原文核对；无效引用剔除；引用可跳转。
6. 持久化：每段对话的步骤、工具调用、最终回答、引用、摘要；重开可回看，不重新调用 AI。
7. 权限：工具只读；MCP 外部工具需单独开关和用户确认；不执行任意代码。
8. 安全：书内文本视为数据、不执行指令；工具参数校验；不把整本书发给模型。
9. MCP：iOS 17+ 可选，接入官方 `modelcontextprotocol/swift-sdk`；不支持时隐藏入口。

## 非目标

- 不承诺完整阅读整本书或总结全书；不替读者做决定。
- 不在首版接任意第三方 MCP 服务器市场；外部工具先只读、需授权。

## 验收

- 真实书问题集：单书问答、跨章、追问、找不到、引用核对、长对话、取消、模型不支持工具、无模型降级。
- 每步工具调用可在 UI 展开；引用可跳回原文。
- 现有 60 项 fixtures 与 PDF/EPUB 回归不红；App 体积不因 Agent 内核增加超过 2MB（MCP SDK 除外，按需评估）。
