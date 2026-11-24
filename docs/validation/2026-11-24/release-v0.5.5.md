# v0.5.5 模拟器正式包验收

2026-11-24，版本 `0.5.5 / 18`，应用身份 `dev.shudeng.mobile`。构建使用 Apple Silicon Mac 和 Xcode 27.2，覆盖安装使用 Shudeng Small iOS 26.5。

| 检查 | 结果 |
| --- | --- |
| 源码与文档 | 四个包类型检查通过。全量测试 1,161 项通过、9 项跳过、0 项失败。内联 EPUB 资源及文档站构建通过。 |
| 发布包 | 重新执行 iOS Release 构建。主程序及两个内嵌框架为 arm64 模拟器架构，Info.plist 和 Expo 配置均为 0.5.5 / 18。ZIP 完整性、解压后的深度签名和许可审计通过，包含 127 个 npm 包及 Readium CSS 许可。包内无书籍、数据库、日志和 source map。 |
| 覆盖安装 | 从最终 ZIP 解压后覆盖安装。安装后的主程序、JS bundle 和 Expo 配置与交付包一致。原有 8 本书仍在，验收用 EPUB 校验值一致，重新打开后显示此前阅读章节的正文。 |

真机 v0.5.5、旧版模拟器运行时、TestFlight、App Store 和真实 DeepSeek Flash 联网结果未验证。组件与联网协议的独立检查见[阅读与书架组件复用](reader-component-reuse.md)和[联网能力提示](web-search-capability-guidance.md)。发布包校验值见[交付 manifest](../../../delivery/releases/v0.5.5/release-manifest.json)。
