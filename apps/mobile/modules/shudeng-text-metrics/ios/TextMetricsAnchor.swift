import UIKit

/// Local actual traits + cancellable scheduling. Contains no visible text or bubble policy.
@MainActor
final class TextMetricsAnchor: UIView {
    typealias Model = TextMetricsEngine
    enum Event {
        case pending(Model.Request, hostID: String, environmentEpoch: Int, workRevision: Int)
        case measured(Model.Request, hostID: String, environmentEpoch: Int, workRevision: Int, Model.Environment, Model.Metrics)
        case failed(Model.Request, hostID: String, environmentEpoch: Int, workRevision: Int, Error)
    }
    struct BatchEntry: Equatable { let id: String; let request: Model.Request }
    struct BatchRequest: Equatable { let bindingID: String; let revision: Int; let entries: [BatchEntry] }
    struct BatchResult { let id: String; let metrics: Model.Metrics }
    enum BatchEvent {
        case pending(BatchRequest, hostID: String, environmentEpoch: Int, workRevision: Int)
        case measured(BatchRequest, hostID: String, environmentEpoch: Int, workRevision: Int, Model.Environment, [BatchResult])
        case failed(BatchRequest, hostID: String, environmentEpoch: Int, workRevision: Int, Error)
    }
    private enum Work: Equatable {
        case single(Model.Request), batch(BatchRequest)
        var bindingID: String { switch self { case .single(let r): r.bindingID; case .batch(let r): r.bindingID } }
        var revision: Int { switch self { case .single(let r): r.revision; case .batch(let r): r.revision } }
    }
    private final class BatchJob {
        let request: BatchRequest; let traits: UITraitCollection; let environment: Model.Environment
        let ticket: Int; let epoch: Int; weak var window: UIWindow?
        var index = 0; var results: [BatchResult] = []
        init(_ request: BatchRequest, traits: UITraitCollection, environment: Model.Environment, ticket: Int, epoch: Int, window: UIWindow) {
            self.request = request; self.traits = traits; self.environment = environment
            self.ticket = ticket; self.epoch = epoch; self.window = window
        }
    }
    static let maximumBatchCount = 64
    static let maximumItemsPerSlice = 16
    static let sliceBudget: TimeInterval = 0.004
    var onEvent: ((Event) -> Void)?
    var onBatchEvent: ((BatchEvent) -> Void)?
    private let hostID = UUID().uuidString
    private var work: Work?
    private var batchJob: BatchJob?
    private var generation = 0
    private var environmentEpoch = 0
    private var environment: Model.Environment?
    private var windowID: ObjectIdentifier?
    private var scheduled = false
    private var observers: [NSObjectProtocol] = []

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false; isAccessibilityElement = false; accessibilityElementsHidden = true
        if #available(iOS 17.0, *) {
            registerForTraitChanges([UITraitPreferredContentSizeCategory.self, UITraitDisplayScale.self,
                UITraitLayoutDirection.self, UITraitLegibilityWeight.self]) { (view: TextMetricsAnchor, _: UITraitCollection) in view.invalidate() }
        }
        for name in [UIContentSizeCategory.didChangeNotification, UIAccessibility.boldTextStatusDidChangeNotification,
                     NSLocale.currentLocaleDidChangeNotification, UIApplication.didBecomeActiveNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor [weak self] in self?.invalidate() }
            })
        }
    }
    required init?(coder: NSCoder) { fatalError("Programmatic metrics anchor only") }
    deinit { for observer in observers { NotificationCenter.default.removeObserver(observer) } }
    func submit(_ next: Model.Request) { submit(.single(next)) }
    func submitBatch(_ next: BatchRequest) { submit(.batch(next)) }
    func cancel() { work = nil; batchJob = nil; generation += 1 }
    func cancelBatch() { if case .batch = work { cancel() } }
    private func submit(_ next: Work) {
        if let current = work, current.bindingID == next.bindingID, next.revision < current.revision { return }
        guard work != next else { return }
        work = next; invalidate()
    }
    override func didMoveToWindow() { super.didMoveToWindow(); invalidate() }
    @available(iOS, introduced: 16.4, deprecated: 17.0)
    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        if #unavailable(iOS 17.0) { invalidate() }
    }
    private func currentEnvironment() -> Model.Environment? {
        guard window != nil, traitCollection.displayScale > 0 else { return nil }
        return Model.Environment(category: traitCollection.preferredContentSizeCategory.rawValue,
            displayScale: traitCollection.displayScale, rightToLeft: effectiveUserInterfaceLayoutDirection == .rightToLeft,
            legibilityWeight: traitCollection.legibilityWeight.rawValue, boldText: UIAccessibility.isBoldTextEnabled, preferredLanguages: Locale.preferredLanguages)
    }
    private func invalidate() {
        generation += 1; batchJob = nil
        let nextWindow = window.map(ObjectIdentifier.init), next = currentEnvironment()
        if nextWindow != windowID || next != environment { windowID = nextWindow; environment = next; environmentEpoch += 1 }
        switch work {
        case .single(let r): onEvent?(.pending(r, hostID: hostID, environmentEpoch: environmentEpoch, workRevision: generation))
        case .batch(let r): onBatchEvent?(.pending(r, hostID: hostID, environmentEpoch: environmentEpoch, workRevision: generation))
        case nil: break
        }
        guard !scheduled else { return }
        scheduled = true; DispatchQueue.main.async { [weak self] in self?.drainLatest() }
    }
    private func drainLatest() {
        scheduled = false
        guard let work, let window else { return }
        if #available(iOS 17.0, *) { window.updateTraitsIfNeeded(); updateTraitsIfNeeded() }
        if scheduled { return }
        let latest = currentEnvironment()
        if latest != environment { invalidate(); return }
        guard let environment = latest else { return }
        let ticket = generation, epoch = environmentEpoch
        switch work {
        case .single(let request):
            do {
                let metrics = try Model.measure(request, traits: traitCollection, rightToLeft: environment.rightToLeft)
                guard ticket == generation, epoch == environmentEpoch, self.work == work, self.window === window else { return }
                onEvent?(.measured(request, hostID: hostID, environmentEpoch: epoch, workRevision: ticket, environment, metrics))
            } catch {
                guard ticket == generation, epoch == environmentEpoch, self.work == work else { return }
                onEvent?(.failed(request, hostID: hostID, environmentEpoch: epoch, workRevision: ticket, error))
            }
        case .batch(let request):
            guard !request.bindingID.isEmpty, request.revision > 0, !request.entries.isEmpty,
                  request.entries.count <= Self.maximumBatchCount, request.entries.allSatisfy({ !$0.id.isEmpty
                    && $0.request.bindingID == request.bindingID && $0.request.revision == request.revision }),
                  Set(request.entries.map(\.id)).count == request.entries.count else {
                onBatchEvent?(.failed(request, hostID: hostID, environmentEpoch: epoch, workRevision: ticket, Model.Failure.invalidInput)); return
            }
            let job = BatchJob(request, traits: traitCollection, environment: environment, ticket: ticket, epoch: epoch, window: window)
            batchJob = job; drainBatch(job)
        }
    }
    private func drainBatch(_ job: BatchJob) {
        guard batchJob === job, job.ticket == generation, job.epoch == environmentEpoch,
              work == .batch(job.request), let window = job.window, self.window === window else { return }
        guard currentEnvironment() == job.environment else { invalidate(); return }
        let start = CFAbsoluteTimeGetCurrent(); var count = 0
        do {
            while job.index < job.request.entries.count && count < Self.maximumItemsPerSlice {
                if count > 0 && CFAbsoluteTimeGetCurrent() - start >= Self.sliceBudget { break }
                let entry = job.request.entries[job.index]
                let metrics = try Model.measure(entry.request, traits: job.traits, rightToLeft: job.environment.rightToLeft)
                job.results.append(.init(id: entry.id, metrics: metrics)); job.index += 1; count += 1
            }
        } catch {
            guard batchJob === job, job.ticket == generation, job.epoch == environmentEpoch else { return }
            batchJob = nil; onBatchEvent?(.failed(job.request, hostID: hostID, environmentEpoch: job.epoch, workRevision: job.ticket, error)); return
        }
        guard batchJob === job, job.ticket == generation, job.epoch == environmentEpoch, self.window === window else { return }
        guard currentEnvironment() == job.environment else { invalidate(); return }
        if job.index == job.request.entries.count {
            batchJob = nil
            onBatchEvent?(.measured(job.request, hostID: hostID, environmentEpoch: job.epoch, workRevision: job.ticket, job.environment, job.results))
        } else {
            // The budget bounds a segment, not an individual UILabel call. Yield
            // between segments so newer props, traits and window detach can cancel.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.001) { [weak self, weak job] in
                if let job { self?.drainBatch(job) }
            }
        }
    }
}
