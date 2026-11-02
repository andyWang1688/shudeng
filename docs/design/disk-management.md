# 构建与磁盘管理

## 入口

- iOS 构建：`scripts/build-ios-rn.sh [Debug|Release]`；`apps/mobile` 的 `build:ios:release` / `build:ios:debug` 调用它。
- 历史清理：`scripts/prune-project-artifacts.sh`；只清可再生产物。

## 硬规则

1. 可用空间 < **30 GiB**：脚本拒绝新增大型构建。
2. 固定构建目录：`.build/rn-ios/derived`，不写 `/tmp`、不散落 DerivedData。
3. `trap EXIT/INT/TERM`：正常、失败、中断都回收本次 `tmp-$$`；失败不晋级 artifact。
4. `.build` 上限 20 GiB；artifact 上限 3 GiB；每个配置只保留最新一份 app。
5. 重复 `Shudeng.app` 备份保留最新一份；源码、书籍、阅读/问答/笔记数据库、密钥不删除。
6. 清理前确认无 xcodebuild/pnpm 等进程占用；无法判断的文件跳过。

## 本次清理与验证（2026-11-02）

- 清理前可用 **48.6 GiB**；清理 638 项历史构建/中间产物/临时副本/重复 app 备份后 **73.9 GiB**。
- 保留 `.scratch` 当前证据与用户数据；`.scratch` 3.8 GiB、`node_modules` 1.6 GiB、iOS Pods 0.9 GiB。
- Android SDK/模拟器/Gradle 缓存/Android 构建产物已移除（Android 暂停，未重装、未构建）。
- 两次实际 iOS Release 构建：`.build` 5.4 GiB → 5.2 GiB，可用空间 68 GiB 不变；app 180 MB。
- 失败路径模拟：exit=1，`tmp-*` 目录为 0；清理逻辑生效。
- 中断/失败共用 trap；`prune-project-artifacts.sh` 可重复运行，受保留规则约束。
