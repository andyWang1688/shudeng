import ExpoModulesCore
import UIKit

public final class ShudengChatBackgroundModule: Module {
  private let tasks = ChatBackgroundTasks()

  public func definition() -> ModuleDefinition {
    Name("ShudengChatBackground")
    Events("onExpiration")

    AsyncFunction("begin") { [weak self, tasks] (id: Int) in
      MainActor.assumeIsolated {
        tasks.begin(id) { [weak self] in
          self?.sendEvent("onExpiration", ["id": id])
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("end") { [tasks] (id: Int) in
      MainActor.assumeIsolated { tasks.end(id) }
    }.runOnQueue(.main)

    OnDestroy { [tasks] in
      DispatchQueue.main.async { tasks.endAll() }
    }
  }
}

@MainActor
private final class ChatBackgroundTasks {
  private var active: [Int: UIBackgroundTaskIdentifier] = [:]

  // The table is accessed from the main queue, including UIKit's expiration callback.
  nonisolated init() {}

  func begin(_ id: Int, onExpiration: @escaping () -> Void) {
    guard active[id] == nil else { return }
    let task = UIApplication.shared.beginBackgroundTask(withName: "Reading question") { [weak self] in
      guard let self, self.active[id] != nil else { return }
      defer { self.end(id) }
      onExpiration()
    }
    if task != .invalid { active[id] = task }
  }

  func end(_ id: Int) {
    if let task = active.removeValue(forKey: id) {
      UIApplication.shared.endBackgroundTask(task)
    }
  }

  func endAll() {
    for id in Array(active.keys) { end(id) }
  }
}
