# v0.5.3 模拟器正式包验收

版本 `0.5.3 / 16`，正式应用身份 `dev.shudeng.mobile`。2026-11-23 使用 Apple Silicon Mac、Xcode 27.2 和 Small iOS 26.5。关联 [#55](https://github.com/andyWang1688/shudeng/issues/55)、[#61](https://github.com/andyWang1688/shudeng/issues/61)、[#62](https://github.com/andyWang1688/shudeng/issues/62)。

| 核验 | 结果 |
| --- | --- |
| 最终源码 | `pnpm typecheck` 四个包通过；`pnpm test` 1,157 项通过、9 项跳过、0 项失败；官网以 `/shudeng/` 为根路径构建通过。 |
| 原生和 JS | 复用项目 DerivedData 重新执行 Release 编译。主程序与 ExpoModulesJSI、Hermes Framework 均为 arm64 模拟器架构。Info.plist 和 Expo 配置一致。 |
| ZIP 和许可 | 用最终 bundle 对应的 source map 生成许可，覆盖 127 个 npm 包；包体审计、ZIP 完整性和深度签名检查通过。包内无书籍、数据库、日志和 source map。 |
| 覆盖安装 | 将最终 ZIP 解压后安装到 Small，确认已安装包的主程序、JS bundle 与 Expo 配置和 ZIP 一致。到达书架，仍显示原有 7 本书。 |
| 阅读入口 | 打开《红楼梦》，打开「阅读设置」，三行各显示独立加减按钮，点字号加号后点减号恢复。完整排版和持久化回归见[本地验收](epub-spacing.md)。 |

发布附件哈希与构建源码见 [交付 manifest](../../../delivery/releases/v0.5.3/release-manifest.json)。真机、旧模拟器运行时、TestFlight、App Store、真实服务商质量与计费、真机后台时长未验。
