# ReadAny 的嵌入模型与问答取材

核查日期：2026-10-20。仅核查公开源码与分支元数据，未运行 ReadAny、未下载模型、未调用付费服务。本文用自己的话记录事实，不移植其代码、提示词、文案或资源；未改变书灯实现及 ADR0007。

## Status

**ReadAny 的默认免费嵌入来自本地计算，不能据此认为它使用了开发者长期补贴的云端向量接口。** 它的共享桌面客户端默认选择 `Xenova/all-MiniLM-L6-v2`，首次获取模型后在设备上执行；远端 embedding 是另外配置的能力。当前默认分支新增的原生 iOS 客户端则走 Apple NaturalLanguage，不能将两条实现混为一个模型。[R1]–[R8]

仓库 `andyWang1688/ReadAny` 当前默认分支为 `feat/native-ios`，固定提交为 `a8dc6b381e19321a1c146ec7260750042a1d0350`。用户提及的 `shudeng` 分支本轮读取返回 404；分支列表中也未出现，故无法确认用户曾经使用的具体版本。另固定 `main` 为 `60ca86997e944850ce684b9b6f870dee84b01fee` 作有限对照：其共享模型 store 同样默认 `builtin`、`all-MiniLM-L6-v2`。[B1]–[B4] 本轮未查询 Git 历史。

| 实现 | 已确认的默认或选择规则 | 免费与联网边界 |
| --- | --- | --- |
| 共享桌面客户端 | 默认内置模式，选 `all-MiniLM-L6-v2`；模型清单映射到 `Xenova/all-MiniLM-L6-v2`，384 维，源码标注下载量约23 MB。`main.tsx` 实际将此选择接到查询 embedding 服务。[R1]–[R3] | “内置”是预设模型选项，不代表权重随应用打包。Worker 用 Transformers.js 从模型仓库获取并缓存后本地计算，不需要 embedding API key。[R4] |
| 共享客户端的远端模式 | 用户另配 endpoint、模型和 API key；实际查询接线创建远端 `EmbeddingService`，请求 OpenAI 兼容 embedding 接口。[R3][R5] | 费用取决于所配供应商，源码没有给这条路径承诺长期免费；本地 Ollama 等服务也可由用户配置，不能把“remote 模式”直接等同付费云端。 |
| 默认分支里的原生 iOS 客户端 | 由 `LocalEmbedding` 按语言及可用性探测 Apple 句向量、词向量均值、上下文 token 向量均值；建索引后按记录的模型身份生成查询向量。[R6][R7] | 在设备上计算；部分系统资源缺失时会请求系统下载。它没有一个固定的 MiniLM 默认，不能仅凭注释认定所有设备首次使用都无需联网。[R6] |

## Files

### 共享桌面客户端：选文和书内自由问答

- **选文先作为问题附件**：阅读器将选中文本和章节交给聊天面板，面板再把附件传入 `useStreamingChat`。此面板调用没有传入 `semanticContext`；该 hook 实际拼入问题的每条选文最多300字符。因此，仓库存在生成阅读上下文的辅助函数，并不能证明该入口默认固定携带选文邻文。[R9]–[R11]
- **选文问答和不选文字的书内问答共用流式链**：hook 读取当前书是否已向量化，并把书、问题、历史和工具提供器交给 `StreamingChat`，后者进入 reading agent。已向量化的书会提供检索、目录和章节上下文工具；未向量化时提供原文件关键词查找等替代工具。[R11]–[R13] 本轮已追到 agent 入口及工具提供器，未继续核实内部工具循环，也未证明每个问题必定调用检索。
- **实际检索函数支持混合搜索**：`ragSearch` 工具默认 `hybrid`、Top-K 5，将当前书 ID 交给 `search()`；后者实际执行向量搜索与 BM25，并按 RRF 合并，向量报错时返回带不可用状态的 BM25 结果。该工具还有总材料预算。章节上下文则是额外工具能力，不能等同每次选文固定加入相邻段落。[R14][R15]
- **向量确实走所选 embedding**：桌面入口注册模型 Worker，并根据 store 在内置与远端服务之间切换；查询会检查索引模型身份及维度，避免直接混用不同模型生成的向量。[R3][R15]

