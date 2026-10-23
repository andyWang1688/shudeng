# 原生设计落地与验收

状态：原生实现、本轮约定范围的 Release 回归和正常模式界面检查已完成，可在原 Shudeng Small 试用。此轮不是新版本发布；不代表完整旧测试集或整应用回归通过。

范围来源：[设计规格](spec.md)、用户确认的 UIKit 页面/模拟器验收接缝。审查固定基线：`8666836159e0cc259e1ccfcd883699399561c867`；此前已有的文档与 Python 改动未混入原生提交。

## 已实现

1. 统一纸白、墨色、暖灯色及浅深主题；沿用系统 Dynamic Type，不全局放大系统字号。原授权图标已接入 AppIcon 与“我的”，品牌文案保持不变。
2. 书架使用真实 EPUB 封面或书名排版回退，增加继续阅读层级；笔记区分引用与个人内容，对话历史展示问题、摘要和状态。
3. 提问在右侧气泡，AI 在左侧带“书灯 · AI”身份；视觉不显示“你”。选文附件与 AI 依据分开，支持多轮与未发送草稿。
4. 引用直达高亮原文，提供“返回问答”与 Escape；返回保留同一对话、附件、草稿、滚动及触发焦点。收起后重开保留同一问答，新的选文仍新建对话。
5. 保留 UIKit、Readium、检索、AI 协议及保存模型。没有新增模拟器、卸载主 App、导入演示书到用户书库或读取真实 Key；没有向真实 AI 发送本轮验收请求。

原图标 SHA-256：`ed339c5144d408d7a1915e0f82db129769a50ccaa16e807bd31053c44ca6e775`；资源目录两份 PNG 与设计资源一致。

### 小屏兼容调整

原 Shudeng Small / iOS 26.5 的正常模式人工检查发现：系统大标题区域空白，虽然 `navigationItem.title` 有值、`prefersLargeTitles` 为真。只读调试确认大标题容器没有呈现标题；显式设置 `largeTitle`、强制 always 未解决，改用紧凑系统标题立即恢复文字并消除空白。

因此四栏根页面统一紧凑导航标题。它与规格“标题约31pt”存在局部视觉差异，已向用户说明；不改系统字号、页面内容层级或导航功能。调试器已退出，最终交付以源码重建包为准，不依赖内存修改。

## Release 行为测试

设备唯一：Shudeng Small，`1B9B9A35-F2D7-4D87-AB31-6B07D1B27D66`。构建前可用空间为39 GiB。

测试使用 UUID 隔离书库及项目 EPUB 夹具，没有操作真实书库或 Key；回答是明确的固定测试内容，不是实际 AI 质量证据。

| 输入/操作 | 预期/禁止 | 已取得的证据 |
| --- | --- | --- |
| 已保存问题和回答打开问答 | 左右身份清晰，已发送问题不重复占用追问输入框；视觉无“你”字 | `testSavedTurnSeparatesQuestionFromAIAndKeepsFollowUpDraft` |
| 展开选文、输入草稿、滚动后点击来源并返回 | 真实定位原文；返回保留草稿、附件展开与滚动，不重复记录 | `testCitationRoundtripPreservesFollowUpDraftAttachmentAndScroll`；含目录写入失败故障注入，必须先显示离开确认 |
| 返回后立即再次打开引用，再关闭和重开问答 | 两次往返成功；同一问答实例、同一对话，不新建空记录 | `testReaderReopensSameConversationAndAcceptsImmediateSecondCitation` |
| 公开 Navigator 委托报告原文加载失败，点击返回 | 仍提供“仍然返回问答”确认选项，不被 loading 门禁困住 | `testFailedCitationLoadStillOffersReturnToConversation`；最后确认动作的分支为静态复核，不作为完整失败恢复交互测试 |

第一轮审查修复后的测试有2项失败；测试需等页面收起与弹窗关闭完成，已修正等待条件，不放宽业务断言。加载失败退出回归先得到1项失败，再修复门禁。失败日志和 xcresult 全部保留。

最终源码（含紧凑标题）的 Release：4 tests / 0 failures，15.19秒，进程退出0。日志 [native-design-reviewed-4.log](../../../.scratch/native-design-reviewed-4.log)，结果 [951e20390e2546689c6719d3ac67d261.xcresult](../../../.scratch/test-evidence/native-design-reviewed/951e20390e2546689c6719d3ac67d261.xcresult)。引用与返回截图保留在 [附件目录](../../../.scratch/native-design-final-reviewed-attachments/)。

导航标题调整前的同组 Release 也通过：4 tests / 0 failures，日志 [native-design-reviewed-2.log](../../../.scratch/native-design-reviewed-2.log)，结果 [e29a9e0326b848ab85c3acf8c503a1da.xcresult](../../../.scratch/test-evidence/native-design-reviewed/e29a9e0326b848ab85c3acf8c503a1da.xcresult)。

## Standards

独立只读复核已关闭：引用返回保存失败门禁、原文加载失败时的退出门禁、重复主题色。紧凑标题仅使用 UIKit 公开 API；当前无未关闭的硬性规范问题或明显判断性异味。

## Spec

独立只读复核已关闭：返回原问答时的异步定位竞态、行内引用返回焦点缺失。紧凑标题为上述小屏兼容偏差，不扩张功能范围。行内 VoiceOver 焦点为代码复核，未执行完整 VoiceOver 手工验收。

## 验证边界

完整旧单元集曾执行一次：79 tests，56 failure assertions（45 unexpected），见 [native-design-unit-suite.log](../../../.scratch/native-design-unit-suite.log)。其中存在未启动本地 HTTP 夹具、该次 Debug 包 Keychain 权限错误，以及同进程性能测试 RSS 733626368 超过629145600等失败；未在完整正确环境重跑，因此不能宣称全套回归或性能通过，也不能排除其他回归。

本轮4项界面集成测试不代替真实 AI 质量、后台恢复、系统大字号、完整 VoiceOver 和整应用回归。模拟器 Release 是用户约定的正式发布测试标准；此轮未创建新 GitHub Release、未推送提交，既有 v0.1.0 未改。

## 正常模式检查

已无测试参数正常启动最终重建的 `dev.shudeng.app` 并打开原模拟器前端，完成以下人工检查：

1. 书架、笔记、对话、我的：四栏均可切换，紧凑标题均实际可见，没有原大标题空白。
2. 原书库显示3本；继续阅读与书名排版回退封面可见，笔记空态和已有历史对话可见。本轮未人工验收带嵌入封面 EPUB 的显示，不将代码实现当作已见证据。
3. “我的”显示原灯泡图标及约定品牌文案，保留 `DeepSeek · deepseek-flash` 配置摘要；没有进入密钥编辑页或读取密钥。已检查浅/深色，并恢复原来的“跟随系统”。
4. 从“继续阅读”打开已有书，实际正文可读，显示“阅读位置已保存”，可返回书架。检查结束停留在书架，供用户继续试用；没有发送新的真实 AI 请求。

正常模式截图保存在本机：[书架](../../../.scratch/native-design-final-normal/shelf.jpg)、[笔记](../../../.scratch/native-design-final-normal/notes.jpg)、[对话](../../../.scratch/native-design-final-normal/conversations.jpg)、[我的](../../../.scratch/native-design-final-normal/profile.jpg)、[阅读](../../../.scratch/native-design-final-normal/reader.jpg)。其中含已有书库/历史内容，不上传 GitHub。
