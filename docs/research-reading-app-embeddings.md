# AI 阅读应用实际采用的向量模型

调查日期：2026-10-20。只读官方当前默认分支的固定提交与少量调用链文件；未运行竞品、下载模型、付费调用或修改书灯实现。本文记录源码事实，不能代替中文阅读问答效果与可用性实测；未读取 ReadAny 源码。

## 结论

**同类应用没有共同采用某个“EPUB 专用向量模型”。** 已核实的阅读应用中，Readest 默认配置本地 `nomic-embed-text`，也有云端 `text-embedding-3-small` 路径；Memoria 实际启动 Nomic v1.5；Anx Reader 使用关键词搜索和读章工具；Koodo 的公开客户端把选文或当前章原文直接交给聊天服务。[R1][R2][A1][A2][K1][M1][M2]

这组事实支持把 EPUB 视为原文、章节与位置的输入格式；模型筛选应围绕“用问题找到可支撑回答的书内段落”，关注中文与跨语言、专名、因果关系以及返回可定位原文。竞品的默认值只能证明该项目做出了工程选择，不能证明其中文效果更好，也不能把聊天模型、可选提供商或产品宣传当作实际 embedding 默认值。后半句为本研究判断，未作效果承诺。

### 对书灯的候选建议

EPUB 检索看提取的文本；nomic-embed-text-v1.5 官方标注语言 en，不能因竞品采用就作为中文首选。优先比较三类候选：Qwen3-Embedding-8B/4B 效果基准、BGE-M3 dense 成熟对照、voyage-4-large 云端对照；不表示全部加入产品。

保持现有 RAG 管线做原题对照，之后再评估较小型号和手机落地。规格、来源与评测边界见[模型候选报告](research-epub-embedding-models.md)。

## 已核实的应用

下表前三项及 Memoria 属于 EPUB 阅读/书籍问答应用；AnythingLLM 是通用文档 RAG 对照。所谓“默认”均指该固定源码中的配置回退值，不能推断用户实际采用比例或商店发行版行为。Readest 的“本地 Ollama”指独立推理服务；它不构成 iPhone 应用内已集成该模型或手机开箱可用的证据。

| 应用 | 实际问答链路 | 实际默认 embedding | 本地 / 云端边界 | 与体验相关的源码事实 |
| --- | --- | --- | --- | --- |
| **Readest** | 书聊在已索引时检索片段再生成；Reedy 分支由模型调用查书工具。选文上下文词典另走“选文＋附近原文”直接生成。 | AI 默认关闭；默认 provider=`ollama`，其 embedding 回退 `nomic-embed-text`。选择 AI Gateway 时回退 `openai/text-embedding-3-small`；它不是全应用无条件默认。 | 默认 Ollama 地址 `127.0.0.1:11434`，可自定义；Gateway 为远程 embedding 服务。 | 书聊可获得书内片段；词典路径没有因此自动获得整书检索。聊天适配器最多三步的 Reedy 路径与预检索路径分开，不能用模型名单独判断回答覆盖。见 [R1]–[R4]。 |
| **Anx Reader** | 聊天模型可调用全书关键词搜索、按目录 href 读章等工具；原文作为工具结果送回模型。 | **已追踪的阅读问答链路没有 embedding 模型。** 不将工具检索误记为向量 RAG，也不宣称穷尽整个仓库的所有功能。 | 原文查找在阅读器侧；聊天按读者配置的 OpenAI / Anthropic / Google 协议端点请求。协议名称本身不证明端点部署位置。 | 可跨章查书，按需读取；关键词搜索忽略大小写、变音符并允许非整词命中。这与向量同义召回是不同能力，实际找全率未测。见 [A1]–[A3]。 |
| **Koodo Reader** | 阅读助手使用已有选文；为空时取当前章全文；自定义助手把原文放入请求并附历史。官方助手提交 text、question、最近 5 条历史与 mode。 | **公开客户端该路径未使用 embedding；官方服务内部模型未公开，无法确认。** 用户配置的 `modelId` 在这里是聊天模型。 | 官方账号服务或用户自定义聊天端点；不能从客户端推断官方后端是否另有索引。 | 直接获得当前原文，减少等待建索引的前置步骤；公开链路没有展示全书语义检索。历史保留与原文直送也不能证明跨章回答有依据。见 [K1][K2]。 |
| **Memoria AI Book Companion**（`Gemma_book_reader`） | 实际 EPUB 导入，按章建书籍 FAISS 索引；问答把当前上下文与检索结果一起交给生成模型。 | 标准启动器固定 `nomic-embed-text-v1.5.Q6_K.gguf`；Python 客户端使用模型标识 `nomic-embed-text`。应以实际加载的 GGUF 为准。 | 独立本地 llama.cpp embedding 服务 `localhost:9001`；`OpenAIEmbeddings` 是兼容接口客户端，不表示调用 OpenAI 云端。 | 以 `search_query:` 查询，按当前阅读章过滤，默认 k=10；结果附章节名。已读过滤会改变可召回范围，不能把少量结果当作整书覆盖。未验证其端到端稳定性或引用回跳。见 [M1]–[M4]。 |
| **AnythingLLM**（通用文档对照） | 文档工作区向量相似检索，结果原文进入生成上下文；还可配置重排。 | 未配置 embedding engine 时回退 Native；Native 未配置或模型不受支持时回退 `Xenova/all-MiniLM-L6-v2`。 | Native 在应用/自托管进程本地执行；另支持云端与其他本地服务，但“支持”不代表默认。 | 本地模型先下载并缓存；源码同时列出 Nomic v1 与 multilingual E5 small 等选项，不能把它们当默认。这里的 MiniLM 也不等于书灯内置的 multilingual MiniLM。仅作为文档 RAG 工程对照，未验证 EPUB 阅读位置能力。见 [G1]–[G3]。 |

