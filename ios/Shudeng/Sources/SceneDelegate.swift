import UIKit

/// iOS 27 起应用必须具备 UIScene 生命周期（否则真机首帧 EXC_BREAKPOINT）。
/// AppDelegate 只负责启动与 scene 配置；窗口、根控制器、DEBUG 夹具/测试路径都在这里创建。
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        self.window = window
#if DEBUG
        if let fixture = DesignFixture.request(in: CommandLine.arguments) {
            do {
                let session = try DesignFixture.makeSession(fixture)
                window.overrideUserInterfaceStyle = fixture.theme
                window.rootViewController = makeApplicationTabs(
                    library: session.library,
                    root: session.root,
                    secrets: session.secrets
                )
                window.makeKeyAndVisible()
                Task { @MainActor in
                    do { try await DesignFixture.seed(session) }
                    catch { print("DESIGN_FIXTURE_ERROR \(error.localizedDescription)") }
                }
            } catch {
                let controller = UIViewController()
                controller.view.backgroundColor = BookDesign.paper
                window.rootViewController = controller
                window.makeKeyAndVisible()
                print("DESIGN_FIXTURE_ERROR \(error.localizedDescription)")
            }
            return
        }
#endif
        window.overrideUserInterfaceStyle = UIUserInterfaceStyle(rawValue: UserDefaults.standard.integer(forKey: "interface-style")) ?? .unspecified
        do {
            var root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Shudeng")
#if DEBUG
            if ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil ||
                ProcessInfo.processInfo.arguments.contains("--isolated-reading-test") {
                root = FileManager.default.temporaryDirectory.appendingPathComponent("ShudengReadingTests")
            }
#endif
            let secrets = KeychainSecrets()
            let library = try LibraryStore(root: root, secrets: secrets)
            window.rootViewController = makeApplicationTabs(library: library, root: root, secrets: secrets)
            // 轻量化：首屏渲染后再启动索引准备，避免启动时与首屏/封面渲染抢 CPU（准备过程不阻塞阅读）。
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                library.prepareBooks()
            }
        } catch {
            let controller = UIViewController()
            controller.view.backgroundColor = BookDesign.paper
            window.rootViewController = controller
            DispatchQueue.main.async {
                let alert = BookAlertController(title: "书架无法读取", message: "已有数据未被覆盖。请检查储存空间后重新打开应用。", preferredStyle: .alert)
                alert.addAction(BookAlertAction(title: "知道了", style: .default))
                controller.present(alert, animated: true)
            }
        }
        window.makeKeyAndVisible()
    }
}
