# “我的”页面分组 Demo

2026-11-10，分支 codex/ui-product-integration 的未提交工作区。以下首轮仅修改 visual-demo 内的 DemoProfile、DemoModelSettings 和 VisualDemo；不接产品路由、数据或服务。用户已同意内容分组；后续认可大体方向并要求去掉两个入口，见末节。任务 [#60](https://github.com/andyWang1688/shudeng/issues/60)。

## 实现与运行

保留“我的”底栏；首页显示“AI 与助手”和“通用”两组，检索及扩展入口并入前一组。没有设置中转页、阅读报告占位、重复阅读主题入口。AI 服务列表与编辑页名称统一为服务，模型名称仍是独立配置字段。助手指令使用本轮进程内的草稿和保存状态，资料、MCP、发送说明及关于仅展示样本边界。

依据是[产品内容归属](../../product-scope.md#我的与设置)和[跨端界面规范](../../design/ui-development-standard.md)。具体分组、间距属于本次提案，Apple 的 [Settings](https://developer.apple.com/design/human-interface-guidelines/settings) 和 [Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)用于核对作用范围、分组与导航语义，不表示 Apple 认可本稿。

通过 pnpm --filter @shudeng/mobile demo:ios profile 复用现有 Release 原生包并更新 JavaScript；Small，iOS 26.5，bundle ID dev.shudeng.visualdemo。没有新增 Xcode 构建或修改正式 App。构建脚本已回收本轮三个 tmp 安装目录。

## 设备结果

| 输入与操作 | 观察结果 | 边界 |
| --- | --- | --- |
| 打开我的首页 | 两组及全部六个入口可见；底栏为书架、对话、我的。 | 当前 Small 尺寸和文字设置；不代表全部文字缩放。 |
| 打开 AI 服务，选择 OpenAI，返回；再选回 DeepSeek | 首页摘要随选择更新。 | 内存样本，不是模型调用或持久化。 |
| 打开助手指令，返回 | 指令文本、返回、保存和恢复默认入口可见。 | 自动输入工具返回成功但文本未改变；编辑、草稿恢复和保存后的内容尚未验证，未据此判断应用缺陷。 |
| 打开离线语义资料，点下载资料，关闭提示并返回 | 显示未下载；明确提示 Demo 不下载或建索引；返回仍显示未下载。 | 下载、取消、重试及删除未接线。 |
| 逐一打开 MCP、关于及 AI 发送说明，返回 | 空状态及样本可达；发送接收方显示已选择的 OpenAI。 | MCP 配置/授权和真实隐私告知未接线；关于未补版本、政策及许可。 |

首页截图见[profile-demo.png](profile-demo.png)。截图证明当前布局，不证明动态手感、VoiceOver、真实模型或数据保存。

## 检查及限制

移动端类型检查、Demo 打包与安装通过。没有为可逆的视觉原型新增镜像测试。真实网络、密钥、服务能力、模型费用、数据库保存、跨端布局、VoiceOver 和用户视觉确认均未验证。旧“设置”提案的否决记录保持原样，本次运行不改变其历史结论。

## 后续反馈：精简为四个入口

用户认可新版大体方向后，要求当前不展示外部工具和独立 AI 发送说明。Demo 已移除这两个入口及对应样本子页，保留 AI 服务、助手指令、离线语义资料、关于书灯；仍为两组。服务配置时的必要告知、聊天发送范围与既有 MCP 数据不在本轮删除范围。产品规范已同步；正式设置页面尚未接入这一版。

复用原生包更新 JavaScript 后，在 Small 的“书灯·UI”实际切换到我的页，确认两组、四个入口及底栏名称，见[当前截图](profile-demo-simplified.png)。移动端类型检查通过。以上首轮六入口截图和操作结果保留历史；这次没有重新验收服务编辑、下载、密钥、真实告知或持久化。对话左滑的同轮修复另见[记录](conversation-swipe-actions.md)。

## 服务编辑工具栏替换

用户指出编辑页“取消/保存”观感别扭。位置与单页编辑语义符合 Apple [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets#Platform-considerations) 的 leading 取消、trailing 完成模式；旧实现实际为手工 RN Header，按钮、边距和标题缺少系统工具栏的整体处理。Apple [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars) 建议优先标准组件、可辨认符号与尾端主要操作；图标方案属于本次原型选择，不能说 HIG 禁止文字按钮。

当前 iOS 独立 Demo 使用已安装的 Expo UI NavigationStack / Toolbar，取消置于 cancellationAction、保存置于 confirmationAction；xmark 与 checkmark 使用系统按钮及样式，保存以书灯棕色强调，读屏名称仍是取消/保存。高级设置使用返回操作，表单由 RNHostView 承载，沿用现有表单字段、dirty 关闭确认、校验与内存保存回调。默认平台文件保留原 Header 预览，未新增依赖或原生模块。

Small iOS 26.5 实际打开我的 → AI 服务 → 编辑 DeepSeek，当前效果见[原生工具栏截图](profile-editor-native-toolbar.jpg)。再进入高级设置并返回，标题和返回操作正常切换，表单保留原值。移动端 typecheck、格式、JS 打包与安装通过，仅复用既有 Release 原生包；临时打包目录已自动回收。

Xcode runtime snapshot 能看到“取消/xmark”和“保存/checkmark”，但触控工具点取消后界面未变化；Device Hub 仍为后台倾斜缩略图，未将其计为通过。原生主编辑栏未出现在该工具的可访问镜像里，高级设置返回却可操作；不能由此断言 VoiceOver 本身失败或通过。本轮取消/保存实际点击、修改后的放弃与保存、键盘配合、大字体和完整 VoiceOver 仍未验证。没有输入真实 Key、发模型请求、修改正式设置或发布。

## 服务删除与上下文自由输入

用户指出删除入口难找、窗口不能选择 1M。源码确认：Demo 原来只有自动至 200K，正式页虽含 1M，仍没有自由输入；正式 aiCatalog 校验拒绝超过 1,000,000，bookChat 再把预算截到 1,000,000，自动值按接口类别固定回退。本轮只更新独立 Demo，不将 UI 输入成功当作正式大窗口支持。

iOS AI 服务列表改用既有 Expo UI 的 List / SwipeActions，保留点选与编辑按钮，左滑显示删除；编辑页底部仍可删除，两处共用确认。首轮用 destructive role 时，通过系统辅助动作打开确认再取消，AX 中服务仍在，实际截图却隐藏了行。已移除此 role，仅保留红色动作，第二轮截图确认取消后两条服务都恢复显示。该失败与修复不影响真实数据库。

高级设置取消固定窗口菜单，提供自动开关和手动 Token 输入；可填 1M、200K、1047576，也可超过 1,000,000。数值按十进制 K/M 解析，拒绝零、负数、非整数结果、无效文本和超出安全整数范围的值；保存时使用完整数字。自动状态没有接模型资料，文案明确尚待接入，不伪造识别结果。

| 实际输入与操作 | 结果 | 边界 |
| --- | --- | --- |
| 服务列表辅助删除动作 → 取消 | 第二轮截图确认 DeepSeek、OpenAI 均可见；未提前隐藏行。 | 辅助动作验证回调与取消，未验证真实指针左滑。 |
| 列表删除 OpenAI → 确认 | OpenAI 移除，DeepSeek 仍选中；有已删除提示。 | 内存样本；重启恢复。 |
| 首轮编辑页删除当前 DeepSeek → 取消，再确认 | 取消保留编辑；确认返回列表，余下 OpenAI 未自动选中。 | 第二轮共用同一删除回调；真实服务配置、凭据与历史保留未验。 |
| 高级设置输入 1M、返回并重开；再填 1047576 | 两种值均可输入、返回并保留在草稿。 | 未据此宣称保存或模型请求成功。 |
| 手动输入 0 后返回 | 保留当前页并出现修正提示；改成 1047576 后可返回。 | 本轮具体校验时机；真实键盘全路径和完整辅助技术未验。 |
| 输入 1M → 自动开 → 自动关 | 手动值恢复为 1M，截图可见。 | 本轮编辑草稿；不是数据库持久化。 |

移动端类型检查和两轮 JS 打包、Small 安装通过，复用已有 Release 原生包。Node 定向检查 15 个输入，包括 1M、2m、200K、1.05M、1047576 及无效值，通过；没有新增镜像测试。保存工具栏自动点击未引起界面变化，保存和重开后的值仍未验证。当前截图为[取消删除后的服务列表](profile-services-native-list.jpg)与[1M 输入](profile-context-window.jpg)。

依据为 Apple [Settings](https://developer.apple.com/design/human-interface-guidelines/settings) 的合理默认和能力检测、[Text fields](https://developer.apple.com/design/human-interface-guidelines/text-fields) 的短值输入及有用校验；Apple 没有规定 AI 窗口选择方式。LangChain 官方 [Model profiles](https://docs.langchain.com/oss/javascript/langchain/models#model-profiles) 确认 model.profile 可提供 maxInputTokens 等资料，主要随集成包发布并源自 models.dev，可能缺失、过时或错误，可覆盖；这不是对自定义服务地址的实时能力证明。正式接线需区分输入/输出限制与共享窗口，去除与实际模型不符的固定上限，并单独验预算和服务错误。
