import Foundation
import SQLite3
import ReadiumShared
import NaturalLanguage

/// Scope is enforced before scoring and again when resolving source ranges.
/// EPUB chapters are reading-order indexes; for PDF books a chapter is one page
/// (ordinal = page - 1), so `throughChapter`/`chapters` already express page ranges.
struct BookEvidenceScope: Codable {
    let bookID: String
    var throughChapter: Int = Int.max
    var throughOrdinal: Int = Int.max
    // Explicit, possibly disjoint reading-order resources; nil preserves legacy scopes.
    var chapters: [Int]? = nil
    func permits(chapter: Int, ordinal: Int) -> Bool {
        (chapters == nil || chapters!.contains(chapter)) &&
        (chapter < throughChapter || (chapter == throughChapter && ordinal <= throughOrdinal))
    }
    func contains(_ other: BookEvidenceScope) -> Bool {
        guard bookID == other.bookID,
              throughChapter > other.throughChapter || (throughChapter == other.throughChapter && throughOrdinal >= other.throughOrdinal) else { return false }
        guard let chapters else { return true }
        guard let previous = other.chapters else { return false }
        return Set(previous).isSubset(of: Set(chapters))
    }
    var sql: (filter: String, bounds: [String]) {
        let allowed = chapters.map { $0.isEmpty ? " AND 0" : " AND f.chapter IN (" + $0.map { _ in "?" }.joined(separator: ",") + ")" } ?? ""
        return ("f.book_id=? AND (f.chapter<? OR (f.chapter=? AND f.ordinal<=?))" + allowed,
                [bookID, String(throughChapter), String(throughChapter), String(throughOrdinal)] + (chapters ?? []).map(String.init))
    }
}
extension BookEvidenceScope {
    /// PDF 页级范围：限定证据只来自第 1...page 页（chapter = 页号 - 1）。
    init(bookID: String, throughPage page: Int) {
        self.bookID = bookID
        throughChapter = max(0, page - 1)
        throughOrdinal = Int.max
    }
}
struct RetrievalTrace: Codable {
    var keyword: [Int] = []
    var semantic: [Int] = []
    var anchors: [Int] = []
    var expanded: [Int] = []
}
struct BookRetrieval {
    var evidence: [QuestionEvidence]
    var trace: RetrievalTrace
}
extension BookIndex {
    func languageSample(bookID: String, scope: BookEvidenceScope? = nil) throws -> String {
        let db = try IndexDatabase(url: url)
        let scope = scope ?? BookEvidenceScope(bookID: bookID)
        guard scope.bookID == bookID else { throw QuestionError.scope }
        return String(try db.rows("SELECT original FROM fragments f WHERE " + scope.sql.filter + " ORDER BY chapter,ordinal LIMIT 6", scope.sql.bounds).map { $0[0] }.joined(separator: " ").prefix(500))
    }

    func localEvidence(scope: BookEvidenceScope, query: String) throws -> [QuestionEvidence] {
        let db = try IndexDatabase(url: url)
        var result: [QuestionEvidence] = []
        for term in QuestionPlan.keywords(query) {
            for hit in try db.search(scope.bookID, query: term, scope: scope) {
                let value = QuestionEvidence(locator: hit.locator, context: hit.locator.text.highlight)
                if try permits([value], scope: scope), !result.contains(where: { $0.locatorJSON == value.locatorJSON }) { result.append(value) }
                if result.count == 15 { return result }
            }
        }
        return result
    }