### 默认分支的原生 iOS：另一条实际接线

`ReadingSession.promptContext` 在有选区时取选文（最多2000字符），否则取当前页正文（最多4000字符），并组合当前位置与近期高亮；聊天页把当前阅读书的上下文交给 `ChatService`，再由桥接层发送。[R16]–[R18]

原生桥的 `chat()` **没有接共享客户端的工具执行器**：它先加入已有阅读上下文；若当前书索引可用且语义检索未被关闭，就直接用用户问题做当前书 `hybrid` 搜索，Top-K 4、阈值0.2，每条命中最多700字符，随后和历史一起交给聊天模型生成。检索失败会跳过该步继续对话。书与查询的 embedding 锁定为同一 Apple 模型；这也意味着仅看到回答完成，不能证明该次回答已取得语义检索结果。[R7][R19]

这条选文路径并未固定补入选文前后段落；其额外材料来自当前书混合检索。有选文时，上述阅读上下文规则也不是“选文再加完整当前页”。[R16][R19]

### 与书灯当前模型的关系

ReadAny 共享客户端默认是 **`all-MiniLM-L6-v2`**；书灯资源清单是 **`sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`**，固定 revision `e8f8c211226b894fcb81acc59f3b34ba3efd5f42`。两者不是同款，名称中的 MiniLM 不能当成模型相同的证据。书灯当前决策还明确采用纯向量 Top-K；不能把 ReadAny 的 BM25/RRF 行为归到书灯上。[S1][S2]

ReadAny 源码还列了中文 BGE 与多语 E5 作为可选项，但“可选模型”不等于默认，更不等于本轮验证过中文效果。[R2]

## Sources

以下源码链接全部固定提交。分支元数据链接仅表示本轮读取位置，其内容今后可能变化。

