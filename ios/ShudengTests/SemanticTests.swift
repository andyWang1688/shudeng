import XCTest
@testable import Shudeng
final class SemanticTests: XCTestCase {
    func testRealIOSTokenizerAndONNXReference() async throws {
        let reference = try JSONSerialization.jsonObject(with: Data(contentsOf: Bundle(for: Self.self).url(forResource: "semantic-reference", withExtension: "json", subdirectory: "Fixtures")!)) as! [String: Any]
        let text = reference["text"] as! String
        let ids = try await SemanticEmbedding.shared.tokenIDs(text)
        XCTAssertEqual(ids, reference["ids"] as! [Int])
        let vector = try await SemanticEmbedding.shared.embed(text)
        let expected = (reference["vector"] as! [Double]).map(Float.init)
        let cosine = zip(vector, expected).reduce(Float(0)) { $0 + $1.0 * $1.1 }
        XCTAssertGreaterThan(cosine, 0.999)
        print("I10_NATIVE tokenizer=exact dimension=\(vector.count) cosine=\(cosine)")
    }
}

import SQLite3
import ReadiumShared
import NaturalLanguage

extension SemanticTests {
    func testIndexCommitWaitsForShortReadersAndRollsBackPersistentLock() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("index-reader-lock-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("book-index.sqlite"), db = try IndexDatabase(url: url), book = "reader-lock"
        try db.execute("INSERT INTO embedding_progress VALUES(?,?,1,1,3)", [book, SemanticEmbedding.version])
        try insertVector(db, book: book, id: 1, text: "Committed source.", vector: Array(repeating: 0.01, count: SemanticEmbedding.dimension))
        let committed = try db.rows("SELECT fragment_id,piece,hex(vector) FROM embeddings", [])
        func withReader(releaseAfter: Double?, _ body: () throws -> Void) throws {
            let ready = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0), closed = DispatchSemaphore(value: 0)
            Thread.detachNewThread {
                var reader: OpaquePointer?, statement: OpaquePointer?
                XCTAssertEqual(sqlite3_open_v2(url.path, &reader, SQLITE_OPEN_READWRITE, nil), SQLITE_OK)
                defer { sqlite3_finalize(statement); sqlite3_close(reader); closed.signal() }
                XCTAssertEqual(sqlite3_prepare_v2(reader, "SELECT * FROM embedding_progress", -1, &statement, nil), SQLITE_OK)
                XCTAssertEqual(sqlite3_step(statement), SQLITE_ROW)
                ready.signal()
                if let releaseAfter { _ = release.wait(timeout: .now() + releaseAfter) }
                else { release.wait() }
            }
            XCTAssertEqual(ready.wait(timeout: .now() + 5), .success)
            defer { release.signal(); XCTAssertEqual(closed.wait(timeout: .now() + 5), .success) }
            try body()
        }
        func commit(_ fragment: Int) throws {
            try db.transaction {
                try insertVector(db, book: book, id: fragment, text: "Next source.", vector: Array(repeating: 0.01, count: SemanticEmbedding.dimension))
                try db.execute("UPDATE embedding_progress SET cursor=?,completed=completed+1 WHERE book_id=?", [String(fragment), book])
            }
        }
        try withReader(releaseAfter: 0.15) { try commit(2) }
        XCTAssertEqual(try db.rows("SELECT cursor,completed,total FROM embedding_progress", []), [["2", "2", "3"]])
        try withReader(releaseAfter: nil) {
            let started = Date()
            XCTAssertThrowsError(try commit(3)) { XCTAssertTrue($0 is IndexError) }
            XCTAssertLessThan(Date().timeIntervalSince(started), 3, "Persistent locks must fail within a bounded wait")
        }
        XCTAssertEqual(try db.rows("SELECT cursor,completed,total FROM embedding_progress", []), [["2", "2", "3"]])
        XCTAssertEqual(try db.rows("SELECT count(*) FROM embeddings WHERE fragment_id=3", []), [["0"]])
        try commit(3)
        XCTAssertEqual(try db.rows("SELECT cursor,completed,total FROM embedding_progress", []), [["3", "3", "3"]])
        XCTAssertEqual(try db.rows("SELECT fragment_id,piece,hex(vector) FROM embeddings WHERE fragment_id=1", []), committed)
        XCTAssertEqual(try db.rows("SELECT count(*),count(DISTINCT fragment_id) FROM embeddings", []), [["3", "3"]])
        XCTAssertEqual(try db.rows("PRAGMA integrity_check", []), [["ok"]])
    }

    func testIssue21ChunksPreserveMixedSourceAndUTF16Coverage() async throws {
        let text = " \t\r\n" + String(repeating: "她说：“👩🏽‍🔬在cafe\u{301}重新\n接好了电池。” The timer kept working. ", count: 18) + "\r\n\r\n最后核对记录。 \t\n"
        let chunks = try await SemanticEmbedding.shared.chunks(text)
        XCTAssertGreaterThan(chunks.count, 1)
        try await assertChunkCoverage(chunks, source: text)
        let whitespace = String(repeating: " \t", count: 512) + "记录没有丢失。" + String(repeating: "\r\n", count: 100)
        let spaced = try await SemanticEmbedding.shared.chunks(whitespace)
        try await assertChunkCoverage(spaced, source: whitespace)
        let empty = try await SemanticEmbedding.shared.chunks("")
        XCTAssertTrue(empty.isEmpty)
    }

    func testIssue21ChunksAggregateSentencesWithOnlyShortTailOverlap() async throws {
        let sentence = "The timer kept working."
        let text = Array(repeating: sentence, count: 40).joined(separator: " ")
        let chunks = try await SemanticEmbedding.shared.chunks(text)
        let specials = try await SemanticEmbedding.shared.tokenIDs("").count
        XCTAssertGreaterThan(chunks.count, 1)
        for chunk in chunks.dropLast() {
            let tokens = try await SemanticEmbedding.shared.tokenIDs(chunk.text).count - specials
            XCTAssertGreaterThanOrEqual(tokens, 80); XCTAssertLessThanOrEqual(tokens, 100)
        }
        for (left, right) in zip(chunks, chunks.dropFirst()) {
            let overlap = NSRange(location: right.offset, length: left.offset + left.text.utf16.count - right.offset)
            XCTAssertGreaterThan(overlap.length, 0)
            let quote = (text as NSString).substring(with: overlap)
            XCTAssertEqual(quote.trimmingCharacters(in: .whitespacesAndNewlines), sentence)
            let tokens = try await SemanticEmbedding.shared.tokenIDs(quote).count - specials
            XCTAssertLessThanOrEqual(tokens, 20)
        }
        try await assertChunkCoverage(chunks, source: text)
        // A complete sentence over the overlap budget must not be forced into the next block.
        let longSentence = "The technician " + String(repeating: "carefully checked the recorder ", count: 8) + "before leaving."
        let count = try await SemanticEmbedding.shared.tokenIDs(longSentence).count - specials
        XCTAssertGreaterThan(count, 20); XCTAssertLessThan(count, 100)
        let longer = try await SemanticEmbedding.shared.chunks(Array(repeating: longSentence, count: 4).joined(separator: " "))
        for (left, right) in zip(longer, longer.dropFirst()) { XCTAssertEqual(left.offset + left.text.utf16.count, right.offset) }
    }

    func testIssue21LongSentenceSplitsAndLongQueryIncludesEveryBlock() async throws {
        let text = String(repeating: "记录器👩🏽‍🔬在cafe\u{301}继续运转并核对备用电池 ", count: 35) + "。"
        let chunks = try await SemanticEmbedding.shared.chunks(text)
        XCTAssertGreaterThan(chunks.count, 1)
        XCTAssertEqual(chunks.map(\.text).joined(), text)
        try await assertChunkCoverage(chunks, source: text)
        do { _ = try await SemanticEmbedding.shared.embedChunk(text); XCTFail("A stored block must never be truncated") }
        catch EmbeddingError.inference { }
        var expected = [Float](repeating: 0, count: SemanticEmbedding.dimension)
        for chunk in chunks {
            let vector = try await SemanticEmbedding.shared.embedChunk(chunk.text)
            for i in expected.indices { expected[i] += vector[i] }
        }
        let norm = sqrt(expected.reduce(Float(0)) { $0 + $1 * $1 })
        expected = expected.map { $0 / norm }
        let actual = try await SemanticEmbedding.shared.embed(text)
        XCTAssertGreaterThan(zip(expected, actual).reduce(Float(0)) { $0 + $1.0 * $1.1 }, 0.99999)
    }

    @MainActor func testIssue21HybridTopKRanksDistinctBlocksAndEnforcesScope() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("issue21-block-rank-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("book-index.sqlite"), db = try IndexDatabase(url: url)
        let book = "issue21-block-rank", query = "recorder backup battery"
        let pieces = (0..<10).map { "Block \($0): 👩🏽‍🔬 cafe\u{301} keeps the timer running. " }
        let body = pieces.joined(), keyword = "recorder backup battery recorder backup battery", middle = "A separate relevant source."
        let split = pieces[1].index(pieces[1].startIndex, offsetBy: 12)
        let inlineBody = pieces[0] + String(pieces[1][..<split]) + "<em>" + String(pieces[1][split...]) + "</em>" + pieces.dropFirst(2).joined()
        try db.initialize(book, total: 2, contents: "[]", rebuild: false)
        try db.commit(book, chapter: 0, href: "read.xhtml", title: "Read", fragments: BookText.fragments(html: "<p>\(inlineBody)</p><p>\(keyword)</p><p>\(middle)</p>", href: AnyURL(string: "read.xhtml")!, title: "Read"))
        try db.commit(book, chapter: 1, href: "unread.xhtml", title: "Unread", fragments: BookText.fragments(html: "<p>UNREAD SENTINEL recorder backup battery</p>", href: AnyURL(string: "unread.xhtml")!, title: "Unread"))
        let rows = try db.rows("SELECT id,original FROM fragments WHERE book_id=? ORDER BY chapter,ordinal", [book])
        let firstID = Int(rows[0][0])!, keywordID = Int(rows[1][0])!, middleID = Int(rows[2][0])!, unreadID = Int(rows[3][0])!
        let queryVector = try await SemanticEmbedding.shared.embed(query)
        func vector(_ score: Float) -> [Float] { queryVector.map { $0 * score } }
        var offset = 0
        for (piece, text) in pieces.enumerated() {
            let score: Float = piece == 1 ? 0.95 : piece < 3 ? 0.9 : 0.8 - Float(piece) * 0.01
            try insertVector(db, book: book, id: firstID, piece: piece, offset: offset, text: text, vector: vector(score))
            offset += text.utf16.count
        }
        try insertVector(db, book: book, id: firstID, piece: 10, offset: 0, text: pieces[0], vector: vector(0.89))
        try insertVector(db, book: book, id: keywordID, text: keyword, vector: vector(-0.5))
        try insertVector(db, book: book, id: middleID, text: middle, vector: vector(0.92))
        try insertVector(db, book: book, id: unreadID, text: rows[3][1], vector: vector(1))
        try db.initialize("foreign", total: 1, contents: "[]", rebuild: false)
        let foreign = "FOREIGN SENTINEL recorder backup battery"
        try db.commit("foreign", chapter: 0, href: "foreign.xhtml", title: "Foreign", fragments: BookText.fragments(html: "<p>\(foreign)</p>", href: AnyURL(string: "foreign.xhtml")!, title: "Foreign"))
        let foreignID = Int(try db.rows("SELECT id FROM fragments WHERE book_id='foreign'", [])[0][0])!
        try insertVector(db, book: "foreign", id: foreignID, text: foreign, vector: vector(1))
        try db.execute("INSERT INTO embedding_progress VALUES(?,?,?,?,?)", [book, SemanticEmbedding.version, rows.last![0], "4", "4"])
        let index = BookIndex(url: url), scope = BookEvidenceScope(bookID: book, throughChapter: 0)
        let result = try await index.retrieve(scope: scope, query: query)
        XCTAssertEqual(result.evidence.count, 8)
        XCTAssertEqual(Array(result.evidence.prefix(4).map(\.quote)), [keyword, pieces[1], middle, pieces[0]])
        XCTAssertEqual(result.trace.semantic.filter { $0 == firstID }.count, 6)
        XCTAssertEqual(result.trace.keyword, [keywordID]); XCTAssertTrue(result.trace.expanded.isEmpty)
        XCTAssertEqual(Set(result.evidence.map(\.locatorJSON)).count, 8)
        XCTAssertFalse(result.trace.semantic.contains(unreadID)); XCTAssertFalse(result.trace.semantic.contains(foreignID))
        XCTAssertFalse(result.trace.keyword.contains(unreadID)); XCTAssertFalse(result.trace.keyword.contains(foreignID))
        XCTAssertEqual(result.evidence.filter { $0.quote == keyword }.count, 1)
        XCTAssertFalse(result.evidence.contains { $0.quote == body })
        let permitted = try await index.permits(result.evidence, scope: scope)
        XCTAssertTrue(permitted)
        let crossed = try XCTUnwrap(result.evidence.first { $0.quote == pieces[1] }).location()
        let dom = try XCTUnwrap(crossed.locations.otherLocations["domRange"]?.object)
        let start = try XCTUnwrap(dom["start"]?.object), end = try XCTUnwrap(dom["end"]?.object)
        XCTAssertNotEqual(start["cssSelector"]?.string, end["cssSelector"]?.string)
        XCTAssertEqual(start["charOffset"]?.integer, pieces[0].utf16.count)
        XCTAssertEqual(end["charOffset"]?.integer, String(pieces[1][split...]).utf16.count)
        XCTAssertTrue(try XCTUnwrap(end["cssSelector"]?.string).contains("em:nth-of-type(1)"))
        for value in result.evidence {
            let locator = try value.location()
            XCTAssertNotNil(locator.locations.otherLocations["domRange"])
            XCTAssertEqual(locator.text.highlight, value.quote)
        }
        let topThree = try await index.retrieve(scope: scope, query: query, topK: 3)
        XCTAssertEqual(topThree.evidence.map(\.quote), Array(result.evidence.prefix(3).map(\.quote)))
        let capped = try await index.retrieve(scope: scope, query: query, topK: 100)
        XCTAssertEqual(capped.evidence.map(\.locatorJSON), result.evidence.map(\.locatorJSON))
        let ordinal = try await index.retrieve(scope: BookEvidenceScope(bookID: book, throughChapter: 0, throughOrdinal: 0), query: query)
        XCTAssertEqual(ordinal.trace.semantic, Array(repeating: firstID, count: 8))
        XCTAssertTrue(ordinal.trace.keyword.isEmpty)
        let empty = try await index.retrieve(scope: scope, query: query, topK: 0)
        XCTAssertTrue(empty.evidence.isEmpty)
        let noKeyword = try await index.retrieve(scope: scope, query: "zzzz unmatched")
        XCTAssertTrue(noKeyword.trace.keyword.isEmpty); XCTAssertEqual(noKeyword.evidence.count, 8)
        let explicit = try await index.retrieve(scope: BookEvidenceScope(bookID: book, chapters: [0]), query: query)
        XCTAssertEqual(explicit.evidence.map(\.locatorJSON), result.evidence.map(\.locatorJSON))
        let whole = try await index.retrieve(scope: BookEvidenceScope(bookID: book), query: query)
        XCTAssertEqual(whole.trace.semantic.first, unreadID)
        let fullText = try await index.search(bookID: book, query: query)
        XCTAssertEqual(fullText.count, 3)
        XCTAssertEqual(fullText.filter { $0.locator.href.string == "read.xhtml" }.count, 2)
        XCTAssertTrue(fullText.allSatisfy {
            $0.locator.text.highlight == query &&
            ($0.locator.text.before ?? "") + query + ($0.locator.text.after ?? "") == ($0.locator.href.string == "read.xhtml" ? keyword : rows[3][1])
        })
        let oldTrace = Data("{\"keyword\":[1],\"semantic\":[2],\"anchors\":[2,1],\"expanded\":[2,1,3]}".utf8)
        XCTAssertEqual(try JSONDecoder().decode(RetrievalTrace.self, from: oldTrace).expanded, [2,1,3])
    }

    @MainActor func testIssue21HybridKeywordHitResolvesLaterStoredBlock() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("issue21-late-keyword-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("book-index.sqlite"), db = try IndexDatabase(url: url), book = "late-keyword"
        let first = String(repeating: "The timer kept working. ", count: 18), last = "The recorder uses a backup battery."
        try db.initialize(book, total: 1, contents: "[]", rebuild: false)
        try db.commit(book, chapter: 0, href: "long.xhtml", title: "Long", fragments: BookText.fragments(html: "<p>\(first)\(last)</p>", href: AnyURL(string: "long.xhtml")!, title: "Long"))
        let id = Int(try db.rows("SELECT id FROM fragments WHERE book_id=?", [book])[0][0])!
        let vector = try await SemanticEmbedding.shared.embed("recorder backup battery")
        try insertVector(db, book: book, id: id, text: first, vector: vector)
        try insertVector(db, book: book, id: id, piece: 1, offset: first.utf16.count, text: last, vector: vector.map { $0 * -0.5 })
        try db.execute("INSERT INTO embedding_progress VALUES(?,?,?,?,?)", [book, SemanticEmbedding.version, String(id), "1", "1"])
        let index = BookIndex(url: url), scope = BookEvidenceScope(bookID: book)
        let result = try await index.retrieve(scope: scope, query: "recorder backup battery")
        XCTAssertEqual(result.evidence.map(\.quote), [last, first])
        XCTAssertEqual(result.trace.keyword, [id])
        XCTAssertEqual(Set(result.evidence.map(\.locatorJSON)).count, 2)
        let location = try XCTUnwrap(result.evidence.first).location()
        XCTAssertEqual(location.text.before, first); XCTAssertEqual(location.text.highlight, last)
        let permitted = try await index.permits(result.evidence, scope: scope)
        XCTAssertTrue(permitted)
    }

    @MainActor func testIssue21VectorVersionUpgradeRollsBackAndResumesPerFragment() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("issue21-vector-upgrade-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("book-index.sqlite"), db = try IndexDatabase(url: url), book = "upgrade"
        let files = ["library.json", "notes.json", "reading-questions.json"]
        for file in files { try Data(("unchanged-" + file).utf8).write(to: root.appendingPathComponent(file)) }
        let snapshots = try files.map { try Data(contentsOf: root.appendingPathComponent($0)) }
        try db.initialize(book, total: 1, contents: "[]", rebuild: false)
        let long = String(repeating: "The recorder kept working. ", count: 30)
        let fragments = try BookText.fragments(html: "<p>\(long)</p><p>备用电池继续供电。</p><p>The timer kept working.</p>", href: AnyURL(string: "upgrade.xhtml")!, title: "Upgrade")
        try db.commit(book, chapter: 0, href: "upgrade.xhtml", title: "Upgrade", fragments: fragments)
        let source = try db.rows("SELECT id,original,locator FROM fragments WHERE book_id=? ORDER BY id", [book])
        XCTAssertEqual(source.count, 3)
        let oldModel = "minilm-e8f8c211-arm64-int8-128-mean-l2-v1"
        for row in source { try insertVector(db, book: book, id: Int(row[0])!, text: row[1], vector: Array(repeating: 0.01, count: SemanticEmbedding.dimension), model: oldModel) }
        try db.execute("INSERT INTO embedding_progress VALUES(?,?,?,?,?)", [book, oldModel, source.last![0], "3", "3"])
        let oldVectors = try db.rows("SELECT fragment_id,piece,hex(vector) FROM embeddings ORDER BY fragment_id,piece", [])
        let oldProgress = try db.rows("SELECT * FROM embedding_progress", [])
        let index = BookIndex(url: url)
        do { _ = try await index.retrieve(scope: BookEvidenceScope(bookID: book), query: "battery"); XCTFail("Old vectors must be unavailable") }
        catch { XCTAssertEqual(error as? QuestionError, .preparation) }
        try db.execute("CREATE TRIGGER issue21_upgrade_abort BEFORE DELETE ON embeddings BEGIN SELECT RAISE(ABORT,'upgrade rollback'); END")
        do { try await index.prepareVectors(bookID: book) { _ in }; XCTFail("Expected upgrade transaction failure") }
        catch { XCTAssertTrue(error is IndexError) }
        XCTAssertEqual(try db.rows("SELECT fragment_id,piece,hex(vector) FROM embeddings ORDER BY fragment_id,piece", []), oldVectors)
        XCTAssertEqual(try db.rows("SELECT * FROM embedding_progress", []), oldProgress)
        try db.execute("DROP TRIGGER issue21_upgrade_abort")
        let task = Task {
            try await index.prepareVectors(bookID: book) { state in
                if state.vectorsCompleted == 1 { withUnsafeCurrentTask { $0?.cancel() } }
            }
        }
        do { try await task.value; XCTFail("Expected interruption after one fragment commit") }
        catch is CancellationError { }
        XCTAssertEqual(try db.rows("SELECT model,completed,total FROM embedding_progress", []), [[SemanticEmbedding.version, "1", "3"]])
        XCTAssertEqual(try db.rows("SELECT count(*) FROM embeddings WHERE model=?", [oldModel]), [["0"]])
        let committed = try db.rows("SELECT fragment_id,piece,offset,original,hex(vector) FROM embeddings ORDER BY fragment_id,piece", [])
        XCTAssertGreaterThan(committed.count, 1)
        let reopened = BookIndex(url: url)
        do { _ = try await reopened.retrieve(scope: BookEvidenceScope(bookID: book), query: "battery"); XCTFail("Incomplete vectors must be unavailable") }
        catch { XCTAssertEqual(error as? QuestionError, .preparation) }
        var observed: [Int] = []
        try await reopened.prepareVectors(bookID: book) { observed.append($0.vectorsCompleted) }
        XCTAssertEqual(observed, [1,2,3])
        XCTAssertEqual(try db.rows("SELECT fragment_id,piece,offset,original,hex(vector) FROM embeddings WHERE fragment_id=? ORDER BY piece", [source[0][0]]), committed)
        XCTAssertEqual(try db.rows("SELECT id,original,locator FROM fragments WHERE book_id=? ORDER BY id", [book]), source)
        XCTAssertEqual(try files.map { try Data(contentsOf: root.appendingPathComponent($0)) }, snapshots)
        for row in try db.rows("SELECT original,hex(vector) FROM embeddings ORDER BY fragment_id,piece", []) {
            let expected = try await SemanticEmbedding.shared.embedChunk(row[0])
            let hex = expected.withUnsafeBytes { $0.map { String(format: "%02X", $0) }.joined() }
            XCTAssertEqual(row[1], hex, "Each stored block must have one direct encoding")
        }
        let beforeNoWork = try db.rows("SELECT * FROM embedding_progress", [])
        try await reopened.prepareVectors(bookID: book) { _ in }
        XCTAssertEqual(try db.rows("SELECT * FROM embedding_progress", []), beforeNoWork)
        XCTAssertEqual(try db.rows("PRAGMA integrity_check", []), [["ok"]])
    }

    private func assertChunkCoverage(_ chunks: [(text: String, offset: Int)], source text: String, file: StaticString = #filePath, line: UInt = #line) async throws {
        let source = text as NSString
        var covered = 0, previousStart = -1
        for chunk in chunks {
            let range = NSRange(location: chunk.offset, length: chunk.text.utf16.count)
            XCTAssertGreaterThan(range.length, 0, file: file, line: line)
            XCTAssertGreaterThan(chunk.offset, previousStart, file: file, line: line)
            XCTAssertLessThanOrEqual(chunk.offset, covered, file: file, line: line)
            XCTAssertEqual(source.substring(with: range), chunk.text, file: file, line: line)
            XCTAssertEqual(source.rangeOfComposedCharacterSequences(for: range), range, file: file, line: line)
            let count = try await SemanticEmbedding.shared.tokenIDs(chunk.text).count
            XCTAssertLessThanOrEqual(count, 128, file: file, line: line)
            covered = NSMaxRange(range); previousStart = chunk.offset
        }
        XCTAssertEqual(covered, source.length, file: file, line: line)
    }

    private func insertVector(_ db: IndexDatabase, book: String, id: Int, piece: Int = 0, offset: Int = 0, text: String, vector: [Float], model: String = SemanticEmbedding.version) throws {
        let statement = try db.statement("INSERT INTO embeddings VALUES(?,?,?,?,?,?,?)", [book, model, String(id), String(piece), String(offset), text])
        defer { sqlite3_finalize(statement) }
        let bound = vector.withUnsafeBytes { sqlite3_bind_blob(statement, 7, $0.baseAddress, Int32($0.count), unsafeBitCast(-1, to: sqlite3_destructor_type.self)) }
        guard bound == SQLITE_OK, sqlite3_step(statement) == SQLITE_DONE else { throw IndexError.storage }
    }

    @MainActor func testIssue13ScopeFilterPrecedesLanguageAndCandidates() async throws {
        let fixture = try scopedFragmentFixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let scoped = try fixture.db.scopedFragments(scope: fixture.scope)
        XCTAssertEqual(Set(scoped.map { Int($0[0])! }), fixture.allowedIDs)

        let sample = try await fixture.index.languageSample(bookID: fixture.bookID, scope: fixture.scope)
        XCTAssertEqual(sample, String(scoped.map { $0[4] }.joined(separator: " ").prefix(500)))
        XCTAssertEqual(NLLanguageRecognizer.dominantLanguage(for: sample), .simplifiedChinese)
        XCTAssertFalse(sample.contains("UNREAD-ENGLISH-SENTINEL"))
        let unscoped = try fixture.db.rows("SELECT original FROM fragments WHERE book_id=? ORDER BY chapter,ordinal", [fixture.bookID]).prefix(20).map { $0[0] }.joined(separator: " ")
        XCTAssertEqual(NLLanguageRecognizer.dominantLanguage(for: unscoped), .english)

        let units = try await fixture.index.sentenceUnits(scope: fixture.scope)
        XCTAssertTrue(Set(units.map(\.fragmentID)).isSubset(of: fixture.allowedIDs))
        XCTAssertFalse(units.contains { $0.fragmentID == fixture.unreadID })
        let abbreviated = units.filter { $0.fragmentID == fixture.abbreviationID }
        let chinese = SourceSentenceUnit.ranges(fixture.abbreviationText, language: .simplifiedChinese)
        let english = SourceSentenceUnit.ranges(fixture.abbreviationText, language: .english)
        XCTAssertEqual(abbreviated.map(\.evidence.quote), chinese.map { (fixture.abbreviationText as NSString).substring(with: $0) })
        XCTAssertNotEqual(chinese.count, english.count)

        let whole = BookEvidenceScope(bookID: fixture.bookID)
        let wholeCandidates = try await fixture.index.retrieve(scope: whole, query: "recorder backup battery")
        XCTAssertTrue(wholeCandidates.trace.semantic.contains(fixture.unreadID))
        let candidates = try await fixture.index.retrieve(scope: fixture.scope, query: "recorder backup battery")
        XCTAssertFalse(candidates.evidence.isEmpty)
        XCTAssertTrue(Set(candidates.trace.semantic).isSubset(of: fixture.allowedIDs))
        XCTAssertFalse(candidates.trace.semantic.contains(fixture.unreadID))
        XCTAssertTrue(try candidates.evidence.allSatisfy { try $0.location().href.string == "allowed.xhtml" })
        let read = BookEvidenceScope(bookID: fixture.bookID, throughChapter: 1, throughOrdinal: 0, chapters: [1])
        let firstOnly = try await fixture.index.retrieve(scope: read, query: "recorder backup battery")
        XCTAssertEqual(firstOnly.trace.semantic, [fixture.abbreviationID])
        XCTAssertEqual(firstOnly.evidence.map(\.quote), [fixture.abbreviationText])
    }

    @MainActor func testIssue13PermitsUsesScopedFragmentRows() async throws {
        let fixture = try scopedFragmentFixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let allowedID = try XCTUnwrap(fixture.allowedIDs.first)
        let allowed = try XCTUnwrap(fixture.db.evidence(id: allowedID, scope: fixture.scope))
        let unread = try XCTUnwrap(fixture.db.evidence(id: fixture.unreadID, scope: BookEvidenceScope(bookID: fixture.bookID)))
        XCTAssertLessThan(fixture.unreadID, allowedID)
        let allowsAllowed = try await fixture.index.permits([allowed], scope: fixture.scope)
        let allowsUnreadFirst = try await fixture.index.permits([unread, allowed], scope: fixture.scope)
        let allowsUnreadLast = try await fixture.index.permits([allowed, unread], scope: fixture.scope)
        let allowsUnread = try await fixture.index.permits([unread], scope: fixture.scope)
        XCTAssertTrue(allowsAllowed)
        XCTAssertFalse(allowsUnreadFirst)
        XCTAssertFalse(allowsUnreadLast)
        XCTAssertFalse(allowsUnread)
        XCTAssertEqual(Set(try fixture.db.scopedFragments(scope: fixture.scope).map { Int($0[0])! }), fixture.allowedIDs)
    }

    private func scopedFragmentFixture() throws -> (root: URL, db: IndexDatabase, index: BookIndex, bookID: String, scope: BookEvidenceScope, unreadID: Int, allowedIDs: Set<Int>, abbreviationID: Int, abbreviationText: String) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("issue13-scope-first-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let db = try IndexDatabase(url: root.appendingPathComponent("book-index.sqlite"))
        let bookID = "issue13-scope-first"
        try db.initialize(bookID, total: 2, contents: "[]", rebuild: false)
        let sentinel = "I13-UNREAD-ENGLISH-SENTINEL. " + String(repeating: "Unread English sentinel describes a recorder with backup battery power. ", count: 20)
        var logical: (key: String, title: String)?
        let unread = try BookText.fragments(html: "<p id='u'>\(sentinel)</p>", href: AnyURL(string: "unread.xhtml")!, title: "Unread", anchors: [:], logical: &logical)
        try db.commit(bookID, chapter: 0, href: "unread.xhtml", title: "Unread", fragments: unread)
        let abbreviation = "Dr. Smith 观察读数。他记录结果。"
        let chinese = String(repeating: "主供电切断后，记录器和计时器继续由独立的备用电池工作，温度仪停止。", count: 3)
        let english = "The recorder draws power from an independent backup cell and the timer keeps working."
        logical = nil
        let allowed = try BookText.fragments(html: "<p id='a'>\(abbreviation)</p><p id='b'>\(chinese)</p><p id='c'>\(english)</p>", href: AnyURL(string: "allowed.xhtml")!, title: "Allowed", anchors: [:], logical: &logical)
        try db.commit(bookID, chapter: 1, href: "allowed.xhtml", title: "Allowed", fragments: allowed)
        let rows = try db.rows("SELECT id,chapter,original FROM fragments WHERE book_id=? ORDER BY id", [bookID])
        let unreadID = Int(rows.first { $0[1] == "0" }![0])!
        let allowedRows = rows.filter { $0[1] == "1" }
        // 384 Float32 values become the 1536-byte BLOB required by embeddings.vector.
        let vector = [Float](repeating: 0.01, count: SemanticEmbedding.dimension)
        for row in rows {
            let statement = try db.statement("INSERT INTO embeddings(book_id,model,fragment_id,piece,offset,original,vector) VALUES(?,?,?,?,?,?,?)", [bookID, SemanticEmbedding.version, row[0], "0", "0", row[2]])
            let status = vector.withUnsafeBytes {
                sqlite3_bind_blob(statement, 7, $0.baseAddress, Int32($0.count), unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            }
            guard status == SQLITE_OK, sqlite3_step(statement) == SQLITE_DONE else {
                sqlite3_finalize(statement)
                throw IndexError.storage
            }
            sqlite3_finalize(statement)
        }
        try db.execute("INSERT INTO embedding_progress VALUES(?,?,?,?,?)", [bookID, SemanticEmbedding.version, "0", String(rows.count), String(rows.count)])
        try db.execute("UPDATE preparations SET completed=total WHERE book_id=?", [bookID])
        return (root, db, BookIndex(url: root.appendingPathComponent("book-index.sqlite")), bookID, BookEvidenceScope(bookID: bookID, chapters: [1]), unreadID,
                Set(allowedRows.map { Int($0[0])! }), Int(rows.first { $0[2] == abbreviation }![0])!, abbreviation)
    }

    func testIssue11SentenceBoundarySoftLinesAbbreviationsAndPunctuation() async throws {
        let english = "Mr. Darcy read the letter\nagain. He changed his mind! Why?"
        let ranges = SourceSentenceUnit.ranges(english, language: .english)
        let sentences = ranges.map { (english as NSString).substring(with: $0) }
        XCTAssertEqual(sentences.count, 3)
        XCTAssertTrue(sentences[0].contains("Mr. Darcy")); XCTAssertTrue(sentences[0].contains("\nagain."))
        XCTAssertEqual(sentences.joined(), english)
        let chinese = "他重新\n读信。她问：“为什么？”他回答！"
        let cn = SourceSentenceUnit.ranges(chinese, language: .simplifiedChinese).map { (chinese as NSString).substring(with: $0) }
        XCTAssertEqual(cn.joined(), chinese); XCTAssertTrue(cn[0].contains("重新\n读信。"))
        let long = String(repeating: "the reader considers the evidence and its consequences ", count: 50) + "."
        let longRanges = SourceSentenceUnit.ranges(long, language: .english)
        XCTAssertEqual(longRanges, [NSRange(location: 0, length: (long as NSString).length)])
        let pieces = try await SemanticEmbedding.shared.chunks(long)
        XCTAssertGreaterThan(pieces.count, 1); XCTAssertEqual(pieces.map(\.text).joined(), long)
        var offset = 0
        for piece in pieces { XCTAssertEqual(piece.offset, offset); offset += piece.text.utf16.count }
    }
    @MainActor func testIssue11SentenceUnitsFrozenChineseAssessment() async throws {
        let root = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Issue11Assessment")
        let (library, book) = try await prepared("pride-and-prejudice", root: root)
        let index = library.preparation.index, scope = BookEvidenceScope(bookID: book.id)
        let derived = root.appendingPathComponent("sentence-units-v2.sqlite")
        let units = try await index.sentenceUnits(scope: scope)
        let source = try IndexDatabase(url: root.appendingPathComponent("book-index.sqlite"))
        for row in try source.rows("SELECT id,original FROM fragments WHERE book_id=?", [book.id]) {
            let fragments = units.filter { $0.fragmentID == Int(row[0])! }.sorted { $0.start < $1.start }
            XCTAssertEqual(fragments.map { $0.evidence.quote }.joined(), row[1])
            XCTAssertEqual(fragments.first?.start, 0)
            for pair in zip(fragments, fragments.dropFirst()) { XCTAssertEqual(pair.0.start + pair.0.length, pair.1.start) }
        }
        try attachment(try JSONSerialization.jsonObject(with: JSONEncoder().encode(units)), name: "issue11-sentence-units")
        print("I11_SENTENCE_UNITS count=\(units.count) bytes=\(units.reduce(0) { $0 + $1.evidence.quote.utf8.count })")
        try await index.prepareSentenceUnitVectors(scope: scope, derivedURL: derived)
        let inputs: [(String, String, Bool)] = [
            ("whole", "概括全书中伊丽莎白与达西怎样逐步纠正对彼此的判断，哪些事件改变了他们的决定？", true),
            ("local", "第3章舞会中，达西为何不与伊丽莎白跳舞？", false),
            ("isolation", "盐桥计划花了多少钱？", false)
        ]
        for (name, question, whole) in inputs {
            let result = try await index.assessSentenceUnits(scope: scope, query: question, derivedURL: derived, wholeBook: whole)
            let final = Set(result.finalUnitIDs)
            for group in result.groups {
                XCTAssertTrue(result.selectedGroupIDs.contains(group.id) ? Set(group.unitIDs).isSubset(of: final) : Set(group.unitIDs).isDisjoint(with: final))
            }
            XCTAssertEqual(result.groups.count, result.selectedGroupIDs.count + result.omittedGroupIDs.count)
            XCTAssertLessThanOrEqual(result.payload.utf8.count, 23000)
            XCTAssertFalse(result.payload.contains("一百万元"))
            try attachment(try JSONSerialization.jsonObject(with: JSONEncoder().encode(result)), name: "issue11-sentence-" + name)
            print("I11_SENTENCE_RESULT \(name) candidates=\(result.candidateIDs.count) groups=\(result.groups.count) selected=\(result.selectedGroupIDs.count) bytes=\(result.payload.utf8.count)")
        }
        let restricted = BookEvidenceScope(bookID: book.id, throughChapter: 0, throughOrdinal: 1)
        let narrow = try await index.sentenceUnits(scope: restricted)
        let allowed = Set(narrow.map(\.id))
        let narrowResult = try await index.assessSentenceUnits(scope: restricted, query: inputs[2].1, derivedURL: derived, wholeBook: false)
        XCTAssertTrue(Set(narrowResult.finalUnitIDs).isSubset(of: allowed))
    }
    func testIssue11InlineChapterBoundariesSkipHiddenAndContinueAcrossResources() throws {
        var logical: (key: String, title: String)? = ("a.xhtml#old", "Old")
        let parts = try BookText.fragments(html: "<p>old<span id='new'></span>new<b hidden id='hidden'>secret</b>still new<i id='last'></i>last</p>", href: AnyURL(string: "a.xhtml")!, title: "resource", anchors: ["new":"New", "hidden":"Hidden", "last":"Last"], logical: &logical)
        XCTAssertEqual(parts.map(\.text), ["old","new","still new","last"])
        XCTAssertEqual(parts.map { $0.locator.title }, ["Old","New","New","Last"])
        let continuation = try BookText.fragments(html: "<p>continued</p>", href: AnyURL(string: "b.xhtml")!, title: "resource", anchors: [:], logical: &logical)
        XCTAssertEqual(continuation.first?.locator.locations.otherLocations["shudengChapter"]?.string, "a.xhtml#last")
        let next = try BookText.fragments(html: "<p>new file chapter</p>", href: AnyURL(string: "c.xhtml")!, title: "resource", anchors: ["":"File chapter"], logical: &logical)
        XCTAssertEqual(next.first?.locator.locations.otherLocations["shudengChapter"]?.string, "c.xhtml")
        XCTAssertEqual(next.first?.locator.title, "File chapter")
    }

    @MainActor func testIssue11IndexVersionUpgradeOnlyRebuildsDerivedData() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("issue11-migration-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let business = ["library.json","reading-questions.json","ai-services.json"]
        for file in business { try Data(("preserve-" + file).utf8).write(to: root.appendingPathComponent(file)) }
        let url = root.appendingPathComponent("book-index.sqlite"), db = try IndexDatabase(url: url)
        try db.execute("INSERT INTO preparations VALUES('book',2,1,1)")
        try db.execute("INSERT INTO chapters VALUES('book',0,'old.xhtml','Old')")
        try db.execute("INSERT INTO fragments VALUES(1,'book',0,0,'old','{}')")
        try db.execute("INSERT INTO embedding_progress VALUES('book','old',1,1,1)")
        try db.initialize("book", total: 1, contents: "[]", rebuild: false)
        XCTAssertEqual(try db.rows("SELECT version,completed FROM preparations WHERE book_id='book'", []), [["3","0"]])
        XCTAssertEqual(try db.rows("SELECT count(*) FROM fragments", [])[0][0], "0")
        XCTAssertEqual(try db.rows("SELECT count(*) FROM embedding_progress", [])[0][0], "0")
        for file in business { XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(file)), Data(("preserve-" + file).utf8)) }
    }
    @MainActor private func prepared(_ name: String, root: URL) async throws -> (LibraryStore, Book) {
        let library = try LibraryStore(root: root)
        let file = Bundle(for: Self.self).url(forResource: name, withExtension: "epub", subdirectory: "Fixtures")!
        let book = try await library.importBook(from: file).book
        for _ in 0..<2400 {
            if library.preparation.states[book.id]?.ready == true { await library.preparation.waitForCurrentWork(); return (library, book) }
            if let error = library.preparation.states[book.id]?.failure { throw NSError(domain: error, code: 1) }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTFail("Preparation did not finish"); throw IndexError.storage
    }
    private func attachment(_ value: Any, name: String) throws {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Issue10Evidence")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try data.write(to: directory.appendingPathComponent(name + ".json"), options: .atomic)
    }
    @MainActor func testRealImportedNecessaryEvidenceBudgetScopesAndFinalPrompt() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("issue10-relevance-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let (library, book) = try await prepared("semantic-fixture", root: root)
        let index = library.preparation.index
        let db = try IndexDatabase(url: root.appendingPathComponent("book-index.sqlite"))
        let all = try db.rows("SELECT id,original FROM fragments WHERE book_id=? ORDER BY id", [book.id])
        let scope = BookEvidenceScope(bookID: book.id)
        func evidence(_ id: String) throws -> QuestionEvidence {
            let map = try JSONSerialization.jsonObject(with: Data(contentsOf: Bundle(for: Self.self).url(forResource: "semantic-map", withExtension: "json", subdirectory: "Fixtures")!)) as! [String: Any]
            let records = (map["semantic-fixture"] as! [String: Any])["records"] as! [[String: Any]]
            let text = records.first { $0["id"] as? String == id }!["text"] as! String
            return try XCTUnwrap(db.evidence(id: Int(all.first { $0[1] == text }![0])!, scope: scope))
        }
        let cases: [(String, String, [String])] = [
            ("no-keyword", "切掉首要电源后，哪两件装置依旧运转？", ["ch3-p1"]),
            ("synonym", "把主要供电断掉以后哪些仪器还能工作？", ["ch3-p1"]),
            ("cross-language", "Which machines keep working after disconnecting the main power?", ["ch3-p1"]),
            ("cross-chapter", "作者为什么从等待次日停机改为危险时立即停机？", ["ch1-p5", "ch2-p1", "ch2-p2"]),
            ("term", "盐桥的余辉是什么意思？", ["ch1-p2"])
        ]
        var report: [[String: Any]] = [], missingTotal = 0
        for (name, query, required) in cases {
            // Empty selection exercises the same production path without injecting the answer.
            var location = try evidence("ch4-p3").location(); location.text = .init(highlight: "")
            var record = ReadingQuestion(book: book, selection: QuestionEvidence(locator: location, context: ""), neighbors: [])
            record.question = query
            let start = Date()
            let plan = try await QuestionPlan.make(record, index: index, local: false, state: library.preparation.states[book.id]!)
            let missing = try required.filter { id in !plan.evidence.contains { $0.quote == (try? evidence(id).quote) } }
            missingTotal += missing.count
            XCTAssertTrue(missing.isEmpty, "\(name) missing \(missing)")
            var rankDiagnostic: [String: Any] = [:]
            if !missing.isEmpty {
                let selected = try await QuestionPlan.requiredEvidence(record, index: index, local: false, scope: scope)
                let actualQuery = QuestionPlan.retrievalInput(record, evidence: selected)
                let vector = try await SemanticEmbedding.shared.embed(actualQuery), sql = scope.sql
                let statement = try db.statement("SELECT e.fragment_id,e.piece,e.offset,e.original,e.vector FROM embeddings e JOIN fragments f ON f.id=e.fragment_id WHERE " + sql.filter + " AND e.book_id=f.book_id AND e.model=?", sql.bounds + [SemanticEmbedding.version])
                defer { sqlite3_finalize(statement) }
                var ranked: [(id: Int, piece: Int, offset: Int, text: String, score: Float)] = []
                while true {
                    let step = sqlite3_step(statement)
                    if step == SQLITE_DONE { break }
                    guard step == SQLITE_ROW, sqlite3_column_bytes(statement, 4) == 1536, let blob = sqlite3_column_blob(statement, 4) else { throw IndexError.storage }
                    var score: Float = 0
                    for i in vector.indices { score += vector[i] * blob.loadUnaligned(fromByteOffset: i * 4, as: Float.self) }
                    ranked.append((Int(sqlite3_column_int64(statement, 0)), Int(sqlite3_column_int(statement, 1)), Int(sqlite3_column_int(statement, 2)), String(cString: sqlite3_column_text(statement, 3)), score))
                }
                ranked.sort { $0.score != $1.score ? $0.score > $1.score : $0.id != $1.id ? $0.id < $1.id : $0.piece < $1.piece }
                // Full vector ranks diagnose misses; the trace contains only final hybrid sources.
                let targets = try missing.map { id -> [String: Any] in
                    let original = try evidence(id).quote, fragmentID = Int(all.first { $0[1] == original }![0])!
                    let blocks: [[String: Any]] = ranked.enumerated().filter { $0.element.id == fragmentID }.map { position, block in
                        ["rank": position + 1, "piece": block.piece, "offset": block.offset, "text": block.text, "score": Double(block.score), "final_contains_exact_block": plan.evidence.contains { $0.quote == block.text }]
                    }
                    return ["id": id, "fragmentID": fragmentID, "original": original, "blocks": blocks]
                }
                rankDiagnostic = ["actual_query": actualQuery, "targets": targets, "top15_original_bytes": ranked.prefix(15).reduce(0) { $0 + $1.text.utf8.count }, "top15": ranked.prefix(15).map { ["fragmentID": $0.id, "piece": $0.piece, "text": $0.text] as [String: Any] }]
                print("I21_RANK_DIAGNOSTIC " + String(decoding: try JSONSerialization.data(withJSONObject: rankDiagnostic, options: [.sortedKeys]), as: UTF8.self))
            }
            XCTAssertLessThanOrEqual(plan.evidence.count, 15); XCTAssertLessThanOrEqual(plan.prompt.utf8.count, 24000)
            let trace = try XCTUnwrap(plan.trace)
            if name == "no-keyword" {
                let target = Int(all.first { $0[1] == (try? evidence("ch3-p1").quote) }![0])!
                XCTAssertFalse(trace.keyword.contains(target)); XCTAssertTrue(trace.semantic.contains(target))
            }
            report.append(["case":name,"query":query,"missing_required":missing,"rank_diagnostic":rankDiagnostic,"bookID":book.id,"trace":try JSONSerialization.jsonObject(with: JSONEncoder().encode(trace)),"evidence":try JSONSerialization.jsonObject(with: JSONEncoder().encode(plan.evidence)),"prompt":plan.prompt,"seconds":Date().timeIntervalSince(start)])
        }
        var selected = ReadingQuestion(book: book, selection: try evidence("ch2-p3"), neighbors: [try evidence("ch2-p2"), try evidence("ch2-p4")])
        selected.question = "为什么说立即停机不违反审慎原则？"
        let plan = try await QuestionPlan.make(selected, index: index, local: false, state: library.preparation.states[book.id]!)
        XCTAssertEqual(plan.evidence.first?.quote, selected.selection.quote)
        XCTAssertTrue(try XCTUnwrap(plan.trace).expanded.isEmpty)
        XCTAssertLessThanOrEqual(try XCTUnwrap(plan.trace).keyword.count, 8)
        XCTAssertLessThanOrEqual(try XCTUnwrap(plan.trace).anchors.count, 8)
        let limited = BookEvidenceScope(bookID: book.id, throughChapter: 0, throughOrdinal: Int.max)
        do { _ = try await QuestionPlan.make(selected, index: index, local: false, state: library.preparation.states[book.id]!, scope: limited); XCTFail("Out-of-scope mandatory selection must refuse the request") }
        catch { XCTAssertEqual(error as? QuestionError, .scope) }
        var permitted = ReadingQuestion(book: book, selection: try evidence("ch1-p5"), neighbors: [try evidence("ch1-p4")]); permitted.question = selected.question
        let limitedPlan = try await QuestionPlan.make(permitted, index: index, local: false, state: library.preparation.states[book.id]!, scope: limited)
        for value in limitedPlan.evidence { XCTAssertTrue(try value.location().href.string.contains("ch1.xhtml")) }
        permitted = ReadingQuestion(book: book, selection: try evidence("ch1-p5"), neighbors: [try evidence("ch2-p1")]); permitted.question = selected.question
        let ignoredNeighbor = try await QuestionPlan.make(permitted, index: index, local: false, state: library.preparation.states[book.id]!, scope: limited)
        XCTAssertFalse(ignoredNeighbor.evidence.contains { $0.quote == (try? evidence("ch2-p1").quote) })
        let safe = try evidence("ch1-p5")
        let poisoned = QuestionEvidence(locator: try safe.location(), context: safe.quote + " CONTEXT-OUTSIDE-SCOPE " + (try evidence("ch2-p1").quote))
        var poisonedRecord = ReadingQuestion(book: book, selection: poisoned, neighbors: [])
        poisonedRecord.question = "解释这条规则"
        let sanitized = try await QuestionPlan.make(poisonedRecord, index: index, local: false, state: library.preparation.states[book.id]!, scope: limited)
        XCTAssertFalse(sanitized.prompt.contains("CONTEXT-OUTSIDE-SCOPE"))
        XCTAssertEqual(sanitized.evidence.first?.context, safe.quote)
        // Reader supplies visible current-book DOM spans; the explicit local choice needs no index.
        let localPlan = try await QuestionPlan.make(poisonedRecord, index: BookIndex(url: root.appendingPathComponent("not-prepared.sqlite")), local: true, state: BookPreparationState())
        XCTAssertFalse(localPlan.prompt.contains("CONTEXT-OUTSIDE-SCOPE"))
        XCTAssertEqual(localPlan.evidence.map(\.context), [safe.quote])
        let other = try await library.importBook(from: Bundle(for: Self.self).url(forResource: "semantic-other", withExtension: "epub", subdirectory: "Fixtures")!).book
        await library.preparation.waitForCurrentWork()
        XCTAssertTrue(library.preparation.states[other.id]?.ready == true)
        let otherRows = try db.rows("SELECT count(*) FROM embeddings WHERE book_id=?", [other.id])[0][0]
        XCTAssertEqual(otherRows, "1")
        let absence = try await index.retrieve(scope: scope, query: "盐桥计划花了多少钱？")
        XCTAssertFalse(absence.evidence.contains { $0.quote.contains("一百万元") })
        var noAnswer = ReadingQuestion(book: book, selection: QuestionEvidence(locator: try evidence("ch4-p3").location(), context: try evidence("ch4-p3").quote), neighbors: [])
        noAnswer.question = "盐桥计划花了多少钱？"
        let absentPlan = try await QuestionPlan.make(noAnswer, index: index, local: false, state: library.preparation.states[book.id]!)
        XCTAssertFalse(absentPlan.prompt.contains("一百万元"))
        let otherID = Int(try db.rows("SELECT id FROM fragments WHERE book_id=?", [other.id])[0][0])!
        XCTAssertFalse(absentPlan.trace!.keyword.contains(otherID)); XCTAssertFalse(absentPlan.trace!.semantic.contains(otherID)); XCTAssertFalse(absentPlan.trace!.expanded.contains(otherID))
        let scoped = try await index.retrieve(scope: limited, query: selected.question)
        for value in scoped.evidence { XCTAssertTrue(try value.location().href.string.contains("ch1.xhtml")) }
        // Final material is what validate()/HTTP consumes, not hidden-only UI filtering.
        try attachment(["cases":report,"selected_prompt":plan.prompt,"limited_prompt":limitedPlan.prompt,"out_of_scope_selection":"refused","out_of_scope_neighbor":"ignored","out_of_scope_context":"rebuilt-from-verified-quote","sanitized_prompt":sanitized.prompt,"local_without_index_prompt":localPlan.prompt,"otherBookID":other.id,"otherBookVectorRows":otherRows,"absence_prompt":absentPlan.prompt,"absence_trace":try JSONSerialization.jsonObject(with: JSONEncoder().encode(absentPlan.trace!)),"absence_evidence":try JSONSerialization.jsonObject(with: JSONEncoder().encode(absence.evidence))], name:"necessary-evidence")
        print("I21_RELEVANCE cases=\(cases.count) missing_required=\(missingTotal)")
    }

    @MainActor func testUniqueEnglishAnswerWithEightyDistractorsRealIOS() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("issue10-english-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let (library, book) = try await prepared("semantic-english", root: root)
        let db = try IndexDatabase(url: root.appendingPathComponent("book-index.sqlite"))
        XCTAssertEqual(try db.rows("SELECT count(*) FROM fragments WHERE book_id=?", [book.id])[0][0], "81")
        let result = try await library.preparation.index.retrieve(scope: BookEvidenceScope(bookID: book.id), query: "移除主电池后记录器为什么还在运行？")
        let expected = "The recorder draws power from an independent backup cell. Removing the main battery stops the thermometer but does not stop the recorder or the timer."
        XCTAssertTrue(result.evidence.contains { $0.quote == expected })
        let target = Int(try db.rows("SELECT id FROM fragments WHERE book_id=? AND original=?", [book.id, expected])[0][0])!
        XCTAssertEqual(result.trace.semantic.first, target)
        let seed = try XCTUnwrap(db.evidence(id: target, scope: BookEvidenceScope(bookID: book.id)))
        var emptyLocation = try seed.location(); emptyLocation.text = .init(highlight: "")
        var record = ReadingQuestion(book: book, selection: QuestionEvidence(locator: emptyLocation, context: ""), neighbors: [])
        record.question = "移除主电池后记录器为什么还在运行？"
        let plan = try await QuestionPlan.make(record, index: library.preparation.index, local: false, state: library.preparation.states[book.id]!)
        XCTAssertTrue(plan.evidence.contains { $0.quote == expected })
        XCTAssertTrue(plan.prompt.contains(expected))
        XCTAssertLessThanOrEqual(plan.evidence.count, 15); XCTAssertLessThanOrEqual(plan.prompt.utf8.count, 24000)
        try attachment(["bookID":book.id,"records":81,"english_required":expected,"final_prompt":plan.prompt,"final_evidence":try JSONSerialization.jsonObject(with: JSONEncoder().encode(plan.evidence)),"missing_required":result.evidence.contains { $0.quote == expected } ? [] : ["ch3-p2"],"trace":try JSONSerialization.jsonObject(with: JSONEncoder().encode(result.trace)),"evidence":try JSONSerialization.jsonObject(with: JSONEncoder().encode(result.evidence)),"model":SemanticEmbedding.version],name:"unique-english")
        print("I10_ENGLISH records=81 semantic-rank=1 necessary-original-in-material=true model=\(SemanticEmbedding.version)")
    }
}

