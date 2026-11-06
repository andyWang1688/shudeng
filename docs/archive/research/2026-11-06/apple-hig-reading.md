# Apple HIG 完整主题阅读与采纳记录

完成日期：2026-11-06（北京时间）。官方快照获取时间：`2026-11-06T03:05:21.798Z`。项目原则见[跨端界面设计规范](../../../design/ui-development-standard.md)，原因与取代范围见 [ADR-0020](../../../adr/0020-cross-platform-design-principles.md)。

## 范围与完成判定

本轮由主代理与五个阅读代理分组通读官方 HIG 当前主题树：**158 篇主题正文、15 个组织目录页，共 173 页；未读 0 页、重复 0 页**。逐篇采纳记录见下表，来源与快照摘要见 [机器可核查清单](apple-hig-sources.json)。不是声称主代理个人逐页阅读了全部内容。

完整阅读范围为官方 DocC 中的摘要、正文、各平台分页内容、列表、规格表、媒体替代文字/图注、资源及更新记录；组织页的介绍与主题入口也已核对。工具输出发生截断时，由负责代理补读。共读取 1,937,922 个 JavaScript 字符。抓取文件存在不等于已经读完，只有阅读完成并写出具体结论的页面才计入完成。

未逐一视觉检查原图或播放视频，也未通读所有外链 SDK、WWDC、设计资源与 Apple 的其他文档。这是 HIG 本次主题正文快照的完整阅读，不是所有 Apple 资料的通读；不构成 UI、可访问性、硬件、构建或功能验收。

## 来源与覆盖核对

