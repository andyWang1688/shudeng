# 产品范围

## 已确认

- 品牌文案：一盏照书的灯，AI 照亮你读不懂的地方。2026-10-23 用户确认沿用；允许复用原书灯品牌图标，见[资源例外](adr/0001-independent-implementation.md)。
- 目标读者：阅读外语或较难非虚构书籍、需要理解难点的个人读者。
- 核心价值：读者在阅读中直接针对不懂的内容提问，问答记录可以保留。
- 内容范围：首发支持用户导入可重排 EPUB；固定版式 EPUB 与 PDF 暂缓。
- 提问范围：选文是提问起点，可从当前书其他章节查找相关依据；选文提问、单书自由提问与追问共用内置 multilingual MiniLM 的本地向量与关键词合并检索，见[阅读问答设计](reading-ai-design.md)和[决策](adr/0008-local-hybrid-retrieval.md)。整书问答不承诺完整概括全书，不逐章覆盖；跨书问答仍移后。
- 阅读范围：所有问答都允许参考当前整本书，包括未读章节；不提供已读范围选择或已读章节确认入口，见[决策](adr/0011-remove-only-read-scope.md)。
- 阅读方式：首发同时支持左右翻页、连续滚动和仿真翻页；默认左右翻页，记住用户选择。
- 阅读内核：Readium Swift 3.11.0，配合独立 UIKit 卷页适配与最小手势补丁，见[决策](adr/0004-readium-reader.md)。
- 后台生成：关闭面板不取消；首发以20～60秒内回答的后台完成为验证目标，不保证固定运行时间。中断保留已有内容并提示重试；不引入协调服务器、任务编号和复杂恢复机制，见[决策](adr/0006-bounded-background-generation.md)。
- 对话入口：进入对话栏目默认展示历史，按书分组；阅读页每次发起选文或单书自由提问都新建对话，追问留在该对话中，保留引用文字和原文位置。
- 移除书籍：默认保留笔记、对话和引用文字供回看；另提供需要明确确认的连同记录彻底删除。原文文件不在时的定位及重新导入关联规则待细化。
- AI 服务：由读者自行提供，支持保存多套接口格式、地址、密钥和模型配置，选择其中一套使用；支持 OpenAI、Anthropic 两种接口格式，切换服务不影响已保存对话，书灯不提供或代付 AI 服务。保存或更换服务时展示一次 AI 服务发送说明，确认后普通问答不再逐次弹出，见[决策](adr/0012-confirm-ai-send-scope-on-setup.md)。
- 产品原则：阅读内容是主角，AI 按需辅助；界面克制、清晰，默认路径简单。
- 界面方向：保留四栏、书架网格及对话历史布局和纸白、墨色、暖灯色；按阅读优先、渐进披露和一页一件事重做信息层级。AI 设置默认只保留选择与状态，长说明进入详情；正文始终使用整个安全区域，阅读控件以覆盖层淡入淡出，点击不改变正文位置。2026-10-23 设计稿转为历史证据，见[信息层级](adr/0010-reading-first-progressive-disclosure.md)与[覆盖式阅读控件](adr/0013-fixed-reading-viewport-overlay-controls.md)。
- 首发设备：iPhone；不将专门的 iPad 布局与多窗口体验列为首发目标。
- 分发目标：最终上架 App Store。
- 当前优先级：先解决读者问题、验证产品价值，不讨论或预设收费模式。
- 可靠性要求：首发本机可靠保存阅读进度、笔记和问答，并处理保存失败及草稿恢复。用户已将完整备份导出与恢复移后，云同步也不纳入首发；不承诺通过首发功能在卸载或设备丢失后恢复数据。
- 旧项目关系：不迁移 ReadAny 数据；允许参考有价值的布局与交互，独立实现且不复制其代码、提示词、文案、资源或 Git 历史。
- 产品基线：用户已确认参考 ReadAny 的 `feat/native-ios` 分支、`packages/app-ios/Shudeng` 应用的已有功能、布局与交互，精简成首版，不从零重新设计整套产品。用户说明重建动因是内核许可限制与部分功能维护困难；具体依赖问题尚需分别核实。
- 技术边界：不预设旧项目架构；允许使用许可适合分发的第三方组件。

## 首发范围

主要功能取舍已确认；表内标明建议或待定的细节仍需确认。

| 模块 | 建议首发范围 | 精简或移后 |
| --- | --- | --- |
| 导航 | 保留书架、笔记、对话、我的四栏；阅读器全屏，阅读中打开 AI 弹层 | 不重新设计整套导航 |
| 书架 | EPUB 文件导入、继续阅读、书名/作者搜索、基础排序与移除；默认保留阅读记录，可确认后彻底删除 | PDF、独立的跨书语义搜索入口暂缓；不限制问答所需的书内检索 |
| 阅读 | 目录、书内搜索、书签、字号与明暗主题；保存阅读位置；左右翻页、连续滚动、仿真翻页 | 朗读、独立翻译入口、高级排版设置暂缓 |
| 笔记 | 选文高亮、写笔记、集中回看与编辑、返回原文；一种可读格式导出 | 首发建议只导出 Markdown，不同时维护 HTML 导出 |
| 阅读问答 | 选文、单书自由提问与追问共用当前书本地向量与有界关键词候选合并，按稳定块身份去重；最终最多8块、原材料预算、一次最终生成；新建对话、历史及可定位引用 | 跨书问答、无书籍通用聊天移后；不承诺完整全书概括，不固定带邻文、不做 AI 预处理或补查、不引入工具 agent，不提供嵌入模型选择、下载或云端 embedding |
| 对话历史 | 默认历史列表、按书分组、最近更新优先；继续、改名、删除 | 更改会话所属书籍暂缓；不将原版的具体排序规则视为必须复刻 |
| 我的与 AI 设置 | 外观、AI 服务、关于；常用服务预设、可见字段标签、连接检查与一次性发送说明；保存多套配置并选择一套使用 | 阅读统计、智能搜索配置暂缓；协议细节与自定义端点放入高级设置 |
| 数据可靠性 | 本机保存；失败可见、草稿可找回、重试不重复 | 完整备份导出与恢复、云同步移后 |

