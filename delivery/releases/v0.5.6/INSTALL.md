# 安装书灯 v0.5.6（构建 19）

适用于 Apple Silicon Mac 和 Xcode 的 arm64 iOS 模拟器。安装到已启动的模拟器即可；已有书灯请直接覆盖，卸载会删除本机数据。此 ZIP 不适用于 iPhone、TestFlight 或 App Store。

1. 从[发布页](https://github.com/andyWang1688/shudeng/releases/tag/v0.5.6)下载 ZIP、SHA256SUMS.txt、release-manifest.json 和本说明，放在同一目录。
2. 在下载目录执行 `shasum -a 256 -c SHA256SUMS.txt`，确认所有文件通过。
3. 执行 `ditto -x -k Shudeng-v0.5.6-ios-simulator.zip .`。
4. 执行 `xcrun simctl install booted ./Shudeng.app`。
5. 执行 `xcrun simctl launch booted dev.shudeng.mobile`。

若有多个运行中的模拟器，把 booted 换成目标设备的 UDID。与旧 Swift 版、开发包的数据沙盒各自独立。本版未改变文件或数据库的所有权，不自动迁移其他 App 的数据。