extension SemanticTests {
    @MainActor func testCommittedVectorsActualSQLiteFailureResumeModelFailureAndRebuild() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("issue10-recovery-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = Bundle(for: Self.self).url(forResource: "semantic-fixture", withExtension: "epub", subdirectory: "Fixtures")!
        let url = root.appendingPathComponent("recovery.sqlite"), index = BookIndex(url: url)
        try await index.prepare(bookID: "recovery", file: file) { _ in }
        let db = try IndexDatabase(url: url)
        let before = try db.rows("SELECT id,original,locator FROM fragments ORDER BY id", [])
        let task = Task {
            try await index.prepareVectors(bookID: "recovery") { state in
                if state.vectorsCompleted == 8 { withUnsafeCurrentTask { $0?.cancel() } }
            }
        }
        do { try await task.value; XCTFail("Expected actual interruption after commit") } catch is CancellationError { }
        let progress = try db.rows("SELECT model,cursor,completed,total FROM embedding_progress", [])
        XCTAssertEqual(progress[0][2], "8")
        let committed = try db.rows("SELECT fragment_id,piece,hex(vector) FROM embeddings ORDER BY fragment_id,piece", [])
        // A trigger aborts an actual vector insert in the production transaction.
        try db.execute("CREATE TRIGGER issue10_abort BEFORE INSERT ON embeddings WHEN NEW.fragment_id>8 BEGIN SELECT RAISE(ABORT,'issue10 real vector write failure'); END")
        let reopened = BookIndex(url: url)
        do { try await reopened.prepareVectors(bookID: "recovery") { _ in }; XCTFail("Expected SQLite insert failure") }
        catch { XCTAssertTrue(error is IndexError) }
        XCTAssertEqual(try db.rows("SELECT model,cursor,completed,total FROM embedding_progress", []), progress)
        XCTAssertEqual(try db.rows("SELECT fragment_id,piece,hex(vector) FROM embeddings ORDER BY fragment_id,piece", []), committed)
        try db.execute("DROP TRIGGER issue10_abort")
        let broken = SemanticEmbedding(folder: root.appendingPathComponent("missing-model"))
        do { try await reopened.prepareVectors(bookID: "recovery", embedding: broken) { _ in }; XCTFail("Missing model cannot succeed") }
        catch { XCTAssertTrue(error is EmbeddingError) }
        let reading = try await reopened.search(bookID: "recovery", query: "盐桥")
        XCTAssertFalse(reading.isEmpty)
        XCTAssertEqual(try db.rows("SELECT model,cursor,completed,total FROM embedding_progress", []), progress)
        var observed: [Int] = []
        try await reopened.prepareVectors(bookID: "recovery") { observed.append($0.vectorsCompleted) }
        XCTAssertEqual(observed.first, 8)
        XCTAssertEqual(observed.last, 104)
        XCTAssertEqual(try db.rows("SELECT fragment_id,piece,hex(vector) FROM embeddings WHERE fragment_id<=8 ORDER BY fragment_id,piece", []), committed)
        XCTAssertEqual(try db.rows("SELECT id,original,locator FROM fragments ORDER BY id", []), before)
        XCTAssertEqual(try db.rows("SELECT count(*) FROM (SELECT fragment_id,piece,count(*) n FROM embeddings GROUP BY fragment_id,piece HAVING n>1)", []), [["0"]])
        XCTAssertEqual(try db.rows("PRAGMA integrity_check", []), [["ok"]])
        // Seed actual independent business files and compare bytes through an index rebuild.
        let (library, book) = try await prepared("semantic-fixture", root: root.appendingPathComponent("business"))
        let businessDB = try IndexDatabase(url: library.root.appendingPathComponent("book-index.sqlite"))
        let id = Int(try businessDB.rows("SELECT id FROM fragments WHERE book_id=? ORDER BY id LIMIT 1", [book.id])[0][0])!
        let value = try XCTUnwrap(businessDB.evidence(id: id, scope: BookEvidenceScope(bookID: book.id)))
        let location = try value.location()
        try library.saveLocation(location, for: book.id)
        try library.saveBookmark(Bookmark(locator: location), for: book.id)
        let note = BookNote(locator: location, body: "Committed business note")
        try library.saveNote(note, for: book.id, highlightOnly: false)
        let draft = BookNote(locator: location, body: "Committed draft")
        try library.saveNote(draft, for: book.id, draft: true)
        let secrets = KeychainSecrets(service: "dev.shudeng.tests.semantic." + UUID().uuidString)
        let questions = QuestionStore(root: library.root, secrets: secrets)
        var question = ReadingQuestion(book: book, selection: value, neighbors: [])
        question.question = "Saved question"; question.answer = "Saved answer"; question.evidence = [value]; question.citations = [value]; question.state = .complete
        XCTAssertTrue(questions.save(question))
        let paths = ["library.json", "reading-questions.json"]
        let snapshots = try paths.map { try Data(contentsOf: library.root.appendingPathComponent($0)) }
        try await library.preparation.index.prepare(bookID: book.id, file: library.fileURL(for: book), rebuild: true) { _ in }
        try await library.preparation.index.prepareVectors(bookID: book.id) { _ in }
        XCTAssertEqual(try paths.map { try Data(contentsOf: library.root.appendingPathComponent($0)) }, snapshots)
        try attachment(["committed_before_failure":progress,"committed_vectors":committed,"resume_progress":observed,"integrity":"ok","business_files_identical":paths,"missing_model_reading_available":true], name:"vector-recovery")
        print("I10_RECOVERY committed=8/104 actual-vector-write-failure=true missing-model-search-available=true resumed-from=8 duplicate-vectors=0 business-bytes-identical=true")
    }
}

