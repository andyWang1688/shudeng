# Issue #27：对话页视觉闭环实施记录

状态：2026-10-24，实现完成，独立验收通过。验收结论见[对话页视觉闭环](issue27-conversations-acceptance.md)；本记录不把其他页面并入本页。

基准：[高保真原型](standalone.html)、[设计规格](spec.md)、[UIKit 界面开发规范](../ui-development-standard.md)。执行单：[GitHub Issue #27](https://github.com/andyWang1688/shudeng/issues/27)。

## 实现结果

- 使用自定义左对齐 31pt“对话”页头、12pt 说明和 44pt 圆角搜索框，不呈系统导航标题或缩进列表。
- 搜索同时匹配对话标题、首问、最新回答和书名；无结果时可清除搜索并恢复全部记录。
- 按书分组并复用笔记页抽取的书籍标识组件，显示原封面或稳定书名回退。
- 每条约会显示问题标题、最多两行的回答摘要、时间和提问次数；问题与摘要过长时截断。
- 空对话、搜索无结果和读取失败使用不同标题、说明与单一操作；空态返回书架，搜索空态清除筛选，读取失败提供重试。
- 打开记录进入原对话，已保存问题与追问入口可继续使用；左滑仍提供改名和删除入口。
- 读取失败时清空列表展示，避免旧缓存内容与失败状态同时出现。

## 证据

最终结果：[final-2.xcresult](../../../.scratch/test-evidence/issue27/final-2.xcresult)，4 tests / 0 failures；设备为 Shudeng Small（iPhone SE 3，iOS 26.5）。

- `DesignFixtureTests/testConversationsPageUsesDesignedHeaderSearchGroupingAndMetadata`：页头、搜索、分组、摘要、时间、次数、改名/删除入口及四种尺寸/主题截图。
- `DesignFixtureTests/testConversationsEmptyAndReadFailureOfferDistinctNextActions`：空态、搜索空态、损坏存储的读取失败及各自下一步；空态操作实际切换回书架。
- `QuestionTests/testIssue12ConversationRenameDeleteDraftAndRealWriteFailures`：既有改名、删除、追问草稿持久化和写入失败不丢失行为回归。
- `ReadingUITests/testIssue27ConversationsSearchOpenAndStates`：Shudeng Small 上实际切换四栏、输入搜索、清除搜索、打开原对话、关闭返回，以及浅/深色和空态。

截图由 [final-2-attachments](../../../.scratch/test-evidence/issue27/final-2-attachments/manifest.json) 导出，以下为精选副本：

| 状态 | 证据 |
| --- | --- |
| 375 × 667 浅色 | [conversations-375x667-light](../../../.scratch/test-evidence/issue27/curated-final/conversations-375x667-light.png) |
| 375 × 667 深色 | [conversations-375x667-dark](../../../.scratch/test-evidence/issue27/curated-final/conversations-375x667-dark.png) |
| 390 × 844 浅色 | [conversations-390x844-light](../../../.scratch/test-evidence/issue27/curated-final/conversations-390x844-light.png) |
| 390 × 844 深色 | [conversations-390x844-dark](../../../.scratch/test-evidence/issue27/curated-final/conversations-390x844-dark.png) |
| Shudeng Small 正常浅色 / 深色 | [浅色](../../../.scratch/test-evidence/issue27/curated-final/app-conversations-375-light.png) / [深色](../../../.scratch/test-evidence/issue27/curated-final/app-conversations-375-dark.png) |
| 搜索无结果 | [键盘展开状态](../../../.scratch/test-evidence/issue27/curated-final/app-conversations-search-empty-375-light.png) |
| 空对话 | [空状态](../../../.scratch/test-evidence/issue27/curated-final/conversations-empty-375x667-light.png) |
| 读取失败 | [失败与重试](../../../.scratch/test-evidence/issue27/curated-final/conversations-failed-375x667-light.png) |

应用级截图裁除 20pt 系统状态栏；固定尺寸图由真实 UIKit 控制器渲染，不是缩放截图。

## 数据与兼容性

1. 本轮只重构 UIKit 展示层；未修改 `ReadingQuestion`、`ReadingConversation`、`QuestionStore` 的编码结构、生成协议或保存位置。
2. 搜索、过滤和日期文本均为只读派生数据，不写回对话记录。
3. 抽出的书籍分组标识组件同时服务笔记页和对话页，减少两套近似实现。
4. 单元测试改用已有的内存密钥夹具，不再访问系统 Keychain；不改生产密钥路径。

## 允许差异与未验证边界

1. 390 × 844 是同一模拟器进程内的内容尺寸渲染，不是第二台设备；系统状态栏不计入对照。
2. 固定夹具没有内嵌封面，书组使用书名首字和稳定底色回退；真实 EPUB 封面优先逻辑未在 #27 重新人工验证。
3. 搜索无结果截图保留输入键盘，这是用户输入后的真实状态；正常状态截图没有键盘。
4. 读取失败测试故意保留损坏 JSON，因此重试后仍显示失败。成功恢复路径已接回现有 `QuestionStore.load()`，但本票没有伪造一次可恢复的存储故障。
5. 完整 VoiceOver 顺序、辅助字号下的所有状态和真实 AI 内容未在本次专项集验收；留给 #32 或用户试用。
