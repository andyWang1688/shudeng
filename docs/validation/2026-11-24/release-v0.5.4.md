# v0.5.4 模拟器正式包验收

版本 `0.5.4 / 17`，正式应用身份 `dev.shudeng.mobile`。2026-11-24 使用 Apple Silicon Mac、Xcode 27.2 和 Small iOS 26.5。关联 [#59](https://github.com/andyWang1688/shudeng/issues/59)。

| 核验 | 结果 |
| --- | --- |
| 最终源码 | `pnpm typecheck` 四个包通过；`pnpm test` 1,159 项通过、9 项跳过、0 项失败；官网构建和 reader-web inline 构建通过。 |
| 原生与 JS | 从发布源码提交重新执行 Release 编译。主程序、ExpoModulesJSI 和 Hermes Framework 均为 arm64 模拟器架构；Info.plist 与 Expo 配置为 `0.5.4 / 17 / dev.shudeng.mobile`，最低系统 16.4。 |
| ZIP 与许可 | 使用最终 bundle 对应的 source map 生成许可，覆盖 127 个 npm 包；包体审计、ZIP 完整性和深度签名检查通过。包内无书籍、数据库、日志和 source map。 |
| 覆盖安装 | 将最终 ZIP 解压后安装到 Small，已安装主程序、JS bundle 和 Expo 配置与 ZIP 一致；书架仍显示原有 7 本书。 |
| 后台恢复 | 打开《红楼梦》后退到主屏，终止该书灯实例的 WebKit 内容进程，再回到前台。出现新的 WebKit 进程，恢复到同一原文位置，没有“阅读器已被系统回收”或重试覆盖层。 |

发布附件哈希与构建源码见 [交付 manifest](../../../delivery/releases/v0.5.4/release-manifest.json)。真机、旧模拟器运行时、TestFlight、App Store、真实服务商质量与计费、真机长时间后台回收未验。