import Darwin

extension SemanticTests {
    @MainActor func testUncachedLoadAndSyntheticTenThousandScanBudget() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("issue10-synthetic-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("SemanticModel")
        try? FileManager.default.removeItem(at: cache)
        XCTAssertFalse(FileManager.default.fileExists(atPath: cache.path))
        let loadStart = Date()
        _ = try await SemanticEmbedding.shared.embed("首次无缓存解压、加载及查询嵌入")
        let uncachedSeconds = Date().timeIntervalSince(loadStart)
        XCTAssertTrue(FileManager.default.fileExists(atPath: cache.appendingPathComponent(SemanticEmbedding.modelSHA + ".onnx").path))
        let (library, book) = try await prepared("semantic-fixture", root: root)
        let db = try IndexDatabase(url: root.appendingPathComponent("book-index.sqlite"))
        // Scan-scale benchmark only: replicate real fixture vectors in this isolated test store.
        let sourceCount = Int(try db.rows("SELECT count(*) FROM embeddings WHERE book_id=?", [book.id])[0][0])!
        let synthetic = "synthetic-10000-scan-only"
        try db.transaction {
            try db.execute("CREATE TEMP TABLE seed AS SELECT row_number() OVER (ORDER BY fragment_id,piece) AS n, * FROM embeddings WHERE book_id=?", [book.id])
            try db.execute("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000) INSERT INTO fragments SELECT 100000+x,?,0,x,s.original,f.locator FROM n JOIN seed s ON s.n=((x-1)%?)+1 JOIN fragments f ON f.id=s.fragment_id", [synthetic, String(sourceCount)])
            try db.execute("INSERT INTO embeddings SELECT ?,s.model,f.id,0,0,s.original,s.vector FROM fragments f JOIN seed s ON s.n=((f.ordinal-1)%?)+1 WHERE f.book_id=?", [synthetic, String(sourceCount), synthetic])
            try db.execute("INSERT INTO preparations VALUES(?,2,1,1)", [synthetic])
            try db.execute("INSERT INTO embedding_progress VALUES(?,?,110000,10000,10000)", [synthetic, SemanticEmbedding.version])
            try db.execute("DROP TABLE seed")
        }
        XCTAssertEqual(try db.rows("SELECT count(*) FROM embeddings WHERE book_id=?", [synthetic]), [["10000"]])
        let queries = ["Why does Elizabeth reject the proposal?", "What changes her opinion of Darcy?", "达西为什么帮助莉迪亚？", "How are wealth and marriage connected?", "切掉首要电源后，哪两件装置依旧运转？"]
        var latencies: [Double] = []
        for i in 0..<20 {
            let start = Date()
            let result = try await library.preparation.index.retrieve(scope: BookEvidenceScope(bookID: synthetic), query: queries[i % queries.count])
            latencies.append(Date().timeIntervalSince(start))
            XCTAssertFalse(result.evidence.isEmpty)
        }
        let p95 = latencies.sorted()[Int(ceil(Double(latencies.count) * 0.95)) - 1]
        var usage = rusage(); getrusage(RUSAGE_SELF, &usage)
        let peak = Int64(usage.ru_maxrss)
        try attachment(["kind":"synthetic scan-scale only; repeated real vectors; not long-book relevance", "vectors":10000, "queries_including_embedding":latencies, "query_p95_seconds":p95, "uncached_decompression_load_and_first_embedding_seconds":uncachedSeconds, "peak_rss_bytes":peak, "platform":"iOS simulator; not iPhone performance"], name:"uncached-synthetic-10000-budget")
        print("I10_SYNTHETIC vectors=10000 queries=20 p95=\(p95)s uncached=\(uncachedSeconds)s peak-rss=\(peak)")
        XCTAssertLessThan(uncachedSeconds, 5)
        XCTAssertLessThan(p95, 2)
        XCTAssertLessThan(peak, 600 * 1024 * 1024)
    }

