# 书灯 · Shudeng

一盏照书的灯，AI 照亮你读不懂的地方。

[![使用文档](https://img.shields.io/badge/%E4%BD%BF%E7%94%A8%E6%96%87%E6%A1%A3-5B7DB1)](https://andywang1688.github.io/shudeng/)

最新版 v0.4.1：[下载](https://github.com/andyWang1688/shudeng/releases/tag/v0.4.1) · [更新说明](docs/releases/v0.4.1.md)

## 安装

下载包面向 Apple Silicon Mac 的 Xcode iOS 模拟器。

1. 从 [Releases](https://github.com/andyWang1688/shudeng/releases) 下载并解压 `.zip`，得到 `Shudeng.app`。
2. 启动 Xcode 自带的 iOS 模拟器。
3. 把 `Shudeng.app` 拖进模拟器，打开「书灯」。

更细的步骤和截图：[快速开始](https://andywang1688.github.io/shudeng/quick-start)。

## 能做什么

- 读 EPUB 和 PDF，分页、滚动、仿真翻页。
- 选中文字提问，也可以直接问当前这本书；回答附带书内引用，能跳回原文。
- 四色高亮、波浪线笔记、书签，按书整理；笔记可以导出。
- AI 服务自己配：支持 OpenAI、Anthropic 两种接口，密钥存在本机。

## 文档

- [使用文档](https://andywang1688.github.io/shudeng/)：安装、阅读、标注、阅读问答、AI 服务、隐私与常见问题。
- [开发文档](docs/README.md)：设计决策、验收记录和协作约定，不对外发布。

## 开发

用 Xcode 打开 `ios/Shudeng.xcodeproj` 运行。测试与打包脚本在 `scripts/`，每个版本的说明在 `docs/releases/`。

## 其他

- 下载包目前只面向模拟器；真机与商店分发尚未验证。
- 独立实现。产品交互参考过 ReadAny 中的书灯应用，没有使用其代码、提示词或资源。
- 许可证尚未选定。公开仓库不等于授权使用；第三方组件按各自许可证处理。
