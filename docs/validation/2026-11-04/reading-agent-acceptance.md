# 阅读 Agent 重构验收记录

实现分支：`codex/reading-agent-rebuild-20261104`。状态：代码已实现、模拟器已部署，尚未发布；以下区分自动化、真实 App 运行和未验证交互。方案与工具契约见 [阅读 Agent 与 RAG 重构](../../archive/planning/reading-agent-rebuild.md)。

## 1. 已实现

- assistant-ui React Native 的消息列表、消息 Parts、输入、发送和取消；窗口采用 Gorhom Bottom Sheet 的 `['76%', '100%']` 两档，保留覆盖层与全屏专注交互。
- LangChain Agent 工具循环、Deep Agents 官方 Memory/Skills，以及仅支持运行内文本的 `read_file`。书灯保留引用核验与现有上下文压缩策略。
- 当前书的关键词/本地向量混合检索、目录、前后原文与游标续读；稳定片段及索引版本校验。实际 RN/Readium/PDF 位置适配，重复文字通过前后文消歧。只有章节或阅读进度时向模型说明精度，不能声称精确选文定位。
- OpenAI Responses、Anthropic 服务端搜索、真实来源、预算及明确能力错误降级。联网默认关闭；未确认的中转服务不凭模型名称开启搜索。
- SQLite 助手指令、各模型服务的联网开关、两套调用方导航栈与草稿保留；每次发问固定配置快照。来源与书内引用分别持久化，取消/重启后不显示永久搜索中。

## 2. 自动化证据

下表为初次实现的检查快照；命令已调整为当前可用入口。本轮代码整理后的整仓证据见 [代码结构与可靠性整理](code-quality-refactor.md)。

| 检查 | 结果 | 执行方式 |
| --- | --- | --- |
| Core 全套 | 240 通过、9 跳过 | `pnpm --filter @shudeng/core test` |
| 移动索引与平台生命周期 | 132 通过 | `pnpm --filter @shudeng/mobile exec vitest run src/platform/library/__tests__ src/platform/ai/__tests__` |
| 聊天生命周期与 assistant-ui adapter | 23 通过 | `pnpm --filter @shudeng/mobile exec vitest run src/ui/chat/__tests__` |
| 设置与会话 SQLite | 64 通过 | `node --experimental-strip-types --test apps/mobile/src/platform/settings/__tests__/*.test.mts apps/mobile/src/ui/settings/__tests__/*.test.mts apps/mobile/src/ui/conversations/persistence.test.mts` |
| TypeScript | Core、Mobile 通过 | 两包各自 `typecheck` |

9 项跳过属于需要额外运行环境的 provider redirect 集成测试，不代表真实服务商联网已验收。真实 SDK 的受控协议测试覆盖搜索开关、来源、超预算、仅明确搜索能力错误降级、已有正文不重复请求、SSE 心跳和取消。

独立复审曾复现三项缺陷，均已修复并以真实内存 SQLite 复验：新旧索引在 emoji 容量边界续读漏块；实际阅读 locator JSON 不被工具识别；旧索引长问句向量超限并退化成零命中。复验确认完整续读、重复选文消歧、长问句完整分段及 FTS/向量召回。

## 3. 构建与实际 App

`scripts/build-ios-rn.sh Release` 返回 `BUILD SUCCEEDED`。Hermes 打包 4242 模块；模拟器 App 约 185 MiB。安装到 **Shudeng Small**（`1B9B9A35-F2D7-4D87-AB31-6B07D1B27D66`），原生基线模拟器保持独立。构建日志为 `.build/rn-ios/reading-agent-build.log`；构建完成时可用空间约 38 GiB。独立导出临时目录已回收，未修改构建脚本。

实际验收使用已配置的 `127.0.0.1:8765` 受控 Chat Completions 服务，无外网请求；它返回固定测试回答，只验证执行与展示，不证明真实回答质量。
测试结束后该临时服务已关闭；当前 AI 服务选择未改动。继续真实提问时，需要在 AI 服务页切换到读者已有的真实模型。

