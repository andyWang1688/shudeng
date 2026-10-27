# 书灯 · Shudeng

> 一盏照书的灯，AI 照亮你读不懂的地方。

以阅读为中心的个人阅读应用。AI 是按需出现的辅助工具。

> 最新版 v0.2.0：界面更简洁，阅读工具栏即时淡入淡出，AI 服务配置与密钥恢复更清楚。[下载新版](https://github.com/andyWang1688/shudeng/releases/tag/v0.2.0) · [安装与版本说明](docs/releases/v0.2.0.md)。下载包用于 Apple Silicon Mac 的 Xcode iOS Simulator，真机和 App Store 分发尚未验证。

## 项目方向

- 首发原生 iOS，以 iPhone 为主，长期考虑多端。
- 面向阅读外语或较难非虚构书籍的个人读者，支持阅读中直接提问并保留问答记录。
- 首发支持 EPUB；AI 服务由读者在设置页自行配置，支持 OpenAI、Anthropic 两种接口格式。
- 界面克制、清晰，核心操作简单可靠。
- 支持左右翻页、连续滚动和仿真翻页。
- 本机可靠保存阅读进度、笔记与对话；完整备份导出与恢复、云同步移后。
- 阅读问答采用内置 multilingual MiniLM 的简单本地 RAG，使用[本地向量与关键词候选合并](docs/adr/0008-local-hybrid-retrieval.md)；最多8块材料、一次生成，不承诺完整理解全书。
- 参考 ReadAny 的 `feat/native-ios` 分支中 Shudeng 应用的已有产品设计，精简首发范围并独立实现。

## 产品文档

先看[首发已确认决策](docs/first-release-decisions.md)，完整入口见[文档首页](docs/README.md)：

- [认识书灯](docs/introduction.md)：为谁解决什么问题，计划提供怎样的阅读体验。
- [阅读问答如何工作](docs/how-reading-ai-works.md)：用具体例子解释查书、向量检索、提示词与代码的分工。
- [产品范围](docs/product-scope.md)：首发包含什么，哪些功能移后，哪些细节尚待确定。
- [阅读问答设计](docs/reading-ai-design.md)：当前简单 RAG 方案与验收边界；[开源项目对照](docs/reading-ai-comparison.md)保留历史调研。

## 当前状态

2026-10-27 发布 v0.2.0，包含界面收敛、覆盖式阅读控件、按书折叠分组、移除“仅已读”和一次性 AI 发送确认；范围与验证记录见[新版说明](docs/releases/v0.2.0.md)。2026-10-21 的[真实服务首发验收](https://github.com/andyWang1688/shudeng/issues/19#issuecomment-6314647587)保留为历史记录，本轮未重跑真实 AI 回答质量；真机、最低系统版本与商店分发仍未验证。

独立实现；本仓库未导入其他项目的源码或 Git 历史。第三方组件须分别核对来源和许可证。

## 许可

项目许可证尚未选定。公开仓库不代表已授予开源使用许可；第三方组件按各自许可证处理。