    func prepareVectors(bookID: String, embedding: SemanticEmbedding = .shared,
                        progress: @escaping @MainActor (BookPreparationState) async -> Void) async throws {
        try Task.checkCancellation()
        let db = try IndexDatabase(url: url)
        let count = try db.rows("SELECT count(*) FROM fragments WHERE book_id=?", [bookID])[0][0]
        try db.transaction {
            let previous = try db.rows("SELECT model,total FROM embedding_progress WHERE book_id=?", [bookID]).first
            if previous != [SemanticEmbedding.version, count] {
                try db.execute("DELETE FROM embeddings WHERE book_id=?", [bookID])
                try db.execute("DELETE FROM embedding_progress WHERE book_id=?", [bookID])
            }
            try db.execute("INSERT OR IGNORE INTO embedding_progress(book_id,model,total) VALUES(?,?,?)", [bookID, SemanticEmbedding.version, count])
        }
        var state = try db.state(bookID)
        state.preparing = !state.semanticReady
        await progress(state)
        let cursor = try db.rows("SELECT cursor FROM embedding_progress WHERE book_id=?", [bookID])[0][0]
        // A single book's immutable committed fragments; inference suspends without holding a transaction.
        let fragments = try db.rows("SELECT id,original FROM fragments WHERE book_id=? AND id>? ORDER BY id", [bookID, cursor])
        for row in fragments {
            try Task.checkCancellation()
            let pieces = try await embedding.chunks(row[1])
            var vectors: [[Float]] = []
            for piece in pieces { vectors.append(try await embedding.embedChunk(piece.text)) }
            try Task.checkCancellation()
            try db.transaction {
                for (ordinal, piece) in pieces.enumerated() {
                    let statement = try db.statement("INSERT INTO embeddings VALUES(?,?,?,?,?,?,?)", [bookID, SemanticEmbedding.version, row[0], String(ordinal), String(piece.offset), piece.text])
                    defer { sqlite3_finalize(statement) }
                    let status = vectors[ordinal].withUnsafeBytes { bytes in
                        sqlite3_bind_blob(statement, 7, bytes.baseAddress, Int32(bytes.count), unsafeBitCast(-1, to: sqlite3_destructor_type.self))
                    }
                    guard status == SQLITE_OK, sqlite3_step(statement) == SQLITE_DONE else { throw IndexError.storage }
                }
                try db.execute("UPDATE embedding_progress SET cursor=?,completed=completed+1 WHERE book_id=? AND model=?", [row[0], bookID, SemanticEmbedding.version])
            }
            state = try db.state(bookID); state.preparing = !state.semanticReady
            await progress(state)
        }
    }

