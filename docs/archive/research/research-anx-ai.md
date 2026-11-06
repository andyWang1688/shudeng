# Anx Reader：选文问答与全书上下文调查

调查日期：2026-10-14。仅阅读官方仓库、GitHub API 和发布说明，未运行应用、未测试回答效果；本文件为原创架构概述，不引入源码、提示词、产品文案或资源。

## 结论

Anx Reader 当前采用**选文进入聊天 + 模型按需调用查书工具**。已追踪的阅读问答链路不经过向量化、向量库或语义 Top-K；全书搜索实际调用阅读器的关键词搜索。它证明“不先做向量索引，也能让模型跨章查书”这条路线存在，但不能证明其跨章回答质量已经可靠。

版本边界：官方 API 的默认分支为 `develop`，调查固定提交为 [`128196b24934dc5f6505f5429db0bf5647b22b23`](https://github.com/Anxcye/anx-reader/commit/128196b24934dc5f6505f5429db0bf5647b22b23)。[仓库元数据](https://api.github.com/repos/Anxcye/anx-reader)与[目录树 API](https://api.github.com/repos/Anxcye/anx-reader/git/trees/128196b24934dc5f6505f5429db0bf5647b22b23?recursive=1)用于确认分支与文件；以下固定源码链接均指向该提交，不代表 v1.14.0 的代码。

## 真实调用链

1. **选文入口**：选中内容后点击 AI，应用打开聊天面板，将所选文字预填入输入框，不立即发送；这个入口没有自动附加整章、整书或结构化选区定位。它不是靠选文替换模板后直接完成问答。[入口源码 L360–374](https://github.com/Anxcye/anx-reader/blob/128196b24934dc5f6505f5429db0bf5647b22b23/lib/widgets/context_menu/excerpt_menu.dart#L360-L374)
2. **快捷操作与追问**：快捷操作将其指令与输入框已有内容拼接；用户提交时，当前历史与新输入组成消息，并开启 agent 模式。[快捷操作 L420–428](https://github.com/Anxcye/anx-reader/blob/128196b24934dc5f6505f5429db0bf5647b22b23/lib/widgets/ai/ai_chat_stream.dart#L420-L428)、[请求 L58–98](https://github.com/Anxcye/anx-reader/blob/128196b24934dc5f6505f5429db0bf5647b22b23/lib/providers/ai_chat.dart#L58-L98)
3. **上下文获取**：模型获得用户启用的工具。初始系统上下文区分是否正在阅读；书名、当前位置、目录和正文可以经工具获取，不能把“工具可用”表述为“每次都会读完书”。[工具与上下文组装 L114–137](https://github.com/Anxcye/anx-reader/blob/128196b24934dc5f6505f5429db0bf5647b22b23/lib/service/ai/langchain_registry.dart#L114-L137)、[阅读元数据结果 L44–70](https://github.com/Anxcye/anx-reader/blob/128196b24934dc5f6505f5429db0bf5647b22b23/lib/service/ai/tools/current_reading_metadata_tool.dart#L44-L70)
4. **反复查书再回答**：执行器将历史、当前输入、已执行的工具结果重新组装发送给模型，模型可继续调用工具；默认最多 120 轮迭代。这个数字是执行上限，不是每个问题实际调用次数。[执行器 L102–108、L151–197](https://github.com/Anxcye/anx-reader/blob/128196b24934dc5f6505f5429db0bf5647b22b23/lib/service/ai/langchain_runner.dart#L102-L197)
5. **保存与继续**：发送前写入未完成历史，完成或失败后分别更新；历史可重新载入继续讨论。这是源码行为，未验证强杀应用过程中的持久性。[历史保存 L70–124、L134–136](https://github.com/Anxcye/anx-reader/blob/128196b24934dc5f6505f5429db0bf5647b22b23/lib/providers/ai_chat.dart#L70-L136)

## 查书能力与限制

| 能力 | 已确认实现 | 对书灯的启示 |
|---|---|---|
| 当前章节 | 从阅读器桥接获取当前章纯文本；调用方未传长度限制。[源码 L34–39](https://github.com/Anxcye/anx-reader/blob/128196b24934dc5f6505f5429db0bf5647b22b23/lib/service/ai/tools/current_chapter_content_tool.dart#L34-L39) | 选文附近及当前章节是天然上下文，不应只靠相似度检索找回来。 |
| 全书目录 | 返回当前位置及含层级、章节 href 的目录树。[源码 L46–67](https://github.com/Anxcye/anx-reader/blob/128196b24934dc5f6505f5429db0bf5647b22b23/lib/service/ai/tools/current_book_toc_tool.dart#L46-L67) | 目录可帮助模型按论证结构定位其他章节。 |
| 指定章节 | 按目录 href 读正文；可选字符限制，正值约束在 500–12000，未传或非正值不设限制；超限取前缀。[源码 L8–18、L40–74](https://github.com/Anxcye/anx-reader/blob/128196b24934dc5f6505f5429db0bf5647b22b23/lib/service/ai/tools/repository/chapter_content_repository.dart#L8-L74) | 书灯宜支持段落范围或分页读取，避免只截章节开头。 |
| 全书搜索 | 输入书 ID 与关键词，调用阅读器全书文本匹配，忽略大小写及变音符，不要求整词匹配；返回章节标题、CFI、命中词与前后文本。[搜索 L355–370](https://github.com/Anxcye/anx-reader/blob/128196b24934dc5f6505f5429db0bf5647b22b23/lib/service/ai/tools/repository/book_content_search_repository.dart#L355-L370)、[结果结构 L519–599](https://github.com/Anxcye/anx-reader/blob/128196b24934dc5f6505f5429db0bf5647b22b23/lib/service/ai/tools/repository/book_content_search_repository.dart#L519-L599) | 精确术语适合关键词；跨语言、同义表达仍可补向量召回。 |
| 搜索限额 | 默认最多 5 组结果、每组 3 条片段，各自允许 1–10；片段字符限制可选。达到数量上限即可结束收集。[参数 L21–40](https://github.com/Anxcye/anx-reader/blob/128196b24934dc5f6505f5429db0bf5647b22b23/lib/service/ai/tools/input/book_content_search_input.dart#L21-L40)、[收集 L438–450](https://github.com/Anxcye/anx-reader/blob/128196b24934dc5f6505f5429db0bf5647b22b23/lib/service/ai/tools/repository/book_content_search_repository.dart#L438-L450) | 不能将有限命中结果当成全书覆盖或语义重排结果。 |

已检查的请求组装与 agent 执行器直接累积历史和本轮工具结果，未见按模型窗口计算预算、自动摘要压缩或全书章节摘要索引：[历史传入 L262–272](https://github.com/Anxcye/anx-reader/blob/128196b24934dc5f6505f5429db0bf5647b22b23/lib/service/ai/index.dart#L262-L272)、[累积上下文 L151–180](https://github.com/Anxcye/anx-reader/blob/128196b24934dc5f6505f5429db0bf5647b22b23/lib/service/ai/langchain_runner.dart#L151-L180)。因此长书不是一次全书加载，而是按工具逐步读取；长章和多次读取仍可能扩大请求，具体溢出行为未运行验证。

搜索结果带 CFI，并不等于回答已具备可靠的逐条可点击来源。当前调查只确认工具结果包含位置、聊天界面展示工具步骤；没有完成引用跳转链路验证，不将其列为已具备能力。[工具展示 L1164–1174](https://github.com/Anxcye/anx-reader/blob/128196b24934dc5f6505f5429db0bf5647b22b23/lib/widgets/ai/ai_chat_stream.dart#L1164-L1174)

## 模型与许可

- 当前源码按协议分别创建 OpenAI、Anthropic、Google 模型客户端，工具抽象位于上层。[协议分发与客户端 L50–102](https://github.com/Anxcye/anx-reader/blob/128196b24934dc5f6505f5429db0bf5647b22b23/lib/service/ai/langchain_registry.dart#L50-L102)。[官方 v1.14.0 发布说明](https://github.com/Anxcye/anx-reader/releases/tag/v1.14.0)也明确记录三类协议支持，但不能由发布说明推断所有自定义端点的工具调用兼容性。
- 根许可证为 MIT，包含保留版权及许可声明的要求；这不替代其阅读内核、依赖、资源的逐项许可检查。本次仅借鉴架构设计，不复用任何实现。[LICENSE L1–21](https://github.com/Anxcye/anx-reader/blob/128196b24934dc5f6505f5429db0bf5647b22b23/LICENSE#L1-L21)

## 对书灯的判断（建议，非 Anx 源码事实）

值得采用的是**模型拥有受控的查书能力**：选文及稳定位置作为问题锚点，应用自动补附近原文，再提供目录、关键词/语义混合搜索、按位置扩展阅读。RAG 负责找材料，工具循环负责发现缺口后补材料，两者可组合。

不建议照搬长上下文无限累积或 120 轮上限。书灯需独立制定调用次数、时间、输入 token、单章读取范围和引用校验约束，并对“当前章解释、前章定义、跨章矛盾、全书归纳”分别验收；目前没有运行证据支持任何具体效果或手机性能承诺。
