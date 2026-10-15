import Foundation
import SQLite3
import ReadiumShared

/// Scope is enforced before scoring and again for neighbor expansion.
struct BookEvidenceScope {
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

extension BookIndex {
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
    func evidence(id: Int, scope: BookEvidenceScope) throws -> QuestionEvidence? {
        guard let row = try rows("SELECT chapter,ordinal,locator,original FROM fragments WHERE id=? AND book_id=?", [String(id), scope.bookID]).first,
              scope.permits(chapter: Int(row[0])!, ordinal: Int(row[1])!),
              var locator = try Locator(json: JSONValue(jsonString: row[2], warnings: nil), warnings: nil) else { return nil }
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
            let start = (locator.text.before ?? "").utf16.count
            guard let a = point(start, end: false), let b = point(start + row[3].utf16.count, end: true) else { throw IndexError.source }
            locator.locations.otherLocations["domRange"] = .object(DOMRange(start: a, end: b).jsonObject)
            locator.locations.otherLocations.removeValue(forKey: "shudengTextNodes")
        }
        return QuestionEvidence(locator: locator, context: row[3])
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
