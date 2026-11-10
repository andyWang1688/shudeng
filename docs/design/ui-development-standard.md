# 书灯跨端界面设计规范

状态：2026-11-06 采纳；用户明确以 Apple 设计理念为依据，并要求面向未来多端。采纳背景见 [ADR-0020](../adr/0020-cross-platform-design-principles.md)。

本文是书灯界面设计、组件实现与视觉评审的统一入口，适用于当前及未来纳入范围的客户端。Apple HIG 是主要设计依据；下文的跨端规则是书灯的产品决定，Apple 专属规则按平台使用。阅读研究及逐篇来源见 [HIG 完整阅读记录](../archive/research/2026-11-06/apple-hig-reading.md)。

## 使用顺序与边界

1. 明确本次页面任务、目标平台、可用窗口和输入方式，沿用 [领域术语](../../GLOSSARY.md)与已接受的业务决策。
2. 用本文的跨端原则确定信息层级、状态和操作后果，再核对目标平台的官方指南。
3. 优先组合系统或成熟组件；用独立视觉 Demo 验证布局与交互，记录用户确认的版本作为该平台设计基准。
4. 定稿后接入真实业务，并按本文末尾的验收范围收集证据；明确标注尚未验证的项目。

用户已确认独立 Demo 的整体视觉方向。设计基准保存在提交 `d663a77`，当前进入真实业务接线与验证；2026-11-07 批准的[书内标注决定](../adr/0021-book-owned-annotations.md)取代基准中的独立笔记栏目，其他功能范围继续冻结。[Demo 说明](../../apps/mobile/src/ui/visual-demo/README.md)记录历史边界。确认基准不表示产品已验收或发布。平台适配不自动改变业务协议、存储语义或产品范围。共享应用层继续遵循 [RN 架构决策](../adr/0019-react-native-langchain-architecture.md)。

## 交付用语

这些词用于设计与开发协作，放在本规范中解释；根 GLOSSARY 只维护书灯领域概念。

| 用语         | 定义与执行边界                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 设计基准稿   | 用户确认、用于对齐目标平台视觉与交互的高保真原型；不是仅供取灵感的参考图。实现偏离基准时说明原因并处理设计变更，未确认的 Demo 不自动成为基准。 |
| 视觉验收     | 按基准检查布局、组件、样式与状态，并保留同尺寸证据；功能可用不表示视觉通过，截图也不证明手势和辅助技术。                                       |
| 允许适配偏差 | 真实内容、目标端文字缩放、安全区、键盘或系统界面导致的局部变化；每项记录原因及实际结果，不能把自由改稿称为适配。                               |

## 一、内容和当前任务优先

读者进入页面应能看懂当前位置、主要内容和下一步操作。书封、原文、个人笔记、问题与回答构成内容；页面名称、控件和反馈帮助完成任务。通过顺序、对齐、间距和文字层级组织它们，再决定是否需要卡片、边框或底色。

- 每个可见元素应服务内容、操作、状态或必要解释。移除重复标题、重复品牌与无助于当前任务的口号；不用另一句装饰文案填回空白。
- 简洁保留必要信息。常用操作与关键状态保持可发现，低频选项、技术细节和长说明按需展开；不能用缩小字号、裁掉标签或藏起必要操作换取整齐。
- 文案直接说明对象、动作、结果或修复方法，沿用领域用语。输入提示帮助提问或填写；多个字段容易混淆时提供持续可见的标签。书内原文与引用不因界面精简而改写。
- 品牌通过书籍内容、排版比例、图标与少量强调色表达。具体色板、字体和圆角经 Demo 验证后确定，不从 Apple 示例或历史稿推导一套固定全端数值。

