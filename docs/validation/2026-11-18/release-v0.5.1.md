# v0.5.1 发布验收

版本 `0.5.1 / 14`，应用身份 `dev.shudeng.mobile`。JS 与应用配置来源为 `0a795b9f3455c69c3dab2c3ebc40b25a6ab1a36b`；后续发布提交仅增加文档和校验资料。关联 [#57](https://github.com/andyWang1688/shudeng/issues/57)。

## 安装包

可用空间约 29 GiB，未执行大型原生构建。确认相对 v0.5.0 的改动仅为历史回看修复、测试、构建脚本、版本配置和文档，原生业务源码及依赖未变；复用正式 v0.5.0 arm64 模拟器 ZIP，基线 SHA256 为 `9696ee511b2c9bf3f171a5dd5f87c4c24303cb2d220c9883eb0e1f4a16ffe81a`。

1. 使用 Expo `export:embed` 重新生成生产 Hermes bytecode v99 与资源。
2. 更新 Info.plist、EXConstants app.config 为 `0.5.1 / 14`；重新生成许可并 ad hoc 签名。
3. 许可核对覆盖 127 个 npm 包、Pods 与阅读器 vendor，manifest 与实际 bundle 哈希一致；`audit-app.sh`、严格深度签名核验和 ZIP 完整性检查通过。
4. 核对 6,697 个 Metro source，无项目 Demo、测试或样书入口；包内未发现 EPUB、PDF、ONNX 模型、数据库、日志或真机授权描述文件。

原生编译工具链沿用 v0.5.0 的 Xcode 27.0、Simulator SDK 27.0；本次打包与设备操作为 Xcode 27.2（27B52）、Node 24.22.3。分发二进制为 arm64、IOSSIMULATOR，最低构建目标 16.4。

最终 ZIP 为 29,173,507 字节，SHA256 为 `dbe8ea6bd141d09bfc31ebc361613f52fa370a90a4b881367d2c896e9782b7c1`。应用约 100 MiB。附件校验及源码树身份见 [manifest](../../../delivery/releases/v0.5.1/release-manifest.json)。

## 源码与网站检查

`pnpm typecheck` 通过，覆盖 core、reader-web、mobile、eval。`pnpm test` 为 **1,116 通过、9 跳过、0 失败**：core 330、reader-web 66、mobile Node 522、mobile Vitest 198；跳过的是未启用的 provider redirect 集成检查。官网 `pnpm --dir website docs:build` 通过。

新增回归覆盖配置读取失败时仍返回书籍与索引资料、历史正常加载、发送提示错误并保留输入。真正发送入口继续严格校验配置与同意范围。上述自动化不等于真实服务商请求验收。

## Small 正式包冒烟

在既有 Small（iOS 26.5、Apple Silicon）上覆盖安装最终分发副本并启动，返回 PID 37169。读取安装后 Info.plist 确认为 `0.5.1 / 14`；截图观察书架显示原有 7 本书、封面和顶层导航。未卸载应用、导出书库或变更配置。

本轮仅验收安装、启动、版本与原有书架显示，没有把截图当作点击、手势或阅读全测。个人真机的历史回看及 PDF 标注显示，另见[迁移记录](../2026-11-17/ios-usb-migration.md)。

## 未验证与清理

未完成最终分发包的完整业务回归、真实触控及引用回跳、真实服务商质量与计费、完整辅助功能、大书长时间性能、iOS 16.4 实际运行及其他平台验收。公开附件仅为模拟器版，个人开发签名真机包不公开分发。

打包临时应用、map、截图与日志位于本轮专属目录，发布确认后删除；仅保留发布 ZIP、安装说明、manifest 和校验文件，不再生成书库或数据库恢复副本。
