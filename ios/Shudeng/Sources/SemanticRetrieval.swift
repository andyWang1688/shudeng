import Foundation
import SQLite3
import ReadiumShared

/// Scope is enforced before scoring and again for neighbor expansion.
struct BookEvidenceScope: Codable {
    let bookID: String
    var throughChapter: Int = Int.max
    var throughOrdinal: Int = Int.max
    func permits(chapter: Int, ordinal: Int) -> Bool {
        chapter < throughChapter || (chapter == throughChapter && ordinal <= throughOrdinal)
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
struct ChapterRank: Codable {
    let fragmentID: Int
    let chapter: String
    let semanticRank: Int
    let lexicalRank: Int?
    let score: Float
    let piece: Int
    let offset: Int
    let matchedText: String
}
struct ChapterRetrieval {
    let evidence: [QuestionEvidence]
    let ranks: [ChapterRank]
    var groups: [[QuestionEvidence]] = []
}

extension BookIndex {
    /// Local, chapter-stratified candidates. A source paragraph is never truncated at its head.
    func chapterCandidates(scope: BookEvidenceScope, query: String) async throws -> ChapterRetrieval {
        let db = try IndexDatabase(url: url)
        guard try db.state(scope.bookID).semanticReady else { throw QuestionError.preparation }
        let vector = try await SemanticEmbedding.shared.embed(query)
        let rows = try db.rows("SELECT id,chapter,ordinal,locator,original FROM fragments WHERE book_id=? ORDER BY chapter,ordinal", [scope.bookID])
        let allowed = rows.filter { scope.permits(chapter: Int($0[1])!, ordinal: Int($0[2])!) }
        let ids = Set(allowed.map { Int($0[0])! })
        var groups: [String: [Int]] = [:], order: [String] = [], scores: [Int: Float] = [:]
        for row in allowed {
            guard let locator = try Locator(json: JSONValue(jsonString: row[3], warnings: nil), warnings: nil) else { throw IndexError.storage }
            let key = locator.locations.otherLocations["shudengChapter"]?.string ?? locator.href.string
            if groups[key] == nil { order.append(key) }
            groups[key, default: []].append(Int(row[0])!)
        }
        var matches: [Int: (piece: Int, offset: Int, text: String)] = [:]
        let statement = try db.statement("SELECT fragment_id,vector,piece,offset,original FROM embeddings WHERE book_id=? AND model=?", [scope.bookID, SemanticEmbedding.version])
        defer { sqlite3_finalize(statement) }
        while true {
            try Task.checkCancellation()
            let step = sqlite3_step(statement)
            if step == SQLITE_DONE { break }
            guard step == SQLITE_ROW, sqlite3_column_bytes(statement, 1) == 1536, let blob = sqlite3_column_blob(statement, 1) else { throw IndexError.storage }
            let id = Int(sqlite3_column_int64(statement, 0))
            guard ids.contains(id) else { continue }
            var score: Float = 0
            for i in vector.indices { score += vector[i] * blob.loadUnaligned(fromByteOffset: i * 4, as: Float.self) }
            if score > scores[id, default: -.infinity] {
                scores[id] = score
                matches[id] = (Int(sqlite3_column_int(statement, 2)), Int(sqlite3_column_int(statement, 3)), String(cString: sqlite3_column_text(statement, 4)))
            }
        }
        let originals = Dictionary(uniqueKeysWithValues: allowed.map { (Int($0[0])!, $0[4]) })
        let terms = QuestionPlan.keywords(query)
        var result: [QuestionEvidence] = []
        var ranks: [ChapterRank] = []
        for key in order {
            let members = groups[key]!
            let semantic = members.sorted { scores[$0, default: -.infinity] == scores[$1, default: -.infinity] ? $0 < $1 : scores[$0, default: -.infinity] > scores[$1, default: -.infinity] }
            let lexical = members.sorted {
                func hits(_ id: Int) -> Int { terms.filter { originals[id]!.localizedCaseInsensitiveContains($0) }.count }
                return hits($0) == hits($1) ? $0 < $1 : hits($0) > hits($1)
            }.filter { id in terms.contains { originals[id]!.localizedCaseInsensitiveContains($0) } }
            var fusion: [Int: Double] = [:]
            for list in [semantic, lexical] {
                for (rank, id) in list.enumerated() { fusion[id, default: 0] += 1 / Double(61 + rank) }
            }
            let ranked = members.sorted { fusion[$0, default: 0] == fusion[$1, default: 0] ? $0 < $1 : fusion[$0, default: 0] > fusion[$1, default: 0] }
            for (rank, id) in semantic.enumerated() {
                if let match = matches[id] {
                    ranks.append(ChapterRank(fragmentID: id, chapter: key, semanticRank: rank + 1,
                                             lexicalRank: lexical.firstIndex(of: id).map { $0 + 1 }, score: scores[id]!,
                                             piece: match.piece, offset: match.offset, matchedText: match.text))
                }
            }
            var chosen = Set(ranked.prefix(2))
            for id in Array(chosen) {
                guard let position = members.firstIndex(of: id) else { continue }
                for neighbor in max(0, position - 1)...min(members.count - 1, position + 1) { chosen.insert(members[neighbor]) }
            }
            for id in members where chosen.contains(id) {
                if let evidence = try db.evidence(id: id, scope: scope) { result.append(evidence) }
            }
        }
        return ChapterRetrieval(evidence: result, ranks: ranks)
    }

    /// Four query facets share one vector scan; source positions remain local.
    func chapterWindows(scope: BookEvidenceScope, queries: [String], wholeBook: Bool, originalQuery: String? = nil) async throws -> ChapterRetrieval {
        guard !queries.isEmpty, queries.count <= 4 else { throw QuestionError.coverage }
        let queries = queries + (originalQuery.map { [$0] } ?? [])
        let db = try IndexDatabase(url: url)
        guard try db.state(scope.bookID).semanticReady else { throw QuestionError.preparation }
        var vectors: [[Float]] = []
        for query in queries { vectors.append(try await SemanticEmbedding.shared.embed(query)) }
        let rows = try db.rows("SELECT id,chapter,ordinal,locator,original FROM fragments WHERE book_id=? ORDER BY chapter,ordinal", [scope.bookID])
            .filter { scope.permits(chapter: Int($0[1])!, ordinal: Int($0[2])!) }
        let sources = Dictionary(uniqueKeysWithValues: rows.map { (Int($0[0])!, $0) })
        var chapters: [String: [Int]] = [:], chapterOrder: [String] = []
        for row in rows {
            guard let locator = try Locator(json: JSONValue(jsonString: row[3], warnings: nil), warnings: nil) else { throw IndexError.storage }
            let chapter = locator.locations.otherLocations["shudengChapter"]?.string ?? locator.href.string
            if chapters[chapter] == nil { chapterOrder.append(chapter) }
            chapters[chapter, default: []].append(Int(row[0])!)
        }
        struct Match { let score: Float; let piece: Int; let offset: Int; let text: String }
        var matches = Array(repeating: [Int: Match](), count: queries.count)
        var pieceMatches = Array(repeating: [Int: [Match]](), count: queries.count)
        let statement = try db.statement("SELECT fragment_id,vector,piece,offset,original FROM embeddings WHERE book_id=? AND model=?", [scope.bookID, SemanticEmbedding.version])
        defer { sqlite3_finalize(statement) }
        while true {
            try Task.checkCancellation()
            let step = sqlite3_step(statement)
            if step == SQLITE_DONE { break }
            guard step == SQLITE_ROW, sqlite3_column_bytes(statement, 1) == 1536, let blob = sqlite3_column_blob(statement, 1) else { throw IndexError.storage }
            let id = Int(sqlite3_column_int64(statement, 0))
            guard sources[id] != nil else { continue }
            for q in vectors.indices {
                var score: Float = 0
                for i in vectors[q].indices { score += vectors[q][i] * blob.loadUnaligned(fromByteOffset: i * 4, as: Float.self) }
                guard score.isFinite else { throw IndexError.storage }
                let match = Match(score: score, piece: Int(sqlite3_column_int(statement, 2)), offset: Int(sqlite3_column_int(statement, 3)), text: String(cString: sqlite3_column_text(statement, 4)))
                if score > (matches[q][id]?.score ?? -.infinity) { matches[q][id] = match }
                var pieces = pieceMatches[q][id, default: []].filter { $0.piece != match.piece }
                pieces.append(match)
                pieceMatches[q][id] = Array(pieces.sorted { $0.score > $1.score }.prefix(3))
            }
        }
        // Compare ranks within each query; cosine magnitudes across facets are not comparable.
        var globalRanks: [[Int: Int]] = []
        for q in queries.indices {
            let ordered = matches[q].keys.sorted { matches[q][$0]!.score > matches[q][$1]!.score }
            globalRanks.append(Dictionary(uniqueKeysWithValues: ordered.enumerated().map { ($0.element, $0.offset) }))
        }
        struct Candidate { let id: Int; let chapter: String; let match: Match; let score: Float; let query: Int }
        var candidates: [Candidate] = [], ranks: [ChapterRank] = []
        for chapter in chapterOrder {
            let members = chapters[chapter]!
            var choices: [[Candidate]] = []
            for q in queries.indices {
                let ranked = members.sorted { (matches[q][$0]?.score ?? -.infinity) > (matches[q][$1]?.score ?? -.infinity) }
                let terms = QuestionPlan.keywords(queries[q])
                let lexical = members.sorted { a, b in
                    let left = terms.filter { sources[a]![4].localizedCaseInsensitiveContains($0) }.count
                    let right = terms.filter { sources[b]![4].localizedCaseInsensitiveContains($0) }.count
                    return left == right ? a < b : left > right
                }.filter { id in terms.contains { sources[id]![4].localizedCaseInsensitiveContains($0) } }
                var fusion: [Int: Double] = [:]
                for list in [ranked, lexical] {
                    for (rank, id) in list.enumerated() { fusion[id, default: 0] += 1 / Double(61 + rank) }
                }
                let hybrid = members.sorted { fusion[$0, default: 0] == fusion[$1, default: 0] ? $0 < $1 : fusion[$0, default: 0] > fusion[$1, default: 0] }
                for (rank, id) in ranked.enumerated() {
                    guard let match = matches[q][id] else { continue }
                    ranks.append(ChapterRank(fragmentID: id, chapter: chapter, semanticRank: rank + 1, lexicalRank: lexical.firstIndex(of: id).map { $0 + 1 }, score: match.score, piece: match.piece, offset: match.offset, matchedText: match.text))
                }
                choices.append(hybrid.prefix(2).flatMap { id in
                    pieceMatches[q][id, default: []].map { match in
                        Candidate(id: id, chapter: chapter, match: match, score: 1 / Float(61 + globalRanks[q][id, default: rows.count]), query: q)
                    }
                })
            }
            // Two anchors per facet, interleaved by rank; retain the role rather than
            // truncating all roles by one query's larger absolute cosine value.
            var chapterSeen = Set<String>()
            for rank in 0..<(choices.map(\.count).max() ?? 0) {
                for role in choices where role.indices.contains(rank) {
                    let candidate = role[rank]
                    if chapterSeen.insert("\(candidate.id):\(candidate.match.offset)").inserted { candidates.append(candidate) }
                }
            }
        }
        candidates.sort { $0.score == $1.score ? $0.id < $1.id : $0.score > $1.score }
        var seen = Set<String>(), selected: [QuestionEvidence] = [], groups: [[QuestionEvidence]] = []
        var usedChapters = Set<String>()
        @discardableResult func append(_ id: Int, offset: Int?, text: String?) throws -> QuestionEvidence? {
            guard let row = sources[id] else { return nil }
            let source = row[4] as NSString
            let start = min(max(offset ?? 0, 0), max(0, source.length - 1))
            var range = NSRange(location: start, length: min(text?.utf16.count ?? 1600, source.length - start))
            while source.substring(with: range).utf8.count > 1800 && range.length > 1 { range.length -= 1 }
            range = source.rangeOfComposedCharacterSequences(for: range)
            let key = "\(id):\(range.location):\(range.length)"
            guard let value = try db.evidence(id: id, scope: scope, range: range) else { return nil }
            if seen.insert(key).inserted { selected.append(value) }
            return value
        }
        // First pass gives each relevant chapter a chance before second anchors.
        let first = candidates.filter { usedChapters.insert($0.chapter).inserted }
        let ordered = wholeBook ? first + candidates.filter { candidate in !first.contains { $0.id == candidate.id && $0.match.offset == candidate.match.offset } } : candidates
        for candidate in ordered {
            guard let allMembers = chapters[candidate.chapter] else { continue }
            func parent(_ id: Int) throws -> String {
                guard let location = try Locator(json: JSONValue(jsonString: sources[id]![3], warnings: nil), warnings: nil) else { throw IndexError.storage }
                return (location.locations.cssSelector ?? "").split(separator: ">").dropLast().joined(separator: ">")
            }
            let container = try parent(candidate.id)
            // Sibling prose paragraphs exclude embedded illustration/copyright blocks.
            let members = try allMembers.filter { try parent($0) == container }
            guard let position = members.firstIndex(of: candidate.id) else { continue }
            let original = sources[candidate.id]![4].trimmingCharacters(in: .whitespacesAndNewlines)
            // Expand a dialogue in source order, bounded to four nearby paragraphs per side.
            let dialogue = original.hasPrefix("“") || original.hasPrefix("\"") || original.hasPrefix("「")
            let distance = dialogue ? 4 : 1
            var lower = max(0, position - distance), upper = min(members.count - 1, position + distance)
            func spoken(_ index: Int) -> Bool {
                let text = sources[members[index]]![4].trimmingCharacters(in: .whitespacesAndNewlines)
                return text.hasPrefix("“") || text.hasPrefix("\"") || text.hasPrefix("「")
            }
            // Preserve a continuous exchange, including a single intervening narration.
            // Stop at a prose transition or the explicit local scene byte budget.
            var sceneBytes = members[lower...upper].reduce(0) { $0 + sources[$1]![4].utf8.count }
            for direction in [-1, 1] {
                while true {
                    let edge = direction < 0 ? lower : upper
                    let next = edge + direction
                    guard members.indices.contains(next), spoken(edge) || spoken(next) else { break }
                    let bytes = sources[members[next]]![4].utf8.count
                    guard sceneBytes + bytes <= 16000 else { break }
                    sceneBytes += bytes
                    if direction < 0 { lower = next } else { upper = next }
                }
            }
            var group: [QuestionEvidence] = []
            for neighbor in lower...upper {
                let id = members[neighbor]
                let match = id == candidate.id ? candidate.match : matches[candidate.query][id]
                if let value = try append(id, offset: match?.offset, text: match?.text) { group.append(value) }
            }
            if !group.isEmpty { groups.append(group) }
        }
        if wholeBook {
            var grouped: [String: [QuestionEvidence]] = [:], order: [String] = []
            for evidence in selected {
                let location = try evidence.location()
                let key = location.locations.otherLocations["shudengChapter"]?.string ?? location.href.string
                if grouped[key] == nil { order.append(key) }
                grouped[key, default: []].append(evidence)
            }
            // Round-robin source windows: one chapter cannot consume the entire budget.
            selected = []
            for position in 0..<(grouped.values.map(\.count).max() ?? 0) {
                for key in order where grouped[key]!.indices.contains(position) { selected.append(grouped[key]![position]) }
            }
        }
        return ChapterRetrieval(evidence: selected, ranks: ranks, groups: groups)
    }

    func languageSample(bookID: String, scope: BookEvidenceScope? = nil) throws -> String {
        let db = try IndexDatabase(url: url)
        let scope = scope ?? BookEvidenceScope(bookID: bookID)
        guard scope.bookID == bookID else { throw QuestionError.scope }
        return String(try db.rows("SELECT original FROM fragments WHERE book_id=? AND (chapter<? OR (chapter=? AND ordinal<=?)) ORDER BY chapter,ordinal LIMIT 6", [bookID, String(scope.throughChapter), String(scope.throughChapter), String(scope.throughOrdinal)]).map { $0[0] }.joined(separator: " ").prefix(500))
    }

    func localEvidence(scope: BookEvidenceScope, query: String) throws -> [QuestionEvidence] {
        var result: [QuestionEvidence] = []
        for term in QuestionPlan.keywords(query) {
            for hit in try search(bookID: scope.bookID, query: term) {
                let value = QuestionEvidence(locator: hit.locator, context: hit.locator.text.highlight)
                if try permits([value], scope: scope), !result.contains(where: { $0.locatorJSON == value.locatorJSON }) { result.append(value) }
                if result.count == 15 { return result }
            }
        }
        return result
    }

    func prepareVectors(bookID: String, embedding: SemanticEmbedding = .shared,
                        progress: @escaping @MainActor (BookPreparationState) async -> Void) async throws {
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
            for piece in pieces { vectors.append(try await embedding.embed(piece.text)) }
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

    func retrieve(scope: BookEvidenceScope, query: String) async throws -> BookRetrieval {
        let db = try IndexDatabase(url: url)
        guard try db.state(scope.bookID).semanticReady else { throw QuestionError.preparation }
        let vector = try await SemanticEmbedding.shared.embed(query)
        try Task.checkCancellation()
        let bounds = [scope.bookID, String(scope.throughChapter), String(scope.throughChapter), String(scope.throughOrdinal)]
        let filter = "f.book_id=? AND (f.chapter<? OR (f.chapter=? AND f.ordinal<=?))"
        // Scan one vector at a time; do not materialize the entire book's vector matrix.
        let statement = try db.statement("SELECT e.fragment_id,e.vector FROM embeddings e JOIN fragments f ON f.id=e.fragment_id WHERE " + filter + " AND e.book_id=f.book_id AND e.model=?", bounds + [SemanticEmbedding.version])
        defer { sqlite3_finalize(statement) }
        var scores: [Int: Float] = [:]
        while true {
            let step = sqlite3_step(statement)
            if step == SQLITE_DONE { break }
            guard step == SQLITE_ROW, sqlite3_column_bytes(statement, 1) == 1536, let blob = sqlite3_column_blob(statement, 1) else { throw IndexError.storage }
            var dot: Float = 0
            for i in vector.indices { dot += blob.loadUnaligned(fromByteOffset: i * 4, as: Float.self) * vector[i] }
            guard dot.isFinite else { throw IndexError.storage }
            let id = Int(sqlite3_column_int64(statement, 0))
            scores[id] = max(scores[id] ?? -Float.infinity, dot)
        }
        let semantic = Array(scores.keys.sorted { scores[$0]! == scores[$1]! ? $0 < $1 : scores[$0]! > scores[$1]! }.prefix(20))
        var lexicalScores: [Int: Int] = [:]
        for term in QuestionPlan.keywords(query) {
            let terms = BookText.tokens(term, query: true)
            guard !terms.isEmpty else { continue }
            for row in try db.rows("SELECT f.id,f.original FROM fragment_terms t JOIN fragments f ON f.id=t.rowid WHERE fragment_terms MATCH ? AND " + filter, [terms] + bounds) {
                if row[1].range(of: term, options: [.caseInsensitive, .diacriticInsensitive]) != nil {
                    lexicalScores[Int(row[0])!, default: 0] += 1
                }
            }
        }
        let keyword = Array(lexicalScores.keys.sorted { lexicalScores[$0]! == lexicalScores[$1]! ? $0 < $1 : lexicalScores[$0]! > lexicalScores[$1]! }.prefix(20))
        var fusion: [Int: Double] = [:]
        for list in [keyword, semantic] {
            for (rank, id) in list.enumerated() { fusion[id, default: 0] += 1 / Double(61 + rank) }
        }
        let ranked = fusion.keys.sorted { fusion[$0]! == fusion[$1]! ? $0 < $1 : fusion[$0]! > fusion[$1]! }
        // Preserve the semantic best hit when same-language distractors dominate both lists.
        var anchors = Array(semantic.prefix(1))
        anchors += ranked.filter { !anchors.contains($0) }.prefix(5 - anchors.count)
        var expanded: [Int] = []
        var evidence: [QuestionEvidence] = []
        // Anchors precede expansion so a later anchor cannot be displaced by earlier neighbors.
        for anchor in anchors {
            if let value = try db.evidence(id: anchor, scope: scope), !expanded.contains(anchor) {
                expanded.append(anchor); evidence.append(value)
            }
        }
        for anchor in anchors {
            let row = try db.rows("SELECT chapter,ordinal FROM fragments WHERE id=? AND book_id=?", [String(anchor), scope.bookID])[0]
            let neighbors = try db.rows("SELECT id FROM fragments f WHERE " + filter + " AND f.chapter=? AND f.ordinal BETWEEN ? AND ? ORDER BY f.ordinal", bounds + [row[0], String(Int(row[1])! - 1), String(Int(row[1])! + 1)])
            for item in neighbors {
                let id = Int(item[0])!
                if !expanded.contains(id), let value = try db.evidence(id: id, scope: scope) {
                    expanded.append(id); evidence.append(value)
                }
            }
        }
        return BookRetrieval(evidence: evidence, trace: RetrievalTrace(keyword: keyword, semantic: semantic, anchors: anchors, expanded: expanded))
    }
}

extension IndexDatabase {
    func evidence(id: Int, scope: BookEvidenceScope, range: NSRange? = nil) throws -> QuestionEvidence? {
        guard let row = try rows("SELECT chapter,ordinal,locator,original FROM fragments WHERE id=? AND book_id=?", [String(id), scope.bookID]).first,
              scope.permits(chapter: Int(row[0])!, ordinal: Int(row[1])!),
              var locator = try Locator(json: JSONValue(jsonString: row[2], warnings: nil), warnings: nil) else { return nil }
        let original = row[3] as NSString
        let span = range ?? NSRange(location: 0, length: original.length)
        guard span.location >= 0, span.length > 0, NSMaxRange(span) <= original.length else { return nil }
        let quote = original.substring(with: span)
        // Use the canonical fragment and its existing source mapping, not model-generated positions.
        if let nodes = locator.locations.otherLocations["shudengTextNodes"]?.array {
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
        let fragments = try db.rows("SELECT chapter,ordinal,locator,original FROM fragments WHERE book_id=?", [scope.bookID])
        for value in evidence where !value.quote.isEmpty {
            let location = try value.location()
            let found = try fragments.contains { row in
                guard scope.permits(chapter: Int(row[0])!, ordinal: Int(row[1])!),
                      let source = try Locator(json: JSONValue(jsonString: row[2], warnings: nil), warnings: nil),
                      source.href == location.href else { return false }
                let original = row[3] as NSString
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
}