依据：[Design principles — Purpose / Simplicity / Delight](https://developer.apple.com/design/human-interface-guidelines/design-principles)、[Layout](https://developer.apple.com/design/human-interface-guidelines/layout)、[Writing](https://developer.apple.com/design/human-interface-guidelines/writing)、[Branding](https://developer.apple.com/design/human-interface-guidelines/branding)。

## 二、读者掌控操作，界面保护上下文

返回、收起、关闭、取消执行和删除有各自的含义。界面应让后果清楚、恢复容易；重要而不可恢复的后果需要相应确认，普通可撤销操作优先提供恢复路径，避免无价值中断。

- 导航、窗口尺寸、横竖屏或输入方式变化时，按任务保存规则保留当前书、阅读锚点、选择、搜索条件、滚动位置与输入。笔记关闭丢弃未保存内容的明确例外继续按 [ADR-0016](../adr/0016-annotations-information-architecture.md)执行；布局适配不等于跨设备云同步。
- 阅读内问答继续保留弹层与上拉进入全屏专注模式的产品行为；收起或关闭不等于停止生成。切换高度不重建对话或丢失草稿，返回阅读保留位置。其他平台如何承载该任务按空间和本地惯例设计。
- 加载、空结果、错误、未完成、保存失败和已有离线限制应有可理解的状态与下一步。实际可测量才显示百分比；AI 生成不伪造完成进度。发生错误时保留已有工作。
- AI 内容、书内依据与外部来源保持可辨，引用支持原有核查路径。数据去向、费用和权限在做决定的合适位置说明；AI 服务发送说明仍按 [ADR-0012](../adr/0012-confirm-ai-send-scope-on-setup.md)在保存或更换服务时确认。

依据：[Design principles — Agency / Responsibility](https://developer.apple.com/design/human-interface-guidelines/design-principles)、[Modality](https://developer.apple.com/design/human-interface-guidelines/modality)、[Undo and redo](https://developer.apple.com/design/human-interface-guidelines/undo-and-redo)、[Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators)、[Generative AI](https://developer.apple.com/design/human-interface-guidelines/generative-ai)、[Privacy](https://developer.apple.com/design/human-interface-guidelines/privacy)。

## 三、跨端统一语义，每端遵循本地习惯

各端统一的是书籍、笔记、对话等概念，操作结果、状态含义及内容优先级。在同一端，同类页面的搜索、选择、返回、反馈和动效应一致。导航容器、密度和输入方式根据平台调整。

| 层级       | 书灯的规则                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| 产品语义   | 同一动作有相同名称与后果；相同保存模型和业务边界不随视觉主题变化。                                                         |
| 视觉语言   | 共享文字层级、颜色用途、空间节奏、图标语义与状态表达；各端映射为合适的字体、尺寸、资源和材质。                             |
| 导航与容器 | 主要目的地为书架、对话、我的；标注归属于当前书，书内弹层与书架快捷入口共用列表。窄窗口可使用逐层导航和底部弹层；宽窗口可评估侧栏、分栏与面板，具体形式另做基准。 |
| 输入与反馈 | 触控照顾可达性和命中区，键盘提供完整操作与可见焦点，指针支持熟悉的选择和上下文操作；关键动作有复杂手势之外的入口。         |

下表是后续进入对应端时的适配路线，不是已经完成或承诺发布的平台清单：

| 目标端         | 适配依据与需单独决定的内容                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| iOS / iPadOS   | [Apple HIG](https://developer.apple.com/design/human-interface-guidelines)：系统导航、安全区、文字缩放、触控、键盘与指针；平板和分屏依据实际可用空间设计。                                                                           |
| macOS          | [Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos)：窗口、菜单、快捷键、焦点和信息密度。支持的输入按硬件核对；不能假设所有 Mac 有触屏，也不能把 Dynamic Type 当作 macOS 能力。 |
| Android        | 开工时核对 [Android 官方设计指南](https://developer.android.com/design)与 [Material Design](https://m3.material.io/)：系统返回、系统栏、窗口、字体缩放和触控。Apple 的按钮顺序、pt 尺寸与材质不作为此端标准。                        |
| Web            | 开工时核对 Web 标准、浏览器导航、语义结构、键盘焦点、缩放与 [WCAG](https://www.w3.org/TR/WCAG22/)，并按采用的要求实际验证。                                                                                                          |
| 其他桌面或设备 | 明确目标平台后读取其官方规范，评审窗口、菜单、文件交互、辅助技术及输入。未纳入范围的平台与能力保持条件参考。                                                                                                                         |

这套跨端适配路线是书灯的决定，HIG 没有替 Android、Web 或 Windows 定义交互规范。示例：手机里拖动问答层进入专注模式的任务，可在桌面提供显式展开操作；这需要保持对话与原文关联，不要求复制手指拖动轨迹。

依据：[Design principles — Familiarity / Flexibility](https://developer.apple.com/design/human-interface-guidelines/design-principles)、[Designing for iOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ios)、[Designing for iPadOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ipados)、[Split views](https://developer.apple.com/design/human-interface-guidelines/split-views)。

## 四、可读、可操作和自适应是基础

布局按可用空间和内容变化，字体按语义角色变化。阅读正文尊重读者设置，操作界面采用目标端适宜的字体与层级；二者可以有不同排版，但引用来源和个人文字应容易区分。

- 用长书名、长中文标签、长回答、窄窗口与大字体检查重排。允许容器增高、换行、减少列数或更换导航形式；安全区和键盘不得遮住正在输入的内容与必要操作。
- 为有意义的内容与控件提供可访问名称、角色、状态和阅读顺序；装饰元素不增加朗读负担。重要信息同时用文字、形状或其他可感知方式表达，不能只靠颜色、音效、悬停或动效。
- 颜色采用背景、表面、主次文字、边界、强调、选中和错误等语义角色。具体值按各端外观、高对比与实际背景验证，允许映射系统语义色；数值与单位留在对应端规格中。
- 图标保持含义与视觉重量一致，资源按平台规则和许可提供。SF Symbols、Apple 字体与 Liquid Glass 属于平台资源或能力，不作为全端资产或强制风格；正文的可读性优先。

依据：[Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)、[Typography](https://developer.apple.com/design/human-interface-guidelines/typography)、[Color](https://developer.apple.com/design/human-interface-guidelines/color)、[Materials](https://developer.apple.com/design/human-interface-guidelines/materials)、[Icons](https://developer.apple.com/design/human-interface-guidelines/icons)。

## 五、用成熟组件完成细节，通过原型验证

优先复用平台系统、框架或持续维护的组件已有的导航、列表、搜索、选择、弹层、键盘协作和辅助技术能力。先确认其能力适配任务，再做有限样式与业务组合；框架选择遵守现有架构 ADR，HIG 本身不要求改用 UIKit 或 SwiftUI。

- 共享组件围绕稳定语义与真实重复需求抽取，页面负责组合与连接业务；平台差异封装在适配层。需要本地交互时允许平台实现，不为代码复用强求各端同一组件树。
- 动效说明进入、离开、层级或状态变化；连续拖动、松手吸附与形状变化应连贯、可中断，遵守减少动态效果等偏好。优先使用组件提供的交互与动画机制。
- 快速视觉 Demo 使用独立入口和示例数据，保留代表性的长短内容、空结果、选中与输入状态；不要为了评审外观先接完整 AI 或重复构建原生依赖。
- 经确认的 Demo 形成目标端设计基准，业务接入后再复核真实状态。视觉稿中出现的按钮与状态必须最终对应真实行为，不能把占位交互当成功能完成。

依据：[Design principles — Craft](https://developer.apple.com/design/human-interface-guidelines/design-principles)、[Motion](https://developer.apple.com/design/human-interface-guidelines/motion)、[Components](https://developer.apple.com/design/human-interface-guidelines/components)。组件与业务边界沿用 [ADR-0019](../adr/0019-react-native-langchain-architecture.md)，并保留 [ADR-0014](../adr/0014-system-list-components.md)优先复用成熟交互的意图。

## 验收与旧规范迁移

验收前写清目标端、系统版本、窗口、主题、字号与输入方式。每个被修改的页面分别记录设计对照、实际操作结果和未验证项；本轮研究不构成产品验收。

| 检查面         | 可核查的结果                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------ |
| 任务与信息层级 | 能辨认当前任务与主要操作；装饰不挤占内容，必要说明和入口可发现。                                 |
| 视觉与自适应   | 与该端已确认基准对照；代表性窄/宽窗口、长内容、大字体及支持的外观下可读，无关键裁切或遮挡。      |
| 交互与状态     | 返回、弹层、输入、搜索及相关加载/空/失败/中断路径可实际完成，并保留需要的上下文。                |
| 可访问性与输入 | 在目标端实际检查文字缩放、对比、读屏顺序、焦点、所支持输入及减少动态效果；截图不能证明这些行为。 |
| 证据与范围     | 保留必要截图或操作记录；区分示例 Demo、静态检查、运行验收与已发布行为，未测项目明确写未验证。    |

本文整体替代本路径原有的 UIKit 界面开发规范。旧版强制品牌行与口号、自定义导航/底栏、继续阅读卡片、固定全端色字尺寸、禁用系统语义色及仅允许 UIKit 等要求不再执行。其历史正文可通过 Git 查阅，旧设计稿和发布验收仍只说明当时版本。

现有业务决策、原文锚点、可靠保存与问答生命周期继续有效；各端具体页面结构和像素值以随后确认的设计基准为准。原则允许评估替代方案，不意味着任何尚未确认的 Demo 已成为正式产品设计。
