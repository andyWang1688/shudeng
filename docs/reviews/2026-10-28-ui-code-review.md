# UI 层独立代码审查（2026-10-28）

由独立「代码审查组」（干净上下文、只读）对 `ios/Shudeng/Sources` 与未提交 diff 做审查，Lead 统筹修复。

## A. BUG 根因

对话页搜索取消后大标题消失：iOS 26 自定义不透明导航栏外观 + 大标题/搜索状态切换导致大标题未绘制；后续滚动一次可恢复（scroll-edge 进度/alpha 未复位）。修复见 [ADR-0015](../adr/0015-ios26-navigation-bar-appearance.md)。

## B. 严重问题与处理状态

| 问题 | 处理 |
| --- | --- |
| 全局 `UINavigationBar.appearance()` 不透明背景是 BUG 根因 | 已修：iOS 26 下 scrollEdge 透明，列表页统一 helper（ADR-0015） |
| Dynamic Type 静态化（UIFontMetrics 一次性缩放；固定高度裁切） | 已修列表页：`registerForTraitChanges` 刷新可见 cell；固定高度仅保留图标 |
| `BookDesign.button` 字体被 configuration 覆盖 | 已修：`titleTextAttributesTransformer` |
| 书架搜索 refocus hack / header 复用 | 已修：系统 `UISearchBar` 收敛；常显取消按钮为系统语义 |
| 未复用 cell 残留（Reader 目录/书签、EvidenceController） | 已修：dequeue + `UIListContentConfiguration` |
| 重复代码/巨文件（Notes vs QuestionHistory 约 250 行） | 部分处理：导航栏外观与组头配置抽 helper；sections/查询去重因泛型风险跳过 |
| 强解包/废弃 API/死代码（`try!`、`traitCollectionDidChange`、accent/muted、BookElevation.card） | 已修：死代码删除、新代码改 `registerForTraitChanges`、DateFormatter 共享；Reader `try!` 留待后续 |
| 无障碍缺口（return 按钮、SkeletonView、AI 检查播报） | 部分修：return 按钮与 SkeletonView 已补；AI 播报待后续 |
| 全局导航栏外观与逐页覆盖两套逻辑 | 已统一（helper + 全局规则） |

## C. 剩余组件化建议（Top 5，下一轮候选）

1. 合并三份空状态为共享组件（iOS 17+ `UIContentUnavailableConfiguration`，iOS 16 回退）。
2. 书架页头继续收敛（搜索已系统化；页头仍为品牌结构）。
3. iOS 16 空态回退分支运行验证（当前仅编译）。
4. Reader 目录/书签列表改用 diffable + section snapshot（当前已系统 cell + content-unavailable，未用 section snapshot）。
5. `BookGroupListState` 等小型支持类归位；消除 Notes/QuestionHistory 剩余约 150 行重复。

## D. 明确不动

根导航/底栏（ADR-0010）、阅读覆盖控件（ADR-0013）、AI 问答面板（ADR-0014）、纸白弹层、书架品牌页头外观、Readium 正文渲染。
