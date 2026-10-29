# 纸与灯实现进度

2026-10-27 全部页面视觉替换完成（Issue #44–#48）。截图来自固定设计夹具渲染与 UI 测试附件，不是整机实拍。

| 文件 | 内容 |
| --- | --- |
| `shelf-375-light/dark.png`、`shelf-390-light.png` | 书架 |
| `profile-375-light/dark.png` | 我的 |
| `notes-375-light/dark.png` | 笔记 |
| `conversations-375-light/dark.png` | 对话 |
| `reader-375-light/dark.png`、`reader-390-light.png` | 阅读页 |
| `question-375-light/dark.png` | 问答面板 |
| `citation-375-light.png` | 引用返回阅读 |
| `ai-*.png` | AI 设置（UI 测试截图） |
| `dialog-action-sheet-375-*.png` | 纸白 actionSheet（外观选择）浅 / 深 |
| `dialog-alert-375-*.png` | 纸白 alert（删除确认）浅 / 深 |

## 已落地

- 颜色、9 档字号、间距、圆角、阴影令牌；底栏 56pt + 选中填充；书封字体书衣；应用图标 A 方案。
- 书架、我的、笔记、对话、阅读、问答面板、AI 设置全部按视觉系统替换；旧品牌行、解释句、系统蓝/红、9 档圆角不再出现。
- 保留 ADR-0013 覆盖式阅读控件与 200ms 显隐；阅读正文改 18.5pt / 行高 1.75 / 边距 28，章节标题通过 `typeScale: 1` 收敛。

## 验证

- `DesignFixtureTests` 21 项全部通过（两尺寸 × 浅深色渲染、可访问性字号、引用返回、问答面板状态）。
- `ShudengTests` 全量：118 项中 74 通过。失败集中在需要本地 HTTP fixture 的 AIService / Question HTTP 用例（network 错误）与 Semantic 内存预算用例（整包同进程 RSS 884MB > 629MB），与本次 UI 改动无关。
- 未跑：完整 UI 测试套件、真机、VoiceOver 运行验收、Reduce Motion 运行验收。

## 第二轮反馈（2026-10-27）

- 问答抽屉：初始 76%，可上拉展开全屏（`.large()` detent，内容滚动扩展）。
- 系统弹层全部替换为 `BookAlertController`（纸白卡片、宋体标题、实心主操作、错误色破坏性操作、可选输入框）。
- 笔记/对话分组：箭头 200ms 旋转 + 行 fade 展开收起；减少动态效果时直接切换。
- 列表：笔记增加类型胶囊、原文/笔记层级与回到原文；对话增加右侧箭头；按压用纸深色高亮。

## 第三轮反馈（2026-10-27）

- 笔记 / 对话：DSH 工作区式分组头（封面 + 书名 + 数量胶囊 + 箭头）、粘性分组、行右侧时间、紧凑两行、按压缩放；展开动画保留。
- 我的：品牌 + 统计 hero 卡片；设置与关于改为卡片；AI 服务行改为模型 + 右侧服务名。
- AI 设置：卡片化 insetGrouped + 纸白令牌 + 当前服务 `lampInk` 高亮。
- 外观弹层重复修复：只保留一次淡入 + 重复 presentedViewController 守卫。

## 未完成 / 风险

- 视觉验收矩阵与允许适配偏差尚未写入；由 #49 完成。
- 阅读章节标题字号依赖 Readium `typeScale`，真实 EPUB 的标题样式可能不同。
- 动画时长、面板进入动效沿用现有实现，未按新规范逐个复验。

## 系统列表组件迁移（2026-10-27 第四轮）

- 笔记 / 对话历史：改为 `UICollectionView` 列表（`.insetGrouped`）+ `UICollectionViewDiffableDataSource` + `NSDiffableDataSourceSectionSnapshot`；书籍分组头为首项 cell + `outlineDisclosure`；行用 `UICollectionViewListCell` + `UIListContentConfiguration`；系统大标题、系统搜索（stacked）、系统分段筛选、系统滑动操作；iOS 17+ 系统空状态（iOS 16 回退）。
- 书架：手工样式搜索字段改为系统 `UISearchBar`（取消/回车/180ms 防抖）；`ShelfProgressView` 改 `UIProgressView` 并补 accessibilityValue。
- AI 设置：复用 cell + `UIListContentConfiguration`，当前服务用系统 checkmark accessory。
- 我的：卡片描边改为 trait 感知，修复深色模式描边不更新。
- 允许适配偏差：分组头不粘性、类型胶囊改为文本元信息、分组计数不再胶囊化、搜索框高度由系统决定（见 ADR-0014）。

验证：`DesignFixtureTests` 22/22；定向 UI 测试 4/4（issue26 笔记、issue27 对话、issue28 我的、AISettings 可见标签与通过、AISettings 保存流程）；最新构建已安装到 Shudeng Small 并成功启动、无闪退。未验证：真机、VoiceOver、Reduce Motion、iOS 16 空态回退分支。

## 第五轮：BUG 修复与第二轮组件化（2026-10-28）

- 修复对话页搜索取消后大标题消失：iOS 26 导航栏外观回归（ADR-0015），全局 scrollEdge 透明 + 列表页外观 helper + 搜索取消后延迟两段式滚动 nudge；笔记页同步。
- 我的 / 关于 / 第三方许可 → 系统 collection list（品牌区自定义列首 cell + 设置/关于 insetGrouped 区 + UIListContentConfiguration + 系统 accessory）。
- BookSearch → `navigationItem.searchController` + 系统空状态；阅读设置 → 系统 insetGrouped 列表 + 分段控件/UIButton.Configuration；目录/书签 → 系统 cell + content-unavailable。
- 列表页最佳实践：CellRegistration、Dynamic Type trait 刷新、return 按钮无障碍、共享 DateFormatter、死代码清理。

验证（最终构建 11:08）：DesignFixtureTests 22/22；定向 UI 5/5；BUG 回归 passed；截图 19 张覆盖/新增（notes/conversations/profile/shelf/about/reader-settings/AI/XXXL）。未验证：真机、VoiceOver、Reduce Motion、iOS 16 分支。

## 第六轮：标注信息架构定稿（2026-10-28）

- 笔记页单一合并列表（高亮+笔记），无筛选、无书签；行=颜色点+章节+日期+引文+正文左细线；点击回原文，左滑编辑/右滑删除。
- 阅读器：目录/书签两 tab；书签行显示进度；高亮=底色、笔记=波浪线（自定义 note-wave 模板）；点击分流到高亮调色盘或笔记详情浮层。
- 决策：ADR-0016；术语：GLOSSARY.md 标注/高亮/笔记/笔记页/书签。
- 验证：24/24 单测、8/8 定向 UI；证据 `.scratch/impl/annotation-preview4/`。
