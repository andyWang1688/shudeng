---
status: accepted
date: 2026-10-27
supersedes: docs/design/ui-development-standard.md 中与系统列表组件冲突的条目
---

# 列表类页面优先使用系统组件

2026-10-27 用户反馈笔记与对话历史“交互还是不好看”，并明确要求“有现成组件就用，不要手搓”。决定：列表类页面改用 Apple 系统组件的组合，而不是继续维护自定义页头、筛选胶囊、分组头和表格行。

## 决定

笔记、对话历史（后续可推广到“我的 / 关于 / 许可”等列表页）：

- 列表：`UICollectionView` + `UICollectionViewCompositionalLayout.list(using: .insetGrouped)`，`headerMode = .firstItemInSection`。
- 分组：`UICollectionViewDiffableDataSource` + `NSDiffableDataSourceSectionSnapshot`，书籍分组头为首项 cell，`UICellAccessory.outlineDisclosure(style: .header)`；展开/收起、动画与无障碍语义由系统提供。
- 行：`UICollectionViewListCell` + `UIListContentConfiguration`（宋体引文/标题用 attributed text 保留品牌排版）；对话行使用系统 disclosure 指示器；笔记“回到原文”为系统 custom-view accessory。
- 交互：系统 `trailingSwipeActionsConfigurationProvider`（改名/删除）、`UISearchController`（`preferredSearchBarPlacement = .stacked`）、`UISegmentedControl`（笔记筛选）、系统大标题导航栏。
- 空状态：iOS 17+ `UIContentUnavailableConfiguration`；iOS 16 回退现有自定义空态视图。
- 保留内部接缝供测试：`toggleGroup(bookID:)`、`swipeActions(forConversationID:)`、`BookGroupListState` 的展开与滚动持久化。

## 代价与允许的适配偏差

- 分组头不再粘性；类型胶囊改为文本元信息；分组计数不再胶囊化；搜索框高度由系统决定——均记录为允许适配偏差。
- 视觉定制自由度下降，换来系统级交互、动画、Dynamic Type 与无障碍行为。
- 测试需按 collection view + diffable 结构改写（已完成）。

## 不变

数据、检索、AI 协议与保存模型；阅读器覆盖式控件（ADR-0013）；AI 问答面板；纸白/墨色令牌；自定义底栏（ADR-0010 仍约束根导航与底栏）；纸白弹层。
