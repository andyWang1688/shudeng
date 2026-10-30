# 快速开始

从安装到提出第一个问题，大约两分钟。

## 安装

需要一台 Apple Silicon Mac 和 Xcode（使用它自带的 iOS 模拟器）。

1. 打开 [GitHub Releases](https://github.com/andyWang1688/shudeng/releases)，下载最新的模拟器安装包。
2. 解压 `.zip`，得到 `Shudeng.app`。
3. 打开 Xcode，菜单 Xcode → Open Developer Tool → Simulator，启动一台 iPhone 模拟器。
4. 把 `Shudeng.app` 拖进模拟器窗口。也可以在终端执行：

   ```sh
   xcrun simctl install booted Shudeng.app
   ```

5. 在模拟器主屏点开「书灯」。

## 导入第一本书

1. 书架为空时点「导入」。
2. 选一个 EPUB 或 PDF 文件。
3. 导入完成后回到书架，点封面开始阅读。

支持可重排 EPUB 和 PDF；固定版式 EPUB 打不开。需要密码的文件无法导入。PDF 导入时会检查每一页能不能选中文字，页面多时会显示进度，可以取消。

## 配置 AI 服务

书灯不提供 AI 服务，需要你准备一个 API 服务。

1. 打开「我的」→「AI 服务」，添加一套服务：选择「DeepSeek」预置，或选「自定义服务」。
2. 填写接口格式、名称、API 根地址或完整端点、API Key 和模型。
3. 保存后点「检查连接」，再点「使用此服务」。

更细的说明见 [AI 服务](ai-service.md)。

第一次用 AI 前，还要在「AI 服务」里下载「离线语义资料」（约 81MB，联网一次）。阅读、搜索和笔记不依赖它；下载完成后 AI 问答会使用本机语义检索。

## 问第一个问题

1. 打开一本书，长按选中一段原文。
2. 在菜单里点「问 AI」。
3. 第一次提问会先让你确认「AI 服务发送说明」；确认后发送。
4. 回答会先解释问题，再给出「书内依据」。点引用可以打开原文、跳到对应位置。

不选文字也可以：阅读器页脚点「问书灯」，直接问当前这本书。

接下来可以看 [阅读](reading.md)、[标注与笔记](annotations.md) 和 [阅读问答](reading-qa.md)。
