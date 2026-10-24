# Issue #31：引用原文视觉与往返闭环实施记录

状态：2026-10-24，实现与专项回归完成，等待独立验收。本记录只覆盖引用原文与返回问答，不把整应用或 Release 验收并入。

基准：[高保真原型](standalone.html)、[设计规格](spec.md)、[UIKit 界面开发规范](../ui-development-standard.md)。执行单：[GitHub Issue #31](https://github.com/andyWang1688/shudeng/issues/31)。

## 实现结果

- 引用状态复用阅读页 51pt 自定义顶栏。左上角显示返回图标与“返回问答”，中栏显示书名及“查看引用 1 · 章节”，右侧目录与阅读设置入口保持可见。
- 引用原文使用设计中的暖灯选区色 `BookDesign.selection`，浅色 `#F4E3AC`、深色 `#5B4D2D`；不再使用较浅的帮助底色替代。
- 进入引用前收起选文菜单并清除当前选区；引用状态下禁止再次弹出高亮/笔记/提问菜单，避免遮挡依据。
- 回答尾部的“书内依据 [1]”使用已验证引用 URL；来源卡继续复用同一证据和目标。两种入口都进入同一阅读定位链路。
- 返回后由既有异步路径恢复到原对话和问答底部面板，并恢复草稿、附件展开、滚动位置与引用触发焦点；连续第二次引用继续复用同一问答实例。
- 原文加载失败或保存失败仍保留明确退出路径；没有替换保存模型、检索或 AI 协议。

## 证据

最终专项结果：[round1b.xcresult](../../../.scratch/test-evidence/issue31/round1b.xcresult)，7 tests / 0 failures；设备为 Shudeng Small（iPhone SE 3，iOS 26.5）。

- `QuestionPresentationTests/testInlineCitationOpensReaderFromVerifiedLink`：回答提供 `shudeng://citation/0` 已验证链接，链接委托实际打开 Reader，并暴露返回问答入口。
- `QuestionPresentationTests/testCitationRoundtripPreservesFollowUpDraftAttachmentAndScroll`：来源卡往返、保存失败退出、草稿、附件展开、滚动与同一对话保留。
- `QuestionPresentationTests/testReaderReopensSameConversationAndAcceptsImmediateSecondCitation`：连续第二次引用、同一问答实例及同一对话。
- `QuestionPresentationTests/testFailedCitationLoadStillOffersReturnToConversation`：原文加载失败后仍可返回问答。
- `DesignFixtureTests/testCitationRendersBothContentSizesAndThemesWithReturnChrome`：375×667/390×844、浅深色引用页；返回文案、引用章节、工具栏、无选文菜单及暖灯高亮。
- `ReadingUITests/testIssue31CitationVisualAndReturnToConversation`：Shudeng Small 上从来源卡进入引用、返回同一问答面板；浅色与深色均实际执行。

截图保存在 [round1b-attachments](../../../.scratch/test-evidence/issue31/round1b-attachments/)：

| 状态 | 证据 |
| --- | --- |
| Shudeng Small 引用浅色 | [citation-375-light](../../../.scratch/test-evidence/issue31/round1b-attachments/2858DB66-7F80-4A3B-BC9A-AABF81058FE2.png) |
| 返回同一问答浅色 | [returned-375-light](../../../.scratch/test-evidence/issue31/round1b-attachments/D55B6444-298A-414B-8CA6-785669BCA922.png) |
| Shudeng Small 引用深色 | [citation-375-dark](../../../.scratch/test-evidence/issue31/round1b-attachments/207134B9-7E72-4796-AC46-B94FD8624760.png) |
| 返回同一问答深色 | [returned-375-dark](../../../.scratch/test-evidence/issue31/round1b-attachments/0EBFCF6D-5E4D-4566-9BDE-25A3D485E3B5.png) |
| 390×844 浅色 | [citation-390-light](../../../.scratch/test-evidence/issue31/round1b-attachments/8478855B-74CF-4004-92D3-1E575587D424.png) |
| 390×844 深色 | [citation-390-dark](../../../.scratch/test-evidence/issue31/round1b-attachments/074628B0-99D3-4EF0-B7C8-400C2C29A899.png) |

应用级截图按 point 裁除 20pt 系统状态栏；390×844 是同一测试进程内的固定内容尺寸渲染，不创建第二台设备。

## 数据与兼容性

1. 没有修改 `Book`、`ReadingQuestion`、`QuestionEvidence`、笔记、书签或保存格式。
2. 行内引用只使用已验证证据生成的 URL；模型文字不能自行构造目的地。
3. 返回路径继续验证原文位置和保存状态；失败时保留已保存内容并提供确认退出。
4. 测试只使用固定设计夹具、隔离临时书库与内存密钥，不读取真实 Key、不发送真实 AI 请求、不操作用户书库。

## 未验证边界

1. 390×844 使用内容尺寸渲染，不是第二台模拟器；系统状态栏与 Home Indicator 不计入对照。
2. 本轮未重新运行完整旧测试集、完整 VoiceOver 顺序、所有辅助字号组合或真机性能。
3. 固定夹具引用原文中的保存高亮与引用高亮可能同时出现，属于夹具的已有笔记与引用两个独立记录，不是重复定位。