| 操作 | 观测与结果 |
| --- | --- |
| 对《论语》自动发问 | 真正发出两次 SSE 请求；第二次包含一次 `search_book` 返回。UI 显示完成回答及“书内依据 [1]”卡片。 |
| 重启 App 后重新打开会话 | 回答与引用从 SQLite 恢复；没有新增模型请求。数据库为 user/assistant 各一条、status=done、工具一项、E1 定位 JSON 有效。 |
| 独立慢速流式会话 | 页面显示问题、生成中状态与“停止生成”入口。 |
| 生成中离开问答路由 | 服务端继续完成；数据库最终 status=done、回答 31 字符，未重复生成。该操作验证路由离开，不等于实际下拉或关闭按钮点击验收。 |
| 打开阅读助手设置 | 实际原生页面显示 Markdown 指令编辑器与保存入口；编辑保存语义由上述自动化测试覆盖。 |

本地截图保存在 `.scratch/reading-agent-acceptance/`：`restored-answer.png`、`assistant-settings.png`、`streaming.png`。测试会话分别为 `book:reading-agent-smoke-20261104` 与 `book:reading-agent-stream-20261104`，没有改动已有会话和模型配置。

### 官方完整界面预览（本轮更新）

用户要求先完整采用 assistant-ui 默认界面查看效果。本轮直接导入官方 Native Elements registry 的完整 `Thread`，替换前一版沿用旧样式的消息与输入区；保留默认英文文案和官方黑白主题。来源与局部宿主适配记录见 `apps/mobile/components/assistant-ui/README.md`。选文、书内引用、网页来源和设置通过附加插槽承载。

- 本轮 Mobile 类型检查与聊天测试 23/23 通过；独立只读复核确认停止、草稿、能力隐藏、滚动宿主接口与单层键盘避让的源码接线。
- `scripts/build-ios-rn.sh Release` 构建通过，Hermes 6682 模块，模拟器 App 约 193 MiB。日志 `.build/rn-ios/assistant-ui-official-build.log`。已安装到同一 Small 模拟器；结束时 `.build/rn-ios` 约 12 GiB，可用空间约 36 GiB。
- 实际 App 已查看默认空态、已保存回答、Reasoning、`search_book` 工具行、流式正文、生成中方形停止按钮及完成后的书内引用。独立受控会话 `book:assistant-ui-official-preview-20261104` 完成两次 SSE 请求，第二次携带一次书内工具结果；没有外网模型请求。临时本机服务已关闭，模型配置未改动。
- 截图位于 `.scratch/reading-agent-acceptance/`：`official-empty.jpg`、`official-answer.jpg`、`official-streaming.jpg`、`official-completed.jpg`。仅观察到按钮与内容显示，不代表已点击停止、完成手势或键盘验收。

### Claude 手机适配与原生吸附弹层（2026-11-05）

- 界面按官方 Claude Web 示例适配 RN：暖色明暗主题、中文状态、宋体正文、橙色发送/停止，输入固定底部并支持多行；没有接入网页容器或新增依赖。
- 用户否定自定义透明拖动窗口后，已恢复原生 `formSheet` 的 `[0.76, 1]` 两档与系统吸附、层叠效果，删除本次自定义几何/拖动代码及对应测试。最大档请求隐藏状态栏与去除圆角。品牌标题行已移除。
- 本轮 Mobile 类型检查、23 项聊天回归和统一 Release 构建通过，安装到 Small。实际截图确认原生浮层及暖色问答显示正常，证据 `.scratch/reading-agent-acceptance/claude-mobile/native-sheet-answer.jpg`。
- 设备语义快照仍无触控目标，Device Hub 只返回倾斜缩略图；未宣称松手吸附手感、最大档屏幕边界、键盘或引用点击已通过。原生基线、用户书籍与模型配置未修改。

### 现成 Bottom Sheet 接入（2026-11-05）

用户截图证实上一轮原生卡片的最大档仍露出阅读器工具栏，并要求使用成熟组件。此轮替换为 `@gorhom/bottom-sheet@5.2.14`，不保留自定义拖动/吸附/键盘算法。原生透明路由只维护导航生命周期；100% 档对应容器顶部 0，安全区只用于内部内容，未给窗口留外部顶边距。

