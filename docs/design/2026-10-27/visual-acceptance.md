# 纸与灯视觉系统 · 实现验收记录（草稿）

状态：2026-10-27 实现完成后的第一轮验收记录，等待用户确认。截图来自固定设计夹具渲染与 UI 测试附件，不是真机实拍。

基准：`docs/design/2026-10-27/visual-system/visual-system.md`；实现证据：`docs/design/2026-10-27/implementation/`。

## 逐页结果

| 页面 | 375×667 浅 / 深 | 390×844 浅 | 结构对照 | 允许适配偏差 |
| --- | --- | --- | --- | --- |
| 书架 | 通过 | 通过 | 标题 / 搜索 / 实心导入 / 继续阅读卡 / 两列书格 / 底栏 56 | 无封面书籍显示字体书衣；SE 首屏第三本书只露顶部 |
| 笔记 | 通过 | 通过 | 标题 / 导出 / 搜索胶囊 / 四类筛选胶囊 / 按书分组 / 引用与笔记分层 | 空状态沿用旧插画结构 |
| 对话 | 通过 | 通过 | 标题 / 搜索 / 按书分组 / 宋体问题 / 两行摘要 / 元信息 | 无 |
| 我的 | 通过 | 通过 | 56pt 灯标 / 宋体字标 / 三行设置 / 版本脚注 | 无 |
| 阅读 | 通过 | 通过 | 顶栏 64 / 正文 18.5 / 行高 1.75 / 边距 28 / 底栏 76 / 提问胶囊 | 章节标题字号由 Readium 与真实 EPUB 决定，用 `typeScale: 1` 收敛 |
| 问答面板 | 通过 | 通过 | 圆角 22 / 灯标头 / 气泡 / 选文附件 / 依据卡 / 输入区 | 夹具中独立渲染，未叠加阅读背景 |
| 引用返回 | 通过 | — | 返回问答 + 原文高亮 + 引用装饰 | 无 |
| AI 设置 | 通过（UI 测试截图） | — | 纸白表单 / lampInk 操作 / error 删除 | 使用系统表单与 iOS 26 导航胶囊，未改为自定义页头 |

## 通用检查

- 颜色：使用 `BookDesign` 新令牌；页面内无硬编码色值（旧页面残留的 `BookDesign.secondary` 等别名指向新令牌）。
- 字号：根页面标题宋体 30；书名宋体 22/20/19；正文 15/12.5/13；元信息 10.5/10。
- 圆角：书封 4、输入与胶囊 10/胶囊、卡片 14、面板 22。
- 底栏：56pt、选中填充图标、无顶部小横条。
- 应用图标：A 方案（纸底 + 暖灯色灯泡 + 墨色灯座 + 暖光灯晕）。
- DesignFixtureTests 21 项通过（两尺寸 × 浅深色渲染、可访问性字号、引用返回、问答面板状态、分组与搜索）。
- `AISettingsUITests/testVisibleLabelsPresetAndConsentCancellation` 通过。

## 未验证 / 待确认

1. 真机、320pt 宽度、横屏与最低系统版本未验证。
2. VoiceOver 运行顺序、Reduce Motion 运行表现未验收（仅代码核对）。
3. Dynamic Type 仅覆盖现有可访问性字号用例，未逐页量取 XXXL 布局。
4. 完整 UI 测试套件未重跑；全量单元测试中需要本地 HTTP fixture 的用例与 Semantic 内存预算用例失败（与 UI 改动无关，见实现 README）。
5. 视觉验收需用户确认后关闭 #49。

## 第二轮反馈（2026-10-27）

| 反馈 | 处理 | 证据 |
| --- | --- | --- |
| 问答抽屉只有半屏，希望上拉全屏 | 增加 `.large()` detent + 内容滚动扩展 | 代码与标准 sheet API；未做真机手势验收 |
| 系统弹层太素 | 新增 `BookAlertController`，替换 34 处系统弹层 | `implementation/dialog-action-sheet-375-light/dark.png`、`dialog-alert-375-light/dark.png` |
| 笔记/对话展开无动画 | 箭头 200ms 旋转 + 行 fade；减少动态效果时关闭 | 代码；需真机确认观感 |
| 笔记/对话列表不好看 | 类型胶囊、层级、右箭头、按压反馈 | `implementation/notes-375-*.png`、`conversations-375-*.png` |