    func retrieve(scope: BookEvidenceScope, query: String, topK: Int = 8) async throws -> BookRetrieval {
        let db = try IndexDatabase(url: url)
        guard try db.state(scope.bookID).semanticReady else { throw QuestionError.preparation }
        let limit = max(0, min(topK, 8))
        guard limit > 0 else { return BookRetrieval(evidence: [], trace: RetrievalTrace()) }
        let vector = try await SemanticEmbedding.shared.embed(query)
        try Task.checkCancellation()
        let (filter, bounds) = scope.sql
        let candidateLimit = 64
        let terms = QuestionPlan.keywords(query)
        let keywordFragments = try db.keywordFragments(scope: scope, terms: terms, limit: candidateLimit)
        // Both candidate pools stay bounded while scanning one existing block at a time.
        let statement = try db.statement("SELECT e.fragment_id,e.vector,e.piece,e.offset,e.original FROM embeddings e JOIN fragments f ON f.id=e.fragment_id WHERE " + filter + " AND e.book_id=f.book_id AND e.model=?", bounds + [SemanticEmbedding.version])
        defer { sqlite3_finalize(statement) }
        struct BlockID: Hashable { let fragment: Int; let offset: Int; let length: Int }
        struct Match {
            let id: Int; let piece: Int; let offset: Int; let score: Float; let keyword: Int; let evidence: QuestionEvidence
            var key: BlockID { BlockID(fragment: id, offset: offset, length: evidence.quote.utf16.count) }
        }
        func sourceOrder(_ a: Match, _ b: Match) -> Bool {
            if a.id != b.id { return a.id < b.id }
            return a.piece == b.piece ? a.offset < b.offset : a.piece < b.piece
        }
        func semanticOrder(_ a: Match, _ b: Match) -> Bool {
            if a.score != b.score { return a.score > b.score }
            return sourceOrder(a, b)
        }
        func keywordOrder(_ a: Match, _ b: Match) -> Bool {
            if a.keyword != b.keyword { return a.keyword > b.keyword }
            return sourceOrder(a, b)
        }
        func retain(_ match: Match, in matches: inout [Match], by precedes: (Match, Match) -> Bool) {
            if let duplicate = matches.firstIndex(where: { $0.key == match.key }) {
                guard precedes(match, matches[duplicate]) else { return }
                matches.remove(at: duplicate)
            }
            matches.append(match); matches.sort(by: precedes)
            if matches.count > candidateLimit { matches.removeLast() }
        }
        var semantic: [Match] = [], keyword: [Match] = []
        while true {
            try Task.checkCancellation()
            let step = sqlite3_step(statement)
            if step == SQLITE_DONE { break }
            guard step == SQLITE_ROW, sqlite3_column_bytes(statement, 1) == 1536, let blob = sqlite3_column_blob(statement, 1) else { throw IndexError.storage }
            var dot: Float = 0
            for i in vector.indices { dot += blob.loadUnaligned(fromByteOffset: i * 4, as: Float.self) * vector[i] }
            guard dot.isFinite else { throw IndexError.storage }
            let id = Int(sqlite3_column_int64(statement, 0))
            let piece = Int(sqlite3_column_int(statement, 2))
            let vectorCandidate = semantic.count < candidateLimit || semantic.last.map {
                dot > $0.score || (dot == $0.score && (id < $0.id || (id == $0.id && piece < $0.piece)))
            } == true
            guard vectorCandidate || keywordFragments.contains(id) else { continue }
            let offset = Int(sqlite3_column_int(statement, 3))
            let original = String(cString: sqlite3_column_text(statement, 4))
            let lexical = keywordFragments.contains(id) ? terms.filter { original.range(of: $0, options: [.caseInsensitive, .diacriticInsensitive]) != nil }.count : 0
            guard vectorCandidate || lexical > 0 else { continue }
            let range = NSRange(location: offset, length: original.utf16.count)
            guard let value = try db.evidence(id: id, scope: scope, range: range), value.quote == original else { throw IndexError.source }
            let match = Match(id: id, piece: piece, offset: offset, score: dot, keyword: lexical, evidence: value)
            if vectorCandidate { retain(match, in: &semantic, by: semanticOrder) }
            if lexical > 0 { retain(match, in: &keyword, by: keywordOrder) }
        }
        var scores: [BlockID: Double] = [:], blocks: [BlockID: Match] = [:]
        for list in [semantic, keyword] {
            for (rank, match) in list.enumerated() {
                scores[match.key, default: 0] += 1 / Double(2 + rank)
                blocks[match.key] = match
            }
        }
        let matches = blocks.values.sorted {
            scores[$0.key] == scores[$1.key] ? sourceOrder($0, $1) : scores[$0.key]! > scores[$1.key]!
        }.prefix(limit)
        let selected = Set(matches.map(\.key))
        return BookRetrieval(evidence: matches.map(\.evidence), trace: RetrievalTrace(keyword: keyword.filter { selected.contains($0.key) }.map(\.id), semantic: semantic.filter { selected.contains($0.key) }.map(\.id), anchors: matches.map(\.id)))
    }
}

extension IndexDatabase {
    func scopedFragments(scope: BookEvidenceScope) throws -> [[String]] {
        let sql = scope.sql
        return try rows("SELECT f.id,f.chapter,f.ordinal,f.locator,f.original FROM fragments f WHERE " + sql.filter + " ORDER BY f.chapter,f.ordinal", sql.bounds)
    }

    func evidence(id: Int, scope: BookEvidenceScope, range: NSRange? = nil) throws -> QuestionEvidence? {
        guard let row = try rows("SELECT chapter,ordinal,locator,original FROM fragments WHERE id=? AND book_id=?", [String(id), scope.bookID]).first,
              scope.permits(chapter: Int(row[0])!, ordinal: Int(row[1])!),
              var locator = try Locator(json: JSONValue(jsonString: row[2], warnings: nil), warnings: nil) else { return nil }
        let original = row[3] as NSString
        let span = range ?? NSRange(location: 0, length: original.length)
        guard span.location >= 0, span.length > 0, NSMaxRange(span) <= original.length else { return nil }
        let quote = original.substring(with: span)
        // PDF locators are page-level fragments: there is no DOM mapping, so the page fragment
        // itself is the canonical source range and the EPUB DOM rebuild below is skipped.
        if !locator.mediaType.matches(.pdf), let nodes = locator.locations.otherLocations["shudengTextNodes"]?.array {
            func point(_ offset: Int, end: Bool) -> DOMRange.Point? {
                for node in nodes {
                    guard let value = node.object, let start = value["start"]?.integer, let length = value["length"]?.integer, length > 0,
                          offset >= start, end ? offset <= start + length : offset < start + length,
                          let selector = value["selector"]?.string, let child = value["child"]?.integer else { continue }
                    return DOMRange.Point(cssSelector: selector, textNodeIndex: child, charOffset: offset - start)
                }
                return nil
            }
            let start = (locator.text.before ?? "").utf16.count + span.location
            guard let a = point(start, end: false), let b = point(start + span.length, end: true) else { throw IndexError.source }
            locator.locations.otherLocations["domRange"] = .object(DOMRange(start: a, end: b).jsonObject)
            locator.locations.otherLocations.removeValue(forKey: "shudengTextNodes")
        }
        locator.text = .init(after: original.substring(from: NSMaxRange(span)) + (locator.text.after ?? ""),
                             before: (locator.text.before ?? "") + original.substring(to: span.location), highlight: quote)
        return QuestionEvidence(locator: locator, context: quote)
    }
}

