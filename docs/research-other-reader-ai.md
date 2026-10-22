# Librum：选文 AI 实现对照

日期：2026-10-14。仅阅读官方公开源码，未克隆、运行或复制代码、提示词、文案及资源。本文是独立架构概述。

## 比较价值与范围

Librum 有完整可追踪的选文解释实现，适合作为轻量交互对照；**本次核实的解释链路不是整书 RAG，也不是带持久历史的书内对话系统**，不把它当作书灯核心问答方案的完整样板。

固定源码快照：

- 客户端默认分支 `main`：[`5fdac3454c3c3fbc4191aa6a4f277368895c9c70`](https://github.com/Librum-Reader/Librum/tree/5fdac3454c3c3fbc4191aa6a4f277368895c9c70)。
- 服务端默认分支 `main`：[`f9e49819efe94f50afcdcb362f115665fb1a30ee`](https://github.com/Librum-Reader/Librum-Server/tree/f9e49819efe94f50afcdcb362f115665fb1a30ee)。

两者是各自默认分支快照，未验证作为一组实际部署运行；以下结论限定到所读源码路径。

## 实际数据流

1. 用户在阅读页面选择文字，或对已有高亮调用解释；菜单读取选中文字/高亮文字，向阅读视图发出字符串。阅读视图把该字符串设为解释弹窗输入并打开弹窗。[选文菜单](https://github.com/Librum-Reader/Librum/blob/5fdac3454c3c3fbc4191aa6a4f277368895c9c70/src/presentation/readingPage/MSelectionOptionsPopup.qml)、[弹窗接线](https://github.com/Librum-Reader/Librum/blob/5fdac3454c3c3fbc4191aa6a4f277368895c9c70/src/presentation/readingPage/MDocumentView.qml)
2. 弹窗打开即请求解释，用户可切换解释模式重新请求；输入展示只读。Controller/Service/Gateway 只传递选文和模式，没有在这些层追加附近段落、章节内容、书籍标识或历史消息。[解释弹窗](https://github.com/Librum-Reader/Librum/blob/5fdac3454c3c3fbc4191aa6a4f277368895c9c70/src/presentation/readingPage/MExplanationPopup.qml)、[客户端服务](https://github.com/Librum-Reader/Librum/blob/5fdac3454c3c3fbc4191aa6a4f277368895c9c70/src/application/services/ai_explanation_service.cpp)、[Gateway](https://github.com/Librum-Reader/Librum/blob/5fdac3454c3c3fbc4191aa6a4f277368895c9c70/src/adapters/gateways/ai_explanation_gateway.cpp)
3. 网络层使用用户认证 token，请求项目配置的服务器；JSON 仅有 `text`、`mode`。客户端接收流式文本并追加到当前弹窗。[客户端网络层](https://github.com/Librum-Reader/Librum/blob/5fdac3454c3c3fbc4191aa6a4f277368895c9c70/src/infrastructure/persistance/ai_explanation_access.cpp)
4. 服务端检查输入长度和用户额度，再向 OpenAI Chat Completions 发起请求；消息列表只有一条由本次模式与选文组成的用户消息，固定模型为 `gpt-3.5-turbo`，输出上限 280 tokens。该路径未加载书籍、分片、embedding 或检索结果。[服务端入口](https://github.com/Librum-Reader/Librum-Server/blob/f9e49819efe94f50afcdcb362f115665fb1a30ee/src/Presentation/Controllers/AiController.cs)、[服务端 AI 服务](https://github.com/Librum-Reader/Librum-Server/blob/f9e49819efe94f50afcdcb362f115665fb1a30ee/src/Application/Services/AIService.cs)

## 能力边界

| 问题 | 源码结论 |
| --- | --- |
| 选文之外传什么？ | 本链路没有追加正文上下文；客户端传选文和模式，服务器再附带请求参数及散列用户标识。 |
| 整书检索与向量化？ | 本解释链路没有，不能从产品宣称有 AI 推导出整书检索。未声称穷尽整个仓库所有功能。 |
| 长文本如何处理？ | 服务端拒绝长度超过 5000 的文本（C# `string.Length` 口径），没有自动切片或多批归纳。 |
| 历史与追问？ | 弹窗关闭即清空问题和答案；切换模式重发本次选文，不发送之前答案。所读链路没有持久对话历史。服务端保存的是用户请求计数。 |
| 引用与跳回？ | 返回流式文本；没有结构化章节位置、检索证据或可定位引用。原选文展示不能等同于回答依据的引用系统。 |
| 服务依赖？ | 使用项目服务器认证与额度体系，OpenAI 凭据配置在服务器；自托管也需配置服务端。不是书灯要求的手机直接连接读者自有模型服务。 |

以上分别由前述弹窗、网络层、服务端入口与 AI 服务支撑。

## 平台与许可

- 固定快照 README 列出 Windows、GNU/Linux、macOS；iOS、Android 标为尚未推出。Qt/C++ 桌面交互不能直接作为原生 iPhone 可用性的证据。[README](https://github.com/Librum-Reader/Librum/blob/5fdac3454c3c3fbc4191aa6a4f277368895c9c70/README.md)
- 客户端许可证为 GPL v3；本研究不把它纳入代码复用候选，也不据此对所有 GPL 项目的 App Store 可行性作笼统结论。[LICENSE](https://github.com/Librum-Reader/Librum/blob/5fdac3454c3c3fbc4191aa6a4f277368895c9c70/LICENSE.md)
- 服务端许可证为 AGPL v3，同样只作设计研究。[服务端 LICENSE](https://github.com/Librum-Reader/Librum-Server/blob/f9e49819efe94f50afcdcb362f115665fb1a30ee/LICENSE.md)

## 对书灯的启示

可参考“从选文直接进入解释、流式展示、失败明确反馈”的低操作成本。不能沿用其信息边界来满足本项目：书灯需要在选文外补上下文、按问题检索书内依据、保存可继续的对话及原文定位。这些核心能力在该解释链路里没有现成答案。

未确认生产服务当前状态、实际输出质量和性能；没有执行功能测试。
