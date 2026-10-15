import Foundation
import CryptoKit
import SemanticRuntime
import zlib

enum EmbeddingError: LocalizedError {
    case unavailable, inference
    var errorDescription: String? {
        switch self {
        case .unavailable: return "本地语义模型不可用，请重新安装应用后重试；仍可阅读和搜索原文"
        case .inference: return "本地语义推理失败，可重试准备；仍可阅读和搜索原文"
        }
    }
}

/// One local model space for both document and query vectors. No network calls.
actor SemanticEmbedding {
    static let shared = SemanticEmbedding()
    static let version = "minilm-e8f8c211-arm64-int8-128-mean-l2-v1"
    static let dimension = 384
    static let modelSHA = "783fea82d71a58179b830a4dbd2d58447e640609e98eedf9ffa12622d375a672"
    private let folder: URL?
    private var loading: Task<Model, Error>?
    init(folder: URL? = Bundle.main.url(forResource: "SemanticModel", withExtension: nil)) { self.folder = folder }

    private final class Model {
        let env: ORTEnv
        let session: ORTSession
        let tokenizer: any Tokenizer
        init(folder: URL) async throws {
            tokenizer = try await AutoTokenizer.from(modelFolder: folder)
            let manager = FileManager.default
            let cache = try manager.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                .appendingPathComponent("SemanticModel", isDirectory: true)
            try manager.createDirectory(at: cache, withIntermediateDirectories: true)
            let model = cache.appendingPathComponent(SemanticEmbedding.modelSHA + ".onnx")
            if !manager.fileExists(atPath: model.path) {
                let temporary = cache.appendingPathComponent(UUID().uuidString)
                defer { try? manager.removeItem(at: temporary) }
                guard let source = gzopen(folder.appendingPathComponent("model.onnx.gz").path, "rb") else { throw EmbeddingError.unavailable }
                defer { gzclose(source) }
                manager.createFile(atPath: temporary.path, contents: nil)
                let output = try FileHandle(forWritingTo: temporary)
                defer { try? output.close() }
                var buffer = [UInt8](repeating: 0, count: 1_048_576)
                var hash = SHA256()
                while true {
                    let count = gzread(source, &buffer, UInt32(buffer.count))
                    guard count >= 0 else { throw EmbeddingError.unavailable }
                    if count == 0 { break }
                    let data = Data(buffer.prefix(Int(count)))
                    hash.update(data: data); try output.write(contentsOf: data)
                }
                guard hash.finalize().map({ String(format: "%02x", $0) }).joined() == SemanticEmbedding.modelSHA else { throw EmbeddingError.unavailable }
                try output.close(); try manager.moveItem(at: temporary, to: model)
            }
            env = try ORTEnv(loggingLevel: .warning)
            let options = try ORTSessionOptions()
            try options.setIntraOpNumThreads(2)
            try options.setGraphOptimizationLevel(.all)
            // CPU is the verified INT8 execution path; no unmeasured ANE claim.
            session = try ORTSession(env: env, modelPath: model.path, sessionOptions: options)
        }
    }
    private func model() async throws -> Model {
        if loading == nil {
            guard let folder else { throw EmbeddingError.unavailable }
            loading = Task { try await Model(folder: folder) }
        }
        do { return try await loading!.value }
        catch { loading = nil; throw EmbeddingError.unavailable }
    }
    func tokenIDs(_ text: String) async throws -> [Int] { try await model().tokenizer.encode(text: text) }

    /// Exact source substrings; each is small enough for the model, including specials.
    func chunks(_ text: String) async throws -> [(text: String, offset: Int)] {
        let tokenizer = try await model().tokenizer
        var result: [(String, Int)] = []
        var start = text.startIndex
        while start < text.endIndex {
            try Task.checkCancellation()
            var end = text.index(start, offsetBy: 512, limitedBy: text.endIndex) ?? text.endIndex
            while tokenizer.encode(text: String(text[start..<end])).count > 128 {
                end = text.index(start, offsetBy: max(1, text.distance(from: start, to: end) / 2))
            }
            result.append((String(text[start..<end]), text[..<start].utf16.count))
            start = end
        }
        return result
    }
    func embed(_ text: String) async throws -> [Float] {
        let model = try await model()
        try Task.checkCancellation()
        // Queries can be long; average separately normalized windows rather than silently truncating.
        let pieces = try await chunks(text)
        guard !pieces.isEmpty else { throw EmbeddingError.inference }
        var combined = [Float](repeating: 0, count: Self.dimension)
        for piece in pieces {
            try Task.checkCancellation()
            let ids = model.tokenizer.encode(text: piece.text).map(Int64.init)
            func value(_ numbers: [Int64]) throws -> ORTValue {
                let data = numbers.withUnsafeBytes { Data($0) }
                return try ORTValue(tensorData: NSMutableData(data: data), elementType: .int64, shape: [1, NSNumber(value: ids.count)])
            }
            do {
                let inputs = ["input_ids": try value(ids), "attention_mask": try value(Array(repeating: 1, count: ids.count)), "token_type_ids": try value(Array(repeating: 0, count: ids.count))]
                let outputName = try model.session.outputNames()[0]
                let output = try model.session.run(withInputs: inputs, outputNames: [outputName], runOptions: nil)
                guard let tensor = output[outputName] else { throw EmbeddingError.inference }
                let data = try tensor.tensorData() as Data
                guard data.count == ids.count * Self.dimension * MemoryLayout<Float>.size else { throw EmbeddingError.inference }
                var pooled = [Float](repeating: 0, count: Self.dimension)
                data.withUnsafeBytes { bytes in
                    for i in 0..<(ids.count * Self.dimension) { pooled[i % Self.dimension] += bytes.loadUnaligned(fromByteOffset: i * 4, as: Float.self) / Float(ids.count) }
                }
                pooled = try Self.normalized(pooled)
                for i in combined.indices { combined[i] += pooled[i] }
            } catch { throw EmbeddingError.inference }
        }
        return try Self.normalized(combined)
    }
    private static func normalized(_ vector: [Float]) throws -> [Float] {
        let norm = sqrt(vector.reduce(Float(0)) { $0 + $1 * $1 })
        guard norm.isFinite, norm > 0, vector.allSatisfy(\.isFinite) else { throw EmbeddingError.inference }
        return vector.map { $0 / norm }
    }
}