extension BookIndex {
    func permits(_ evidence: [QuestionEvidence], scope: BookEvidenceScope) throws -> Bool {
        let db = try IndexDatabase(url: url)
        let fragments = try db.scopedFragments(scope: scope)
        for value in evidence where !value.quote.isEmpty {
            let location = try value.location()
            let found = try fragments.contains { row in
                guard let source = try Locator(json: JSONValue(jsonString: row[3], warnings: nil), warnings: nil),
                      source.href == location.href else { return false }
                let original = row[4] as NSString
                let fragmentStart = (source.text.before ?? "").utf16.count
                if let range = location.locations.otherLocations["domRange"]?.object,
                   let nodes = source.locations.otherLocations["shudengTextNodes"]?.array {
                    func offset(_ point: JSONValue?) -> Int? {
                        guard let point = point?.object, let selector = point["cssSelector"]?.string,
                              let child = point["textNodeIndex"]?.integer, let character = point["charOffset"]?.integer else { return nil }
                        for node in nodes {
                            guard let node = node.object, node["selector"]?.string == selector, node["child"]?.integer == child,
                                  let start = node["start"]?.integer, let length = node["length"]?.integer,
                                  character >= 0, character <= length else { continue }
                            return start + character
                        }
                        return nil
                    }
                    guard let start = offset(range["start"]), let end = offset(range["end"]),
                          start >= fragmentStart, end >= start, end <= fragmentStart + original.length else { return false }
                    return original.substring(with: NSRange(location: start - fragmentStart, length: end - start)) == value.quote
                }
                if location.mediaType.matches(.pdf) {
                    // PDF 页级 locator 没有 DOM；选区 before 是「页面内 quote 前 80 字」，与
                    // fragment before（fragment 前 80 字）不能拼接反推偏移（页中下部选区会算错）。
                    // 改为在 fragment 原文中直接定位 quote：精确匹配 → 忽略空白/换行归一化匹配；
                    // 都失败才回退旧的 before 偏移算法，保持既有边界不放宽。
                    if Self.pdfQuote(value.quote, occursIn: original) { return true }
                    guard let before = location.text.before, before.hasPrefix(source.text.before ?? "") else { return false }
                    let start = before.utf16.count - (source.text.before ?? "").utf16.count
                    guard start >= 0, start + value.quote.utf16.count <= original.length else { return false }
                    return original.substring(with: NSRange(location: start, length: value.quote.utf16.count)) == value.quote
                }
                guard source.locations.cssSelector == location.locations.cssSelector,
                      let before = location.text.before, before.hasPrefix(source.text.before ?? "") else { return false }
                let start = before.utf16.count - fragmentStart
                guard start >= 0, start + value.quote.utf16.count <= original.length else { return false }
                return original.substring(with: NSRange(location: start, length: value.quote.utf16.count)) == value.quote
            }
            if !found { return false }
        }
        return true
    }

    /// PDF 页级证据的内容定位：直接在 fragment 原文中查找 quote。
    /// 先精确子串；失败则忽略空白/换行/不可见字符后再查找（PDF 抽取的换行位置可能与选区
    /// 字符串不一致）。仍找不到返回 false，由调用方回退旧的 before 偏移算法。
    private static func pdfQuote(_ quote: String, occursIn original: NSString) -> Bool {
        guard !quote.isEmpty else { return false }
        if original.range(of: quote).location != NSNotFound { return true }
        let normalizedQuote = pdfNormalized(quote)
        guard !normalizedQuote.isEmpty else { return false }
        return pdfNormalized(original as String).contains(normalizedQuote)
    }

