import Foundation

enum AgentRunStatus: String, Codable, Sendable {
    case running, completed, failed, cancelled
}

/// 每段对话的完整进度：消息历史、工具调用、最终回答、引用、摘要与预算状态。
/// 重开对话可以直接回看，不需要重新调用 AI；崩溃后也能从最后一步续跑。
struct AgentCheckpoint: Codable, Sendable, Equatable {
    var version: Int = 1
    let conversationID: UUID
    let bookID: String
    let bookTitle: String
    var createdAt: Date
    var updatedAt: Date
    var status: AgentRunStatus
    var model: String
    var messages: [AgentMessage]
    /// 已经完成的模型步数（恢复时计入上限）。
    var steps: Int
    var result: AgentRunResult?
    var failure: AgentFailure?
    var warnings: [String]
    var context: AgentContextUsage?
}

enum AgentCheckpointError: Error, LocalizedError, Equatable {
    case storage
    case corrupted

    var errorDescription: String? {
        switch self {
        case .storage: return "对话进度无法保存，请检查储存空间后重试。"
        case .corrupted: return "对话进度记录损坏，无法恢复。"
        }
    }
}

/// JSON 检查点存储：`<书灯 root>/agent-checkpoints/<conversationID>.json`，原子写入。
struct AgentCheckpointStore: Sendable {
    let directory: URL

    init(root: URL) {
        directory = root.appendingPathComponent("agent-checkpoints", isDirectory: true)
    }

    func fileURL(conversationID: UUID) -> URL {
        directory.appendingPathComponent(conversationID.uuidString + ".json")
    }

    /// Data.write(.atomic) 先写同目录临时文件再替换，崩溃时旧文件保持完整。
    func save(_ checkpoint: AgentCheckpoint) throws {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try Self.encoder().encode(checkpoint).write(to: fileURL(conversationID: checkpoint.conversationID), options: .atomic)
        } catch {
            throw AgentCheckpointError.storage
        }
    }

    func load(conversationID: UUID) throws -> AgentCheckpoint? {
        let url = fileURL(conversationID: conversationID)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        do {
            return try Self.decoder().decode(AgentCheckpoint.self, from: Data(contentsOf: url))
        } catch {
            throw AgentCheckpointError.corrupted
        }
    }

    func remove(conversationID: UUID) throws {
        let url = fileURL(conversationID: conversationID)
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        do { try FileManager.default.removeItem(at: url) } catch { throw AgentCheckpointError.storage }
    }

    /// 供对话历史页回看；损坏的旧文件跳过，不影响其他对话。
    func list() -> [AgentCheckpoint] {
        guard let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return [] }
        return files.filter { $0.pathExtension == "json" }
            .compactMap { try? Self.decoder().decode(AgentCheckpoint.self, from: Data(contentsOf: $0)) }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    private static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }

    private static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