## 版本与一手证据

所有下列 GitHub 源码链接均固定 SHA；2026-10-20 读取时各仓库当前默认分支提交如下。它们之间没有做实际部署组合测试。

| 主仓库 | 固定提交 |
| --- | --- |
| [readest/readest](https://github.com/readest/readest) | [`23365811eabd5ac2b8bcce79ff358e3db727d166`](https://github.com/readest/readest/commit/23365811eabd5ac2b8bcce79ff358e3db727d166) |
| [Anxcye/anx-reader](https://github.com/Anxcye/anx-reader) | [`0c7fc1ad4551f7dbbeba6a6468f69d830957fa2a`](https://github.com/Anxcye/anx-reader/commit/0c7fc1ad4551f7dbbeba6a6468f69d830957fa2a) |
| [koodo-reader/koodo-reader](https://github.com/koodo-reader/koodo-reader) | [`b7e3ee7dee0081affdc0554628430ae553d93f14`](https://github.com/koodo-reader/koodo-reader/commit/b7e3ee7dee0081affdc0554628430ae553d93f14) |
| [Santhoshl2312/Gemma_book_reader](https://github.com/Santhoshl2312/Gemma_book_reader) | [`0967922845d9af1a6841e1ddb2c8b89c04c213cc`](https://github.com/Santhoshl2312/Gemma_book_reader/commit/0967922845d9af1a6841e1ddb2c8b89c04c213cc) |
| [Mintplex-Labs/anything-llm](https://github.com/Mintplex-Labs/anything-llm) | [`feb0ebe8a0de61afd33bb491d5e8f12f0d901e32`](https://github.com/Mintplex-Labs/anything-llm/commit/feb0ebe8a0de61afd33bb491d5e8f12f0d901e32) |

- **[R1] Readest 默认值及实际 Ollama 接线**：[constants.ts:22–40](https://github.com/readest/readest/blob/23365811eabd5ac2b8bcce79ff358e3db727d166/apps/readest-app/src/services/ai/constants.ts#L22-L40)、[OllamaProvider.ts:27–42](https://github.com/readest/readest/blob/23365811eabd5ac2b8bcce79ff358e3db727d166/apps/readest-app/src/services/ai/providers/OllamaProvider.ts#L27-L42)。AI 与 Reedy 均默认关闭；不能表述为安装后默认已能进行 RAG。
- **[R2] Readest Gateway embedding**：[AIGatewayProvider.ts:34–44](https://github.com/readest/readest/blob/23365811eabd5ac2b8bcce79ff358e3db727d166/apps/readest-app/src/services/ai/providers/AIGatewayProvider.ts#L34-L44)、[ProxiedGatewayEmbedding.ts:8–20](https://github.com/readest/readest/blob/23365811eabd5ac2b8bcce79ff358e3db727d166/apps/readest-app/src/services/ai/providers/ProxiedGatewayEmbedding.ts#L8-L20)。实际调用 embeddingModel 或代理 embedding 请求。
- **[R3] Readest 书聊调用路径**：[TauriChatAdapter.ts:109–170](https://github.com/readest/readest/blob/23365811eabd5ac2b8bcce79ff358e3db727d166/apps/readest-app/src/services/ai/adapters/TauriChatAdapter.ts#L109-L170)。区分按需查书工具与索引存在时预检索的路径。
- **[R4] Readest 词典直送原文**：[contextDictionary.ts:69–96](https://github.com/readest/readest/blob/23365811eabd5ac2b8bcce79ff358e3db727d166/apps/readest-app/src/services/dictionaries/contextDictionary.ts#L69-L96)、[同文件:147–186](https://github.com/readest/readest/blob/23365811eabd5ac2b8bcce79ff358e3db727d166/apps/readest-app/src/services/dictionaries/contextDictionary.ts#L147-L186)。
- **[A1] Anx 模型与工具组装**：[langchain_registry.dart:54–137](https://github.com/Anxcye/anx-reader/blob/0c7fc1ad4551f7dbbeba6a6468f69d830957fa2a/lib/service/ai/langchain_registry.dart#L54-L137)。这里创建的是聊天模型并挂载工具。
- **[A2] Anx 全书搜索**：[book_content_search_repository.dart:110–151](https://github.com/Anxcye/anx-reader/blob/0c7fc1ad4551f7dbbeba6a6468f69d830957fa2a/lib/service/ai/tools/repository/book_content_search_repository.dart#L110-L151)、[同文件:334–370](https://github.com/Anxcye/anx-reader/blob/0c7fc1ad4551f7dbbeba6a6468f69d830957fa2a/lib/service/ai/tools/repository/book_content_search_repository.dart#L334-L370)。正在阅读的书走阅读器搜索，其余支持路径调用书内文本 search。
- **[A3] Anx 读章**：[chapter_content_repository.dart:24–73](https://github.com/Anxcye/anx-reader/blob/0c7fc1ad4551f7dbbeba6a6468f69d830957fa2a/lib/service/ai/tools/repository/chapter_content_repository.dart#L24-L73)。通过桥接读取当前章或指定 href。
- **[K1] Koodo 选文/当前章直送**：[popupAssist/component.tsx:235–305](https://github.com/koodo-reader/koodo-reader/blob/b7e3ee7dee0081affdc0554628430ae553d93f14/src/components/popups/popupAssist/component.tsx#L235-L305)、[同文件:345–365](https://github.com/koodo-reader/koodo-reader/blob/b7e3ee7dee0081affdc0554628430ae553d93f14/src/components/popups/popupAssist/component.tsx#L345-L365)。
- **[K2] Koodo 官方请求边界**：[utils/request/reader.ts:38–54](https://github.com/koodo-reader/koodo-reader/blob/b7e3ee7dee0081affdc0554628430ae553d93f14/src/utils/request/reader.ts#L38-L54)。这里只能确认公开客户端提交什么，不能反推远程服务的内部模型。
- **[M1] Memoria 实际启动的 embedding 模型**：[start.bat:244–253](https://github.com/Santhoshl2312/Gemma_book_reader/blob/0967922845d9af1a6841e1ddb2c8b89c04c213cc/start.bat#L244-L253)、[同文件:378–380](https://github.com/Santhoshl2312/Gemma_book_reader/blob/0967922845d9af1a6841e1ddb2c8b89c04c213cc/start.bat#L378-L380)、[backend/run_all.bat:59–73](https://github.com/Santhoshl2312/Gemma_book_reader/blob/0967922845d9af1a6841e1ddb2c8b89c04c213cc/backend/run_all.bat#L59-L73)。标准安装下载 Nomic v1.5 GGUF，并启动它为 embedding 服务。
- **[M2] Memoria 索引与检索**：[embed_chapter.py:10–25](https://github.com/Santhoshl2312/Gemma_book_reader/blob/0967922845d9af1a6841e1ddb2c8b89c04c213cc/backend/embed_chapter.py#L10-L25)、[同文件:42–68](https://github.com/Santhoshl2312/Gemma_book_reader/blob/0967922845d9af1a6841e1ddb2c8b89c04c213cc/backend/embed_chapter.py#L42-L68)、[query.py:5–47](https://github.com/Santhoshl2312/Gemma_book_reader/blob/0967922845d9af1a6841e1ddb2c8b89c04c213cc/backend/query.py#L5-L47)。
- **[M3] Memoria 问答实际调用检索**：[gemma.py:216–245](https://github.com/Santhoshl2312/Gemma_book_reader/blob/0967922845d9af1a6841e1ddb2c8b89c04c213cc/backend/gemma.py#L216-L245)。仅在有 book_id 与 chapter_index 时补充向量上下文。
- **[M4] Memoria EPUB 导入和问答接线**：[main.py:159–167](https://github.com/Santhoshl2312/Gemma_book_reader/blob/0967922845d9af1a6841e1ddb2c8b89c04c213cc/backend/main.py#L159-L167)、[同文件:259–285](https://github.com/Santhoshl2312/Gemma_book_reader/blob/0967922845d9af1a6841e1ddb2c8b89c04c213cc/backend/main.py#L259-L285)。
- **[G1] AnythingLLM 默认 engine 与模型**：[helpers/index.js:313–364](https://github.com/Mintplex-Labs/anything-llm/blob/feb0ebe8a0de61afd33bb491d5e8f12f0d901e32/server/utils/helpers/index.js#L313-L364)、[EmbeddingEngines/native/index.js:7–8](https://github.com/Mintplex-Labs/anything-llm/blob/feb0ebe8a0de61afd33bb491d5e8f12f0d901e32/server/utils/EmbeddingEngines/native/index.js#L7-L8)、[同文件:103–107](https://github.com/Mintplex-Labs/anything-llm/blob/feb0ebe8a0de61afd33bb491d5e8f12f0d901e32/server/utils/EmbeddingEngines/native/index.js#L103-L107)。
- **[G2] AnythingLLM 可选本地模型与实际执行**：[native/constants.js:1–58](https://github.com/Mintplex-Labs/anything-llm/blob/feb0ebe8a0de61afd33bb491d5e8f12f0d901e32/server/utils/EmbeddingEngines/native/constants.js#L1-L58)、[native/index.js:140–156](https://github.com/Mintplex-Labs/anything-llm/blob/feb0ebe8a0de61afd33bb491d5e8f12f0d901e32/server/utils/EmbeddingEngines/native/index.js#L140-L156)。选项表与真正回退值分别核实。
- **[G3] AnythingLLM 检索结果进入回答**：[chats/stream.js:194–203](https://github.com/Mintplex-Labs/anything-llm/blob/feb0ebe8a0de61afd33bb491d5e8f12f0d901e32/server/utils/chats/stream.js#L194-L203)、[同文件:282–290](https://github.com/Mintplex-Labs/anything-llm/blob/feb0ebe8a0de61afd33bb491d5e8f12f0d901e32/server/utils/chats/stream.js#L282-L290)。

## 本轮能判断和仍未验证的边界

- 可确认模型名、默认/选项区别、接口部署位置与原文进入生成的方式；不能确认真实读者默认采用比例。
- 未运行中文长书、人物指代、前章定义、跨章因果或长问题的对照测试；不按仓库热度、功能数量或模型参数量宣布体验胜者。
- 本轮暂不以 iPhone 内存、包体或必须纯本地淘汰候选；本地/云端只作为事实标记。新模型建议不静默覆盖已接受的 [ADR0007](adr/0007-simple-local-rag.md)。