    @MainActor func testLongPublicDomainBookBudgetAndMainThreadResponsiveness() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("issue10-long-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        func peakRSS() -> Int64 { var usage = rusage(); getrusage(RUSAGE_SELF, &usage); return Int64(usage.ru_maxrss) }
        let baselineRSS = peakRSS()
        let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("SemanticModel")
        if FileManager.default.fileExists(atPath: cache.path) { try FileManager.default.removeItem(at: cache) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: cache.path))
        print("I10_REPAIR_PROCESS pid=\(getpid()) uncached=true")
        let cold = Date()
        _ = try await SemanticEmbedding.shared.tokenIDs("Cold load measurement")
        let coldSeconds = Date().timeIntervalSince(cold)
        let afterColdRSS = peakRSS()
        _ = try await SemanticEmbedding.shared.embed("Why does Elizabeth reject the first proposal?")
        let uncachedFirstEmbeddingSeconds = Date().timeIntervalSince(cold)
        let afterFirstInferenceRSS = peakRSS()
        print("I10_MEMORY after-first-inference=\(afterFirstInferenceRSS)")
        print("I10_MEMORY baseline=\(baselineRSS) after-cold=\(afterColdRSS)")
        var gaps: [Double] = []
        let pulse = Task { @MainActor in
            var last = Date()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 20_000_000)
                let now = Date(); gaps.append(now.timeIntervalSince(last)); last = now
            }
        }
        defer { pulse.cancel() }
        let start = Date()
        let (library, book) = try await prepared("pride-and-prejudice", root: root)
        let indexSeconds = Date().timeIntervalSince(start)
        let afterIndexRSS = peakRSS()
        print("I10_MEMORY after-index=\(afterIndexRSS)")
        let db = try IndexDatabase(url: root.appendingPathComponent("book-index.sqlite"))
        let stats = try db.rows("SELECT count(*),sum(length(original)) FROM fragments WHERE book_id=?", [book.id])[0]
        let vectors = try db.rows("SELECT count(*),sum(length(vector)),min(length(vector)),max(length(vector)) FROM embeddings WHERE book_id=?", [book.id])[0]
        let chapters = try db.rows("SELECT count(*) FROM chapters WHERE book_id=?", [book.id])[0][0]
        let prose = try db.rows("SELECT original FROM fragments WHERE book_id=? ORDER BY chapter,ordinal", [book.id]).map { $0[0] }.joined(separator: " ")
        let words = prose.split(whereSeparator: { $0.isWhitespace }).count
        var latencies: [Double] = []
        let queries = ["Why does Elizabeth reject the first proposal?", "What changes her opinion of Darcy?", "达西为什么帮助莉迪亚？", "What is the connection between wealth and marriage?", "How does prejudice affect the judgment of Elizabeth?"]
        for i in 0..<20 {
            let query = queries[i % queries.count]
            let queryStart = Date()
            let result = try await library.preparation.index.retrieve(scope: BookEvidenceScope(bookID: book.id), query: query)
            latencies.append(Date().timeIntervalSince(queryStart))
            XCTAssertFalse(result.evidence.isEmpty)
        }
        var usage = rusage(); getrusage(RUSAGE_SELF, &usage)
        let rss = Int64(usage.ru_maxrss)
        let p95 = latencies.sorted()[18]
        let peakGap = gaps.max() ?? 0
        XCTAssertLessThan(indexSeconds, 900)
        XCTAssertLessThan(coldSeconds, 5)
        XCTAssertLessThan(uncachedFirstEmbeddingSeconds, 5)
        XCTAssertLessThan(latencies.sorted().last!, 2)
        XCTAssertLessThan(rss, 600 * 1024 * 1024)
        XCTAssertLessThan(peakGap, 0.1, "Main actor heartbeat while indexing")
        let before = try db.rows("SELECT cursor,completed,total FROM embedding_progress WHERE book_id=?", [book.id])
        let resumeStart = Date()
        try await library.preparation.index.prepareVectors(bookID: book.id) { _ in }
        let resumeSeconds = Date().timeIntervalSince(resumeStart)
        XCTAssertEqual(try db.rows("SELECT cursor,completed,total FROM embedding_progress WHERE book_id=?", [book.id]), before)
        try attachment(["bookID":book.id,"source":"https://www.gutenberg.org/ebooks/1342.epub.noimages","sha256":"e59e587472723023b21bf380b8327858e7540b25e57affa3a68935b291e370dc","license":"Project Gutenberg public domain text, Jane Austen died 1817; embedded license retained","word_count":words,"characters":stats[1],"reading_order_resources":chapters,"fragments":stats[0],"vector_rows":vectors[0],"vector_bytes":vectors[1],"vector_min_max_bytes":Array(vectors.suffix(2)),"pid":getpid(),"uncached":true,"uncached_load_and_first_embedding_seconds":uncachedFirstEmbeddingSeconds,"query_p95_seconds":p95,"after_first_inference_peak_rss_bytes":afterFirstInferenceRSS,"cold_session_seconds":coldSeconds,"index_seconds":indexSeconds,"query_seconds":latencies,"peak_rss_bytes":rss,"baseline_rss_bytes":baselineRSS,"after_cold_rss_bytes":afterColdRSS,"after_index_rss_bytes":afterIndexRSS,"main_actor_20ms_heartbeat_max_seconds":peakGap,"no_work_resume_seconds":resumeSeconds,"platform":"iOS 26.5 simulator on Mac; not iPhone memory, speed, thermals or battery"],name:"long-book-performance")
        print("I10_LONG words=\(words) fragments=\(stats[0]) vectors=\(vectors[0]) index=\(indexSeconds)s cold=\(coldSeconds)s query-max=\(latencies.max()!)s peak-rss=\(rss) main-gap=\(peakGap)s resume=\(resumeSeconds)s")
    }
}
