import Foundation

/// One viewer open owns one token. Only the token's state crosses queues;
/// PDFKit work runs outside the lock and cannot be preempted after admission.
final class PdfViewerOpenCancellation: @unchecked Sendable {
  private let lock = NSLock()
  private var cancelled = false
  private var started = false

  func cancel() {
    lock.lock()
    cancelled = true
    lock.unlock()
  }

  var isCancelled: Bool {
    lock.lock()
    defer { lock.unlock() }
    return cancelled
  }

  /// Cancellation and work admission have a single order. A queued operation
  /// cancelled before admission never enters work; active synchronous work may
  /// finish, but its result is discarded. The main thread never waits for work.
  func runIfActive<Result>(_ work: () throws -> Result) rethrows -> Result? {
    lock.lock()
    let admitted = !cancelled && !started
    if admitted { started = true }
    lock.unlock()
    guard admitted else { return nil }
    let result = try work()
    return isCancelled ? nil : result
  }
}
