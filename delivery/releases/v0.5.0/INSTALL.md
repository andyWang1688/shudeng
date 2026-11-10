# 书灯 v0.5.0 安装说明

应用版本 `0.5.0`，构建号 `13`，包名 `dev.shudeng.mobile`。附件是新的 React Native 产品包，包含真实书架、阅读、书内标注、对话和服务设置，不是独立视觉 Demo。

## 安装

需要 Apple Silicon Mac、Xcode 和 iOS Simulator。ZIP 仅含 arm64 模拟器应用；最低构建目标 iOS 16.4，当前已有设备操作记录来自 iOS 26.5。附件不能直接安装到 iPhone，也不是 TestFlight 或 App Store 版本。

从 [v0.5.0 发布页](https://github.com/andyWang1688/shudeng/releases/tag/v0.5.0) 下载 ZIP、校验文件、manifest 和本说明。启动目标模拟器后，在下载目录运行：

```sh
shasum -a 256 -c SHA256SUMS.txt
ditto -x -k Shudeng-v0.5.0-ios-simulator.zip .
xcrun simctl install booted ./Shudeng.app
xcrun simctl launch booted dev.shudeng.mobile
```

有多个已启动模拟器时，将 `booted` 替换为目标 UDID。核验不一致时不要安装，重新下载对应发布附件。

## 旧版本与本机数据

本版 `dev.shudeng.mobile` 与旧 Swift 版 `dev.shudeng.app`、开发包 `dev.shudeng.integration` 的沙盒独立。安装不会覆盖它们，也不会自动迁移其中的书籍、标注、对话或 API Key；请保留旧 App，需要的书重新导入新版。

已有同包名 `dev.shudeng.mobile` 的安装会共享该包自己的数据空间；卸载会删除本机数据。本版没有云同步、跨包一键迁移或完整备份恢复。每本书可导出标注，但它不包含完整书库与对话。

## 首次使用

1. 书架导入可重排 EPUB 或 PDF，点封面阅读；字号、阅读方式和主题在书内「阅读设置」。
2. 阅读器「目录 → 标注」或书架菜单「查看标注」管理当前书的高亮和笔记。
3. 「我的 → AI 服务」添加并选择服务；接口格式创建后固定，模型、地址、密钥和上下文窗口可编辑。
4. 「我的 → 离线语义资料」按需下载约 81MB 的资料，再等待书内索引准备；未下载仍可阅读、标注及在文字索引可用时按关键词查书。
5. 阅读工具栏「问问这本书」，或选中文字后「问 AI」。问答上拉全屏；关闭窗口不等于停止生成。

## 限制与验收

扫描 PDF 页不支持 OCR、文字检索或文字标注；固定版式 EPUB 暂不支持。大书连续滚动仍有内存增长和偶发长帧风险，尚未完成全场景性能验收。AI 服务能力与费用以服务商为准，手填更大上下文不会扩大实际限制。

本次最终构建、校验和正式包运行结果见 `release-manifest.json`；前期开发包测试不能替代正式包验证。真实服务商质量、计费、完整辅助功能、旧系统与真机分发仍有未验证项。

API Key、个人书库与对话不随包分发，离线语义资料由用户主动下载。第三方许可可在「我的 → 关于书灯」查看。
