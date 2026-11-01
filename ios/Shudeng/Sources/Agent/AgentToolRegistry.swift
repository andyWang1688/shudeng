import Foundation

// MARK: - 工具与证据

/// 工具定义与执行分离（对应 LangChain Tool / StructuredTool）。
/// context 由执行器提供：调用序号、步数、证据分配器。工具不持有可变状态。
protocol AgentTool: Sendable {
    var spec: AgentToolSpec { get }
    func call(_ arguments: AgentToolArguments, context: AgentToolCallContext) async throws -> AgentToolResult
}

struct AgentToolCallContext: Sendable {
    let callID: String
    let step: Int
    let bookID: String
    let evidence: AgentEvidenceAllocator
}

/// 本次运行内登记的可核查依据。工具注册原文片段并拿到稳定 id（E1、E2…），
/// 模型在最终回答里用 id 引用，执行器再统一核对。
actor AgentEvidenceAllocator {
    private var byID: [String: QuestionEvidence] = [:]
    private var order: [String] = []
    private var idByKey: [String: String] = [:]

    /// 同一 locator + 同一原文只保留一条，避免多步重复引用撑大上下文。
    @discardableResult
    func register(_ evidence: QuestionEvidence) -> QuestionEvidence {
        let key = evidence.locatorJSON + "\u{1F}" + evidence.quote
        if let id = idByKey[key], let stored = byID[id] { return stored }
        var stored = evidence
        let id = "E\(order.count + 1)"
        stored.id = id
        order.append(id)
        byID[id] = stored
        idByKey[key] = id
        return stored
    }

    func all() -> [QuestionEvidence] { order.compactMap { byID[$0] } }
    func evidence(id: String) -> QuestionEvidence? { byID[id] }
    var count: Int { order.count }
}

/// 工具注册表（对应 LangChain ToolRegistry）。未知工具由执行器转成错误工具结果，而不是崩溃。
struct AgentToolRegistry: Sendable {
    private let tools: [String: any AgentTool]

    init(_ tools: [any AgentTool]) {
        var values: [String: any AgentTool] = [:]
        for tool in tools { values[tool.spec.name] = tool }
        self.tools = values
    }

    var specs: [AgentToolSpec] {
        tools.values.map { $0.spec }.sorted { $0.name < $1.name }
    }
    var names: [String] { specs.map(\.name) }
    func tool(named name: String) -> (any AgentTool)? { tools[name] }
}
