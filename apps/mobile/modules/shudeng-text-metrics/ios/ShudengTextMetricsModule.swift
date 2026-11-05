import ExpoModulesCore
import UIKit

public final class ShudengTextMetricsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ShudengTextMetrics")
    View(TextMetricsView.self) {
      Events("onMetrics", "onBatchMetrics")
      // One atomic prop; individual text/style/width setters must not race.
      Prop("request", "") { (view, value: String) in view.submit(value) }
      Prop("batchRequest", "") { (view, value: String) in view.submitBatch(value) }
    }
  }
}
private struct MetricsBatchInput: Decodable {
  struct Entry: Decodable {
    let id: String; let text: String; let maxContentWidth: Double; let typography: MetricsInput.Typography
  }
  let bindingID: String; let revision: Int; let entries: [Entry]
  @MainActor func request() throws -> TextMetricsAnchor.BatchRequest {
    guard !entries.isEmpty, entries.count <= TextMetricsAnchor.maximumBatchCount,
      Set(entries.map(\.id)).count == entries.count else { throw TextMetricsEngine.Failure.invalidInput }
    let values = try entries.map { entry in
      TextMetricsAnchor.BatchEntry(id: entry.id, request: try MetricsInput(bindingID: bindingID, revision: revision,
        text: entry.text, maxContentWidth: entry.maxContentWidth, typography: entry.typography).request())
    }
    return .init(bindingID: bindingID, revision: revision, entries: values)
  }
}

private struct MetricsInput: Decodable {
  struct Typography: Decodable {
    struct Face: Decodable { let kind: String; let weight: String?; let postScriptName: String? }
    let face: Face; let basePointSize: Double; let metricsStyle: String; let lineSpacing: Double
  }
  let bindingID: String; let revision: Int; let text: String
  let maxContentWidth: Double; let typography: Typography
  func request() throws -> TextMetricsEngine.Request {
    guard !bindingID.isEmpty, revision > 0 else { throw TextMetricsEngine.Failure.invalidInput }
    let face: TextMetricsEngine.Face
    if typography.face.kind == "system" {
      let weights: [String: UIFont.Weight] = ["regular": .regular, "medium": .medium, "semibold": .semibold, "bold": .bold]
      guard let weight = weights[typography.face.weight ?? ""] else { throw TextMetricsEngine.Failure.invalidInput }
      face = .system(weight)
    } else if typography.face.kind == "named", let name = typography.face.postScriptName, !name.isEmpty { face = .named(name) }
    else { throw TextMetricsEngine.Failure.invalidInput }
    let ramps: [String: UIFont.TextStyle] = ["body": .body, "caption1": .caption1, "footnote": .footnote]
    guard let ramp = ramps[typography.metricsStyle] else { throw TextMetricsEngine.Failure.invalidInput }
    return .init(bindingID: bindingID, revision: revision, text: text, maxContentWidth: maxContentWidth,
      typography: .init(face: face, basePointSize: typography.basePointSize, metricsStyle: ramp, lineSpacing: typography.lineSpacing))
  }
}

