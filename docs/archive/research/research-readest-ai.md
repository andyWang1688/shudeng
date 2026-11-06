# Readest 的选段 AI 与书内问答：源码调查

调查日期：2026-10-14。只读官方 GitHub API 与源码，没有克隆、运行或复制项目实现。默认分支 `main`，固定提交 `3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3`（版本提交 0.12.16）。下面描述源码行为，不代表运行效果或各应用商店版本状态。

## 结论

Readest 当前源码中至少有两条不同的 AI 链路：

1. **选文的上下文词典**：选文＋附近原文＋书名作者直接请求模型，未做全书检索。
2. **笔记面板的书籍聊天**：索引全书后做混合检索；普通路径预先检索，启用 Reedy 的特定路径让模型按需调用检索工具。

因此，不能把“Readest 有整书 RAG”解释成“它的选段解释默认会结合整本书”。也不能说当前 main 已全面替换旧检索：旧实现仍然可达，而且 Reedy 默认关闭。

## 选文如何解释

| 阶段 | 当前实现 | 一手证据 |
| --- | --- | --- |
| 入口 | 阅读器选区打开词典时构造上下文，附书名、作者、目标语言。此处确认的是 context dictionary，不是一个已核实名为 Explain 的独立按钮。 | [Annotator.tsx:463–477](https://github.com/readest/readest/blob/3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3/apps/readest-app/src/app/reader/components/annotator/Annotator.tsx#L463-L477) |
| 附近原文 | 取选区所属段落的未选部分及两侧相邻段落；每侧最多约 1000 字符，按词边界截断。 | [contextDictionary.ts:69–96](https://github.com/readest/readest/blob/3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3/apps/readest-app/src/services/dictionaries/contextDictionary.ts#L69-L96) |
| 调用模型 | 直接将选文、前后原文、书名作者组织成请求，使用用户的自定义翻译器模型调用 generateText。该函数没有 embedding、书内搜索或检索工具。 | [contextDictionary.ts:147–190](https://github.com/readest/readest/blob/3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3/apps/readest-app/src/services/dictionaries/contextDictionary.ts#L147-L190) |
| 结果 | 解析为结构化词典解释，并有内存缓存；不能将其视为已证实的持久多轮选段对话。 | [contextDictionary.ts:114–145](https://github.com/readest/readest/blob/3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3/apps/readest-app/src/services/dictionaries/contextDictionary.ts#L114-L145)、[同文件:187–190](https://github.com/readest/readest/blob/3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3/apps/readest-app/src/services/dictionaries/contextDictionary.ts#L187-L190) |

这个设计适合减少词义解释对纯选文的误解，但**没有证据证明该路径能发现前几章的定义或跨章论证**。

## 整书问答如何实现

### 当前仍在的普通路径

聊天适配器提取最后一条用户消息作为检索 query；在书已索引时取 top-K 片段，拼入模型上下文，再发送完整文本对话历史。默认片段上限配置为 10。检索 query 本身不包含对话历史的显式问题改写，因此“他为什么这样说”一类追问的检索质量不能从源码直接保证。

证据：[TauriChatAdapter.ts:86–101](https://github.com/readest/readest/blob/3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3/apps/readest-app/src/services/ai/adapters/TauriChatAdapter.ts#L86-L101)、[同文件:134–176](https://github.com/readest/readest/blob/3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3/apps/readest-app/src/services/ai/adapters/TauriChatAdapter.ts#L134-L176)、[constants.ts:36–40](https://github.com/readest/readest/blob/3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3/apps/readest-app/src/services/ai/constants.ts#L36-L40)。

旧存储使用 IndexedDB，向量余弦相似度与 Lunr/BM25 词法结果一起召回。融合不是 RRF：两路分数各自归一化，权重为 1.0 和 0.8，合并重复项后取较大分数排序。查询没有 embedding 时仍可走 BM25。

证据：[aiStore.ts:15–29](https://github.com/readest/readest/blob/3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3/apps/readest-app/src/services/ai/storage/aiStore.ts#L15-L29)、[aiStore.ts:174–206](https://github.com/readest/readest/blob/3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3/apps/readest-app/src/services/ai/storage/aiStore.ts#L174-L206)、[aiStore.ts:275–304](https://github.com/readest/readest/blob/3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3/apps/readest-app/src/services/ai/storage/aiStore.ts#L275-L304)。

### Reedy 路径：已在 main，但受开关与平台限制

- **默认关闭**：默认设置为 `reedy.enabled=false`；只有开启 Reedy 且处于 Tauri 平台才选 Reedy backend，其他情况走 legacy-IDB。
- **MVP 工具路径**：模型获得 lookupPassage，可按需查询当前书；一次生成允许最多三步。它不是每次回答前强制执行一次固定 RAG。
- **另有 agent runtime 路径**：须额外指定 runtime=agent，同时满足 AI/Reedy 开启、Tauri、书文档存在等条件；默认 runtime 回退 mvp。不能把该路径当成默认体验。

证据：[constants.ts:23–40](https://github.com/readest/readest/blob/3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3/apps/readest-app/src/services/ai/constants.ts#L23-L40)、[retrievalBackend.ts:58–74](https://github.com/readest/readest/blob/3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3/apps/readest-app/src/services/ai/adapters/retrievalBackend.ts#L58-L74)、[TauriChatAdapter.ts:107–132](https://github.com/readest/readest/blob/3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3/apps/readest-app/src/services/ai/adapters/TauriChatAdapter.ts#L107-L132)、[AIAssistant.tsx:283–306](https://github.com/readest/readest/blob/3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3/apps/readest-app/src/app/reader/components/notebook/AIAssistant.tsx#L283-L306)。

Reedy 的索引与检索：

- 按书籍 section 切片，优先段落/句子边界；默认目标 500 字符、重叠 50 字符。片段保留章节、顺序和起止 CFI。
- 索引构建调用独立 embedding model，为每个片段保存向量。因此该实现的正常索引流程**需要 embedding 能力**，不是只配置聊天模型就够。
- 查询在当前书范围做全量向量余弦排序＋Tantivy/BM25，分别多取候选，再以 RRF 合并；没有要求独立远程向量数据库。
- 返回 CFI、章节和原文，可用于引用定位。存在未索引、索引失败、模型变化需重建、降级等状态。

证据：[CfiChunker.ts:21–37](https://github.com/readest/readest/blob/3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3/apps/readest-app/src/services/reedy/retrieval/CfiChunker.ts#L21-L37)、[BookIndexer.ts:145–178](https://github.com/readest/readest/blob/3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3/apps/readest-app/src/services/reedy/retrieval/BookIndexer.ts#L145-L178)、[ReedyDb.ts:483–538](https://github.com/readest/readest/blob/3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3/apps/readest-app/src/services/reedy/db/ReedyDb.ts#L483-L538)、[BookRetriever.ts:63–120](https://github.com/readest/readest/blob/3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3/apps/readest-app/src/services/reedy/retrieval/BookRetriever.ts#L63-L120)。

查询 embedding 失败时源码意图降级到全文检索，但实际传入零向量后仍进入同一混合搜索函数；没有执行验证，不将其描述为已验证的纯 BM25 降级效果。

## 引用、追问与尚未接通的边界

普通聊天路径有会话历史加载、持久化适配器，追问会将历史消息送到模型。Reedy 检索结果能带 CFI；旧结果无 CFI 时界面按静态来源展示，不能跳回原文。

证据：[AIAssistant.tsx:142–181](https://github.com/readest/readest/blob/3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3/apps/readest-app/src/app/reader/components/notebook/AIAssistant.tsx#L142-L181)、[AIAssistant.tsx:380–391](https://github.com/readest/readest/blob/3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3/apps/readest-app/src/app/reader/components/notebook/AIAssistant.tsx#L380-L391)。

Agent runtime 注册了读取选文、当前阅读位置、检索片段和引用等工具，但当前 notebook bridge 构建 readingContext 时只提供 CFI、章节、页码，没有提供 selection。这意味着“工具类型支持选文”不能当成“阅读器选文已自动传入 agent”的证明。所读工具注册表也没有直接读取任意整章正文的工具；本次不能确认存在章节层级导航阅读方案。

证据：[ReedyAssistant.tsx:175–205](https://github.com/readest/readest/blob/3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3/apps/readest-app/src/services/reedy/ui/ReedyAssistant.tsx#L175-L205)、[AIAssistant.tsx:491–500](https://github.com/readest/readest/blob/3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3/apps/readest-app/src/app/reader/components/notebook/AIAssistant.tsx#L491-L500)。

## 对书灯的借鉴（设计建议，不是对方已实现的事实）

1. 保留局部上下文，但将选段提问与书内检索接成同一条对话链，避免词典解释与整书聊天分裂。
2. 混合召回有现实参照；全书向量化不是每次问答把全书发给聊天模型。
3. CFI/段落稳定位置、原文证据与索引版本应跟切片同时设计，不要等回答做好再补来源跳转。
4. 若首发支持用户自带 OpenAI/Anthropic 聊天服务，embedding 必须单独解决；该项目的实现不能证明聊天配置自动具备 embedding。
5. 查询必须考虑选文和追问指代；简单用最后一句用户输入检索不能作为书灯核心能力的最终方案。

## 版本与许可边界

以上结论来自固定 main 源码，不以 PR #3023、#3119 的说明作为已上线证据；没有核实这些 PR 的合并状态，也不据此断言其功能整体已发布。

GitHub 仓库官方元数据将 Readest 标为 AGPL-3.0；[官方仓库 API](https://api.github.com/repos/readest/readest) 与 [固定提交 LICENSE](https://github.com/readest/readest/blob/3cc39ad7a558e6612e1a8135058fbd6f3c90b3e3/LICENSE)。本次许可证文件内容的 API 读取未成功完成，因此许可识别依据为官方元数据，不作进一步法律结论。调查只抽象设计，不复制代码、提示词、产品文案或资源。