- 使用官方把手、Backdrop、两个固定吸附档、`BottomSheetTextInput`、`BottomSheetScrollView` 和 `BottomSheetFooter`。assistant-ui 原消息 Provider、引用、滚动接线及唯一草稿状态保留；关闭不取消后台回答。输入时进入最大档，收键盘后可保持最大档，再下拉回 76%。
- 首次实际截图发现 76% 档内联输入区落在屏幕外，已改用官方固定 Footer；运行时与业务 Provider 包住窗口，Footer 类型稳定，避免流式更新重挂输入。底部安全区计入 Footer 实测高度，列表通过库自带余量调整避让。
- 本轮 Mobile 类型检查、聊天 23/23 与 diff 检查通过，独立源码复审完成。统一 Release 构建通过，App 193 MiB，已安装 Small；最终可用空间 41 GiB。复用 `.build/rn-ios/derived` 与 `.build/rn-ios/claude-mobile-build.log`，没有新增独立构建目录。
- 实际截图确认 76% 浮层、暖色回答、书内依据及底部输入区可见，证据 `.scratch/reading-agent-acceptance/claude-mobile/gorhom-sheet-answer.jpg`。查看的是已保存受控会话，没有发起新的模型请求。截图未证明引用点击、键盘或最大档手势通过。
- 语义设备快照仍为 1 节点、0 触控目标；最大档屏幕边界、松手吸附、键盘与长列表惯性滚动仍待可触控设备验收，不以源码尺寸或构建结果代替。

### Bottom Sheet 连续外观与悬浮输入（2026-11-05）

用户触控确认两档与全屏方向正确，同时报告圆角/方角硬切、空态偏下和输入文字裁切。此轮保留 Gorhom 手势、弹簧与键盘逻辑，仅调整官方外观/布局扩展点。

- 官方 `backgroundComponent/handleComponent` 读取组件的 UI 线程 `animatedIndex`，连续插值圆角与内部安全区，删除松手后的 React 状态切换。不另设拖动阈值或吸附算法。
- 空态通过 `BottomSheetFooter` 提供的最终位置与实际正文坐标确定可见高度，在当前聊天区域居中；不复制键盘高度算法。输入区减少垂直 padding，最小高度兼顾系统字号与实测多行内容。
- 继续使用官方固定 Footer，去掉整条不透明底座；输入卡片保留白色/深色圆角背景与轻阴影，透明边缘允许触控穿到消息。库内置 Footer 内容余量保留，使末尾可以滚出卡片上方。
- 类型检查、23 项聊天回归、diff 检查及独立源码复审通过。统一 Release 构建通过并部署 Small，App 193 MiB，构建结束可用空间 41 GiB。实际空态和保存回答截图确认居中、完整中文提示与悬浮卡片外观，证据 `claude-mobile/gorhom-polish-empty.jpg` 和 `claude-mobile/gorhom-polish-history.jpg`（均位于 `.scratch/reading-agent-acceptance/`）。没有发起模型请求。
- 圆角随拖动的连续手感、键盘、大字号多行及历史从卡片背后滑过仍需触控验收；静态截图不作为流畅度证明。

### 上下文圆环与发送时配置提示（2026-11-05）

用户要求去掉输入左侧的双菜单入口，以圆环呈现上下文容量，并用轻量方式查看明细。

- 左侧改为 20pt 上下文圆环、44pt 触控区域；单击在输入卡片内展开，再点击收起。用户随后要求参照 Codex 精简，当前只保留“上下文 · 约 N% 已用”和“Nk / Mk token”两行，移除材料构成与整理说明。没有菜单、Alert、Modal 或遮罩。无请求记录或窗口未知时仅显示空轨道与“—”，不伪造零占比；超过容量时文字保留真实百分比。
- 常态不展示设置入口。未配模型仍可尝试发送，此时只显示内联“去设置”提示并保留问题及选文；不新增消息、落库或发起模型请求。提示可收起，模型配置可用后清除。`send` 返回是否接收，由 assistant-ui 的公开 `MessageNotSentError` 处理未接收时的草稿恢复；宿主不再重复恢复输入。
- 本轮聊天回归 28/28、类型检查与独立复审通过；新增回归覆盖未知容量/超容量显示、发送后才提示、问题与选文保留、零模型请求与零会话写入。设备上的圆环点击展开和未配模型发送仍须单独触控验收，未通过修改当前模型配置伪造验收。
- 最终统一 Release 构建通过并安装 Small；实际保存会话截图确认圆环与悬浮输入显示，证据 `.scratch/reading-agent-acceptance/claude-mobile/context-ring.jpg`。App 193 MiB、构建结束可用空间 41 GiB，无 `tmp-*` 残留；未修改当前服务或凭据，没有新模型请求。