新增 `DesignFixtureTests/testPaperDialogsRenderBothThemes`；4 个目标 UI 测试（书架、笔记、对话、我的/外观弹层）全部通过。

## 第三轮反馈（2026-10-27）

| 反馈 | 处理 | 证据 |
| --- | --- | --- |
| 笔记/对话历史参考 DSH 工作区 | 分组头改封面 + 书名 + 数量胶囊 + 箭头；粘性组头；行右侧时间与按压反馈；展开动画保留 | `implementation/notes-375-*.png`、`conversations-375-*.png` |
| 外观弹层出现 2 次 | 去掉叠加动画 + `presentedViewController` 守卫，只保留一次淡入 | 代码；`testIssue28ProfileBrandSettingsAndAbout` 通过 |
| 我的页面丑 | 品牌与统计合并 hero 卡片 + 两张设置卡片 + 关于卡片 + 版本脚注 | `implementation/profile-375-*.png` |
| AI 设置丑 | 卡片化 insetGrouped + 纸白令牌 + 当前服务高亮 + 说明脚注 | `implementation/ai-services-375.png`、`ai-editor-375.png` |

验证：`DesignFixtureTests` 22 项全部通过（另加 profile 定向用例）；`testIssue26NotesFiltersVisualAndReturnToOriginal`、`testIssue27ConversationsSearchOpenAndStates`、`testIssue28ProfileBrandSettingsAndAbout`、`AISettingsUITests/testVisibleLabelsPresetAndConsentCancellation` 全部通过。

## 第四轮：系统列表组件迁移（2026-10-27）

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 笔记：系统大标题 + stacked 搜索 + 分段筛选 + collection 分组卡片 + outlineDisclosure 折叠 | 通过 | `implementation/notes-375-light/dark.png`、`notes-390-light.png` |
| 对话历史：系统大标题 + 搜索 + collection 分组卡片 + 系统 disclosure + swipe actions | 通过 | `implementation/conversations-375-light/dark.png`、`conversations-390-light.png` |
| 空状态：iOS 17+ 系统 content-unavailable（iOS 16 回退旧视图，未运行验证） | 通过（iOS 26.5） | UI 测试 issue26/27 |
| 书架搜索：系统 UISearchBar（取消/回车/防抖） | 通过 | 单测 22/22 + issue26 |
| AI 设置：dequeue + UIListContentConfiguration + checkmark accessory | 通过 | 单测 22/22 + AISettings UI 测试 |
| 进度条（UIProgressView）与“我的”卡片深色描边 | 通过 | 单测 22/22 + issue28 |

验证：`DesignFixtureTests` 22/22；定向 UI 测试 4/4（issue26/27/28 + AISettings）；系统大标题空白风险已关闭（真实 App 层级与大标题文本正常）。未验证：真机、VoiceOver、Reduce Motion、iOS 16 空态回退分支。

## 第五轮：BUG 修复 + 第二轮组件化（2026-10-28）

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 对话页搜索取消后大标题消失（iOS 26 导航栏回归） | 已修复：全局 scrollEdge 透明 + 列表页 helper + `didDismissSearchController` 延迟两段式滚动 nudge；对话/笔记各 2 轮 inkRatio 断言绿 | `.scratch/impl/qa-final-evidence/`、`implementation/notes-*`、`implementation/conversations-*` |
| 我的 / 关于书灯 / 第三方许可 → 系统列表 | 通过（UICollectionView list + UIListContentConfiguration + 系统 accessory） | `implementation/profile-375-light/dark.png`、`profile-390-light.png`、`about-375-light.png` |
| BookSearch → 系统 searchController + content-unavailable | 通过 | 定向 UI / 编译验证 |
| 阅读设置 / 目录 / 书签 → 系统列表与令牌 | 通过（阅读覆盖控件未动） | `implementation/reader-settings-375-light.png` |
| Dynamic Type / CellRegistration / 无障碍 / DateFormatter 收尾 | 通过（22/22 + XXXL 无越界） | `implementation/notes-accessibility-xxxl-*.png` |