- [B1：仓库默认分支元数据](https://api.github.com/repos/andyWang1688/ReadAny)。
- [B2：默认分支提交](https://github.com/andyWang1688/ReadAny/commit/a8dc6b381e19321a1c146ec7260750042a1d0350)。
- [B3：分支列表](https://api.github.com/repos/andyWang1688/ReadAny/branches?per_page=100)；[shudeng 分支读取位置](https://api.github.com/repos/andyWang1688/ReadAny/branches/shudeng)。
- [B4：main 的模型 store 对照](https://github.com/andyWang1688/ReadAny/blob/60ca86997e944850ce684b9b6f870dee84b01fee/packages/core/src/stores/vector-model-store.ts#L72-L80)。
- [R1：共享客户端初始模型配置](https://github.com/andyWang1688/ReadAny/blob/a8dc6b381e19321a1c146ec7260750042a1d0350/packages/core/src/stores/vector-model-store.ts)。
- [R2：预设模型清单](https://github.com/andyWang1688/ReadAny/blob/a8dc6b381e19321a1c146ec7260750042a1d0350/packages/core/src/ai/builtin-embedding-models.ts)。
- [R3：桌面入口的查询服务和 Worker 接线](https://github.com/andyWang1688/ReadAny/blob/a8dc6b381e19321a1c146ec7260750042a1d0350/packages/app/src/main.tsx#L47-L90)。
- [R4：Worker 模型加载、计算和缓存](https://github.com/andyWang1688/ReadAny/blob/a8dc6b381e19321a1c146ec7260750042a1d0350/packages/core/src/ai/embedding-worker.ts)。
- [R5：远端 embedding 请求](https://github.com/andyWang1688/ReadAny/blob/a8dc6b381e19321a1c146ec7260750042a1d0350/packages/core/src/rag/embedding-service.ts)。
- [R6：Apple 模型选择、资源准备与查询模型锁定](https://github.com/andyWang1688/ReadAny/blob/a8dc6b381e19321a1c146ec7260750042a1d0350/packages/app-ios/CoreBridge/Sources/ShudengCoreBridge/LocalEmbedding.swift)。
- [R7：原生 embedding 到共享检索器的适配](https://github.com/andyWang1688/ReadAny/blob/a8dc6b381e19321a1c146ec7260750042a1d0350/packages/app-ios/CoreBridge/Sources/ShudengCoreBridge/Resources/app-bootstrap.js#L324-L359)。
- [R8：原生模型设置页](https://github.com/andyWang1688/ReadAny/blob/a8dc6b381e19321a1c146ec7260750042a1d0350/packages/app-ios/Shudeng/Features/Settings/VectorModelView.swift)。
- [R9：阅读器选文事件](https://github.com/andyWang1688/ReadAny/blob/a8dc6b381e19321a1c146ec7260750042a1d0350/packages/app/src/components/reader/ReaderView.tsx#L1813-L1834)。
- [R10：聊天面板附件与 hook 参数](https://github.com/andyWang1688/ReadAny/blob/a8dc6b381e19321a1c146ec7260750042a1d0350/packages/app/src/components/chat/ChatPanel.tsx#L55-L170)。
- [R11：选文组装及流式入口](https://github.com/andyWang1688/ReadAny/blob/a8dc6b381e19321a1c146ec7260750042a1d0350/packages/core/src/hooks/use-streaming-chat.ts)。
- [R12：流式入口向 reading agent 传递工具提供器](https://github.com/andyWang1688/ReadAny/blob/a8dc6b381e19321a1c146ec7260750042a1d0350/packages/core/src/ai/streaming.ts)。
- [R13：按当前书索引状态提供工具](https://github.com/andyWang1688/ReadAny/blob/a8dc6b381e19321a1c146ec7260750042a1d0350/packages/core/src/ai/tools/index.ts#L73-L116)。
- [R14：RAG 搜索工具调用参数与材料预算](https://github.com/andyWang1688/ReadAny/blob/a8dc6b381e19321a1c146ec7260750042a1d0350/packages/core/src/ai/tools/rag-tools.ts)。
- [R15：混合、向量、BM25 检索的实际实现](https://github.com/andyWang1688/ReadAny/blob/a8dc6b381e19321a1c146ec7260750042a1d0350/packages/core/src/rag/search.ts)。
- [R16：原生阅读上下文组装](https://github.com/andyWang1688/ReadAny/blob/a8dc6b381e19321a1c146ec7260750042a1d0350/packages/app-ios/Shudeng/Core/ReadingSession.swift#L79-L105)。
- [R17：原生聊天页传入阅读上下文](https://github.com/andyWang1688/ReadAny/blob/a8dc6b381e19321a1c146ec7260750042a1d0350/packages/app-ios/Shudeng/Features/Chat/ChatView.swift)。
- [R18：原生聊天 payload](https://github.com/andyWang1688/ReadAny/blob/a8dc6b381e19321a1c146ec7260750042a1d0350/packages/app-ios/Shudeng/Features/Chat/ChatService.swift#L325-L415)。
- [R19：原生问答直接检索及最终调用](https://github.com/andyWang1688/ReadAny/blob/a8dc6b381e19321a1c146ec7260750042a1d0350/packages/app-ios/CoreBridge/Sources/ShudengCoreBridge/Resources/app-bootstrap.js#L1227-L1335)。
- [S1：书灯实际模型资源清单](../ios/Shudeng/Resources/SemanticModel/manifest.json)。
- [S2：书灯现行 ADR0007](adr/0007-simple-local-rag.md)。

## Concerns

- 本轮无法识别用户过去体验所对应的 ReadAny 分支、提交、平台和个人设置；上述事实不能直接解释其当时效果。
- 本轮没有跑模型、真实书籍检索或产品问答，不对中文检索质量作结论。`all-MiniLM`、多语 MiniLM 或 Apple 模型的名称都不能替代同一书籍与问题上的实测。
- 本地 embedding 不产生供应商按量调用账单，仍需要设备计算和模型资源；这与聊天模型是否免费、向量数据库是否有免费存储额度是三件不同的事。上述证据不支持任何云端供应商永久免费的承诺。
