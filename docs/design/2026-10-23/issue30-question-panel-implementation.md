# Issue #30：问答底部面板实施记录

状态：2026-10-24，独立验收发现的问题已修复，等待复审。本记录只覆盖阅读问答面板，不把引用原文视觉或整应用验收并入通过范围。

基准：[高保真原型](standalone.html)、[设计规格](spec.md)、[UIKit 界面开发规范](../ui-development-standard.md)。执行单：[GitHub Issue #30](https://github.com/andyWang1688/shudeng/issues/30)。

## 实现结果

- 阅读问答改为约 76% 屏高的自定义底部面板，23pt 顶部圆角、33 × 4pt 把手、灯泡品牌头“问问书灯”和 44pt 关闭入口；不再呈普通全屏导航页。
- 用户问题位于右侧浅纸色气泡，视觉不出现“你”；附带选文在气泡内可展开并保留原书宋体排版。
- AI 回答位于左侧，显示“书灯 · AI”；回答正文使用 15pt 系统字体，行内引用与来源卡归属回答。
- 来源卡显示序号、书名、章节和“查看原文，核对这段解释”，保留既有点击引用通路。
- 输入区固定在底部，使用 wash 底、16pt 圆角和 44pt 发送按钮；键盘出现时仍停留在可见区域。
- 草稿、多轮追问和附件展开继续使用现有 `QuestionStore`；关闭后重开同一问答保留草稿，新的选文仍走原新对话创建路径。
- 生成中显示同形骨架；连接失败和中断在 AI 一侧显示状态卡与“重试回答”入口。原保存失败重试、生成取消和关闭入口保留。

## 证据

最终结果：[fix-2.xcresult](../../../.scratch/test-evidence/issue30/fix-2.xcresult)，7 tests / 0 failures；设备为 Shudeng Small（iPhone SE 3，iOS 26.5）。

- `DesignFixtureTests/testQuestionSheetUsesDesignedPanelIdentityDraftAndStates`：验证把手、品牌头、关闭、用户/AI 身份、右侧气泡、固定输入区、正常/生成/失败/中断状态与两尺寸浅深色截图。
- `DesignFixtureTests/testQuestionSheetKeepsHeaderAndComposerAtAccessibilitySize`：XXXL 辅助字号下保留页头、关闭和输入区。
- `QuestionPresentationTests`：4 项已有保存、引用往返、连续引用和加载失败退出回归全部通过。
- `ReadingUITests/testIssue30QuestionSheetLayoutDraftAndIdentity`：真实打开底部面板，检查面板高度、身份、无“你”、收起后重开草稿，以及深浅色。

截图保存在本机 [修复后精选目录](../../../.scratch/test-evidence/issue30/curated-fix/)：

| 状态 | 证据 |
| --- | --- |
| 375 × 667 浅色 / 深色 | [浅色](../../../.scratch/test-evidence/issue30/curated-fix/question-375x667-light.png) / [深色](../../../.scratch/test-evidence/issue30/curated-fix/question-375x667-dark.png) |
| 390 × 844 浅色 / 深色 | [浅色](../../../.scratch/test-evidence/issue30/curated-fix/question-390x844-light.png) / [深色](../../../.scratch/test-evidence/issue30/curated-fix/question-390x844-dark.png) |
| 生成中 / 连接失败 / 回答中断 | [生成中](../../../.scratch/test-evidence/issue30/curated-fix/question-generating.png) / [连接失败](../../../.scratch/test-evidence/issue30/curated-fix/question-error.png) / [回答中断](../../../.scratch/test-evidence/issue30/curated-fix/question-interrupted.png) |
| Shudeng Small 浅色 / 深色 | [浅色](../../../.scratch/test-evidence/issue30/curated-fix/app-question-375-light.png) / [深色](../../../.scratch/test-evidence/issue30/curated-fix/app-question-375-dark.png) |
| XXXL 辅助字号 | [可滚动面板](../../../.scratch/test-evidence/issue30/curated-fix/question-accessibility-xxxl.png) |

## 独立验收修复

1. 正常完成态隐藏“回答已保存”成功状态条，只在生成、失败、中断或保存未完成时显示状态卡。
2. 移除独立“继续追问”按钮，追问直接使用固定输入区。
3. “查看本次实际发送材料”收进回答以下的次要“更多”菜单，不再占据回答尾部主操作。
4. 回答底部增加弱提示“解释供参考，可回原文核查”和 44pt 复制入口。
5. 应用级用例新增键盘出现时输入区不遮挡、正常态无成功条/重复追问、新选文使对话数增加 1 的断言。

应用级截图裁除 20pt 系统状态栏。390 × 844 为同一测试进程中的固定内容尺寸渲染，不新建模拟器。

## 数据与兼容性

1. 本轮只修改问答面板展示层及布局测试；未改变检索、AI 请求、取消、保存、草稿恢复或对话身份数据。
2. 关闭/重开、追问和附件状态继续由现有 `QuestionStore` 持久化。
3. 固定设计夹具只使用隔离临时书库和内存密钥；不读取真实 Key、不发送真实 AI 请求、不操作用户书库。
4. Release 生产路径不启用设计夹具；本轮没有创建新模拟器或发布新版本。

## 允许差异与未验证边界

1. 面板高度按屏高约 76% 计算，系统 sheet 的安全区和可用最大 detent 会造成少量实际像素差异。
2. 390 × 844 是内容尺寸截图，不包含另一台设备的状态栏差异。
3. 生成中/失败/中断使用固定夹具状态截图，不调用真实模型；真实网络错误文案和回答质量仍未验证。
4. 完整 VoiceOver 顺序、所有辅助字号组合、完整旧测试集、真机性能和商店分发未在本票重新验收。
