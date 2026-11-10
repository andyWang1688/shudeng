# v0.5.0 RN 模拟器发布验收

版本 `0.5.0 / 13`，正式应用身份 `dev.shudeng.mobile`。验证环境为 Apple Silicon、Xcode 27.0（27A266a）、iOS Simulator SDK 27.0、Small iOS 26.5；不沿用旧 Swift 包的真机或旧系统结果。

## 构建与包检查

- 通过 `scripts/build-ios-rn.sh Release`，复用 `.build/rn-ios/derived`；最终应用的 Info.plist 与 Expo app.config 均为 `0.5.0 / 13 / dev.shudeng.mobile`，MinimumOSVersion 为 `16.4`，新架构开启。
- 构建产物含两个模拟器架构；分发副本将应用与两个 Framework 都裁为 arm64，再逐个重新 ad hoc 签名。最终 `codesign --verify --deep --strict` 与 `scripts/audit-app.sh` 通过。
- 完整许可来自最终 Metro map、实际 Pods 和内嵌阅读器，覆盖 127 个 npm 包；包含原生 ONNX Runtime 1.30.0 与 ZIP vendor 声明。许可 manifest 与实际 JS bundle 哈希匹配。
- 最终 Metro map 有 6,697 个来源，不含产品 Demo、书籍 fixture、spike 或项目测试入口；包内无 EPUB/PDF 样书、ONNX 模型、SQLite 数据库或日志。第三方 LangChain 自带的协议测试常量属于其运行时依赖，不是用户书籍。

本轮发现 ReaderWebView 静态导入样书并在缺原文时打开默认样书。已移除 native/web 两处回退；缺少或空正文显式报错，真实文件与显式正文仍可打开。修复定向 15/15 通过，移动端类型检查通过，最终产物已重新构建。

## 最终源码检查

最终修复后重新执行 `pnpm typecheck` 与 `pnpm test`，退出码均为 0：类型检查覆盖 core、reader-web、mobile 和 eval；测试共 **1,113 通过、9 跳过、0 失败**，包括 core 330、reader-web 66、mobile Node 522 与 mobile Vitest 195。9 项跳过为未启用的 provider redirect 集成测试，不作通过记录。官网 `pnpm --dir website docs:build` 通过。

## 正式包设备冒烟

| 输入与操作 | 观察结果 | 证据边界 |
| --- | --- | --- |
| 将分发副本安装到 Small 并启动正式包 | 安装成功，启动 PID 61835；系统实际启动身份为 dev.shudeng.mobile | 首次 launch 工具仍引用旧默认开发 ID，随后切换默认值并重新启动，以下均为正式包 |
| 打开书架 | 显示同包已有的 7 本书及封面；书架可操作 | 未向包内复制这些书籍或数据库 |
| 打开已有《红楼梦》 | 显示第三回正文、既有高亮和笔记波浪线，工具栏可用 | 不代替全书或长时间性能测试 |
| 打开并关闭阅读设置 | 显示分页、滚动、仿真及字号；关闭后回到同一正文 | 本轮未更改用户偏好 |
| 返回书架 | 正常返回，仍显示 7 本书 | 未新增或删除用户书籍、配置或密钥 |

设备操作后将正式包停留在书架。旧 Swift `dev.shudeng.app` 与开发包 `dev.shudeng.integration` 的原数据仍保留；本轮没有跨包自动迁移。

## 未验证

真机与商店分发、iOS 16.4 实际运行、其他平台、完整辅助技术和大字体组合、真实服务商回答质量与计费、全书长时间滚动性能未在本次发布验收中完成。开发包既有功能记录仍按各轮原范围解释，不能视作正式包逐项全测。

发布附件及校验值见 [v0.5.0 Release](https://github.com/andyWang1688/shudeng/releases/tag/v0.5.0)；包体与源码身份以随包 manifest 为准。