    /// 归一化 PDF 文本：只去掉空白、换行与抽取产生的软连字符/零宽字符，不改动可见字符。
    private static func pdfNormalized(_ text: String) -> String {
        String(text.filter { character in
            if character.isWhitespace { return false }
            return character != "\u{00AD}" && character != "\u{200B}" && character != "\u{FEFF}"
        })
    }
}


/// Offline structural assessment. Kept separate from the production question path.
struct SourceSentenceUnit: Codable {
    let id: String
    let fragmentID: Int
    let chapter: String
    let start: Int
    let length: Int
    let evidence: QuestionEvidence
    static func ranges(_ text: String, language: NLLanguage?) -> [NSRange] {
        // EPUB source newlines often wrap a sentence; mask them without changing UTF-16 positions.
        let masked = text.replacingOccurrences(of: "\r", with: " ").replacingOccurrences(of: "\n", with: " ")
        let tokenizer = NLTokenizer(unit: .sentence)
        tokenizer.string = masked
        if let language { tokenizer.setLanguage(language) }
        var ends: [Int] = []
        tokenizer.enumerateTokens(in: masked.startIndex..<masked.endIndex) { range, _ in
            ends.append(NSMaxRange(NSRange(range, in: masked))); return true
        }
        let length = (text as NSString).length
        if ends.last != length { ends.append(length) }
        var result: [NSRange] = [], start = 0
        for end in ends where end > start { result.append(NSRange(location: start, length: end - start)); start = end }
        return result
    }
}
struct AtomicSourceGroup: Codable {
    let id: String
    let anchorIDs: [String]
    let unitIDs: [String]
}
struct SentenceUnitAssessment: Codable {
    let query: String
    let units: [SourceSentenceUnit]
    let candidateIDs: [String]
    let groups: [AtomicSourceGroup]
    let selectedGroupIDs: [String]
    let omittedGroupIDs: [String]
    let finalUnitIDs: [String]
    let payload: String
    let ranking: String
}

extension BookIndex {
    /// Immutable units cover every original UTF-16 code unit once, including whitespace.
    /// Model child chunks all point back to their complete parent sentence.
    func sentenceUnits(scope: BookEvidenceScope) throws -> [SourceSentenceUnit] {
        let db = try IndexDatabase(url: url)
        let rows = try db.scopedFragments(scope: scope)
        let language = NLLanguageRecognizer.dominantLanguage(for: rows.prefix(20).map { $0[4] }.joined(separator: " "))
        var units: [SourceSentenceUnit] = []
        for row in rows {
            guard let location = try Locator(json: JSONValue(jsonString: row[3], warnings: nil), warnings: nil) else { throw IndexError.source }
            let text = row[4], source = text as NSString
            let chapter = location.locations.otherLocations["shudengChapter"]?.string ?? location.href.string
            for range in SourceSentenceUnit.ranges(text, language: language) {
                let start = range.location
                guard let evidence = try db.evidence(id: Int(row[0])!, scope: scope, range: range) else { throw IndexError.source }
                let id = scope.bookID + ":" + chapter + ":" + row[0] + ":" + String(start) + ":" + String(range.length)
                units.append(SourceSentenceUnit(id: id, fragmentID: Int(row[0])!, chapter: chapter, start: start, length: range.length, evidence: evidence))
            }
        }
        return units
    }

