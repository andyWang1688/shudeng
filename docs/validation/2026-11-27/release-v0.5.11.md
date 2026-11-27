# v0.5.11 模拟器验收

阅读器等待某页写入时，后续 PDF 翻页仍会加入保存队列。修复后，返回问答前会等待最新页。受控回归让第 40 页写入暂缓、插入第 41 页并注入写入失败，验证界面可留在阅读页，重试后保存第 41 页。39 项定向测试和移动端类型检查通过，详见 [PDF 翻页与返回问答](pdf-progress-return.md)。

复用既有构建目录完成一次 Release 构建。分发包的 Info.plist 与 Expo 配置均为 0.5.11 / 24。arm64、深度签名、ZIP 完整性与 127 项 npm 许可审核通过。用最终 ZIP 覆盖安装到 Shudeng Small（iOS 26.5），保留 8 本书、5 条标注和 39 段对话。主程序、Hermes、Info.plist 和 Expo 配置与解压包一致。文档站本地构建通过。

打包前在已发布的 v0.5.10 模拟器版把 DeepSeek 改为 `deepseek-flash` 并开启联网。从先前关闭联网的 PDF 历史对话追问官方搜索工具名。回答仍归入同一对话，SQLite 状态为完成、联网完成，并保存 1 条官方网页出处。正文给出 `deepseek_web_search`，点击其中的文档链接打开 Safari 的 Web Tools 页面。测试后恢复原先的 `deepseek-chat` 和关闭联网的设置。v0.5.11 覆盖安装后重开该回答，内容及「已完成联网搜索」仍可见。iPhone 目前不可用，真机流程待验。[交付清单](../../../delivery/releases/v0.5.11/release-manifest.json)