验证（最终构建 11:08，clean install）：DesignFixtureTests **22/22**；定向 UI **5/5**（issue26/27/28 + AISettings + 全局导航栏外观）；BUG 回归 **passed**。未验证：真机、VoiceOver、Reduce Motion、iOS 16–25 分支、iOS 16 空态回退。

## 第六轮：标注 IA 定稿（2026-10-28）

- 笔记页合并为单一「笔记」列表（高亮+笔记；书签移出），按书分组、组内按位置；行=颜色点+章节+日期+引文+正文细线（参考 ReadAny 书灯原型）。行点击回原文；左右滑编辑/删除。
- 阅读器目录面板恢复 目录/书签 两 tab；书签行显示章节+进度；丝带保留。
- 原文呈现：高亮=底色，笔记=波浪线（自定义 note-wave 模板）；点高亮=改色/写笔记/取消高亮；点波浪线=查看/编辑/删除笔记浮层（4 色下划线）。
- 验证：DesignFixtureTests 24/24；UI 8/8（笔记合并列表、滑删/编辑、阅读器两 tab、首屏丝带、高亮浮层、note-wave 浮层）。证据 `.scratch/impl/annotation-preview4/` 21 张。
- 未验证：波浪线样式像素级断言、高亮→写笔记后线条切换的自动化、深色阅读页波浪线对比度、iOS 16 空态 fallback。

## 第七轮：紧凑笔记弹层与转换禁令（2026-10-28）

- 笔记编辑器从整页表单改为 paper medium sheet：关闭 / 笔记 / 保存笔记，引用原文 ≤2 行，正文内联，草稿状态；键盘自动升 large。
- 高亮浮层移除“写笔记”转换入口，只剩 4 色 + 取消高亮；空正文不可保存（阻止笔记变高亮）。
- 验证：DesignFixtureTests 24/24；UI 9/9（含紧凑弹层 61.8s、高亮浮层无写笔记 35.2s）。证据 `.scratch/impl/annotation-preview5/`。
- 未验证：iOS 16 detents、legacy 用例（保存草稿/返回原文）已失效、深色弹层对比度。

## 第八轮：交互简化（2026-10-28）

- 去草稿（无草稿文案/恢复/自动保存）；编辑器自定义底部卡片，键盘只上移+收窄、不自动升 large，用户可拖动展开到 92%。
- 取消高亮免确认、调色盘选色自动关闭、笔记详情引用浅灰底+正文普通文本、高亮↔笔记禁止隐式转换。
- 参考 Apple HIG：Sheets / Alerts / Modality（官方链接见 ADR-0016）。
- 验证：DesignFixtureTests 25/25（新增卡片键盘高度稳定性与几何断言）；UI 9/9。证据 `.scratch/impl/annotation-preview9/`。
- 未验证：iOS 16、真机键盘高度差异、UI 层键盘 frame 硬断言（单测已覆盖）。

## 第九轮：笔记/阅读器进一步简化（2026-10-28）

- 笔记去掉下划线颜色（固定暖灯波浪线；高亮保留 4 色）；点波浪线直接进编辑弹层，删除移至编辑器 header；列表笔记色点固定暖灯。
- 阅读器去掉进入书时的「正在打开…」状态条（错误/重试保留）；问问书灯按钮缩到 36pt、阴影减淡。
- 验证：DesignFixtureTests 26/26；UI 10/10；证据 `.scratch/impl/annotation-preview10/`。
- 未验证：错误状态条主动注入、iOS 16、XXXL 下删除/保存同排拥挤度。