public final class TextMetricsView: ExpoView {
  let onMetrics = EventDispatcher()
  let onBatchMetrics = EventDispatcher()
  private let anchor = TextMetricsAnchor(frame: .zero)
  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false; isAccessibilityElement = false; accessibilityElementsHidden = true
    addSubview(anchor)
    anchor.onEvent = { [weak self] event in self?.emit(event) }
    anchor.onBatchEvent = { [weak self] event in self?.emitBatch(event) }
  }
  func submitBatch(_ json: String) {
    guard !json.isEmpty else { anchor.cancelBatch(); return }
    do {
      anchor.submitBatch(try JSONDecoder().decode(MetricsBatchInput.self, from: Data(json.utf8)).request())
    } catch {
      let envelope = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any]
      anchor.submitBatch(.init(bindingID: envelope?["bindingID"] as? String ?? "",
        revision: envelope?["revision"] as? Int ?? 0, entries: []))
    }
  }
  private func emitBatch(_ event: TextMetricsAnchor.BatchEvent) {
    let request: TextMetricsAnchor.BatchRequest; let host: String; let epoch: Int; let work: Int
    var payload: [String: Any]
    switch event {
    case let .pending(value, hostID, environmentEpoch, workRevision):
      request = value; host = hostID; epoch = environmentEpoch; work = workRevision; payload = ["type": "pending"]
    case let .measured(value, hostID, environmentEpoch, workRevision, environment, results):
      request = value; host = hostID; epoch = environmentEpoch; work = workRevision
      payload = ["type": "measured", "entries": results.map { ["id": $0.id, "metrics": metricsPayload($0.metrics)] },
        "environment": environmentPayload(environment)]
    case let .failed(value, hostID, environmentEpoch, workRevision, error):
      request = value; host = hostID; epoch = environmentEpoch; work = workRevision
      payload = ["type": "failed", "code": failureCode(error)]
    }
    payload.merge(["bindingID": request.bindingID, "revision": request.revision, "hostID": host,
      "environmentEpoch": epoch, "workRevision": work]) { _, new in new }
    onBatchMetrics(payload)
  }
  private func metricsPayload(_ metrics: TextMetricsEngine.Metrics) -> [String: Any] {
    ["width": metrics.fit.width, "height": metrics.fit.height,
      "resolvedPointSize": metrics.resolvedPointSize, "resolvedFontName": metrics.resolvedFontName]
  }
  private func environmentPayload(_ environment: TextMetricsEngine.Environment) -> [String: Any] {
    ["category": environment.category, "displayScale": environment.displayScale,
      "rightToLeft": environment.rightToLeft, "legibilityWeight": environment.legibilityWeight,
      "boldText": environment.boldText, "preferredLanguages": environment.preferredLanguages]
  }
  private func failureCode(_ error: Error) -> String {
    switch error as? TextMetricsEngine.Failure {
    case .unavailableFont: "unavailable-font"
    case .invalidResolvedFont: "invalid-resolved-font"
    default: "invalid-input"
    }
  }
  func submit(_ json: String) {
    guard !json.isEmpty else { return }
    do {
      let input = try JSONDecoder().decode(MetricsInput.self, from: Data(json.utf8))
      anchor.submit(try input.request())
    } catch {
      let envelope = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any]
      // A rejected input still supersedes previous work and gets a versioned failure.
      anchor.submit(.init(bindingID: envelope?["bindingID"] as? String ?? "", revision: envelope?["revision"] as? Int ?? 0,
        text: "", maxContentWidth: -1, typography: .init(face: .system(.regular), basePointSize: 15, metricsStyle: .body, lineSpacing: 0)))
    }
  }
  private func emit(_ event: TextMetricsAnchor.Event) {
    let request: TextMetricsEngine.Request; let host: String; let epoch: Int; let work: Int
    var payload: [String: Any]
    switch event {
    case let .pending(value, hostID, environmentEpoch, workRevision):
      request = value; host = hostID; epoch = environmentEpoch; work = workRevision; payload = ["type": "pending"]
    case let .measured(value, hostID, environmentEpoch, workRevision, environment, metrics):
      request = value; host = hostID; epoch = environmentEpoch; work = workRevision
      payload = ["type": "measured", "metrics": metricsPayload(metrics), "environment": environmentPayload(environment)]
    case let .failed(value, hostID, environmentEpoch, workRevision, error):
      request = value; host = hostID; epoch = environmentEpoch; work = workRevision
      payload = ["type": "failed", "code": failureCode(error)]
    }
    payload.merge(["bindingID": request.bindingID, "revision": request.revision, "hostID": host,
      "environmentEpoch": epoch, "workRevision": work]) { _, new in new }
    onMetrics(payload)
  }
}