    /// Writes only the explicitly supplied isolated derived database, never the book index.
    func prepareSentenceUnitVectors(scope: BookEvidenceScope, derivedURL: URL) async throws {
        guard derivedURL.standardizedFileURL != url.standardizedFileURL else { throw IndexError.storage }
        let units = try sentenceUnits(scope: scope)
        let db = try IndexDatabase(url: derivedURL)
        try db.execute("CREATE TABLE IF NOT EXISTS sentence_units(id TEXT PRIMARY KEY,book TEXT NOT NULL,source TEXT NOT NULL,model TEXT NOT NULL)")
        try db.execute("CREATE VIRTUAL TABLE IF NOT EXISTS sentence_terms USING fts5(id UNINDEXED,book UNINDEXED,terms)")
        try db.execute("CREATE TABLE IF NOT EXISTS sentence_vectors(id TEXT NOT NULL,piece INTEGER NOT NULL,offset INTEGER NOT NULL,original TEXT NOT NULL,vector BLOB NOT NULL CHECK(length(vector)=1536),PRIMARY KEY(id,piece))")
        for (position, unit) in units.enumerated() {
            try Task.checkCancellation()
            let previous = try db.rows("SELECT source,model FROM sentence_units WHERE id=?", [unit.id]).first
            if previous == [unit.evidence.quote, SemanticEmbedding.version] { continue }
            let pieces = try await SemanticEmbedding.shared.chunks(unit.evidence.quote)
            var vectors: [[Float]] = []
            for piece in pieces { vectors.append(try await SemanticEmbedding.shared.embed(piece.text)) }
            try db.transaction {
                try db.execute("DELETE FROM sentence_vectors WHERE id=?", [unit.id])
                try db.execute("DELETE FROM sentence_terms WHERE id=?", [unit.id])
                try db.execute("INSERT OR REPLACE INTO sentence_units VALUES(?,?,?,?)", [unit.id, scope.bookID, unit.evidence.quote, SemanticEmbedding.version])
                try db.execute("INSERT INTO sentence_terms VALUES(?,?,?)", [unit.id, scope.bookID, BookText.tokens(unit.evidence.quote)])
                for (i, piece) in pieces.enumerated() {
                    let statement = try db.statement("INSERT INTO sentence_vectors VALUES(?,?,?,?,?)", [unit.id, String(i), String(piece.offset), piece.text])
                    defer { sqlite3_finalize(statement) }
                    let status = vectors[i].withUnsafeBytes { bytes in
                        sqlite3_bind_blob(statement, 5, bytes.baseAddress, Int32(bytes.count), unsafeBitCast(-1, to: sqlite3_destructor_type.self))
                    }
                    guard status == SQLITE_OK, sqlite3_step(statement) == SQLITE_DONE else { throw IndexError.storage }
                }
            }
            if position % 500 == 0 { print("I11_SENTENCE_PREP \(position)/\(units.count)") }
        }
    }

