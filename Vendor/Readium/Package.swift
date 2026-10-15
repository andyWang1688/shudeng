// swift-tools-version:5.10
// Readium 3.11.0; Shudeng limits the upstream manifest to the three used products.
// Copyright 2026 Readium Foundation. BSD-3-Clause; see LICENSE.
import PackageDescription
let package = Package(
    name: "Readium", defaultLocalization: "en", platforms: [.iOS("15.0")],
    products: ["ReadiumShared", "ReadiumStreamer", "ReadiumNavigator"].map { .library(name: $0, targets: [$0]) },
    dependencies: [
        .package(url: "https://github.com/krzyzanowskim/CryptoSwift.git", exact: "1.10.0"),
        .package(url: "https://github.com/marmelroy/Zip.git", exact: "2.1.2"),
        .package(url: "https://github.com/ra1028/DifferenceKit.git", exact: "1.3.0"),
        .package(url: "https://github.com/readium/Fuzi.git", exact: "4.0.1"),
        .package(url: "https://github.com/readium/ZIPFoundation.git", exact: "3.0.1"),
        .package(url: "https://github.com/scinfu/SwiftSoup.git", exact: "2.14.2")
    ],
    targets: [
        .target(name: "ReadiumInternal", path: "Sources/Internal"),
        .target(name: "ReadiumShared", dependencies: ["ReadiumInternal", "SwiftSoup", "Zip", .product(name: "ReadiumFuzi", package: "Fuzi"), .product(name: "ReadiumZIPFoundation", package: "ZIPFoundation")], path: "Sources/Shared", resources: [.process("Resources")], linkerSettings: [.linkedFramework("CoreServices"), .linkedFramework("UIKit")]),
        .target(name: "ReadiumStreamer", dependencies: ["CryptoSwift", "ReadiumShared", .product(name: "ReadiumFuzi", package: "Fuzi")], path: "Sources/Streamer", resources: [.copy("Assets")]),
        .target(name: "ReadiumNavigator", dependencies: ["ReadiumInternal", "ReadiumShared", "DifferenceKit", "SwiftSoup"], path: "Sources/Navigator", exclude: ["EPUB/Scripts"], resources: [.copy("EPUB/Assets"), .process("Resources")])
    ]
)