## 参考版本的静态事实

2026-10-14 基于本地 ReadAny `feat/native-ios` 的界面与相关保存逻辑确认；未运行旧应用，不能将代码存在性当作实际可靠性验证。只记录行为，不复制旧实现或材料。

- 四栏导航、全屏阅读和阅读内 AI 弹层：[RootView.swift](https://github.com/andyWang1688/ReadAny/blob/feat/native-ios/packages/app-ios/Shudeng/RootView.swift#L27)。
- 书库支持 EPUB/PDF、继续阅读和搜索：[LibraryView.swift](https://github.com/andyWang1688/ReadAny/blob/feat/native-ios/packages/app-ios/Shudeng/Features/Library/LibraryView.swift#L100)。
- 阅读设置、目录搜索及标注入口：[ReaderScreen.swift](https://github.com/andyWang1688/ReadAny/blob/feat/native-ios/packages/app-ios/Shudeng/Features/Reader/ReaderScreen.swift#L433)。
- 笔记可导出 Markdown/HTML：[NotesView.swift](https://github.com/andyWang1688/ReadAny/blob/feat/native-ios/packages/app-ios/Shudeng/Features/Notes/NotesView.swift#L224)。
- 对话首屏为历史，按书分组；组内按更新时间排列，无书对话另列：[ChatListView.swift](https://github.com/andyWang1688/ReadAny/blob/feat/native-ios/packages/app-ios/Shudeng/Features/Chat/ChatListView.swift#L34)。
- 选文提问新建当前书的会话，普通阅读器 AI 入口可继续当前书会话：[ChatService.swift](https://github.com/andyWang1688/ReadAny/blob/feat/native-ios/packages/app-ios/Shudeng/Features/Chat/ChatService.swift#L472)。这不等于已确认每条历史消息都能返回原文。
- AI 配置具有多供应商选项、模型和密钥设置：[AISettings.swift](https://github.com/andyWang1688/ReadAny/blob/feat/native-ios/packages/app-ios/Shudeng/Core/AISettings.swift#L7)。
- 已有同一安装内的阅读进度补存、笔记草稿和未保存回答恢复路径：[ReadingSession.swift](https://github.com/andyWang1688/ReadAny/blob/feat/native-ios/packages/app-ios/Shudeng/Core/ReadingSession.swift#L318)、[NoteDrafts.swift](https://github.com/andyWang1688/ReadAny/blob/feat/native-ios/packages/app-ios/Shudeng/Core/NoteDrafts.swift#L31)、[ChatService.swift](https://github.com/andyWang1688/ReadAny/blob/feat/native-ios/packages/app-ios/Shudeng/Features/Chat/ChatService.swift#L260)。
- 本次检查未发现完整书库备份包的导出/导入入口或跨端云同步实现。笔记导出不能恢复书库、阅读进度与完整对话；已有草稿补存也不保证所有中断情形下零丢失。

## 建议验收场景（待交互规则确认后细化，尚未执行）

- 导入 EPUB 后阅读、退出并重启，能够继续上次已保存的位置。
- 高亮、笔记及问答保存后重启仍存在；阅读主题或字号变化不破坏原文关联。
- 从阅读页选文提问、继续追问，随后能在对话历史找到并继续同一段交流。
- AI 未配置或请求失败时仍可正常阅读；保留用户输入，并允许明确重试，不把不完整回答标记为成功。
- 保存失败时显示真实状态，保留可恢复内容；重试不产生重复笔记或消息。
- 三种阅读模式使用同一阅读位置与原文关联规则；切换模式后仍可继续阅读并定位高亮、笔记与问答引用。
- 切换 AI 配置后历史对话仍可回看和继续；具体上下文发送规则待确认。

## 决策树：待确认

- 基础阅读 → 导入与书籍身份规则。
- 按书分组的对话历史 → 原文定位失败处理、移除书籍后的重新导入关联。
- 已确认简单 RAG 的本地混合检索 → 技术验收通过，准备状态细节及真机表现仍待验收；模型保留内置 multilingual MiniLM，不展开长书逐章覆盖。
- OpenAI 与 Anthropic 多套配置 → 具体协议范围与自定义端点；发送说明确认时点已确定，见 ADR-0012。
- 本机可靠保存 → 保存反馈及异常验收；完整备份移后，不继续展开其首发设计。
- iPhone 与 App Store → 支持系统版本、组件许可审查与实现方案；收费讨论移后。

待决项不代表已承诺的首发功能。2026-10-20 [#21 技术验收通过](https://github.com/andyWang1688/shudeng/issues/21)，见[分阶段证据](../.scratch/supervision/local-hybrid/acceptance.md)；原纯向量两处漏检、#11 旧验收及 #20 补查失败和证据保留。整应用、真实 AI 回答质量、真机和发行未因此通过验收。
