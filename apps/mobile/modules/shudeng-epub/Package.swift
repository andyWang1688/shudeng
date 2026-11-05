// swift-tools-version:5.9
import Foundation
import PackageDescription

// Production CocoaPods uses the same pinned Git commit through withEpubResources.
// The optional local checkout is only for offline tests and its HEAD is checked by the runner.
let zip: Package.Dependency = ProcessInfo.processInfo.environment["SHUDENG_ZIP_SOURCE"].map { .package(path: $0) }
    ?? .package(url: "https://github.com/readium/ZIPFoundation.git", revision: "adb49c8bfe060cc187370b12fa081012a6440b86")
let package = Package(
    name: "EpubFilePortHarness", platforms: [.macOS(.v12), .iOS(.v16)],
    products: [.library(name: "EpubFilePort", targets: ["EpubFilePort"]), .executable(name: "EpubWKProbe", targets: ["EpubWKProbe"])],
    dependencies: [zip],
    targets: [
        .target(name: "EpubFilePort", dependencies: [.product(name: "ReadiumZIPFoundation", package: "ZIPFoundation")], path: "ios",
                exclude: ["ShudengEpub.podspec", "ShudengEpubModule.swift", "ShudengEpubChrome.swift", "ShudengEpubSettings.swift", "ShudengEpubNavigation.swift", "ReadiumZIPFoundation-LICENSE.txt"],
                sources: ["EpubArchive.swift", "EpubBoundedFileSource.swift", "EpubResourceStore.swift", "EpubResourceScheme.swift"]),
        .executableTarget(name: "EpubWKProbe", dependencies: ["EpubFilePort"], path: "tests/WKProbe", exclude: ["probe.ts", "build-probe.mjs"]),
        .testTarget(name: "EpubFilePortTests", dependencies: ["EpubFilePort", .product(name: "ReadiumZIPFoundation", package: "ZIPFoundation")], path: "tests/Archive"),
    ]
)