    func assessSentenceUnits(scope: BookEvidenceScope, query: String, derivedURL: URL, wholeBook: Bool) async throws -> SentenceUnitAssessment {
        let units = try sentenceUnits(scope: scope)
        let db = try IndexDatabase(url: derivedURL)
        let allowed = Set(units.map(\.id))
        let vector = try await SemanticEmbedding.shared.embed(query)
        var semantic: [String: Float] = [:]
        let statement = try db.statement("SELECT v.id,v.vector FROM sentence_vectors v JOIN sentence_units u ON u.id=v.id WHERE u.book=? AND u.model=?", [scope.bookID, SemanticEmbedding.version])
        defer { sqlite3_finalize(statement) }
        while true {
            try Task.checkCancellation()
            let step = sqlite3_step(statement)
            if step == SQLITE_DONE { break }
            guard step == SQLITE_ROW, let blob = sqlite3_column_blob(statement, 1), sqlite3_column_bytes(statement, 1) == 1536 else { throw IndexError.storage }
            let id = String(cString: sqlite3_column_text(statement, 0))
            guard allowed.contains(id) else { continue }
            var score: Float = 0
            for i in vector.indices { score += vector[i] * blob.loadUnaligned(fromByteOffset: i * 4, as: Float.self) }
            guard score.isFinite else { throw IndexError.storage }
            semantic[id] = max(semantic[id, default: -.infinity], score)
        }
        guard allowed.isSubset(of: Set(semantic.keys)) else { throw QuestionError.preparation }
        var lexical: [String: Int] = [:]
        let byID = Dictionary(uniqueKeysWithValues: units.map { ($0.id, $0) })
        for term in QuestionPlan.keywords(query) {
            let tokens = BookText.tokens(term, query: true)
            guard !tokens.isEmpty else { continue }
            for row in try db.rows("SELECT id FROM sentence_terms WHERE sentence_terms MATCH ? AND book=?", [tokens, scope.bookID]) {
                if let unit = byID[row[0]], unit.evidence.quote.range(of: term, options: [.caseInsensitive, .diacriticInsensitive]) != nil { lexical[row[0], default: 0] += 1 }
            }
        }
        let chapters = Dictionary(grouping: units.indices, by: { units[$0].chapter })
        var anchors: [Int] = [], relevance: [String: Double] = [:]
        let sets = wholeBook ? chapters.values.map(Array.init) : [Array(units.indices)]
        for members in sets {
            let semanticOrder = members.sorted { semantic[units[$0].id]! == semantic[units[$1].id]! ? $0 < $1 : semantic[units[$0].id]! > semantic[units[$1].id]! }
            let lexicalOrder = members.filter { lexical[units[$0].id] != nil }.sorted { lexical[units[$0].id]! == lexical[units[$1].id]! ? $0 < $1 : lexical[units[$0].id]! > lexical[units[$1].id]! }
            var fusion: [Int: Double] = [:]
            for list in [semanticOrder, lexicalOrder] {
                for (rank, id) in list.enumerated() { fusion[id, default: 0] += 1 / Double(61 + rank) }
            }
            let ranked = members.sorted { fusion[$0, default: 0] == fusion[$1, default: 0] ? $0 < $1 : fusion[$0, default: 0] > fusion[$1, default: 0] }
            anchors += ranked.prefix(wholeBook ? 2 : 5)
            for id in ranked { relevance[units[id].id] = fusion[id] }
        }
        // Form source-contiguous groups; overlapping groups merge rather than duplicate/split.
        var intervals: [(lower: Int, upper: Int, anchors: [String])] = []
        for anchor in anchors.sorted() {
            let lower = anchor > 0 && units[anchor - 1].chapter == units[anchor].chapter ? anchor - 1 : anchor
            let upper = anchor + 1 < units.count && units[anchor + 1].chapter == units[anchor].chapter ? anchor + 1 : anchor
            if let last = intervals.last, lower <= last.upper, units[lower].chapter == units[last.lower].chapter {
                intervals[intervals.count - 1] = (last.lower, max(last.upper, upper), last.anchors + [units[anchor].id])
            } else { intervals.append((lower, upper, [units[anchor].id])) }
        }
        let groups = intervals.enumerated().map { i, span in AtomicSourceGroup(id: "G\(i + 1)", anchorIDs: span.anchors, unitIDs: units[span.lower...span.upper].map(\.id)) }
        let ordered = groups.sorted { a, b in
            let left = a.anchorIDs.map { relevance[$0, default: 0] }.max() ?? 0
            let right = b.anchorIDs.map { relevance[$0, default: 0] }.max() ?? 0
            return left == right ? a.id < b.id : left > right
        }
        var selected: [AtomicSourceGroup] = [], omitted: [String] = []
        func payload(_ groups: [AtomicSourceGroup]) throws -> String {
            let ids = Set(groups.flatMap(\.unitIDs))
            let material = units.filter { ids.contains($0.id) }.map { ["id": $0.id, "chapter": $0.evidence.chapter, "quote": $0.evidence.quote] }
            let data = try JSONSerialization.data(withJSONObject: ["bookID": scope.bookID, "question": query, "evidence": material, "groups": groups.map { ["id": $0.id, "units": $0.unitIDs] }], options: [.sortedKeys])
            return String(decoding: data, as: UTF8.self)
        }
        for group in ordered {
            if try payload(selected + [group]).utf8.count <= 23000 { selected.append(group) }
            else { omitted.append(group.id) }
        }
        let finalIDs = Set(selected.flatMap(\.unitIDs))
        let evidence = units.filter { finalIDs.contains($0.id) }.map(\.evidence)
        guard try permits(evidence, scope: scope) else { throw QuestionError.scope }
        return SentenceUnitAssessment(query: query, units: units, candidateIDs: anchors.map { units[$0].id }, groups: groups, selectedGroupIDs: selected.map(\.id), omittedGroupIDs: omitted, finalUnitIDs: units.filter { finalIDs.contains($0.id) }.map(\.id), payload: try payload(selected), ranking: "Existing MiniLM cosine plus unit-level lexical RRF; no joint reranker, no translation")
    }
}