官方入口为 [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines)，结构化正文来自 [Apple 官方 DocC](https://developer.apple.com/tutorials/data/design/human-interface-guidelines.json)及各主题 JSON。递归目录无缺页，提取器无未知节点类型；页面内锚点归入所属正文，未误计为新主题。715 个语言变体补丁均只修改 references，未发现额外正文变体。

正文中另有四个旧路径，网页核对均重定向到已覆盖的正式主题；旧路径的 JSON 404 不代表漏读新主题：

| 旧路径 | 已阅读的正式主题 |
| --- | --- |
| `spatial-interactions` | [Nearby interactions](https://developer.apple.com/design/human-interface-guidelines/nearby-interactions) |
| `components/system-experiences/complications` | [Complications](https://developer.apple.com/design/human-interface-guidelines/complications) |
| `components/presentation/page-controls` | [Page controls](https://developer.apple.com/design/human-interface-guidelines/page-controls) |
| `components/layout-and-organization/tab-views` | [Tab views](https://developer.apple.com/design/human-interface-guidelines/tab-views) |

快照清单保存每页官方 URL、DocC 对象与实际阅读文本的 SHA-256、负责分组和完成状态。为减少仓库冗余，不保留整套官方正文副本；摘要用于识别本次来源，重新获取时内容变化需重新评审。

## 采纳口径

| 类别 | 页数 | 含义 |
| --- | ---: | --- |
| 跨端采纳 | 57 | 书灯采纳其中的通用任务原则；该页 Apple 专属实现仍有平台范围。 |
| 平台适配 | 25 | 主要用于具体平台的交互、组件或输入适配，不转为全端固定形式。 |
| 条件参考 | 43 | 组织页或只有相关任务、平台、能力明确存在时才启用的指导。 |
| 当前范围外 | 48 | 已读但不引入该能力；通用启发也不扩展产品范围。 |

分类表示书灯本轮采纳的主要方式，不是 Apple 官方的平台支持声明。没有平台小节不证明支持、不适用或行为相同；建议、考虑、优先等措辞保留原有程度。Android、Web、Windows 等平台规则需另行核对，不能由 HIG 推定。

## 通读后的主要结论

Apple 当前 [Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles)包含 Purpose、Agency、Responsibility、Familiarity、Flexibility、Simplicity、Craft、Delight 八项，是帮助权衡的工具。书灯将其落实为内容与任务优先、读者掌控与可信反馈、跨端语义与本地习惯、可访问与自适应、成熟组件与原型迭代五组规则。简单保留必要信息，愉悦来自细节与可靠性，不靠反复口号或装饰。

全端共享业务概念、操作后果和视觉角色，具体窗口、导航、键盘、触控、尺寸与资源按端设计。Apple 系统材质、SF Symbols、pt 数值和 API 不作为 Android/Web 的强制标准；macOS 不套用 Dynamic Type 能力。广泛阅读支付、医疗、游戏、车载与系统扩展指南，不表示书灯要增加这些功能。

## 来源差异与保留疑点

1. [Mac Catalyst](https://developer.apple.com/design/human-interface-guidelines/mac-catalyst)的旧 iPad 菜单栏表述与较新 [Menus](https://developer.apple.com/design/human-interface-guidelines/menus)内容不同。按目标系统和较新官方文档核实，不用旧页推定当前能力。
2. [Designing for games](https://developer.apple.com/design/human-interface-guidelines/designing-for-games)按钮行文与尺寸表语境不同；[Complications — Inline](https://developer.apple.com/design/human-interface-guidelines/complications#Inline)的小型 Flat 41mm 表存在 pt/px 高度换算疑点。均不静默修正，不写入书灯全端令牌。
3. [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)与 [Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)对比度描述有不同用途与建议程度，不能用一项比值宣告全端合规；按实际元素、背景与采用标准测量。
4. [Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures)及 [Pointing devices](https://developer.apple.com/design/human-interface-guidelines/pointing-devices)含 2026-10-28 的 Mac 触摸适配更新，不意味着所有 Mac 有触屏。官方本次正文优先于安装技能旧快照。

## 逐篇阅读与适用边界

下列 173 页均已全文阅读，每行记录来源、书灯结论与平台限制；本表不是功能清单或实现验收。

### 总入口（1 页）

| 官方页面 | 采纳类别 | 书灯结论 | 适用边界 |
| --- | --- | --- | --- |
| [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines) | 条件参考 | 已完整核对本目录的简介、主题与关联入口，递归主题均纳入总清单。 | 这是组织页，不单独定义产品功能或平台能力；具体规则以主题正文与适用平台为准。 |

### 入门与平台（10 页）

| 官方页面 | 采纳类别 | 书灯结论 | 适用边界 |
| --- | --- | --- | --- |
| [Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles) | 跨端采纳 | 八项原则是权衡设计的工具；简洁保留必要信息，灵活性要求每个平台用心设计并保留上下文。 | Apple 面向其平台的哲学；书灯自行决定把其中的通用目标采纳为跨端原则，不能推导出其他平台控件规范。 |
| [Designing for iPhone Duo](https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo) | 条件参考 | 折叠与窗口尺寸变化时保持功能、状态和信息层级；使用自适应容器与安全区，避免随尺寸重造应用。 | 预留区域、侧置导航及特定 API 只适用于对应设备和系统；其他折叠设备另行核对。 |
| [Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos) | 平台适配 | 桌面任务依赖可调整窗口、菜单、快捷键及精确输入；信息密度随输入方式与可用空间调整。 | 菜单栏与窗口规则为 macOS 适配依据；Windows/Linux 需各自平台核对，不能直接放大手机界面。 |
| [Getting started](https://developer.apple.com/design/human-interface-guidelines/getting-started) | 条件参考 | 已完整核对本目录的简介、主题与关联入口，递归主题均纳入总清单。 | 这是组织页，不单独定义产品功能或平台能力；具体规则以主题正文与适用平台为准。 |
| [Designing for games](https://developer.apple.com/design/human-interface-guidelines/designing-for-games) | 当前范围外 | 已读游戏启动、显示、输入、包容性与技术集成；可参考及时开始任务、可读文本及输入替代，但不采用游戏能力。 | 游戏下载、Game Center、控制器和游戏尺寸表不成为书灯要求；本页按钮表与行文存在尺寸语境差异，不能据此规定全端数值。 |
| [Designing for iOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ios) | 平台适配 | 移动场景优先主要任务、可达控件，支持外观、方向和字体变化；次要操作保持可发现。 | 触控、系统手势、安全区和具体系统集成适用于 iOS，不能规定桌面端也使用相同导航。 |
| [Designing for iPadOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ipados) | 平台适配 | 利用可用空间并减少模态层级，照顾触控、键盘、指针及多任务窗口变化。 | Apple Pencil 与 iPadOS 多任务是条件能力，不由阅读本指南自动进入产品范围。 |
| [Designing for tvOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-tvos) | 当前范围外 | 远距观看、遥控器与焦点系统决定电视的信息密度和导航，不适宜直接复制手机操作。 | 书灯尚未规划电视端，不增加多用户媒体、Top Shelf 或遥控功能。 |
| [Designing for visionOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-visionos) | 当前范围外 | 空间体验优先舒适、安全、视野内内容和最小必要沉浸；标准窗口适合常规任务。 | 眼手输入、Shared/Full Space 和空间布局只作条件参考，不引入空间端。 |
| [Designing for watchOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-watchos) | 当前范围外 | 腕上体验需要短时、可瞥读、低层级交互，不能照搬完整手机阅读与问答。 | Digital Crown、表盘和复杂功能属于手表特定能力，未进入书灯范围。 |

### 基础设计（19 页）

| 官方页面 | 采纳类别 | 书灯结论 | 适用边界 |
| --- | --- | --- | --- |
| [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) | 跨端采纳 | 正文放大后重排，重要状态同时用文字或形状表达，核心手势有替代入口；避免来不及阅读的定时消息，支持对应平台的辅助输入。 | Apple 字号、控件 pt 表不是全端数值；VoiceOver、Full Keyboard Access、visionOS 指针按端适配，双重确认仅属于文中 Assistive Access 模式。 |
| [App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons) | 平台适配 | 图标用单一清晰概念保持小尺寸识别和跨端品牌一致，避免多余文字；Apple 端提供未裁切分层素材，让系统处理遮罩、光影和外观。 | Icon Composer、画布尺寸、遮罩及深色/透明/着色变体是 Apple 资产规则，Android/Web 按自身要求输出；不新增备用图标选择功能。 |
| [Color](https://developer.apple.com/design/human-interface-guidelines/color) | 跨端采纳 | 颜色按正文、辅助信息、交互、状态和层级赋予稳定语义，不单靠颜色区分重要状态；品牌色只强调少量主要操作，在真实背景和外观偏好下检查可读性。 | Apple 动态色 API、Mac 强调色、Liquid Glass 及 RGB 表属于平台映射，不硬编码为全端色值；TV/空间/Watch 补充只在对应目标适用。 |
| [Foundations](https://developer.apple.com/design/human-interface-guidelines/foundations) | 条件参考 | 已完整核对本目录的简介、主题与关联入口，递归主题均纳入总清单。 | 这是组织页，不单独定义产品功能或平台能力；具体规则以主题正文与适用平台为准。 |
| [Layout](https://developer.apple.com/design/human-interface-guidelines/layout) | 跨端采纳 | 用阅读顺序、对齐、分组与渐进披露表达层级，按实际可用空间和文本大小重排；调整窗口时保留任务、内容与选择，必要操作始终可达。 | Size Class、安全区 API、Mac 窗底风险、TV 过扫描和眼动间距分别适配；不能把 Apple 设备名、横竖屏或数字表当成跨端断点。 |
| [Materials](https://developer.apple.com/design/human-interface-guidelines/materials) | 平台适配 | 材质用于区分内容与功能层并保护可读性；Apple Liquid Glass 主要用于导航和关键控件，不铺满正文或内容卡片，文字密集时优先常规变体。 | Liquid Glass、vibrancy 和材质变体属于 Apple 表达，不要求 Android/Web 复制；clear 的 35% 遮暗仅是明亮媒体背景下的条件建议。 |
| [Typography](https://developer.apple.com/design/human-interface-guidelines/typography) | 跨端采纳 | 按标题、正文和辅助信息建立语义层级，持续阅读使用易读字重与行距；大字时容器增长、文字换行、减少列数，有意义图标随文字放大。 | SF/NY、Dynamic Type 尺寸和字距表仅用于 Apple；macOS 不支持 Dynamic Type，其他端接入当地缩放机制，不固定全端字号或把最小值当默认值。 |
| [Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode) | 平台适配 | 明暗外观保留文字、图片和浮层层级，不能简单反色；优先响应系统外观，并组合检查增强对比与降低透明度，阅读内容主题需明确分工。 | 本文 Dark Mode 覆盖 iOS/iPadOS/macOS/tvOS，不覆盖 visionOS/watchOS；不据此删除书灯已确认主题或外观能力，对比度建议与 Accessibility 表保留各自范围。 |
| [Inclusion](https://developer.apple.com/design/human-interface-guidelines/inclusion) | 跨端采纳 | 语言直白、尊重且可翻译，不把学历、文化、身体能力或家庭结构作为隐含前提；只收集必要个人信息，语言、地区格式和无障碍共同支持读者参与。 | Apple 辅助技术及 SF 图形是平台实现；不因建议新增头像、性别采集、引导页或语言功能，文化措辞仍需对应语言读者验证。 |
| [Icons](https://developer.apple.com/design/human-interface-guidelines/icons) | 跨端采纳 | 图标表达单一熟悉动作，统一笔画、视角、复杂度并与文字匹配视觉重量；自定义图标有可访问名称，按语义提供方向或文字本地化。 | SF Symbols 和动作映射用于 Apple 端，其他端选当地约定；macOS 折角文档图标仅在有自定义文档类型时适用，不能跨端直接发运 SF 图形。 |
| [Images](https://developer.apple.com/design/human-interface-guidelines/images) | 跨端采纳 | 书封、插图按实际显示尺寸、像素密度和色彩配置输出，简单界面图形优先矢量；不拉伸资产，清晰度与文件体积、运行性能一起权衡。 | Apple 倍率、tvOS 视差、visionOS 角度点及空间照片、watchOS PDF 缩放属平台规则；不据此新增立体书封、空间场景或媒体功能。 |
| [Branding](https://developer.apple.com/design/human-interface-guidelines/branding) | 跨端采纳 | 品牌通过克制的颜色、语气和内容表达，让正文占主要空间；保留熟悉组件行为，不反复摆放标志，不为品牌展示延长启动。 | Apple 商标和 App Store 营销规范约束对应资产与分发；Liquid Glass 拾取品牌色是 Apple 表现方式，不是全端必须实现。 |
| [Immersive experiences](https://developer.apple.com/design/human-interface-guidelines/immersive-experiences) | 当前范围外 | visionOS 沉浸由用户主动进入和退出，只服务有价值时刻，并保留状态、现实环境意识和稳定参照；移动边界与虚拟手追踪失败按空间环境处理。 | 全文沉浸模型仅支持 visionOS；当前阅读与问答不因此新增 Full Space、环境、虚拟手或空间音频，未来空间端明确立项后再用。 |
| [Motion](https://developer.apple.com/design/human-interface-guidelines/motion) | 跨端采纳 | 动效只说明反馈、状态和关系，简短且可中断，不阻塞阅读或快速重复操作；减少动态效果时保留信息与终态，避免自动、重复和无用运动。 | Liquid Glass 输入反馈、SF 动画及 Watch easing 限制按 Apple 适配；visionOS 周边运动、0.2Hz 振荡和世界旋转风险不转成普通二维页面统一参数。 |
| [Privacy](https://developer.apple.com/design/human-interface-guidelines/privacy) | 跨端采纳 | 仅在明确用途下请求最少数据，说明收集、发送和使用方式，尽可能本机处理，用平台安全存储保护密钥；可选 AI 配置不能阻断本机阅读。 | 系统权限、ATT、位置按钮、Keychain 及 ARKit 按 Apple 规则；预权限单按钮限制不泛化为 AI 告知，继续遵守配置时发送说明，不增加逐次问答确认。 |
| [Right to left](https://developer.apple.com/design/human-interface-guidelines/right-to-left) | 条件参考 | 有 RTL 目标时，按语义镜像导航、进度和有序集合；保留数字内部顺序、照片、标志、通用符号与真实物理方向，正文按其语言对齐。 | 自动镜像和 SF 变体按平台实现；短标签、列表遵循界面方向，不能整体翻转画面，也不因阅读本篇新增本地化交付承诺。 |
| [SF Symbols](https://developer.apple.com/design/human-interface-guidelines/sf-symbols) | 平台适配 | Apple 端先按动作和状态选择符号与变体，再匹配文字字重、渲染和缩放；渐变、变色和动画只在传达含义时使用，并检查系统版本回退。 | SF Symbols 是 Apple 专有适配，不能作 Android/Web 统一图标包，不能用于应用图标、Logo 或商标；受限 Apple 产品符号不可定制。 |
| [Spatial layout](https://developer.apple.com/design/human-interface-guidelines/spatial-layout) | 当前范围外 | visionOS 把重要内容放在舒适视野中并锚定空间，深度只用于必要层级；常用交互允许静坐完成，避免频繁重新聚焦或重叠目标。 | 视野、动态/固定比例、60pt 中心距和 16pt 间隔是 visionOS 条件，不转成二维页面统一间距；当前不新增空间窗口、体积或 3D 排版。 |
| [Writing](https://developer.apple.com/design/human-interface-guidelines/writing) | 跨端采纳 | 文案先说明目的、动作和恢复下一步，沿流程使用一致术语；空白页给具体入口，错误靠近问题并说明补救，设置描述开启后的行为。 | 英语大小写和 tap/click 需按语言与设备适配，不能直接变成全端文案规则；书灯沿用领域词汇，不因此新增流程或技术说明。 |

### 任务模式（26 页）

| 官方页面 | 采纳类别 | 书灯结论 | 适用边界 |
| --- | --- | --- | --- |
| [Patterns](https://developer.apple.com/design/human-interface-guidelines/patterns) | 条件参考 | 已完整核对本目录的简介、主题与关联入口，递归主题均纳入总清单。 | 这是组织页，不单独定义产品功能或平台能力；具体规则以主题正文与适用平台为准。 |
| [Playing haptics](https://developer.apple.com/design/human-interface-guidelines/playing-haptics) | 平台适配 | 触觉只为明确事件补充反馈，成功、警告、错误、选择保持含义一致，短促且克制；关闭或缺少触觉时仍能完成全部任务。 | iPhone 内置触觉、Mac Force Touch/Magic Trackpad、Pencil Pro 与手柄为不同硬件路径；不得因手柄支持便宣称 iPad/Mac/visionOS 具备同一内置振动能力，舒适度需真机测试。 |
| [File management](https://developer.apple.com/design/human-interface-guidelines/file-management) | 跨端采纳 | 书籍导入与笔记导出优先使用平台文件浏览能力，并明确类型和目标位置；笔记、阅读位置及草稿在编辑、关闭或切到后台时按可靠保存策略保留。 | Document launcher、File Provider、Quick Look、Finder Sync 与 Mac 未保存标志按实际文件架构和平台启用；书灯书架不因此改成文档启动器，也不新增云同步或备份能力。 |
| [Going full screen](https://developer.apple.com/design/human-interface-guidelines/going-full-screen) | 跨端采纳 | 全屏阅读以正文为主，工具栏可临时隐藏但要用熟悉动作恢复，关键操作持续可达；离开和返回保留阅读位置，全屏结束由读者决定。 | Mac 用系统全屏入口与 Control-Command-F，iOS/iPadOS 保留熟悉的 Home/Dock 导航；tvOS/watchOS 已默认占满显示，visionOS 沉浸不是同一种全屏模式。书灯控件覆盖且不重排正文来自 ADR-0013。 |
| [Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback) | 跨端采纳 | 阅读资料准备、问答生成和保存结果使用与事实一致的就近状态；关键失败说明原因与可执行下一步，只有足够重要的信息才中断，意外且不可逆的数据丢失须事先警示。 | 多通道补充而非只靠颜色/声音/振动；Watch 不应让人盯着不定进度等候，此例不能推导为手机必须发送完成通知，也不改变项目既有删除确认规则。 |
| [Multitasking](https://developer.apple.com/design/human-interface-guidelines/multitasking) | 跨端采纳 | 切换应用前保存上下文，回来恢复阅读位置、编辑草稿与生成状态；无须继续输入的用户任务尽量后台完成，常规完成结果可等返回后展示。 | iOS 后台受系统调度限制，HIG 不保证固定时长；遵守 ADR-0006 中断保留内容/提示重试边界，不新增协调服务器或例行完成通知。visionOS 看向别窗不等于媒体离场，Watch 不支持本篇多任务模型。 |
| [Charting data](https://developer.apple.com/design/human-interface-guidelines/charting-data) | 条件参考 | 只有需要解释趋势或比较时才用图表，记录查找可用列表；若以后已有统计，先给简单结论、再渐进展开，并同时提供数值与交互的无障碍表达。 | 原文无额外平台差异不等于输入密度和框架完全相同；阅读统计当前移后，不能因图表规范增加统计页、阅读排行榜或指标。 |
| [Collaboration and sharing](https://developer.apple.com/design/human-interface-guidelines/collaboration-and-sharing) | 条件参考 | 现有笔记导出可借用熟悉的系统分享入口，清楚表达发送副本；持续协作必须另有真实权限、参与者与管理模型，不能让导出看起来像共同编辑。 | Messages/CloudKit/iCloud Drive/ShareLink 为 Apple 适配；自定义协作要求 universal links，tvOS 不可用，visionOS Full Space 会暂停窗口分享。书灯不据此增加账户、协作或云同步。 |
| [Drag and drop](https://developer.apple.com/design/human-interface-guidelines/drag-and-drop) | 条件参考 | 已有拖放场景须先明确复制/移动语义，再提供有效目标、失败和传输状态反馈；保留导入、粘贴或菜单替代，尽可能允许撤销。 | Apple 通常同容器移动、跨容器复制、跨应用始终复制；Option 在放下时判断，iPad 聚合拖放、Mac 后台选择与 visionOS 空间放下各有条件，tvOS/watchOS 不支持；不由此新增书架重排功能。 |
| [Entering data](https://developer.apple.com/design/human-interface-guidelines/entering-data) | 跨端采纳 | AI 服务、笔记与改名只索取必要信息，提供明确标签、合理默认值、粘贴和及时校验；敏感内容遮挡输入，不能继续时解释缺失或错误位置。 | 密码字段不得预填，API 密钥须按其自身安全契约处理，不能机械等同密码示例；visionOS 安全输入 AirPlay 模糊和 Mac 扩展 tooltip 均是平台能力。 |
| [Launching](https://developer.apple.com/design/human-interface-guidelines/launching) | 跨端采纳 | 启动尽快给出可用首屏，恢复上次阅读和页面细节；大型资料准备与引导不能伪装为必须等待的启动过程。 | iOS/iPadOS/tvOS 的 launch screen 匹配首屏方向与明暗、无额外广告文字；Mac/visionOS/Watch 不要求该组件。visionOS 先 Shared Space 为建议，不能套用 Android/Web 启动实现。 |
| [Live-viewing apps](https://developer.apple.com/design/human-interface-guidelines/live-viewing-apps) | 当前范围外 | 本篇围绕直播播放、频道、EPG、云 DVR 与对应音频上下文；书灯无直播目标，不能转成首页自动播放、频道导航或自动清理用户阅读数据的依据。 | 原文无额外平台差异不证明每个平台具有同样直播/DVR 能力；其中自动覆盖旧录制属于明确的云 DVR 存储策略，不能外推到笔记、书籍或问答。 |
| [Loading](https://developer.apple.com/design/human-interface-guidelines/loading) | 跨端采纳 | 离线语义资料和书内准备允许后台加载，已有内容与其他阅读操作保持可用；需要等待时清楚显示进行中，只有有真实依据时才显示确定进度或预计时长。 | Background Assets 属 Apple 实现选项而非必须采用的框架；Watch 一两秒等待可用短指示优于白屏，与 feedback 的避免长时间盯不定指示应结合解释，不能硬写为 Watch 永远禁用加载指示。 |
| [Managing accounts](https://developer.apple.com/design/human-interface-guidelines/managing-accounts) | 跨端采纳 | 核心阅读不需要账户就不增加注册门槛，配置外部 AI 服务也不等于书灯账号；若未来确实支持开户，须有清晰真实的删除路径与完成状态。 | Sign in with Apple、passkeys、生物认证、TV provider、Watch 钥匙串各有范围；删除账户不自动取消 Apple 订阅，不将这些条件功能或法律示例写成当前书灯需求。 |
| [Managing notifications](https://developer.apple.com/design/human-interface-guidelines/managing-notifications) | 条件参考 | 只有产品已有需要通知的事件才请求授权，真实表达紧急性并尊重用户静音/免打扰；常规阅读或问答完成不应为争取注意而升级紧急程度。 | Passive/Active/Time Sensitive/Critical 与 Focus 是 Apple 通知等级；Time Sensitive 须切实影响当下或一小时内，营销须独立明确同意且不可使用该等级，Critical 另需 entitlement；当前不新增推送功能。 |
| [Modality](https://developer.apple.com/design/human-interface-guidelines/modality) | 跨端采纳 | 模态只用于收益明确且边界清晰的任务，提供显而易见的退出；按钮和手势退出使用相同内容保护规则，复杂层级不变成弹层内另一套应用。 | 全屏不必然模态，各平台 sheet/popover/window 的阻断范围不同，不能按视觉遮罩推断行为；关闭 AI 面板不取消生成仍以项目契约为准，警示可以盖在模态上但不可叠多个警示。 |
| [Offering help](https://developer.apple.com/design/human-interface-guidelines/offering-help) | 跨端采纳 | 帮助紧贴当前导入、阅读、AI 配置或错误任务，一两句说明能做什么并可关闭；已会用或已跳过的读者不应反复看到基础提示。 | TipKit 为 Apple 选项，24小时频率只是示例；Mac/visionOS tooltip 的60–75字符是带本地化考量的建议，不变成中文跨端硬字数，输入动词随实际设备调整。 |
| [Onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding) | 跨端采纳 | 先让读者完成安全的第一项阅读任务，以就近提示代替大段记忆教学；可选教程可跳过且记住选择，AI 设置、权限和大型下载在实际需要时再出现。 | 无额外平台差异只表示本篇共享建议；“可选”不推导为取消必须的发送告知或法律义务，项目 AI 服务发送说明仍在保存/更换服务时确认。 |
| [Playing audio](https://developer.apple.com/design/human-interface-guidelines/playing-audio) | 当前范围外 | 现阶段不增加朗读或音频；若未来已有播放，应尊重静音、音量与音频路由，拔耳机暂停，按中断类型决定是否恢复，关键信息不得只靠声音。 | AVAudioSession 类别表、Mac 通知音混合、tvOS 仅主动音频、visionOS 空间音频和 Watch 编码各自有范围；不能把 visionOS 优先声音当成安静阅读全平台强制配音。 |
| [Playing video](https://developer.apple.com/design/human-interface-guidelines/playing-video) | 当前范围外 | 书灯不增加视频播放；若未来已有视频，应优先系统播放器，保持原始比例、用户控制、续播位置与退出上下文，避免以品牌过场拖延观看。 | 原文2:1宽高比同时出现在两种默认模式边界，保留系统行为而不擅造排他条件；tvOS 0.5秒覆盖层延迟、visionOS 160px缩略图和 Watch30秒/编码建议都不外推。 |
| [Printing](https://developer.apple.com/design/human-interface-guidelines/printing) | 条件参考 | 只有产品已有打印能力时，使用系统打印入口与选项，按可打印内容和打印机能力启用；不重复制造副本数、范围等系统配置。 | 支持 iOS/iPadOS/macOS/visionOS，tvOS/watchOS 不支持；Mac File/Print/Page Setup 与移动端分享动作不同，现有 Markdown 导出不因此新增打印或分页实现。 |
| [Ratings and reviews](https://developer.apple.com/design/human-interface-guidelines/ratings-and-reviews) | 条件参考 | 以后已有商店评价入口时，只在读者实际使用并完成有意义任务后的自然停顿请求，不在首次启动、引导或阅读途中打断，不反复催促。 | 系统提示示例限 iOS/iPadOS/macOS，365天内最多3次由系统控制且请求不保证展示；一两周是候选请求间距建议，不是跨端商店规定，也不强制新增评价弹窗。 |
| [Searching](https://developer.apple.com/design/human-interface-guidelines/searching) | 跨端采纳 | 已有书架、书内等搜索明确标明范围、提供可理解的无结果与定位结果；如保存近期搜索，先考虑隐私并允许清空。 | 单一搜索入口是 aim 建议，明确分区允许本地搜索；Spotlight/Quick Look 属 Apple 适配。此篇不能突破书灯既定范围新增跨书语义搜索或把普通搜索变成问答。 |
| [Settings](https://developer.apple.com/design/human-interface-guidelines/settings) | 跨端采纳 | 选合理默认值并减少设置数；阅读字号/主题等任务选项靠近阅读，AI 服务等全局且低频内容进入设置，尊重系统无障碍和语言偏好。 | Mac App菜单/Command-逗号/独立面板和 Watch 主视图少量选项为适配规则；不要将 Apple Settings 结构强制套到 Android/Web，也不以减少设置为由删除已承诺阅读方式。 |
| [Undo and redo](https://developer.apple.com/design/human-interface-guidelines/undo-and-redo) | 跨端采纳 | 已有编辑操作的撤销/重做要能预测目标并看见结果，连续同类调整可合并为有意义一步；不要把只改视觉状态说成撤销不可逆外部操作。 | iOS/iPadOS三指/摇动、Mac Edit菜单/Command-Z与Shift-Command-Z属于平台适配；tvOS/watchOS不支持本篇模式，不因此新增全应用无限历史或改变彻底删除契约。 |
| [Workouts](https://developer.apple.com/design/human-interface-guidelines/workouts) | 当前范围外 | 本篇要求真实运动会话状态、可读运动指标、清楚的开始/暂停/结束和实际记录总结；书灯不增加健身、健康传感器或 Activity rings。 | 运动会话主题支持iOS/iPadOS/watchOS，macOS/tvOS/visionOS不支持；大屏可观看健身课程与记录运动会话不同，游泳传感器限制不能外推到阅读统计。 |

### 组件（73 页）

| 官方页面 | 采纳类别 | 书灯结论 | 适用边界 |
| --- | --- | --- | --- |
| [Components](https://developer.apple.com/design/human-interface-guidelines/components) | 条件参考 | 已完整核对本目录的简介、主题与关联入口，递归主题均纳入总清单。 | 这是组织页，不单独定义产品功能或平台能力；具体规则以主题正文与适用平台为准。 |
| [Widgets](https://developer.apple.com/design/human-interface-guidelines/widgets) | 条件参考 | 只有产品明确规划小组件时才采用：围绕一个核心用途提供可扫读的及时信息，尺寸增加应增加有用内容，点击直达对应书籍或记录；状态不能只靠颜色表达。小组件不是实时更新界面，不把持续刷新或完整应用布局塞入其中。 | WidgetKit、Lock Screen、StandBy、CarPlay、HomeView、visionOS 挂载方式和各尺寸表仅适用于对应 Apple 环境；11 pt 字号、16/11 pt 边距不是 Android/Web 通用令牌。书灯尚未规划小组件，本研究不增加此功能。 |
| [Complications](https://developer.apple.com/design/human-interface-guidelines/complications) | 当前范围外 | 全文含圆形、角落、行内、矩形及全部旧模板和尺寸表；表盘复杂功能应显示及时有用数据、按family提供合适内容与静态占位、保护常亮隐私，并为不同内容提供对应深链。书灯当前不增加Watch表盘或阅读统计。 | 仅watchOS；watchOS9及以后优先WidgetKit，旧版ClockKit模板需区分，更新时间线有次数与存储限制。Inline小型Flat的41mm单元格写10.5–23.5×21pt但@2x写21–47×21px，两者不一致；保留原文疑点，不能将该数值列入生产标准。 |
| [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars) | 平台适配 | 宽屏适配时可用侧栏承载主要区域或内容集合，层级通常不超过两层；窄屏优先为内容腾出空间，折叠分组用清晰短标签。隐藏侧栏应保留可发现、符合平台习惯的恢复入口。 | Liquid Glass 背景延展、sidebarAdaptable、macOS 系统强调色与用户侧栏尺寸是 Apple 规则；四栏结构不因此改为全端强制侧栏，也不扩大首发 iPad/桌面范围。 |
| [Content](https://developer.apple.com/design/human-interface-guidelines/content) | 条件参考 | 已完整核对本目录的简介、主题与关联入口，递归主题均纳入总清单。 | 这是组织页，不单独定义产品功能或平台能力；具体规则以主题正文与适用平台为准。 |
| [Layout and organization](https://developer.apple.com/design/human-interface-guidelines/layout-and-organization) | 条件参考 | 已完整核对本目录的简介、主题与关联入口，递归主题均纳入总清单。 | 这是组织页，不单独定义产品功能或平台能力；具体规则以主题正文与适用平台为准。 |
| [Menus and actions](https://developer.apple.com/design/human-interface-guidelines/menus-and-actions) | 条件参考 | 已完整核对本目录的简介、主题与关联入口，递归主题均纳入总清单。 | 这是组织页，不单独定义产品功能或平台能力；具体规则以主题正文与适用平台为准。 |
| [Navigation and search](https://developer.apple.com/design/human-interface-guidelines/navigation-and-search) | 条件参考 | 已完整核对本目录的简介、主题与关联入口，递归主题均纳入总清单。 | 这是组织页，不单独定义产品功能或平台能力；具体规则以主题正文与适用平台为准。 |
| [Presentation](https://developer.apple.com/design/human-interface-guidelines/presentation) | 条件参考 | 已完整核对本目录的简介、主题与关联入口，递归主题均纳入总清单。 | 这是组织页，不单独定义产品功能或平台能力；具体规则以主题正文与适用平台为准。 |
| [Selection and input](https://developer.apple.com/design/human-interface-guidelines/selection-and-input) | 条件参考 | 已完整核对本目录的简介、主题与关联入口，递归主题均纳入总清单。 | 这是组织页，不单独定义产品功能或平台能力；具体规则以主题正文与适用平台为准。 |
| [Status](https://developer.apple.com/design/human-interface-guidelines/status) | 条件参考 | 已完整核对本目录的简介、主题与关联入口，递归主题均纳入总清单。 | 这是组织页，不单独定义产品功能或平台能力；具体规则以主题正文与适用平台为准。 |
| [System experiences](https://developer.apple.com/design/human-interface-guidelines/system-experiences) | 条件参考 | 已完整核对本目录的简介、主题与关联入口，递归主题均纳入总清单。 | 这是组织页，不单独定义产品功能或平台能力；具体规则以主题正文与适用平台为准。 |
| [Split views](https://developer.apple.com/design/human-interface-guidelines/split-views) | 平台适配 | 宽屏确实需要同时展示层级或辅助内容时，可分栏呈现并持续标出当前选择；窗口收窄时保持清楚的前后导航关系。可调整栏宽应设可用上下限，隐藏辅助栏后提供可发现的恢复入口。 | iPhone 紧凑环境不宜硬塞多栏，iPad 流动窗口需覆盖多种宽度，macOS 可横/纵分割，watchOS 则逐页显示；Apple 原生组件和 tvOS 比例不约束 Android/Web。此篇不改变当前 iPhone 首发范围或强制引入平板版。 |
| [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars) | 跨端采纳 | 工具栏围绕当前内容提供高频导航和动作，按功能与重要性分组，拥挤时逐步收纳次要命令；阅读中可暂时收起，但恢复入口必须可靠。返回、关闭与主操作要清楚且稳定。 | Liquid Glass、SF Symbols、iOS大标题、15字符标题建议、iPad/macOS自动溢出和定制、visionOS底栏均按 Apple 端适配；Android/Web 沿用其平台组件、文案和布局惯例。 |
| [Dock menus](https://developer.apple.com/design/human-interface-guidelines/dock-menus) | 条件参考 | 若未来有macOS应用且确认需要Dock菜单，仅提供高价值现有任务或最近窗口，所有命令也需能从主界面或菜单栏找到。当前不据此增加桌面窗口、最近项目或快捷操作。 | Dock菜单仅为macOS入口，iOS/iPadOS相近体验是Home Screen quick actions；Android/Web不需复制Dock。 |
| [The menu bar](https://developer.apple.com/design/human-interface-guidelines/the-menu-bar) | 平台适配 | macOS/iPadOS 适配时沿用系统菜单顺序、常用快捷键及明确的命令名，命令应可发现，修饰键隐藏命令不能成为唯一操作路径。iPad 菜单栏经常隐藏，功能仍须能从应用界面完成。 | 菜单栏及 About/File/Edit/View/Window 的具体结构只约束 macOS/iPadOS；iPad Settings 菜单指向系统设置，与应用内偏好入口分开。不得强加 iPhone、Android 或 Web，也不据此新增桌面版或菜单栏常驻项。 |
| [Notifications](https://developer.apple.com/design/human-interface-guidelines/notifications) | 条件参考 | 若明确提供系统通知，应先获同意，只发送简短、有价值、及时的信息，同一事项不反复催促，点击到对应内容，应用前台用上下文内的轻量更新。敏感阅读内容不出现在通知预览，关键失败与保存状态不能只存在于通知或角标。 | Apple 图标角标只代表未读通知数量，不能直接当成跨端数字徽标的通用限制；watchOS 短/长预览、双指互点的动作顺序及最多四个通知动作按系统处理。无计划时不新增阅读提醒。 |
| [Ornaments](https://developer.apple.com/design/human-interface-guidelines/ornaments) | 当前范围外 | 本篇用于 visionOS 窗口外沿的空间控件，强调关联窗口、稳定位置和避免遮挡内容。书灯不新增空间版本，也不把 ornament 默认持续可见的建议用于推翻阅读控件按需显隐。 | z 轴浮动、窗口附着、眼睛悬停效果与原生工具栏/标签栏自动成为 ornament 均属 visionOS；Android/Web/iPhone 不复刻空间组件。 |
| [Scroll views](https://developer.apple.com/design/human-interface-guidelines/scroll-views) | 跨端采纳 | 连续阅读和长列表应沿用平台滚动手势与键盘行为，使可滚动性可感知，并避免同方向嵌套滚动。定位搜索结果、选文或输入时仅滚动必要距离，保持读者上下文；缩放边界应符合内容用途。 | 弹性、滚动条、Scroll Edge Effect、watchOS分页和visionOS Look to Scroll按平台实现；页控件只是特定分页场景建议，不替换书灯既定三种阅读模式。 |
| [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) | 跨端采纳 | 顶级栏目用于导航而非执行操作，切换时保留各栏状态，栏目标签清楚稳定；空内容应解释原因，不能临时隐藏栏目。书灯四栏可继续作为信息架构，全屏阅读另按既定阅读流程呈现。 | iOS底部浮栏、iPadOS顶部栏/侧栏转换、visionOS竖栏、SF Symbols实心偏好与Liquid Glass不构成Android/Web统一外观；徽标只用于确有必要关注的信息。 |
| [Windows](https://developer.apple.com/design/human-interface-guidelines/windows) | 平台适配 | 窗口化平台应适应尺寸变化，避免无必要地自动新增窗口，保留熟悉的系统窗口框架、输入焦点与开关行为。主要内容与辅助任务的窗口职责应明确。 | 本页窗口组件不支持 iOS/tvOS/watchOS；iPad 多窗口、macOS main/key 状态与 visionOS 玻璃、体积、缩放都不能作为全端要求，也不扩大当前首发范围。 |
| [Sliders](https://developer.apple.com/design/human-interface-guidelines/sliders) | 跨端采纳 | 字号等有界连续值的调节须明确两端含义和当前结果；调整时尽可能即时反馈，精确选择有需求时才辅以数值或步进。方向遵循语言阅读方向与平台预期。 | macOS 刻度、圆形滑块、visionOS 横向手势和 watchOS 两端按钮均属平台模式；iOS 音量专用控件规则不推导为书灯新增音频能力。 |
| [Toggles](https://developer.apple.com/design/human-interface-guidelines/toggles) | 跨端采纳 | 开关仅表达两个相反状态，必须明确作用对象，并用形状、勾选等线索表达状态，不能只靠颜色。互斥多选项与可多选集合应分别采用合适的单选和复选组件。 | iOS 的 switch 仅置于列表行、列表外使用切换按钮，以及 macOS 的 switch/checkbox/radio 排列规则属于平台适配；Android/Web 使用各自可访问组件惯例。 |
| [Context menus](https://developer.apple.com/design/human-interface-guidelines/context-menus) | 跨端采纳 | 对象菜单应只列少量当前相关、高频动作，并在主要界面提供可发现的等效入口；相似对象保持一致，分组和子菜单从简。删除类命令须清楚标明后果，不能依赖长按才可发现。 | Apple触摸/右键/捏合触发、隐藏不可用项规则、iOS对象同处仅提供上下文或编辑菜单之一、预览动画和红色破坏角色按平台适配；不把编辑菜单的可用性规则混用。 |
| [Live Activities](https://developer.apple.com/design/human-interface-guidelines/live-activities) | 条件参考 | 若未来明确规划持续任务的系统进度入口，应有明确起止，只显示需要扫读的真实状态，结束时立即结束活动，点击直达相关任务，并避免在锁屏暴露书籍内容或问答。不能因书灯有后台生成就自动要求 Live Activity，也不能把相同更新同时推送成重复通知。 | Dynamic Island 四种呈现、28 pt 受限宽度、最长八小时适用建议、两秒动画、14 pt 边距及 Mac/Watch/CarPlay 派生呈现均是 Apple 能力边界，不能原样规定 Android/Web。 |
| [Virtual keyboards](https://developer.apple.com/design/human-interface-guidelines/virtual-keyboards) | 跨端采纳 | 输入内容类型与键盘匹配，URL、数字、普通问题分别选择合适输入方式，提交键说明真实动作；键盘出现后仍能看到正在输入的内容与提交操作。优先系统输入能力，不为阅读助手另做自定义键盘或重复系统语音、表情入口。 | iOS/iPadOS keyboard layout guide、Liquid Glass 配件条、tvOS 线性键盘、visionOS 独立键盘窗口和 watchOS 内容类型能力各自适用；Android/Web 使用各自窗口尺寸、输入法与语义 API，不能照搬布局假设。 |
| [App Shortcuts](https://developer.apple.com/design/human-interface-guidelines/app-shortcuts) | 条件参考 | 若产品另行确认系统快捷入口，只暴露常用且重要的现有任务，命令应简单、可记忆，缺失参数时有清晰澄清，纯音频场景仍能理解结果。本文不要求新增快捷指令或硬件按钮入口。 | App Shortcuts最多10项、激活短语含应用名与macOS不支持该入口等是Apple限定；macOS可用App Intents自建快捷指令不能混为同一能力。 |
| [Snippets](https://developer.apple.com/design/human-interface-guidelines/snippets) | 条件参考 | 只有规划 Siri、Spotlight 或快捷指令任务时才应用 snippet：确认卡片提供明确动作和取消，结果卡片说明真实结果，更多信息直达应用。视觉内容应独立传意，避免把口述对话重复显示一遍。 | App Intents snippet 的确认/结果模型、系统按钮及 400 pt 自定义视图高度属于 Apple 系统展示；书灯未规划此集成，不能据此限制普通 AI 回答长度或新增语音助手入口。 |
| [Charts](https://developer.apple.com/design/human-interface-guidelines/charts) | 条件参考 | 只有已确认的信息任务需要图表时采用：根据比较、趋势或分布选择标记，给出清楚标题、单位和主结论，轴范围服务数据含义，重要信息不能依赖交互或颜色。读屏描述要包含数值及其语境，并按图表用途决定逐点还是分组描述。 | Swift Charts、Audio Graphs 和 VoiceOver 通知是 Apple 实现选项；Android/Web 应采用其等效语义及读屏支持。阅读统计已移后，不因这篇新增统计页、图表或复杂探索交互。 |
| [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons) | 跨端采纳 | 按钮需有明确动作含义、充分间距及可见按下状态；耗时动作提供真实等待反馈，少量突出样式建立主次。破坏性动作不能获得默认主按钮角色或被回车误触。 | 44×44 pt、visionOS 60×60 pt、形状材质、macOS省略号及watchOS全宽按钮须保留原平台单位和场景；不机械换算为Web像素或Android尺寸。 |
| [Menus](https://developer.apple.com/design/human-interface-guidelines/menus) | 跨端采纳 | 菜单按任务组织，常用与重要操作靠前，同组图标一致且有实际意义；标签用具体动作，相关项分组，子菜单通常仅一层。当前状态、不可用状态与需要继续输入的操作应可辨认。 | 英文标题大小写、省略号与禁用菜单持续可打开等是 Apple 菜单惯例；iOS 小中大布局及 visionOS breakthrough effect 由平台适配，不把仅图标菜单变成全端默认。 |
| [Top Shelf](https://developer.apple.com/design/human-interface-guidelines/top-shelf) | 当前范围外 | 本篇针对 Apple TV 主屏的内容预览与快捷播放入口，书灯未规划电视媒体体验。不能把自动播放、轮播推荐或促活展示推广到书架与阅读首屏。 | Top Shelf 的轮播、焦点行、滚动横幅、图像安全区和数量建议仅限 tvOS 系统入口，不是 Android TV、Web 或手机书架规范。 |
| [Watch faces](https://developer.apple.com/design/human-interface-guidelines/watch-faces) | 当前范围外 | 本页针对 watchOS 表盘分享、复杂功能预览和设备兼容替代；书灯当前未规划手表或表盘分发。 | 表盘、ClockKit 和 Apple Watch 型号适配均为 Apple 专属，不形成移动端或 Web 的设计要求。 |
| [Disclosure controls](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls) | 跨端采纳 | 常用内容持续可见，进阶细节按需展开，展开控件紧邻所控制内容并用描述性标签说明将显示什么。适用于既有书籍分组及高级 AI 配置的渐进披露。 | AppKit disclosure triangle 与 disclosure button 的箭头方向和单视图一个 disclosure button 指特定组件；不能误用为所有折叠分组只能有一个，Android/Web 遵循自身控件语义。 |
| [Image views](https://developer.apple.com/design/human-interface-guidelines/image-views) | 跨端采纳 | 书封等图片显示保持比例与清晰度；若图片会触发动作，应具有按钮或链接的交互语义，而非仅给图片加点击。图片上叠文字需检查对比度与可读性，不能让封面装饰压过书籍识别。 | SF Symbols、macOS image button/image well、tvOS分层图和visionOS空间图像是平台专属选项；书灯不因图像指南新增动画、HDR或3D展示。 |
| [Text views](https://developer.apple.com/design/human-interface-guidelines/text-views) | 跨端采纳 | 长篇回答、笔记正文和多行输入使用适合长文本的呈现，保持可读、可滚动和有用文本可复制；可编辑区域匹配键盘。系统文字放大与粗体等设置不能造成遮挡或操作丢失。 | UIKit/AppKit文本组件与Dynamic Type是Apple实现；正文阅读继续使用既定阅读内核，不能从HIG示例推导替换Readium或统一固定字号。 |
| [Web views](https://developer.apple.com/design/human-interface-guidelines/web-views) | 跨端采纳 | 嵌入网页应服务当前内容任务；若允许在多页间导航，提供可发现的前进与返回。仅需短暂查看外部内容时保留上下文，不在阅读应用中扩展完整浏览器功能。 | WKWebView、Safari 优先和 Apple 平台支持范围属于 Apple 适配；Android/Web 应明确自身网页容器或浏览器历史关系，不能将不用 WebView 写浏览器误读为禁止 EPUB 内核使用 HTML 渲染。 |
| [Boxes](https://developer.apple.com/design/human-interface-guidelines/boxes) | 跨端采纳 | 仅为逻辑相关的信息与控件增加分组容器，优先用留白与对齐表达内部关系，避免层层嵌套边框和占满页面的巨型卡片。必要时加简短标题，让视觉和读屏都能理解这一组的用途。 | iOS/iPadOS secondary/tertiary 背景、macOS 标题在容器上方及设置标题标点是 Apple 呈现惯例；Android/Web 采用各自语义颜色与分组组件，不要求每块内容都使用 GroupBox。 |
| [Collections](https://developer.apple.com/design/human-interface-guidelines/collections) | 跨端采纳 | 书架封面适合稳定的网格或行布局，间距足以选择、聚焦且不重叠；笔记和对话等文字集合优先列表。布局变化应可追踪，避免读者交互时无因重排。 | 触摸长按、焦点和悬停按输入方式实现，标准增删动画还须服从减弱动态效果；不要求各平台使用同一网格列数或UIKit集合组件。 |
| [Column views](https://developer.apple.com/design/human-interface-guidelines/column-views) | 平台适配 | 只有深层级且频繁往返时才考虑列式浏览，每列表示一个层级，第一列保留根节点，叶节点可展示详情。书灯浅层的书籍分组不因此变成 Finder 式多列浏览或新目录管理功能。 | 本篇 column view/NSBrowser 限 macOS；iPadOS/visionOS 官方建议考虑 split view。Android/Web 可按层级深度与可用空间选择本端导航，不强制列式结构。 |
| [Labels](https://developer.apple.com/design/human-interface-guidelines/labels) | 跨端采纳 | 短静态文字用于说明当前内容和下一步，字段标签常驻且含义具体；通过语义文字层级表达重要性，并随主题和文字大小保持清晰。错误信息等有复制价值的文本可选择复制。 | Apple四级label色、Dynamic Type和watchOS日期/计时标签是平台实现；跨端保留语义层级与缩放要求，不强制SwiftUI组件或相同色值，也不替换阅读字体偏好。 |
| [Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables) | 跨端采纳 | 笔记和对话历史适合可扫描的文字列表，保留可辨识标题与必要摘要，过长内容进入详情；分组清楚表达书籍归属，选择反馈区分导航与选项。表格只用于确需比较多列的数据。 | Apple列表样式、编辑模式、信息按钮与层级箭头区别、macOS可调列和watchOS分页是平台机制；不能据此给书灯增加重排、多列表格或编辑模式。 |
| [Lockups](https://developer.apple.com/design/human-interface-guidelines/lockups) | 当前范围外 | 本篇的 lockup 是 tvOS 中随焦点一起放大的内容、页眉与页脚组合，书灯未规划该电视能力。保持相关内容整体和合理间距可作为一般观察，不能强制手机书封采用电视焦点动效。 | TVLockupView、card/caption button/monogram/poster 的命名与倾斜、放大行为限 tvOS，不等同于所有平台的卡片规范。 |
| [Outline views](https://developer.apple.com/design/human-interface-guidelines/outline-views) | 平台适配 | 有层级的内容组可借鉴清楚展开/收起与保留展开状态，避免回看笔记、对话或目录时重复定位；无层级数据不应伪装成树。若 macOS 使用多列大纲，层级只在第一列，列标题与调整列宽须清楚。 | 本篇原生 outline view 限 macOS；单击编辑、Option 展开子层、可排序列等不是移动端或 Web 的通用操作。书籍分组仍沿用领域用语，不新增文件夹管理或多列表格。 |
| [Tab views](https://developer.apple.com/design/human-interface-guidelines/tab-views) | 平台适配 | 相互排斥、密切相关的内容可共用一处区域切换，标签应可预期，每个面板的控件只影响本面板。需与应用顶级栏目导航区分，不能把本页tab view直接当作四栏tab bar。 | 本文主要是macOS NSTabView与watchOS分页，明确iOS/iPadOS同类任务可用分段控件；六项数量、内边距与顶端样式不能无条件施加Android/Web标签页。 |
| [Activity views](https://developer.apple.com/design/human-interface-guidelines/activity-views) | 平台适配 | 笔记导出或已有分享任务在Apple端优先接入系统分享界面，只显示当前适用动作，不复制系统已有操作；自定义动作使用简短明确动词。分享扩展与应用内分享分属不同能力，不因阅读指南新增扩展。 | UIActivityViewController仅对应支持的平台；macOS没有该activity view但可有分享/动作扩展。Android/Web应使用各自分享和文件导出机制，并保留成功、取消与失败语义。 |
| [Edit menus](https://developer.apple.com/design/human-interface-guidelines/edit-menus) | 平台适配 | 选中文字后保留熟悉的系统选择与复制，书灯的提问、高亮、笔记等动作按相关性加入，避免过多自定义命令或遮挡选文。正文、回答和有用错误信息在合适场景应可选择复制。 | Apple横向紧凑菜单/指针纵向菜单、系统排序及macOS Edit菜单按平台保留；Android/Web沿用原生或浏览器文本选择，不能照搬UIKit形状和触发事件。 |
| [Home Screen quick actions](https://developer.apple.com/design/human-interface-guidelines/home-screen-quick-actions) | 条件参考 | 若后续明确需要主屏快捷入口，只提供少量高价值现有任务，标签直接描述结果，动态内容保持可预测。本文不把至少一个快捷项的建议变成书灯当前交付项。 | iOS/iPadOS主屏长按、最多四项与单色SF Symbols属于平台入口；Android应用快捷方式或Web安装体验需独立采用其机制。 |
| [Pop-up buttons](https://developer.apple.com/design/human-interface-guidelines/pop-up-buttons) | 跨端采纳 | 一组平级且互斥的选项应显示当前选择、合理默认值及足以预测选项的标签，空间紧张时可以折叠呈现。不要把多选、命令列表或层级子菜单混作同一选择器。 | iPad 模态列表以内嵌弹出选择代替详情导航是可选平台优化；具体 picker/select/menu 外观随平台，不引入额外自定义选项。 |
| [Pull-down buttons](https://developer.apple.com/design/human-interface-guidelines/pull-down-buttons) | 跨端采纳 | 下拉菜单聚合与按钮目的直接相关的命令，适合排序等次要操作；主要动作不应全部藏进更多菜单。破坏选项必须明确后果，并给读者有意识地确认或取消的机会。 | Apple 下拉菜单与弹出选择器的区分、SF Symbols 和 iOS action sheet/iPad popover 确认外观由适配层处理；不是要求所有平台菜单同形同位。 |
| [Path controls](https://developer.apple.com/design/human-interface-guidelines/path-controls) | 平台适配 | 只有 macOS 中确有让用户理解或选择文件系统位置的任务才考虑路径控件，放在窗口正文而不是工具栏或状态栏。书灯导入后的书籍身份、目录和原文定位不等同文件路径，不暴露内部沙盒路径。 | NSPathControl 两种样式、拖入路径与 Choose 菜单是 macOS 文件交互，不是 iPhone、Android 或 Web 的导航面包屑规则，也不要求新增文件管理器。 |
| [Search fields](https://developer.apple.com/design/human-interface-guidelines/search-fields) | 跨端采纳 | 搜索入口的位置和占位提示应说明搜索范围；输入后尽快反馈，优先呈现相关结果。书架搜索与书内搜索须保持上下文明确，只有已有清晰分类且确有需要时才增加范围筛选或 token。 | iOS 底部搜索、独立搜索标签和 iPad/macOS 工具栏位置是平台策略，不要求改动四栏导航或新增跨书搜索；Android/Web 沿各自键盘、布局与搜索惯例适配。 |
| [Token fields](https://developer.apple.com/design/human-interface-guidelines/token-fields) | 条件参考 | 只有多实体或结构化搜索项确有需要时才将文字转为可选、可编辑 token，建议的出现时机应避免打断输入。当前普通书名与书内搜索不必因此复杂化。 | 此页 NSTokenField 仅为 macOS 组件；iOS 搜索 token 是另一个搜索模式，Android/Web 不要求复制逗号转 token 和拖动行为。 |
| [Action sheets](https://developer.apple.com/design/human-interface-guidelines/action-sheets) | 平台适配 | 用户主动触发后需要澄清选择时才展示操作选项，简短且避免长列表；破坏操作要明确语义并提供可退出路径。为同一动作作选择与意外错误警报应有不同的交互语义。 | iOS/iPadOS 的 action sheet、Cancel 位置和破坏操作置顶、watchOS 四按钮上限都是平台规则；Android/Web 采用各自对话框或菜单模式，visionOS 不支持此组件。 |
| [Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts) | 跨端采纳 | 只为需要立即处理的重要情况或不可撤销的数据损失使用警告；常见可撤销动作和纯状态信息优先放回原上下文。标题说明发生了什么，按钮直接命名动作并提供安全取消，避免错误码标题、含糊的确定/是/否与启动即打断。 | 按钮顺序、默认键、警告图标、最多三按钮及 action sheet 与 alert 的分工是 Apple 适配规则。Apple 对用户已主动选择的破坏动作并非一律要求 destructive 样式；跨端应保留清楚后果和安全退出，不制定所有删除按钮必红的规则。 |
| [Page controls](https://developer.apple.com/design/human-interface-guidelines/page-controls) | 条件参考 | 圆点页控件适用于少量、有顺序的同级页面，约十个以上难以扫读，不适合作为整本书页码或层级目录的替代。自定义指示符保持简单且不超过两种含义。 | iOS 点按/拖扫、背景样式、visionOS 只展示不交互及 watchOS Digital Crown 规则各有限定；不据此新增轮播或引导页。 |
| [Panels](https://developer.apple.com/design/human-interface-guidelines/panels) | 平台适配 | 桌面辅助面板应服务当前内容或选中对象、保持精简且不遮挡主要内容；信息固定的独立窗口与随选择变化的检查器应区分。 | 本页 panel 与 HUD 均为 macOS 特定窗口类型；不适用于 iOS 的阅读问答弹层，不能拿少打字、随应用失活隐藏等规则限制跨端问答输入。 |
| [Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers) | 平台适配 | 临时浮层只承载少量相关任务，锚点清楚、不遮挡重要内容，一次仅一个；意外点外关闭不能丢弃工作，只有明确取消才可丢弃。长内容或紧凑空间应采用适合该平台的较完整呈现。 | iOS/iPadOS紧凑宽度改用模态sheet、macOS可拆卸popover及箭头样式是Apple适配；Android/Web按自身浮层与对话框惯例保留任务、草稿和关闭语义。 |
| [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets) | 跨端采纳 | 上下文弹层承载范围明确、能回到原任务的短任务；复杂长流程需重新评估呈现方式，避免叠套弹层导致返回关系混乱。完成、取消和返回语义应明确，未保存修改退出时保护草稿，辅助阅读的问答不应无故阻断正文。 | iOS/iPadOS 可有非模态 sheet，其余 Apple 平台本篇 sheet 为模态；取消/完成按钮位置、detents、grabber、滑动关闭和 iPad form/page sheet 只用于对应适配。Android/Web 可用各端抽屉、对话框或分栏，不强制复刻 Apple 弹层。 |
| [Color wells](https://developer.apple.com/design/human-interface-guidelines/color-wells) | 条件参考 | 只有明确允许任意颜色时，才考虑平台标准颜色选择器并持续显示当前选择；现有高亮预设颜色不因此升级为自由调色。全文的macOS颜色拖放也是可选平台能力。 | UIColorWell、系统跨应用色板与macOS拖放属于平台适配；Android/Web按各自颜色输入机制，不能无条件复制Apple色板。 |
| [Combo boxes](https://developer.apple.com/design/human-interface-guidelines/combo-boxes) | 条件参考 | 仅当某字段确实同时允许预置与自定义值时考虑组合输入，提供说明、相关预置与有意义默认，避免选中值无法辨认。不能把仅能选择现有AI配置的控件改成任意输入，也不增加配置能力。 | 本页NSComboBox仅支持macOS；标签冒号和大小写为其文案惯例，Android/Web同类可编辑选择控件须按各自可访问交互实现。 |
| [Digit entry views](https://developer.apple.com/design/human-interface-guidelines/digit-entry-views) | 当前范围外 | 本页讨论 tvOS 全屏 PIN 等数字输入，敏感数字用安全字段并说明目的；书灯当前未规划 PIN 或电视输入流程。 | TVDigitEntryViewController 仅适用 tvOS；不把全屏数字键盘要求套到 API 密钥、普通文本或移动端。 |
| [Image wells](https://developer.apple.com/design/human-interface-guidelines/image-wells) | 当前范围外 | 可编辑图片井支持标准复制、粘贴、删除和拖入；必需图片被清空时回到默认图。书灯目前展示导入书籍封面，不规划编辑封面或图片内容，因此不新增图片井。 | 本文是macOS NSImageView的可编辑形态，不等同于其他平台图片上传控件，也不是普通封面展示的要求。 |
| [Pickers](https://developer.apple.com/design/human-interface-guidelines/pickers) | 跨端采纳 | 选择控件按选项数量和任务选型：短列表宜轻量呈现，中长有序值可用选择器，极长集合用可定位列表。选项需逻辑有序、可预期，选择发生在字段附近，并尊重语言地区设置。 | iOS紧凑/内嵌/滚轮、macOS文字/图形日期选择器及watchOS表冠是具体适配，不要求Android/Web复制滚轮；日期时间示例不代表书灯需要新增日历功能。 |
| [Segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls) | 跨端采纳 | 分段只用于紧密相关的选项或局部视图，明确当前选择，同一组不能混用选择状态与即时动作，标签与视觉形式保持一致。全应用独立栏目不能仅因外观相似而换成分段控件。 | iPhone 约五项、宽屏约五至七项是建议而非所有端硬上限；macOS 主区域更适合 tab view，tvOS 焦点即选择，watchOS 不支持该原生控件。Android/Web 应按其组件惯例与内容长度适配。 |
| [Steppers](https://developer.apple.com/design/human-interface-guidelines/steppers) | 跨端采纳 | 小幅增减数值可用步进，旁边明确呈现作用对象与当前值；需要跨越大范围时才补充直接输入方式。 | macOS Shift-click 加速是可选平台习惯，具体组件形态与键盘交互按目标平台，不能为简单字号设置强加文本字段。 |
| [Text fields](https://developer.apple.com/design/human-interface-guidelines/text-fields) | 跨端采纳 | 短而具体的信息用文本框，问题和笔记等长内容用多行文本区域；输入后仍保留可见字段标签，密钥等敏感数据用安全输入。按语义配置键盘与验证时机，多字段焦点顺序可预测，数值格式尊重区域设置。 | iOS 尾部清空按钮、macOS combo box 与展开 tooltip、tvOS/watchOS 尽量少输入分别适用。不得将 Apple 控件位置和尺寸直接规定到 Android/Web；安全输入也不等于阻止用户粘贴自己提供的密钥。 |
| [Activity rings](https://developer.apple.com/design/human-interface-guidelines/activity-rings) | 当前范围外 | Activity rings 专门代表同一人的 Move、Exercise、Stand 健康目标，不能复制修改来呈现阅读进度、装饰或品牌。书灯不应借用三环健康语义。 | Apple 对配色、黑底、边距与配对状态有专门要求，仅在真正 HealthKit 健康能力中采用；不据此新增阅读统计或健康集成。 |
| [Gauges](https://developer.apple.com/design/human-interface-guidelines/gauges) | 条件参考 | 仅在确有范围内数值需要可视化时使用仪表，明确当前值与两端含义，并提供可供辅助技术读取的标签。容量、评分和相关性须各用真实含义，不能借仪表暗示回答可信度。 | Apple accessory 样式、macOS level indicator 和 tiered 颜色是平台实现；阅读统计不因本页而纳入范围，不新增锁屏仪表。 |
| [Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators) | 跨端采纳 | 导入、离线语义资料准备与回答生成应展示真实进行状态；能够测量进度时再给确定进度，停滞时说明问题和下一步，完成后移除。可安全中断才提供取消或暂停，并明确丢失进度的后果。 | 各平台进度条/旋转器、刷新控件样式由原生或对应设计系统适配；不得为无法估算的 AI 生成伪造百分比或固定完成时间，也不据此新增同步或刷新功能。 |
| [Rating indicators](https://developer.apple.com/design/human-interface-guidelines/rating-indicators) | 当前范围外 | 书灯未规划书籍星级或评分，本篇不产生评分功能。若未来独立确认评分任务，符号含义需明确，列表内的更改不必绕到另一编辑页。 | 本篇 NSLevelIndicator.rating 限 macOS，其整星取整且不显示半星的行为不是跨端评级系统或内容评分的普遍规则。 |
| [Controls](https://developer.apple.com/design/human-interface-guidelines/controls) | 条件参考 | 若另行规划系统快捷控制，应只提供无需完整打开应用也有价值的直接动作，符号表达行为，进行中与完成后状态及时更新，锁屏隐藏敏感信息。此处 Controls 是控制中心、锁屏与操作按钮入口，不能误当成普通界面控件总则。 | WidgetKit 控制、Action button、Dynamic Island 与 LockedCameraCapture 按 Apple 支持范围及认证规则处理；Android 快捷设置/Web 快捷入口需独立适配。书灯不因此新增控制中心入口或锁屏相机功能。 |
| [Status bars](https://developer.apple.com/design/human-interface-guidelines/status-bars) | 平台适配 | 系统状态区必须可读，背景不能使读者误以为被覆盖的控件仍能点击；沉浸阅读若暂时隐藏状态栏，应有简单、可发现的恢复方式。 | 本页专指 iOS/iPadOS 顶部系统状态栏，不是应用底部阅读信息栏；Android 的系统栏与 Web 浏览器 UI 由各平台适配，不强制永久隐藏或复制模糊效果。 |

### 输入（14 页）

| 官方页面 | 采纳类别 | 书灯结论 | 适用边界 |
| --- | --- | --- | --- |
| [Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures) | 跨端采纳 | 阅读翻页、显隐控件、选文等手势沿用熟悉含义并即时反馈；重要操作同时保留可发现的控件或无障碍替代入口，自定义手势只作快捷方式。 | 三指撤销、四指切换、Watch 双指互点和 visionOS 手掌覆盖层属于各 Apple 平台；2026-10-28 新增 Mac 触摸规则仅在支持硬件上采用，不外推为 Android/Web 手势规范。 |
| [Inputs](https://developer.apple.com/design/human-interface-guidelines/inputs) | 条件参考 | 已完整核对本目录的简介、主题与关联入口，递归主题均纳入总清单。 | 这是组织页，不单独定义产品功能或平台能力；具体规则以主题正文与适用平台为准。 |
| [Pointing devices](https://developer.apple.com/design/human-interface-guidelines/pointing-devices) | 平台适配 | 键鼠、触摸切换保持同一任务和选择；隐藏的阅读控件能被指针唤出，支持触摸的 Mac 上关键 hover 控件也须能用触摸或上下文菜单找到。 | iPad 的 highlight/lift/hover、约12/24pt命中区 padding、Mac 光标与触摸显隐、visionOS 视线转移均为平台条件；tvOS/watchOS 不支持本主题，不把数值换成跨端硬指标。 |
| [Keyboards](https://developer.apple.com/design/human-interface-guidelines/keyboards) | 平台适配 | 保留复制、搜索、撤销等标准快捷键语义，只为高频独有动作增加易发现的组合；在支持平台验证 Full Keyboard Access 与国际键盘。 | Command/Shift/Option/Control 的优先级及系统快捷键属于 Apple；iPad 普通内容焦点与 Full Keyboard Access 不同，不能给所有按钮自造方向焦点；watchOS 不支持物理键盘。 |
| [Game controls](https://developer.apple.com/design/human-interface-guidelines/game-controls) | 当前范围外 | 该篇要求游戏控制覆盖平台默认输入、按实际手柄显示符号，并保留系统 Home 行为；书灯没有游戏循环，不引入虚拟摇杆、手柄要求或按键布局。 | 44×44pt/28×28pt是该篇游戏触控控件语境，不能拿次要游戏控件数值作为书灯全部按钮标准；watchOS 不支持本主题，空间手柄规则仅 visionOS。 |
| [Apple Pencil and Scribble](https://developer.apple.com/design/human-interface-guidelines/apple-pencil-and-scribble) | 条件参考 | 仅在以后已有 iPad 手写能力时采用：Pencil 与手指可自由切换，hover 只预览；Scribble 写入时字段和已转写文字保持稳定，双击/挤压不得意外损坏内容。 | Pencil/Scribble 属 iPadOS，设备与笔型号决定 hover、压力、挤压和 barrel roll；当前文字高亮/笔记不等于已有自由手绘，不据此新增手写或 PDF 涂画。 |
| [Eyes](https://developer.apple.com/design/human-interface-guidelines/eyes) | 当前范围外 | 该篇区分视线 hover 与键盘焦点：视线只提供目标反馈，不能把注视当成业务操作或已读事件；若未来做 visionOS，应保持稳定目标、克制动效和输入替代。 | 仅 visionOS；16pt周围余量、60pt中心间距和持续阅读至少1米距离均为空间输入建议，不套到手机/Web。系统在点击前不向应用提供视线位置。 |
| [Remotes](https://developer.apple.com/design/human-interface-guidelines/remotes) | 当前范围外 | Siri Remote 的滑动移动焦点，按压确认，Back 通常返回层级父级，播放键保持媒体含义；书灯不增加电视遥控器交互。 | 仅 tvOS；正文中父级规则比按钮表的简写 previous screen 更具体，不能把遥控 Back 与手机浏览历史直接等同，EPG 按键仅直播语境。 |
| [Action button](https://developer.apple.com/design/human-interface-guidelines/action-button) | 条件参考 | 以后若已有 App Shortcut 高频动作，Action button 可复用该动作并用简短动词名称；避免只是再增加一个打开应用入口，也不重复系统教学。 | 仅支持硬件的 iPhone/Apple Watch，最多三词的英文标签格式不直接变成中文词数规则；Watch 连续按压/双键暂停与 iPhone 轻量上下文规则不同，当前不新增快捷指令。 |
| [Camera Control](https://developer.apple.com/design/human-interface-guidelines/camera-control) | 当前范围外 | 相机控制覆盖层须用稳定控件集合、短标签、带单位数值及 SF Symbols，并避免遮挡取景；书灯没有拍摄或 OCR 范围，不增加相机入口。 | 本篇指 iPhone 16/16 Pro 的 Camera Control，其他 Apple 平台不支持；不能从硬件拍照规范推导 EPUB/PDF 阅读工具栏或一般滑块的统一约束。 |
| [Digital Crown](https://developer.apple.com/design/human-interface-guidelines/digital-crown) | 当前范围外 | Watch 旋钮优先服务导航，调整数值要有对应触摸路径和实时视觉反馈；Vision Pro 旋钮用于系统音量、沉浸与返回等，应用不能任意重映射。 | 仅 watchOS/visionOS；Watch 旋钮按压由系统保留，iPhone/iPad/Mac 不支持本主题，不把旋钮规则转成书灯翻页硬件要求。 |
| [Focus and selection](https://developer.apple.com/design/human-interface-guidelines/focus-and-selection) | 平台适配 | 区分输入焦点、激活和持久选择，避免未经操作跳走；列表、书封、输入框在键盘导航中遵循平台阅读顺序并保持可辨识状态。 | 本篇组件焦点模型不支持 iOS/watchOS；iPad Tab 跨焦点组、方向键组内移动，tvOS 所有可交互元素可达，visionOS gaze hover 与该焦点无关；不能误述为 iOS 无键盘/无障碍焦点。 |
| [Gyroscope and accelerometer](https://developer.apple.com/design/human-interface-guidelines/gyro-and-accelerometer) | 当前范围外 | 运动数据须有实际用户收益并说明用途，非游戏界面避免依赖倾斜等精密身体动作；书灯不增加摇动翻页或不必要的运动权限。 | 正文明确 iOS/iPadOS/watchOS Core Motion 与 tvOS Siri Remote 陀螺仪场景；平台栏无附加说明不能据此证明 Mac/visionOS 具备同样传感器能力。 |
| [Nearby interactions](https://developer.apple.com/design/human-interface-guidelines/nearby-interactions) | 当前范围外 | 近距交互应围绕真实距离/方向任务，持续反馈并保留替代路径，方向不可用时不能显示确定方向；书灯不引入 UWB 寻物或近距分享。 | 依赖兼容 UWB 硬件与授权；iPhone 可给距离和方向，Watch 仅距离且参与应用须前台，macOS/tvOS/visionOS 不支持本主题。 |

### 技术与系统能力（30 页）

| 官方页面 | 采纳类别 | 书灯结论 | 适用边界 |
| --- | --- | --- | --- |
| [Technologies](https://developer.apple.com/design/human-interface-guidelines/technologies) | 条件参考 | 已完整核对本目录的简介、主题与关联入口，递归主题均纳入总清单。 | 这是组织页，不单独定义产品功能或平台能力；具体规则以主题正文与适用平台为准。 |
| [Siri](https://developer.apple.com/design/human-interface-guidelines/siri) | 条件参考 | 若未来明确规划系统语音入口，应先识别高价值动作，用读者熟悉的术语，并使语音反馈可独立理解、错误原因具体。不能把阅读助手等同于Siri，也不能为了HIG覆盖新增语音控制。 | App Intents、App Schemas、Spotlight实体捐赠、Siri用语与商标是Apple适配；内容暴露需单独核对隐私，Android/Web不得复制其接口或身份表现。 |
| [VoiceOver](https://developer.apple.com/design/human-interface-guidelines/voiceover) | 跨端采纳 | 关键控件与有意义图片需有准确的可访问名称，装饰图跳过；标题、分组、阅读顺序与关联关系应能由读屏理解。问答内容或布局变化要通知辅助技术，文档标题与链接提供快速导航，不能只让视觉用户发现新状态。 | VoiceOver、rotor 和 Apple accessibility 通知是 Apple 实现方式；Android 使用 TalkBack/原生可访问语义，Web 使用语义 HTML/ARIA 与读屏验证。visionOS 自定义手势受读屏模式约束，不能转成所有平台禁用手势的规定。 |
| [AirPlay](https://developer.apple.com/design/human-interface-guidelines/airplay) | 当前范围外 | 全文围绕媒体投放、分辨率、后台播放、遥控事件与AirPlay图标/商标。书灯当前不规划影音播放或投放，不据此增加播放器、外屏或朗读。 | AVKit/AVFoundation及AirPlay控制规范属于Apple媒体适配；不能把不中断播放的后台保证套用AI问答或普通阅读。 |
| [Always On](https://developer.apple.com/design/human-interface-guidelines/always-on) | 条件参考 | 只有未来出现常亮锁屏、通知或手表界面时才需应用：隐藏敏感内容、降低非必要更新和动效，并维持布局连续。当前不据此增加锁屏阅读、Widget、Live Activity或手表应用。 | 本文描述特定iPhone与Apple Watch的Always On状态，不能理解为让主阅读器在锁屏常显，Android其他常亮机制需独立验证。 |
| [App Clips](https://developer.apple.com/design/human-interface-guidelines/app-clips) | 当前范围外 | App Clip 应提供即时、聚焦、可完成的真实任务，不能仅作营销；全文还规定卡片、码、印刷、NFC、通知和商标。书灯目前没有临时使用或试玩分发任务，不据此增加轻应用。 | 仅 iOS/iPadOS 的分发机制；原生组件、数据可能被系统删除、8小时通知等约束不能套用主应用或其他平台。 |
| [Apple In-App Purchase](https://developer.apple.com/design/human-interface-guidelines/apple-in-app-purchase) | 当前范围外 | 购买设计需清楚展示总价、订阅期限、试用后的扣费、恢复购买、退款与取消入口，并使用系统确认流程。书灯已将收费讨论移后，本文不构成新增商店、订阅或付费墙的理由。 | StoreKit、Family Sharing、优惠码与系统退款界面属于 Apple 商业平台；Android/Web 如未来收费须另查其渠道规则。 |
| [Apple Pay](https://developer.apple.com/design/human-interface-guidelines/apple-pay) | 当前范围外 | 全文涵盖支付范围、单品/购物车快捷结账、最少必要信息、订阅披露、交易错误与中断取消，以及按钮和标志规范；书灯当前未确定收费，不因本篇增加购买、订阅、捐赠或 Apple Pay。 | Apple Pay 面向实物/服务等；应用内数字内容指向独立的 Apple In-App Purchase 规范，不能用 Pay 规避。2026年正文明确兼容 Web 浏览器和 Vision Pro，须按设备/浏览器能力判断，tvOS不支持；30pt按钮尺寸和Apple Pay按钮不置灰为支付专用规则，不外推一般按钮。 |
| [Augmented reality](https://developer.apple.com/design/human-interface-guidelines/augmented-reality) | 当前范围外 | 全文涵盖能力检测、系统coaching、物体放置与手势、多人/现实物体识别、中断重定位、问题修复及AR图标；核心是诚实表达环境不确定性、渐进校正且允许取消/重置。书灯不因此增加相机、AR书封或空间阅读。 | 主体适用于iOS/iPadOS相机AR；visionOS另有ARKit及授权模型，不能直接搬手机流程。60次/秒、最多约100张参考图、短时消失约1秒等是AR语境，AR专用图标/徽章只用于ARKit体验，不能作为全平台普通图形。 |
| [CareKit](https://developer.apple.com/design/human-interface-guidelines/carekit) | 当前范围外 | 全文涵盖敏感数据与HealthKit/运动/照片/ResearchKit、五种护理任务、三种图表、联系视图、提醒及品牌；任务呈现应对应实际完成语义，信息不只靠颜色，提醒应合并且克制。书灯没有护理计划，不增加健康资料库或服药/患者功能。 | CareKit UI主体仅iOS/iPadOS；Watch能显示相关通知不等于watchOS支持CareKit应用界面。健康授权与共享须遵守系统权限，不能把健康数据每次使用时核查/请求规则推广成书灯普通问答逐次确认，也不直接采用医疗示例、CareKit2.0结构或健康图表策略。 |
| [CarPlay](https://developer.apple.com/design/human-interface-guidelines/carplay) | 当前范围外 | 本页以驾驶中低交互和系统模板为前提，阅读与阅读问答不因此增加车载入口；不应把驾驶场景的内容删减、布局和声音行为视为一般阅读界面规范。 | CarPlay 模板、连接 iPhone、驾驶安全、车机图标尺寸与音频会话均属特定平台场景；不强加给 Android/Web 或普通 iPhone 阅读。 |
| [Game Center](https://developer.apple.com/design/human-interface-guidelines/game-center) | 当前范围外 | 本篇针对游戏社交、成就、排行榜、限时挑战和多人活动，书灯阅读任务不采用这些机制。不能把游戏的参与度目标转成阅读打卡、排行榜或强制激励设计。 | GameKit、Game Overlay、访问点、官方术语与各类卡片图片规格属于 Apple 游戏体系；watchOS 有 API 不等于有可调用的系统 Game Center UI。均不形成书灯跨端规范。 |
| [Generative AI](https://developer.apple.com/design/human-interface-guidelines/generative-ai) | 跨端采纳 | 阅读问答应明确AI身份与能力边界、区分书内依据和生成解释，让读者可拒绝、重试或继续调整；未配置或不可用时仍能阅读。外发数据最少化并说明去向与用途，生成状态和失败原因必须真实可理解。 | 这些体验原则不要求采用Apple Intelligence或Foundation Models，不要求逐次发送确认；书灯沿用保存/更换服务时的一次性发送说明，本轮不因可选建议新增训练、反馈收集、多候选生成或高风险外部代办；既有LangChain阅读Agent及其检索工具继续有效。 |
| [HealthKit](https://developer.apple.com/design/human-interface-guidelines/healthkit) | 当前范围外 | 没有健康与健身功能的应用不应请求健康数据；书灯不应申请 HealthKit 权限或使用健康兼容标识。健康三环不能改作阅读目标、装饰或品牌。 | HealthKit 授权、系统隐私管理、Apple Health 图标和文案为特定服务契约；不新增健康集成，也不把健康共享配置规则套到 AI 服务设置。 |
| [HomeKit](https://developer.apple.com/design/human-interface-guidelines/homekit) | 当前范围外 | 全文要求沿用家庭、房间、配件、场景等 HomeKit 模型，尊重系统设置、使用系统配网流程，并在写入家庭数据库前获得明确意图。书灯不是家居控制应用，不引入设备、场景或自动化能力。 | HomeKit 术语、命名字符规则、图标与商标使用均限此技术场景，不能约束书名、笔记或跨端通用命名。 |
| [iCloud](https://developer.apple.com/design/human-interface-guidelines/icloud) | 条件参考 | 云同步已移后，不能要求书灯现在增加 iCloud；将来启用时需明确跨设备删除后果、冲突与离线状态，节制带宽和付费存储，避免把可再生产物同步给用户。即使没有云同步，Apple 的应用备份也会包含 Documents，文件存放与可再生资料需区分。 | iCloud/CloudKit 依赖 Apple 账户与系统环境，不是跨 Android/Web 的默认同步方案；自动同步建议只在已采用该服务时适用，不能转成当前应用已保障卸载恢复的承诺。 |
| [ID Verifier](https://developer.apple.com/design/human-interface-guidelines/id-verifier) | 当前范围外 | ID Verifier用于面对面核验证件，区分仅显示与需额外权限的数据传输，并要求最少数据及清晰核验按钮。书灯无需身份或年龄核验，不引入证件收集。 | 限定受支持iPhone与iOS、证件标准及授权场景，不能推导跨端通用身份认证需求。 |
| [iMessage apps and stickers](https://developer.apple.com/design/human-interface-guidelines/imessage-apps-and-stickers) | 当前范围外 | 本篇针对 Messages 会话内扩展与贴纸包，书灯无此协作或贴纸任务。不据此增加引用贴纸、聊天扩展、社交推荐或会话内互动功能。 | 紧凑/展开 Messages 视图、各贴纸尺寸、500 KB 文件限制及扩展图标规格只约束 iOS/iPadOS Messages 扩展，不是书灯跨端聊天界面的规范。 |
| [Live Photos](https://developer.apple.com/design/human-interface-guidelines/live-photos) | 当前范围外 | 本篇针对含声音和前后帧的 Live Photo 捕获、编辑、播放与分享，书灯不采用这些能力。不把静态封面或书内插图变成动态照片，也不把 Live Photo 标记引入书籍内容。 | Live Photo 的完整性、系统徽章、播放方式与不支持环境显示静态图的回退针对该媒体类型；visionOS 仅查看不可捕获，不能据此判定普通照片或视频支持范围。 |
| [Mac Catalyst](https://developer.apple.com/design/human-interface-guidelines/mac-catalyst) | 条件参考 | 只有选择 Mac Catalyst 移植路线后，本页才形成实现依据：桌面应重新审查布局、字体、窗口尺寸、键盘、指针、菜单栏和分页入口，而不是缩放复制触屏布局。跨端一致的是功能可达与任务语义。 | 不据此选择 Catalyst、扩大 macOS 首发范围或要求 Android/Web 用 Mac 控件。本页最后更新 2023，关于 iPad 菜单栏的描述与较新 Menus 页面不同，具体平台能力须以新文档和目标系统核对。 |
| [Machine learning](https://developer.apple.com/design/human-interface-guidelines/machine-learning) | 跨端采纳 | 阅读问答是阅读的补充能力：依据、限制与失败应在使用上下文内说明，给读者可执行的纠正或重试路径。只有验证过置信度与结果质量相关时才传达置信度，不以相似度百分比冒充回答可靠性。 | 这些是跨端体验原则；不因此引入推荐流、隐式行为采集、在线学习、校准或多候选生成。Core ML/Create ML 是 Apple 实现选择。 |
| [Maps](https://developer.apple.com/design/human-interface-guidelines/maps) | 当前范围外 | 地图、地点卡与室内导航不在书灯范围；本页不能推导出位置权限或地图入口。地图的可读标记、逐级披露和不重复信息仅在未来有明确位置任务时再评估。 | Apple logo/legal 留白、MapKit 地点卡、watchOS 静态地图均为特定平台或服务契约，不能成为全端通用布局规则。 |
| [NFC](https://developer.apple.com/design/human-interface-guidelines/nfc) | 当前范围外 | 本篇针对识别现实物体的近场扫描，书灯没有此任务，不新增实体书扫描或标签识别。其明确使用对象名称与真实动作说明的写法可作一般文案参考，不能把开发术语暴露给读者。 | Core NFC、后台读取条件、扫描 sheet 和兼容设备边界限 Apple 扫描能力；不是 Android/Web 的硬件支持或交互承诺。 |
| [Photo editing](https://developer.apple.com/design/human-interface-guidelines/photo-editing) | 当前范围外 | Photos 编辑扩展不在书灯范围；其保留原件、预览修改、仅在有未保存改动时确认丢弃，可作为数据编辑交互的条件性参考。 | Photos 容器工具栏、扩展图标与新文件保存是 Apple 扩展契约，不能强加给阅读笔记流程或推导出图片编辑功能。 |
| [ResearchKit](https://developer.apple.com/design/human-interface-guidelines/researchkit) | 当前范围外 | 本篇针对医学研究的资格筛选、知情同意、研究任务、调查和受试者资料，书灯不是研究应用。不能据此为 AI 服务发送说明添加测验、签名、研究同意流程或健康数据请求。 | ResearchKit 的 iOS/iPadOS 场景及伦理、法律边界不能代替书灯自己的隐私与发送说明决策，也不形成跨端问卷能力要求。 |
| [SharePlay](https://developer.apple.com/design/human-interface-guidelines/shareplay) | 当前范围外 | SharePlay面向同步进行的多人活动，强调加入顺畅、共同状态可理解、个人舒适设置独立与离开后可重返；全文还覆盖空间Persona和座位模板。书灯当前为个人阅读，不增加共读、协作或社交。 | Group Activities、FaceTime、visionOS空间席位及每人内容授权属于Apple平台场景，不能当作跨端协作协议或个人阅读要求。 |
| [ShazamKit](https://developer.apple.com/design/human-interface-guidelines/shazamkit) | 当前范围外 | ShazamKit 音频识别不在书灯范围；若未来确有采样能力，应在需要时解释麦克风用途、尽早停止录音，向资料库写入前给人控制。 | Shazam/iCloud 音乐库行为是特定服务规则；不得以阅读或 AI 问答为由申请麦克风，也不新增识曲能力。 |
| [Sign in with Apple](https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple) | 当前范围外 | 书灯当前阅读与本机记录不需要账户，不能为套用此篇增加登录门槛。若将来另行确认账户，登录应交换明确价值、尽量延后并最小化数据收集，尊重用户选择的转发邮箱。 | Sign in with Apple 可用于非 Apple 平台和网站，但只有采用该服务时才适用其官方按钮、标志、字号比例、最小尺寸与文案规则；不是所有平台统一使用 Apple 登录的要求。 |
| [Tap to Pay on iPhone](https://developer.apple.com/design/human-interface-guidelines/tap-to-pay-on-iphone) | 当前范围外 | 本篇针对商户通过 iPhone 接受非接触付款，涉及 PSP、条款、设备准备、PIN 和交易结果。书灯无商户收单任务，不采用此能力、支付文案、教育流程或结账页面。 | 仅面向受支持 iPhone 的 Tap to Pay/ProximityReader，不能与 Apple Pay、应用内购买或一般支付混同；不据此增加任何收费模式。 |
| [Wallet](https://developer.apple.com/design/human-interface-guidelines/wallet) | 当前范围外 | 全文涵盖票卡样式、字段、图像尺寸、订单跟踪、身份验证及 Apple Watch 适配。书灯的个人阅读任务没有票卡、交易履约或证件核验需求，不据此增加 Wallet 集成。 | PassKit、Wallet 按钮、票卡素材尺寸与 watchOS 裁切都是特定生态约束；不可转成 Android/Web 设计规范。 |
