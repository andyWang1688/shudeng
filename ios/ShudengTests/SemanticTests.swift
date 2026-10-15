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

extension SemanticTests {
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
        var report: [[String: Any]] = []
        for (name, query, required) in cases {
            // Empty selection exercises the same production path without injecting the answer.
            var location = try evidence("ch4-p3").location(); location.text = .init(highlight: "")
            var record = ReadingQuestion(book: book, selection: QuestionEvidence(locator: location, context: ""), neighbors: [])
            record.question = query
            let start = Date()
            let plan = try await QuestionPlan.make(record, index: index, local: false, state: library.preparation.states[book.id]!)
            let missing = try required.filter { id in !plan.evidence.contains { $0.quote == (try? evidence(id).quote) } }
            XCTAssertTrue(missing.isEmpty, "\(name) missing \(missing)")
            XCTAssertLessThanOrEqual(plan.evidence.count, 15); XCTAssertLessThanOrEqual(plan.prompt.utf8.count, 24000)
            let trace = try XCTUnwrap(plan.trace)
            if name == "no-keyword" {
                let target = Int(all.first { $0[1] == (try? evidence("ch3-p1").quote) }![0])!
                XCTAssertFalse(trace.keyword.contains(target)); XCTAssertTrue(trace.semantic.contains(target))
            }
            report.append(["case":name,"query":query,"missing_required":missing,"bookID":book.id,"trace":try JSONSerialization.jsonObject(with: JSONEncoder().encode(trace)),"evidence":try JSONSerialization.jsonObject(with: JSONEncoder().encode(plan.evidence)),"prompt":plan.prompt,"seconds":Date().timeIntervalSince(start)])
        }
        var selected = ReadingQuestion(book: book, selection: try evidence("ch2-p3"), neighbors: [try evidence("ch2-p2"), try evidence("ch2-p4")])
        selected.question = "为什么说立即停机不违反审慎原则？"
        let plan = try await QuestionPlan.make(selected, index: index, local: false, state: library.preparation.states[book.id]!)
        for id in ["ch2-p1", "ch2-p2", "ch2-p3", "ch2-p4"] { XCTAssertTrue(plan.evidence.contains { $0.quote == (try? evidence(id).quote) }) }
        let limited = BookEvidenceScope(bookID: book.id, throughChapter: 0, throughOrdinal: Int.max)
        do { _ = try await QuestionPlan.make(selected, index: index, local: false, state: library.preparation.states[book.id]!, scope: limited); XCTFail("Out-of-scope mandatory selection must refuse the request") }
        catch { XCTAssertEqual(error as? QuestionError, .scope) }
        var permitted = ReadingQuestion(book: book, selection: try evidence("ch1-p5"), neighbors: [try evidence("ch1-p4")]); permitted.question = selected.question
        let limitedPlan = try await QuestionPlan.make(permitted, index: index, local: false, state: library.preparation.states[book.id]!, scope: limited)
        for value in limitedPlan.evidence { XCTAssertTrue(try value.location().href.string.contains("ch1.xhtml")) }
        permitted = ReadingQuestion(book: book, selection: try evidence("ch1-p5"), neighbors: [try evidence("ch2-p1")]); permitted.question = selected.question
        do { _ = try await QuestionPlan.make(permitted, index: index, local: false, state: library.preparation.states[book.id]!, scope: limited); XCTFail("Out-of-scope forced neighbor must refuse final prompt") }
        catch { XCTAssertEqual(error as? QuestionError, .scope) }
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
        try attachment(["cases":report,"forced_prompt":plan.prompt,"limited_prompt":limitedPlan.prompt,"out_of_scope_selection":"refused","out_of_scope_neighbor":"refused","out_of_scope_context":"rebuilt-from-verified-quote","sanitized_prompt":sanitized.prompt,"local_without_index_prompt":localPlan.prompt,"otherBookID":other.id,"otherBookVectorRows":otherRows,"absence_prompt":absentPlan.prompt,"absence_trace":try JSONSerialization.jsonObject(with: JSONEncoder().encode(absentPlan.trace!)),"absence_evidence":try JSONSerialization.jsonObject(with: JSONEncoder().encode(absence.evidence))], name:"necessary-evidence")
        print("I10_RELEVANCE cases=5 missing=0 semantic-only-proven=true forced-neighbors=true final-scope-refusals=2 other-book-excluded=true")
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
        let cold = Date()
        _ = try await SemanticEmbedding.shared.tokenIDs("Cold load measurement")
        let coldSeconds = Date().timeIntervalSince(cold)
        let afterColdRSS = peakRSS()
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
        for query in ["Why does Elizabeth reject the first proposal?", "What changes her opinion of Darcy?", "达西为什么帮助莉迪亚？", "What is the connection between wealth and marriage?", "How does prejudice affect the judgment of Elizabeth?"] {
            let queryStart = Date()
            let result = try await library.preparation.index.retrieve(scope: BookEvidenceScope(bookID: book.id), query: query)
            latencies.append(Date().timeIntervalSince(queryStart))
            XCTAssertFalse(result.evidence.isEmpty)
        }
        var usage = rusage(); getrusage(RUSAGE_SELF, &usage)
        let rss = Int64(usage.ru_maxrss)
        let peakGap = gaps.max() ?? 0
        XCTAssertLessThan(indexSeconds, 900)
        XCTAssertLessThan(coldSeconds, 5)
        XCTAssertLessThan(latencies.sorted().last!, 2)
        XCTAssertLessThan(rss, 600 * 1024 * 1024)
        XCTAssertLessThan(peakGap, 0.1, "Main actor heartbeat while indexing")
        let before = try db.rows("SELECT cursor,completed,total FROM embedding_progress WHERE book_id=?", [book.id])
        let resumeStart = Date()
        try await library.preparation.index.prepareVectors(bookID: book.id) { _ in }
        let resumeSeconds = Date().timeIntervalSince(resumeStart)
        XCTAssertEqual(try db.rows("SELECT cursor,completed,total FROM embedding_progress WHERE book_id=?", [book.id]), before)
        try attachment(["bookID":book.id,"source":"https://www.gutenberg.org/ebooks/1342.epub.noimages","sha256":"e59e587472723023b21bf380b8327858e7540b25e57affa3a68935b291e370dc","license":"Project Gutenberg public domain text, Jane Austen died 1817; embedded license retained","word_count":words,"characters":stats[1],"reading_order_resources":chapters,"fragments":stats[0],"vector_rows":vectors[0],"vector_bytes":vectors[1],"vector_min_max_bytes":Array(vectors.suffix(2)),"cold_session_seconds":coldSeconds,"index_seconds":indexSeconds,"query_seconds":latencies,"peak_rss_bytes":rss,"baseline_rss_bytes":baselineRSS,"after_cold_rss_bytes":afterColdRSS,"after_index_rss_bytes":afterIndexRSS,"main_actor_20ms_heartbeat_max_seconds":peakGap,"no_work_resume_seconds":resumeSeconds,"platform":"iOS 26.5 simulator on Mac; not iPhone memory, speed, thermals or battery"],name:"long-book-performance")
        print("I10_LONG words=\(words) fragments=\(stats[0]) vectors=\(vectors[0]) index=\(indexSeconds)s cold=\(coldSeconds)s query-max=\(latencies.max()!)s peak-rss=\(rss) main-gap=\(peakGap)s resume=\(resumeSeconds)s")
    }
}
