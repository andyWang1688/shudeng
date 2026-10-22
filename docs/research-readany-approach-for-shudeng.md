# 书灯能否借鉴 ReadAny 的做法

2026-10-20；仅可行性评估，未修改实现、测试或 ADR，未运行模型。本地代码事实来自本轮只读核查；ReadAny 事实沿用[固定提交调研](research-readany-embeddings.md)，没有再次抓取或移植其代码、提示词、资源。

**可以借鉴本地向量与关键词共同找依据的思路；优先保留书灯当前多语 MiniLM，复用已有关键词索引。** 这不需要云端 embedding、新模型或外部向量数据库，但也尚未证明能修复此前两条漏检。

| 借鉴方式 | 判断 | 原因与边界 |
| --- | --- | --- |
| A：保留 multilingual MiniLM，加入本地关键词候选合并 | 优先评估 | SQLite 已维护 FTS5 索引；需要新增有界候选排序、按同一原文块身份去重和合并规则，现有原文搜索不能直接无界并入。能补词面命中，无法保证解决语义漏检或跨语言问题。 |
| B：直接换 ReadAny 桌面的 `all-MiniLM-L6-v2` | 不建议直接换 | 官方将它标为英语模型；书灯当前 `paraphrase-multilingual-MiniLM-L12-v2` 的模型卡声明多语并列出中文。两者虽同为384维，向量也不能混用；更小或同属 MiniLM 都不能证明中文更好。[M1][M2] |
| C：改用 ReadAny 原生 iOS 的 Apple NaturalLanguage | 研究备选 | 需要先验证目标系统的模型/语言资源可用性、中英查询与正文是否处于可比较的向量空间，以及建索引与查询的模型一致性；不能把按语种挑模型当成跨语言检索已成立。 |

## A 的本地可复用范围

当前生产 `retrieve` 是纯向量 Top-8；已有 FTS5 随正文事务维护，中文采用字符 unigram/bigram 预编码并用 Set 去重。现有文本 `search` 按章节、段落顺序返回，没有 BM25 排名与 LIMIT，所以“已有关键词搜索”不等于“已有可直接接入问答的混合检索”；预编码还会抹去频次，不能称为标准词级 BM25。[L1][L2]

可复用现有索引，新增有界关键词候选和合并层；是否能在现有表上直接获得合适的 BM25 排名，留待实现验证，不承诺与 ReadAny 完全相同。`assessSentenceUnits` 虽有 RRF 示例，却伴随派生库及邻句扩展，不能整段启用。[L1]

若以后采用 A，仍应遵守当前书范围、仅已读限制、准确原文引用、最终最多8块及总材料预算，并维持一次最终 AI 生成。本次不扩大到工具 agent、固定邻文或云端模型选择。

## 结论边界与来源

“能实现”与“值得切换”不同：A 的额外复杂度较小，但效果仍需在相同原文和问题上验证。[ADR0007](adr/0007-simple-local-rag.md) 目前明确排除关键词混排；此评估不改变已接受决策，也不把未通过的漏检验收标为通过。

- [L1：现有生产检索](../ios/Shudeng/Sources/SemanticRetrieval.swift#L102)；[离线 RRF 评估](../ios/Shudeng/Sources/SemanticRetrieval.swift#L343)。
- [L2：FTS 预编码与建表](../ios/Shudeng/Sources/BookIndex.swift#L283)；[正文和 FTS 事务维护及搜索排序](../ios/Shudeng/Sources/BookIndex.swift#L372)。
- [M1：Sentence Transformers 的 all-MiniLM-L6-v2 官方模型卡](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)：元数据声明英语；用于句子、短段落编码，基于 MiniLM-L6 以十亿级句对对比训练。此训练规模不是中文效果证明。
- [M2：paraphrase-multilingual-MiniLM-L12-v2 官方模型卡](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2)：元数据包含多语及 `zh-cn`、`zh-tw`；384维，模型结构列出的最大序列长度128。声明支持中文不代表书籍检索质量已经验收。
- [书灯实际模型清单](../ios/Shudeng/Resources/SemanticModel/manifest.json)；[ReadAny 默认模型、免费来源及两套实际问答链](research-readany-embeddings.md)。