### 设置分组与服务级联网

- “我的”合并为“AI 与助手”单入口，主设置收为模型服务、阅读助手、本地语义资料、其他四组。阅读助手仅编辑指令；MCP 服务在“其他 → 外部工具”列表管理，保留原编辑深链和调用授权。
- 联网开关随模型服务独立保存，新服务默认关闭。仅已确认支持的端点可在编辑页开启，开关旁提示服务商搜索、可能额外收费与保存生效。旧全局开关仅一次迁到原选中服务，已有服务级值优先；迁移和完成标记一起写入，失败可重试，不改密钥或指令。
- 平台迁移/持久化/原发送确认专项 35/35、请求配置快照 4/4、设置 UI/路由/MCP 专项 30/30 通过；mobile 类型检查、diff 检查和独立只读复审通过。
- 统一 Release 构建通过并安装 Small。真实截图确认主设置、默认 DeepSeek 新服务草稿中的不可用联网开关，以及保留已有服务器的 MCP 列表；证据在 `.scratch/reading-agent-acceptance/settings-reorganization/`（3 张，共约 132 KiB）。没有保存草稿、切换服务、改写密钥、调用 MCP 或发起模型请求。
- 设备点击保存/取消、切换服务与开关交互未实测；自动化状态与持久化检查不能替代触控验收。构建结束可用空间 41 GiB，无 `tmp-*` 残留；保留最少截图证据，已删除本轮工具产生的临时截图副本。

### 书架移除继续阅读卡片

- 按用户要求删除顶部“继续阅读”卡片、专用样式、最近一本书偏好的读写与候选计算；搜索下直接显示书籍网格。阅读进度存储及阅读器恢复位置逻辑未改。
- mobile 类型检查、diff 检查及现有书架/弹窗测试 15/15 通过；补齐旧测试的 PDF 导入 mock，并等待异步动画初始化后检查。
- 统一 Release 构建通过并安装 Small；真实截图确认卡片消失、7 本书及进度正常显示，证据 `.scratch/reading-agent-acceptance/shelf-without-continue.jpg`。未对书籍或进度执行数据清理；可用空间 41 GiB，无构建临时目录残留。

### 书架统一系统导航与搜索

- 书架使用与笔记、对话相同的原生 Stack 大标题与 stacked 搜索，`hideWhenScrolling: false`；网格自动调整导航安全区，移除滚动内容里的重复页头/搜索框。导入使用系统工具栏，保留两列书籍、排序、导入状态及取消。
- 取消搜索清空查询并恢复首次聚焦前偏移；空结果可清除查询。书架独立导航栈使用当前 Expo Router 的 `anchor`，实际路由解析确认 `/`、`/(tabs)` 回到书架，笔记、对话及阅读器深链保持。
- 新书架行为 5 项、真实 Expo 路由 3 项、既有书架/弹窗 15 项，共 23/23 通过；mobile 类型检查及 diff 检查通过。统一 Release 构建通过并安装 Small，截图确认系统搜索栏、大标题、四栏和 7 本书显示，证据 `.scratch/reading-agent-acceptance/shelf-native-search.jpg`。
- 尚未执行设备滑动、搜索聚焦/取消与键盘触控验收，不以静态截图证明动画流畅；临时截图副本已删除，无构建 `tmp-*` 残留，可用空间 41 GiB。

## 4. 未验证项

设备工具的截图可用，但 `snapshot_ui` 对 App 和系统界面均只返回一个节点、零触控目标；Device Hub 的界面截图返回倾斜缩略图。未据此猜测点击或宣称交互通过。以下仍需可操作设备验收：

1. 上拉全屏、下拉收回，以及列表滚动和窗口拖动衔接。
2. 键盘避让、输入后立即发送、多行输入与未发送草稿关闭重开。
3. 实际点击停止、重试、书内引用回跳、返回后的滚动锚点及网页链接。
4. 真实 OpenAI/Anthropic 外网搜索与回答质量；中转服务仍需显式能力确认。
5. 真机、Android、深色和各辅助字号下的完整视觉与性能验收。

## 5. 交付边界

现有正式版本与原生基线未发布或替换。旧索引在后台升级，升级前保留关键词查找；新向量路径仅在当前格式标记后使用，不混用可能截断的旧向量。尚未验证的手势、真实 API 与跨端能力不能由自动化通过或构建成功代替。
