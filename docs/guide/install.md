# 安装与开始

## 需要什么

- 一台 Apple Silicon Mac。
- Xcode，使用它自带的 iOS 模拟器。
- 从 [GitHub Releases](https://github.com/andyWang1688/shudeng/releases) 下载最新的模拟器安装包。

## 安装

1. 下载并解压 `.zip` 包，得到 `Shudeng.app`。
2. 打开 Xcode，菜单 Xcode → Open Developer Tool → Simulator，启动一台 iPhone 模拟器。
3. 把 `Shudeng.app` 拖进模拟器窗口。也可以在终端执行：

   ```sh
   xcrun simctl install booted Shudeng.app
   ```

4. 在模拟器主屏点开「书灯」。

## 导入第一本书

1. 书架为空时点「导入」。
2. 选一个 EPUB 或 PDF 文件。
3. 回到书架，点封面开始阅读。

几点说明：

- 支持可重排 EPUB 和 PDF；固定版式 EPUB 打不开。
- 需要密码的文件无法导入。
- PDF 导入时会检查每一页能不能选中文字，页面多时会显示进度，可以随时取消。
