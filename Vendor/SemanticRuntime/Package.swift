// swift-tools-version: 5.9
import PackageDescription
let package = Package(
    name: "SemanticRuntime", platforms: [.iOS(.v16)],
    products: [.library(name: "SemanticRuntime", targets: ["SemanticRuntime"])],
    dependencies: [
        .package(url: "https://github.com/microsoft/onnxruntime-swift-package-manager", exact: "1.24.2"),
        .package(url: "https://github.com/huggingface/swift-transformers", exact: "1.1.6")
    ],
    targets: [.target(name: "SemanticRuntime", dependencies: [
        .product(name: "onnxruntime", package: "onnxruntime-swift-package-manager"),
        .product(name: "Tokenizers", package: "swift-transformers")
    ])]
)
