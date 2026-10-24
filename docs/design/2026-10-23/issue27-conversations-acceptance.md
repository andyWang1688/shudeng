# Issue #27：对话页视觉闭环

状态：2026-10-24，验收通过。通过范围仅限对话页；不把其他页面的既有结论并入本页。

基准：[高保真原型](standalone.html)、[设计规格](spec.md)、[UIKit 界面开发规范](../ui-development-standard.md)。执行单：[GitHub Issue #27](https://github.com/andyWang1688/shudeng/issues/27)。

## 结论

独立复核最终 xcresult、固定尺寸截图、Shudeng Small 应用截图和确认稿后确认：页头、说明、搜索、按书分组、问题标题、两行摘要、时间与提问次数均与确认稿的结构一致；空对话、搜索无结果和读取失败有不同说明与可执行下一步。以下“允许差异与未验证边界”不阻断 #27 关闭。

- 页头使用自定义左对齐 31pt“对话”、12pt 说明和 44pt 圆角搜索框，不呈系统居中导航标题或缩进列表。
- 搜索匹配标题、首问、最新回答和书名；清除后恢复完整记录。
- 书籍分组显示原封面或稳定书名回退标识；长问题和摘要按规格截断，不挤掉时间与提问次数。
- 打开记录进入原对话；既有继续追问、草稿、改名、删除和保存行为通过回归。
- 375 × 667、390 × 844 的浅色与深色均有固定尺寸渲染；唯一 Shudeng Small 上另有正常、搜索、空态和失败状态的应用级证据。

## 证据

最终结果：[final-2.xcresult](../../../.scratch/test-evidence/issue27/final-2.xcresult)，4 tests / 0 failures，设备为 Shudeng Small（iPhone SE 3，iOS 26.5）。

- `DesignFixtureTests/testConversationsPageUsesDesignedHeaderSearchGroupingAndMetadata`：通过。
- `DesignFixtureTests/testConversationsEmptyAndReadFailureOfferDistinctNextActions`：通过。
- `QuestionTests/testIssue12ConversationRenameDeleteDraftAndRealWriteFailures`：通过。
- `ReadingUITests/testIssue27ConversationsSearchOpenAndStates`：通过。

截图由 [final-2-attachments](../../../.scratch/test-evidence/issue27/final-2-attachments/manifest.json) 导出，精选证据如下：

| 状态 | 证据 |
| --- | --- |
| 375 × 667 浅色 | [conversations-375x667-light](../../../.scratch/test-evidence/issue27/curated-final/conversations-375x667-light.png) |
| 375 × 667 深色 | [conversations-375x667-dark](../../../.scratch/test-evidence/issue27/curated-final/conversations-375x667-dark.png) |
| 390 × 844 浅色 | [conversations-390x844-light](../../../.scratch/test-evidence/issue27/curated-final/conversations-390x844-light.png) |
| 390 × 844 深色 | [conversations-390x844-dark](../../../.scratch/test-evidence/issue27/curated-final/conversations-390x844-dark.png) |
| Shudeng Small 浅色 | [app-conversations-375-light](../../../.scratch/test-evidence/issue27/curated-final/app-conversations-375-light.png) |
| Shudeng Small 深色 | [app-conversations-375-dark](../../../.scratch/test-evidence/issue27/curated-final/app-conversations-375-dark.png) |
| 搜索无结果 | [app-conversations-search-empty-375-light](../../../.scratch/test-evidence/issue27/curated-final/app-conversations-search-empty-375-light.png) |
| 空对话 | [conversations-empty-375x667-light](../../../.scratch/test-evidence/issue27/curated-final/conversations-empty-375x667-light.png) |
| 读取失败 | [conversations-failed-375x667-light](../../../.scratch/test-evidence/issue27/curated-final/conversations-failed-375x667-light.png) |
| 确认稿同页对照 | [design-chats-375x667-light](../../../.scratch/test-evidence/issue27/design-chats-375x667-light.png) |

应用级截图已裁除 20pt 系统状态栏；固定尺寸图由真实 UIKit 控制器渲染，不是缩放截图。

## 数据与兼容性

1. 本轮只重构 UIKit 展示层；未修改 `ReadingQuestion`、`ReadingConversation`、`QuestionStore` 的编码结构、生成协议或保存位置。
2. 搜索、过滤和日期文本均为只读派生数据，不写回对话记录。
3. 书籍分组标识组件由笔记页和对话页复用，没有复制第二套近似实现。
4. 测试改用已有的内存密钥夹具；生产密钥读取路径未改。

## 允许差异与未验证边界

1. 390 × 844 是同一模拟器进程内的固定内容尺寸渲染，不创建第二台设备；系统状态栏不计入对照。
2. 固定夹具没有内嵌封面，分组使用书名首字与稳定底色回退；真实 EPUB 封面优先逻辑不在本页重新验收。
3. 搜索无结果截图保留键盘展开状态；正常页截图不含键盘。
4. 读取失败测试保留损坏 JSON，因此同一次失败状态下重试仍失败；可恢复故障后的成功路径未伪造。
5. 完整 VoiceOver 顺序、辅助字号下的全部状态、真实 AI 内容、旧全套测试和整应用性能留给 #32。
6. xcresult 记录一条既有运行时警告：未来将要求 `UIScene` 生命周期。本页 4 项测试均未失败；该架构警告不在 #27 范围内消除。
