# Issue #26：笔记页视觉闭环

状态：2026-10-24，验收通过。通过范围仅限笔记页；不把书架、对话、我的、阅读、问答或引用的旧结论并入本页。

基准：[高保真原型](standalone.html)、[设计规格](spec.md)、[UIKit 界面开发规范](../ui-development-standard.md)。执行单：[GitHub Issue #26](https://github.com/andyWang1688/shudeng/issues/26)。

## 结论

独立验收复核 `final.xcresult` 的结构化结果与导出的固定尺寸截图后确认：3 tests / 0 failures；页头、四类过滤、书籍分组、宋体引用、系统字体笔记、元信息与返回原文均与确认稿一致。以下“允许差异与未验证边界”不阻断 #26 关闭。

- 使用自定义左对齐 31pt 标题、说明、44pt 导出入口和四类过滤，不再使用系统居中导航标题或 `insetGrouped` 列表。
- 全部、高亮、笔记、书签四类过滤可实际切换；固定夹具中分别为 3、1、1、1 条。
- 记录按书分组，分组带原封面或稳定的书名回退标识；原文为宋体、暖灯色 2pt 左边线，个人想法使用系统字体。
- 元信息显示章节、记录类型和保存时间；历史记录没有时间元数据时显示“时间未记录”，不生成虚假时间。
- 空状态和过滤空态提供说明与单一操作；空书架可从该操作回到书架。
- 记录可打开笔记编辑器，“保存草稿”入口仍在；记录右侧“回到原文”直达保存的 Locator，实测能定位并高亮原文。
- 375 × 667、390 × 844 的浅色与深色均有固定尺寸渲染；Shudeng Small 上另有正常、书签过滤、空状态和返回原文截图。

## 证据

最终源码测试：[final.xcresult](../../../.scratch/test-evidence/issue26/final.xcresult)，日志 [issue26-final.log](../../../.scratch/issue26-final.log)。

最终结果：

- `DesignFixtureTests/testNotesPageUsesDesignedHeaderGroupingAndFourFilters`：通过。
- `DesignFixtureTests/testNotesEmptyStateOffersAReadableNextAction`：通过。
- `ReadingUITests/testIssue26NotesFiltersVisualAndReturnToOriginal`：通过。
- 合计 3 tests / 0 failures。

截图由 [final-attachments](../../../.scratch/test-evidence/issue26/final-attachments/manifest.json) 导出：

| 状态 | 证据 |
| --- | --- |
| 375 × 667 浅色 | [notes-375x667-light](../../../.scratch/test-evidence/issue26/final-attachments/F75D1980-0AA2-445F-A1F2-E740B998F2A0.png) |
| 375 × 667 深色 | [notes-375x667-dark](../../../.scratch/test-evidence/issue26/final-attachments/CD49EDE4-B519-4737-AE2C-5AA4FBF434DD.png) |
| 390 × 844 浅色 | [notes-390x844-light](../../../.scratch/test-evidence/issue26/final-attachments/7DB61E99-A748-44BD-BF7B-ED95140B1114.png) |
| 390 × 844 深色 | [notes-390x844-dark](../../../.scratch/test-evidence/issue26/final-attachments/F875893B-1BFF-4437-A0FF-260B89EE748B.png) |
| 空状态 | [notes-empty](../../../.scratch/test-evidence/issue26/final-attachments/82FA7250-388B-4431-AD6C-63BCD9F960E9.png) |
| Shudeng Small 正常 | [app-normal-light](../../../.scratch/test-evidence/issue26/final-attachments/3E7CE253-729F-4C9C-A691-F94B11D7B3B3.png) |
| Shudeng Small 深色 | [app-normal-dark](../../../.scratch/test-evidence/issue26/final-attachments/B43A28BC-1EE0-4CC4-9AE2-0F58942B88E1.png) |
| 书签过滤 | [app-bookmarks](../../../.scratch/test-evidence/issue26/final-attachments/4CDE6D95-43F2-4F8D-824B-2F3F0F7417EA.png) |
| 返回原文 | [app-original](../../../.scratch/test-evidence/issue26/final-attachments/B51DE865-C2A7-4D0A-AE86-C07B1F9A1672.png) |
| 空状态应用级 | [app-empty](../../../.scratch/test-evidence/issue26/final-attachments/E397BFD9-B0FC-4FDC-A57A-F4A7BEED801B.png) |

应用级截图已裁除 20pt 系统状态栏；固定尺寸图由真实 UIKit 页面控制器渲染，不是缩放截图。

## 数据与兼容性

1. `BookNote`、`Bookmark`、`Book` 和现有 `library.json` 编码结构未增加字段。
2. 新记录的显示时间写入独立 `record-timestamps.json`，键为记录类型、书 ID 和记录 ID；写入采用原子替换。
3. 编辑同一记录的草稿或正式内容只保留首次记录时间；既有记录没有旁路数据时显示“时间未记录”。
4. 侧路文件不可读时停止写入，笔记、草稿和书签本身不受影响。
5. 设计夹具原先让所有 EPUB 段落共用同一 CSS 锚点，引用返回无法唯一定位；已改为逐段唯一锚点，只影响 DEBUG 测试夹具。

## 允许差异与未验证边界

1. 390 × 844 是同一测试进程的内容尺寸，不是第二台模拟器或设备截图；系统状态栏不计入对照。
2. 固定夹具没有内嵌封面，分组标识使用书名首字与稳定底色；真实 EPUB 封面优先，缺失时仍有书目标识。
3. 导出入口及文案生成已实现，但本轮自动化未操作系统分享面板；本轮只证明入口存在且可执行路径已接入。
4. 历史用户记录没有保存时间，只能显示“时间未记录”；没有回填或伪造。
5. 本轮未重新验证真实 EPUB 内嵌封面、完整 VoiceOver 顺序、辅助字号下的全部笔记状态、真实 AI、完整旧测试集或整应用性能；这些留给 #32。
