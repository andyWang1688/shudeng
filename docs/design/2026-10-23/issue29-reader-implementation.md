# Issue #29：阅读页与选文视觉闭环实施记录

状态：2026-10-24，独立验收提出的菜单遮挡与引用按钮契约问题已修复，等待复审。本记录不自行关闭 Issue，也不把其他页面并入阅读页结论。

基准：[高保真原型](standalone.html)、[设计规格](spec.md)、[UIKit 界面开发规范](../ui-development-standard.md)。执行单：[GitHub Issue #29](https://github.com/andyWang1688/shudeng/issues/29)。

## 实现结果

- 阅读页改为 51pt 自定义顶栏：左侧返回入口，中间书名与章节两行标题，右侧目录和阅读设置两个独立 44pt 入口；不再使用原系统的“书架 + 标题 + 设置 + 隐藏工具栏”混排。
- 返回入口固定为 44 × 44pt 触控区；引用查看状态仍保留“返回问答”与原标识，供后续引用往返复用。
- 正文使用 Songti SC，100% 字号对应 20pt；行高 1.95、左右 29pt、两端对齐，段落缩进与段距按设计基准。用户原有字号、滚动、分页、仿真翻页和阅读位置保存链路保持不变。
- 选文底色使用暖灯纸色：浅色 `#F4E3AC`、深色 `#5B4D2D`；已保存高亮也改用同一组语义色，不再使用系统黄色。
- 底栏改为 66pt 平直区域：居中“问问书灯”胶囊、左侧真实阅读进度、右侧章节。胶囊高度 44pt、圆角 24pt，保持独立按钮形态。
- 阅读加载、定位和保存状态移入底部状态面板；正常状态不显示成功提示。失败时保留原因与重试入口，不改变原保存和返回确认逻辑。
- 选中文字后显示自定义深色菜单“高亮 / 笔记 / 提问”，替代默认系统菜单，避免复制、查询等系统项挤压三个核心操作。菜单有 44pt 外侧留白、可聚焦按钮与明确的稳定标识。
- 选区菜单会用完整 Range 边界重新定位；上方空间不足时放到选区下方并隐藏指针，避免盖住当前选区。
- 长按释放产生的尾随 tap 有 450ms 保护窗口，避免菜单刚出现就被同一次手势关闭。点击页面空白会收起菜单并清除选区。
- 点击正文中部仍可隐藏或恢复两侧工具栏；51pt 高度始终保留，避免控件显隐造成重新分页或正文跳动。
- 设计夹具的深色主题现在同时应用到阅读设置，避免根窗口深色但阅读器仍强制浅色。

## 证据

最终结果：[fix-final3.xcresult](../../../.scratch/test-evidence/issue29/fix-final3.xcresult)，6 tests / 0 failures；设备为 Shudeng Small（iPhone SE 3，iOS 26.5）。

- `DesignFixtureTests/testReaderUsesDesignedTypographyMarginsAndWarmSelection`：验证宋体、20pt 基准换算、1.95 行高、29pt 边距、两端对齐和浅深色选文令牌。
- `DesignFixtureTests/testReaderChromeMatchesDesignedMetrics`：验证 51pt 顶栏、左右 13pt 边距、44pt 返回/目录/设置、底栏胶囊居中，以及完整多行选区下菜单不与选区相交。
- `DesignFixtureTests/testReaderRendersBothContentSizesAndThemes`：用真实 Readium 页面在 375 × 667 和 390 × 844、浅色和深色下等待正文加载后截图，并验证顶栏与胶囊尺寸。
- `QuestionPresentationTests`：4 项保存、引用往返、连续引用和加载失败退出回归均通过；返回按钮通过公开 `accessibilityLabel` 暴露“返回问答”。
- `ReadingUITests/testIssue29ReaderToolbarSelectionAndAskEntry`：实际打开书、添加书签、依次切换滚动/仿真/分页、长按无预置高亮段落、验证菜单不遮挡选区、进入笔记并返回；重启后复查暗色选文。

截图由 [final-placement-attachments](../../../.scratch/test-evidence/issue29/final-placement-attachments/manifest.json) 导出：

| 状态 | 证据 |
| --- | --- |
| 375 × 667 浅色 | [reader-375x667-light](../../../.scratch/test-evidence/issue29/final-placement-attachments/EC9FB09B-C0A5-4FC1-90C1-9B9D30918707.png) |
| 375 × 667 深色 | [reader-375x667-dark](../../../.scratch/test-evidence/issue29/final-placement-attachments/F833AE17-293E-4F2C-9B33-64165AB94BCB.png) |
| 390 × 844 浅色 | [reader-390x844-light](../../../.scratch/test-evidence/issue29/final-placement-attachments/28D4FCD9-1908-496A-A499-E227CBA1BF2E.png) |
| 390 × 844 深色 | [reader-390x844-dark](../../../.scratch/test-evidence/issue29/final-placement-attachments/D343C20B-B0FB-4C15-8B2C-400FFCAAAF29.png) |
| Shudeng Small 阅读页 | [reader-375-light](../../../.scratch/test-evidence/issue29/final-placement-attachments/ED00B898-0D72-4CC1-ABB2-E34A0FF0DE6D.png) |
| Shudeng Small 选文浅色 | [selection-375-light](../../../.scratch/test-evidence/issue29/fix-ui5-attachments/A80CA760-1AD4-4F19-A439-E22F3013AE22.png) |
| Shudeng Small 选文深色 | [selection-375-dark](../../../.scratch/test-evidence/issue29/fix-ui5-attachments/BFCFFAF5-B63E-48C0-A743-9D7DC8882B6A.png) |

应用级截图按 point 裁除 20pt 系统状态栏。390 × 844 是同一模拟器进程内的固定内容尺寸渲染，不创建第二台设备。

## 独立验收修复

1. 原实现先按 `Selection.frame` 显示菜单，再用异步完整选区移动，截图会捕获菜单压住原文的中间态。现改为先取得完整 Range 的所有 `getClientRects()` 并求并集，再一次性显示菜单。
2. 菜单位置使用整体选区矩形，优先放在上方；上方不足时放在下方；不得以单行矩形替代多行选区。新增非相交断言。
3. 引用返回按钮已使用公开可访问标题“返回问答”；旧测试读取 `title(for:)` 得到 nil，现改为断言 `accessibilityLabel`，不依赖按钮内部配置形式。
4. 应用级用例新增书签保存和滚动/仿真/分页实际切换，补上本票缺失的阅读模式回归证据。

## 数据与兼容性

1. 本轮只修改 UIKit 阅读展示层及测试夹具，不修改 `Book`、`ReadingSettings`、笔记、书签、对话、检索或 AI 请求的编码结构。
2. 阅读位置、滚动/分页/仿真模式、目录、书签、字号和主题设置继续使用既有 `LibraryStore` 保存路径。
3. 选区菜单直接复用原有高亮、笔记与提问处理；没有新增数据记录类型，也没有改变选文定位或问题材料生成方式。
4. 测试只使用 `DesignFixture` 临时书库和内存密钥，不读取真实 Key、不发送真实 AI 请求、不操作用户书库。
5. Release 生产路径不启用设计夹具；本轮没有创建新模拟器、卸载主 App、清除用户数据或发布新版本。

## 允许差异与未验证边界

1. 设计示例显示 12% 和固定的红楼梦正文；夹具的阅读位置会随实际 locator 和页面高度变化，截图中的百分比与可见段落属于真实内容差异。
2. 390 × 844 使用固定内容尺寸的 UIKit/Readium 渲染；375 × 667 的交互与选文使用唯一 Shudeng Small 模拟器。
3. 字体大小以 Readium CJK 基线换算为 100% = 20pt；实际书籍的内嵌标题、图片和特殊排版仍可能造成自然高度变化。
4. 自定义选区菜单只保留“高亮 / 笔记 / 提问”，不包含系统复制、查询、翻译或分享动作；这是当前确认稿的信息层级。
5. 本轮未重新运行完整旧测试集，也未验证所有 Dynamic Type 辅助字号组合、完整 VoiceOver 顺序、真机性能、真实 AI 回答质量或商店分发。
