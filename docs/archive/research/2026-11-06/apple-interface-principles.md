# 书灯 Demo：从 Apple 设计原则重审界面

研究日期：2026-11-06。仅服务 `codex/ui-design-demo` 视觉实验，功能冻结，不调整产品范围。

范围说明：本文是最初的局部研究，不代表通读 HIG。后续完整主题阅读见 [覆盖记录](apple-hig-reading.md)；当前项目原则以[跨端界面设计规范](../../../design/ui-development-standard.md)为准。

本次核对 Apple 官方 HIG 的 Writing、Branding、Layout、Settings、Typography 正文，以及 WWDC26/WWDC25 官方视频文字稿。HIG 网页使用动态渲染，正文从 Apple 官方 DocC JSON 获取；没有把搜索摘要或本地技能转述当成唯一证据。没有声称完整观看视频。

## 结论与书灯的取舍

| Apple 的指导 | 对书灯当前问题的判断 | 本轮 Demo 应做什么 |
| --- | --- | --- |
| **每个元素要有用途；简单不等于极少。** WWDC26 11:13 明确说 “When we say simple, we don’t mean minimal”，还指出必要上下文可能需要增加信息。[1] | 把功能藏起来、把文字缩小，并不会自动改善体验；口号占了选择外观的空间，却没帮助选择。 | 删除无任务用途的句子；保留清楚的名称、选中状态、必要解释与操作反馈。 |
| **先清楚，再考虑俏皮。** Writing 要求逐字检查是否必要，用更少的词，并说设置标签本身不够时才添加解释。[2] | “让界面安静一点，让文字靠前一点”是设计说明，不是外观选项的说明。不是 Apple 禁止所有口号，而是这句话在此处没有任务价值。 | 删除该句，不换另一句文案填空。搜索框、按钮与设置采用直接名称。 |
| **内容优先，品牌克制。** Branding 明确建议品牌让位内容，避免反复展示 logo；颜色用于主要操作或状态。[3] | “书灯 · 设置”、品牌大区和阅读宣言重复提醒用户正在用哪个 App，延迟接触真实内容。 | 页面直接显示当前位置；品牌集中在图标、少量强调色与关于页，不占据每个首屏。 |
| **层级来自顺序、对齐、间距与对比。** Layout 要求重要内容靠前、相关内容分组，次要复杂度渐进展开。[4] | 截图中返回、面包屑、大标题、宣言、大预览形成五层前奏，真实选项被挤到屏幕底部。 | 外观选择放在首屏，预览缩小或放在选择之后；详情页只保留一套导航标题。 |
| **熟悉的模式和合理默认降低操作负担。** Settings 建议减少设置、遵守系统全局偏好；Typography 建议系统文字样式与稳定层级。[5][6] | 再增加主题、控件或装饰字体不能解决布局问题；把颜色铺满操作也会削弱重点。 | 不新增功能。设置用熟悉的列表、开关与选择标记；操作文案用系统字体，书内原文与封面承担阅读气质。 |

WWDC25 的演示先整理结构与导航，再处理内容与视觉；讲者明确发现，装饰性、无具体用途的元素妨碍关键功能被发现。设计品牌不只是加文字和颜色，而是让它们共同支持功能。[7]

## 各页的具体删减

| 页面 | 删除或收敛 | 保留 |
| --- | --- | --- |
| 书架 | “属于你的阅读时光”；与页面标题重复的“我的书籍”可收敛为数量与排序这一行。 | 书架标题、搜索、导入、封面、书名、作者、阅读进度。 |
| 笔记 | “留下值得再读的句子”；不另造阅读理念文案。 | 搜索、按书分组、原文、想法、位置与时间；长内容按需展开。 |
| 对话 | “每一次提问，都让阅读更深一点”；避免摘要、标题和数量重复表达同件事。 | 对话标题、必要摘要、日期、所属书籍与明确入口。 |
| 我的与设置 | “安放你的阅读习惯”“读懂书，也保留自己的判断”；我的页品牌大区；详情页重复的“书灯 · 设置”。 | 设置入口及当前值；关于页可以介绍书灯。 |
| 外观与问答 | 外观设计宣言与过大的摘录展示；问答中重复说明品牌和范围的文字。 | 外观选项及选中状态、小型真实预览；问题、回答、引用、输入及收起操作。 |

这些是书灯依据当前任务作出的设计选择，不是声称 Apple 规定了具体色值、圆角、必须删除某个标题，或禁止文学表达。书籍里的文学内容应该保留，操作界面的设计说明应回到开发文档。

## 不应因“简洁”而删掉的信息

模型配置和首次发送相关的数据去向、费用、必要授权仍需说清楚；联网开关的效果、失败后的修复办法、空状态下一步也有实际用途。[1][2] 本轮不修改这些业务机制，不以视觉实验冒充真实模型配置。

Demo 的示例数据标识集中在合适位置，不在每段回复和每个页面末尾重复。保留说明的目的，是防止误认真实数据，而不是占据首屏或给设计自我解释。

## 快速验收

1. 打开首屏就能辨认当前位置和主要操作，不需要先读宣传语。
2. 外观首屏能看到可选项和当前选中状态；预览不把选项推出首屏。
3. 删除文案后的空白通过调整布局处理，不再塞一句替代话。
4. 保留可理解的入口、44pt 左右触控目标、必要上下文与可读字号；不通过藏功能或缩小文字制造“极简”。
5. 实际模拟器看小屏首屏、长标题和滚动结果；静态截图不能证明手势、辅助功能或产品验收通过。

## Apple 一手资料

[1] [WWDC26 · Principles of great design](https://developer.apple.com/videos/play/wwdc2026/250/)：Purpose 1:08、Familiarity 6:04、Simplicity 11:13、Craft 13:42。

[2] [HIG · Writing](https://developer.apple.com/design/human-interface-guidelines/writing)：Getting started / Be clear；Best practices / Consider each screen’s purpose、Be action oriented、Keep settings labels clear and simple。

[3] [HIG · Branding](https://developer.apple.com/design/human-interface-guidelines/branding)：Ensure branding always defers to content、Apply your app’s accent color judiciously、Resist the temptation to display your logo throughout your app。

[4] [HIG · Layout](https://developer.apple.com/design/human-interface-guidelines/layout)：Visual hierarchy、Adaptability、Guides and safe areas。

[5] [HIG · Settings](https://developer.apple.com/design/human-interface-guidelines/settings)：Best practices、General settings、Task-specific options。

[6] [HIG · Typography](https://developer.apple.com/design/human-interface-guidelines/typography)：Conveying hierarchy、Using system fonts、Supporting Dynamic Type。

[7] [WWDC25 · Design foundations from idea to interface](https://developer.apple.com/videos/play/wwdc2025/359/)：Structure 1:11、Navigation 4:55、Content 8:19、Visual Design 13:28。
