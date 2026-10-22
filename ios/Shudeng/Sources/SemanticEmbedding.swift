import Foundation
import CryptoKit
import SemanticRuntime
import zlib
import NaturalLanguage

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
    static let version = "minilm-e8f8c211-arm64-int8-128-mean-l2-sentence100-overlap20-v2"
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
            // Keep tokenizer allocations out of the session initialization peak.
            tokenizer = try await AutoTokenizer.from(modelFolder: folder)
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
        guard !text.isEmpty else { return [] }
        let source = text as NSString
        let specials = tokenizer.encode(text: "").count
        let target = min(128, 100 + specials)
        func count(_ range: NSRange) -> Int { tokenizer.encode(text: source.substring(with: range)).count }
        // Mask soft line wraps without changing source UTF-16 positions. Blank lines
        // also end a paragraph when its final sentence has no punctuation.
        let masked = text.replacingOccurrences(of: "\r", with: " ").replacingOccurrences(of: "\n", with: " ")
        let sentences = NLTokenizer(unit: .sentence)
        sentences.string = masked
        if let language = NLLanguageRecognizer.dominantLanguage(for: text) { sentences.setLanguage(language) }
        var ends = Set<Int>()
        sentences.enumerateTokens(in: masked.startIndex..<masked.endIndex) { range, _ in
            ends.insert(NSMaxRange(NSRange(range, in: masked))); return true
        }
        let paragraphs = try NSRegularExpression(pattern: "(?:\r?\n[ \t]*){2,}|\r[ \t]*\r")
        for match in paragraphs.matches(in: text, range: NSRange(location: 0, length: source.length)) { ends.insert(NSMaxRange(match.range)) }
        ends.insert(source.length)
        var units: [(range: NSRange, complete: Bool)] = [], start = 0
        for boundary in ends.sorted() {
            let end = NSMaxRange(source.rangeOfComposedCharacterSequences(for: NSRange(location: 0, length: boundary)))
            guard end > start else { continue }
            let range = NSRange(location: start, length: end - start)
            let sentence = source.substring(with: range)
            if count(range) <= 128 {
                let tail = sentence.trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: "\"'”’」』）》】)]}"))).last
                units.append((range, tail.map { ".!?。！？…".contains($0) } ?? false))
            } else {
                // Search only composed-character boundaries. Even a long sentence
                // keeps every source character; no tokenizer truncation is used.
                let indices = Array(sentence.indices) + [sentence.endIndex]
                var lower = 0, offset = start
                while lower < indices.count - 1 {
                    try Task.checkCancellation()
                    var low = lower + 1, high = indices.count - 1, best = lower
                    while low <= high {
                        let middle = low + (high - low) / 2
                        let length = sentence[indices[lower]..<indices[middle]].utf16.count
                        if count(NSRange(location: offset, length: length)) <= target { best = middle; low = middle + 1 }
                        else { high = middle - 1 }
                    }
                    if best == lower { best = lower + 1 }
                    let length = sentence[indices[lower]..<indices[best]].utf16.count
                    let piece = NSRange(location: offset, length: length)
                    guard count(piece) <= 128 else { throw EmbeddingError.inference }
                    units.append((piece, false)); offset += length; lower = best
                }
            }
            start = end
        }
        var result: [(String, Int)] = [], current: NSRange?
        var previous: (range: NSRange, complete: Bool)?
        for unit in units {
            try Task.checkCancellation()
            if let span = current {
                let combined = NSRange(location: span.location, length: NSMaxRange(unit.range) - span.location)
                if count(combined) <= target { current = combined }
                else {
                    result.append((source.substring(with: span), span.location))
                    current = unit.range
                    if let previous, previous.complete, previous.range.location > span.location,
                       count(previous.range) - specials <= 20 {
                        let overlap = NSRange(location: previous.range.location, length: NSMaxRange(unit.range) - previous.range.location)
                        if count(overlap) <= target { current = overlap }
                    }
                }
            } else { current = unit.range }
            previous = unit
        }
        if let current { result.append((source.substring(with: current), current.location)) }
        return result
    }
    /// A stored block is encoded exactly once, without another split or overlap.
    func embedChunk(_ text: String) async throws -> [Float] {
        let model = try await model()
        try Task.checkCancellation()
        return try encode(text, model: model)
    }
    func embed(_ text: String) async throws -> [Float] {
        let model = try await model()
        try Task.checkCancellation()
        if model.tokenizer.encode(text: text).count <= 128 { return try encode(text, model: model) }
        // Long queries use every window rather than silently truncating the tail.
        let pieces = try await chunks(text)
        guard !pieces.isEmpty else { throw EmbeddingError.inference }
        var combined = [Float](repeating: 0, count: Self.dimension)
        for piece in pieces {
            try Task.checkCancellation()
            let vector = try encode(piece.text, model: model)
            for i in combined.indices { combined[i] += vector[i] }
        }
        return try Self.normalized(combined)
    }
    private func encode(_ text: String, model: Model) throws -> [Float] {
        let ids = model.tokenizer.encode(text: text).map(Int64.init)
        guard !text.isEmpty, !ids.isEmpty, ids.count <= 128 else { throw EmbeddingError.inference }
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
            return try Self.normalized(pooled)
        } catch { throw EmbeddingError.inference }
    }
    private static func normalized(_ vector: [Float]) throws -> [Float] {
        let norm = sqrt(vector.reduce(Float(0)) { $0 + $1 * $1 })
        guard norm.isFinite, norm > 0, vector.allSatisfy(\.isFinite) else { throw EmbeddingError.inference }
        return vector.map { $0 / norm }
    }
}
