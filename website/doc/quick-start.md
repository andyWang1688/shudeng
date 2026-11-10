# 快速开始

当前版本为 v0.5.0（构建 13），采用新的 React Native 应用架构。

## 安装

需要一台 Apple Silicon Mac 和 Xcode（使用它自带的 iOS 模拟器）。附件仅供 arm64 模拟器使用，不是 iPhone 安装包或 TestFlight 版本。最低构建目标为 iOS 16.4；当前设备操作记录来自 iOS 26.5 模拟器，不能据此保证所有旧系统兼容。

1. 打开 [v0.5.0 下载页](https://github.com/andyWang1688/shudeng/releases/tag/v0.5.0)，下载 `Shudeng-v0.5.0-ios-simulator.zip`。
2. 解压 `.zip`，得到 `Shudeng.app`。
3. 打开 Xcode，菜单 Xcode → Open Developer Tool → Simulator，启动一台 iPhone 模拟器。
4. 把 `Shudeng.app` 拖进模拟器窗口。也可以在终端执行：

   ```sh
   xcrun simctl install booted Shudeng.app
   ```

5. 在模拟器主屏点开「书灯」。

### 从旧版本过来

本版使用 `dev.shudeng.mobile`，与旧 Swift 版 `dev.shudeng.app`、开发包 `dev.shudeng.integration` 的数据空间独立。安装不会覆盖它们，也不会自动搬入其中的书库、标注、对话或密钥。请保留旧 App，需要阅读的书重新导入；本版没有跨包一键迁移入口。卸载任一 App 都会删除它自己的本机数据。

## 导入第一本书

1. 在书架点「导入」。
2. 选一个 EPUB 或 PDF 文件。
3. 导入完成后回到书架，点封面开始阅读。

支持可重排 EPUB 和 PDF；固定版式 EPUB 打不开。需要密码的文件无法导入。PDF 导入时会检查每一页能不能选中文字，页面多时会显示进度，可以取消。

## 配置 AI 服务

书灯不提供 AI 服务，需要你准备一个 API 服务。

1. 打开「我的」→「AI 服务」→「添加 AI 服务」，选择预设或自定义服务。
2. 填写名称、地址、API Key 和模型；自定义服务在创建时选择接口格式，可先「检查连接」。
3. 保存时确认发送范围，再在列表轻点选择要使用的服务。切换从下一次提问生效。

更细的说明见 [AI 服务](ai-service.md)。

「我的」→「离线语义资料」可下载约 81MB 的本机检索资料。资料与书内索引准备好后，可按意思查找原文；未下载时仍可阅读、搜索、标注，并在书内文字索引可用时使用关键词查书。

## 问第一个问题

1. 打开一本书，长按选中一段原文。
2. 在菜单里点「问 AI」。
3. 输入问题并发送；尚未选择 AI 服务时，会提示先配置。
4. 回答中的书内引用可打开原文，回到对应位置核对。

不选文字也可以：阅读工具栏点「问问这本书」，直接问当前书。问答层上拉可展开到全屏，下拉返回较小窗口。想了解怎样查书、发送什么，见[阅读问答是怎么工作的](how-reading-ai-works.md)。

接下来可以看 [阅读](reading.md)、[标注与笔记](annotations.md) 和 [阅读问答](reading-qa.md)。
