# EPUB 阅读问答 embedding 候选研究

核实日期：2026-10-20。依据官方模型卡、厂商文档及原论文；没有下载权重、调用收费 API 或执行书内题。

## 结论

**先以 Qwen3-Embedding-8B/4B 和 voyage-4-large 建立效果基准，再谈手机适配。** BGE-M3 适合作为成熟多语言对照；0.6B、Voyage nano、EmbeddingGemma 2 留到效果基准之后比较部署取舍。以下是优先对照候选，不是已测胜负，不能承诺换模型就修复现有两道漏检。

EPUB 是容器，模型实际处理提取后的文本。应分别验证中文问中文书、英文问英文书、中文问英文书及混合文本；支持中文不等于已证明中英跨语质量。阅读问答主要是短问题找书内段落的非对称检索，不能只测近义句相似度。

现行 [ADR0007](adr/0007-simple-local-rag.md) 接受 MiniLM、约100-token正文块、128-token输入硬上限和纯本地 embedding；本轮按用户要求暂不以这些限制筛模型，没有修改该决策或产品实现。

## 五类候选

### 1. Qwen：公开权重效果基准，以及独立云服务候选

归属：阿里 Qwen Team。公开 Qwen3-Embedding 系列支持100余语言及跨语检索，Apache-2.0；官方提供 Transformers、Sentence Transformers、vLLM、TEI 用法，可本地运行或自建服务。官方模型页列出第三方推理供应商，不表示本项目账号、线路或手机适配已验证。[Q1][Q2]

| 公开模型 | 标称参数 | 最大向量维度 | 官方输入长度 | BF16/FP16纯权重估算 | 本轮用途 |
| --- | ---: | ---: | ---: | ---: | --- |
| Qwen3-Embedding-8B | 8B | 4096 | 32K tokens | 约16 GB | 公开权重效果基准 |
| Qwen3-Embedding-4B | 4B | 2560 | 32K tokens | 约8 GB | 与8B同题比较实际差距 |
| Qwen3-Embedding-0.6B | 0.6B | 1024 | 32K tokens | 约1.2 GB | 后续较小模型取舍 |

参数、长度、维度来自官方表；支持 MRL 缩维。体积统一按标称参数×2 bytes、十进制 GB估算，FP32约翻倍；仅是浮点权重数量级，不是下载文件精确大小、安装包、运行 RAM 或峰值内存。[Q1][Q2]

查询使用“Instruct: {task}\nQuery:{question}”，正文不加指令；官方建议多语言场景也用英文任务指令。本项目可先固定任务为“Given a reader question, retrieve relevant passages from the book that help answer the question”（拟定指令，未验证）。原生取最后 EOS 隐状态并归一化，不能套用其他模型的 mean pooling。[Q1]

官方模型卡的 **2025年版本**成绩：

| 模型 | 多语言MTEB Mean(Task) | 多语言Retrieval | C-MTEB Mean(Task) | 中文Retrieval |
| --- | ---: | ---: | ---: | ---: |
| 0.6B | 64.33 | 64.64 | 66.33 | 71.03 |
| 4B | 69.45 | 69.60 | 72.27 | 77.03 |
| 8B | 70.58 | 70.88 | 73.84 | 78.21 |

这是Qwen作者报告的通用基准；榜首声明对应2025-06-05，其他模型比较取自2025-05-24，不能写成2026年当前排名，也不能代替小说书内题实测。[Q1]

**当前云服务另列：** Model Studio 2026-10-11更新的API列出 qwen3.7-text-embedding：新加坡区、201种语言/方言、每条128,000 tokens、256/512/768/1024默认/1536/2048/2560维、最多20条/次、标价$0.07/百万输入tokens。当前选型页将它列为其最高效果文本型号，但未找到足以和公开8B/Voyage直接比较的同题成绩；参数量、权重许可、权重体积未披露，按商业API服务记录。[Q3][Q4]

DashScope支持 text_type=query/document 区分两侧及可选英文 instruct，不应直接手动拼公开Qwen3的固定前缀。text-embedding-v4 是另一API型号：8,192 tokens、最大2048维；只能说属于Qwen3系列，不能认作公开8B checkpoint或混用向量。文档列服务入口，不等于本机网络、账号、延迟已验证。[Q3]

### 2. Voyage 4：当前云端效果对照

归属：Voyage AI，2026-01-15发布。voyage-4-large 是云端首选效果对照，官方定位通用及多语言检索；32,000 tokens、1024默认维度，可选256/512/2048维，商业API可调用。large/4/lite的参数量、权重体积未在所核实资料中披露，不按开源权重许可处理；当前large标价$0.12/百万tokens。[V1][V2][V3]

设 input_type=query/document，后台分别加“Represent the query for retrieving supporting documents: ”和“Represent the document for retrieval: ”，客户端不重复拼前缀。官方支持 truncation=False，便于让超长输入报错，避免评测静默截断。[V1]

官方发布评测采用29个RTEB数据集及NDCG@10，称large相比其参测的Gemini Embedding 001、Cohere Embed v4、OpenAI v3 Large平均高3.87%、8.20%、14.05%；这是厂商自己的该套评测，未与Qwen3同题，也不是中文EPUB验证。多语言与中英跨语仍须分项实测。[V2]

同族后续可测 voyage-4-nano：公开权重、Apache-2.0，卡称180M非embedding参数+160M embedding参数（约340M），32,000 tokens，原生2048维并支持1024/512/256，BF16纯权重约0.68 GB。它也需区分两侧前缀，官方有本地Sentence Transformers示例及 trust_remote_code=True；不代表现有iOS运行时能直接加载。Voyage明确承诺4系列共享向量空间，可另测“large建正文索引+nano编码问题”，先以两侧均large作基准。[V2][V4]

### 3. BGE-M3：成熟多语言对照

归属：北京智源BAAI/FlagOpen。MIT；100余语言，1024维，8,192 tokens。官方FlagEmbedding支持本地dense、sparse、ColBERT三种表示；本轮先只测dense，避免同时引入混合检索。查询**不需要**额外指令，不能沿用BGE中文v1.5或Qwen前缀。[B1]

XLM-R配置对应约568M参数，BF16/FP16纯权重约1.14 GB、FP32约2.27 GB（按公开配置结构估算，非实测内存）。官方给出本地加载及长文档MLDR评测路线；未核实第一方托管API，自建云主机不等于已有厂商云API。[B1][B2]

Qwen卡同期比较给出BGE-M3多语言MTEB Mean(Task)=59.56、Retrieval=54.60，属于Qwen一方的比较快照。BAAI卡还记录2024-07-01修正MIRACL评测时误删相同ID结果的问题，复现应使用修正后的设置。长文档、多语言训练使其值得作为对照，不证明它一定优于较新的Qwen/Voyage。[Q1][B1]

### 4. BGE中文v1.5：仅中文轻量对照

BAAI bge-small/base/large-zh-v1.5 均MIT、官方标中文，最大512 tokens；维度512/768/1024（**small-zh不是small-en的384维**），配置约24M/102M/326M参数，按2 bytes/参数约48/204/652 MB纯权重。卡中中文Retrieval分别61.77/69.49/70.46，是2023年C-MTEB版本，不能直接横比新版Qwen/Gemma。短问题建议仅查询加“为这个句子生成表示以用于检索相关文章：”，正文不加。本地Transformers/Sentence Transformers可运行，未核实第一方云API，不作为中英跨语首选。[B3][B4][B5][B6]

### 5. EmbeddingGemma 2：效果基准之后的移动端候选

归属：Google DeepMind，2026-10-06发布。新代为 **Apache-2.0**，不能沿用旧embeddinggemma-300m的Gemma条款结论；740M为全模态，官方支持只加载270M文本部分，100余语言、8,192 tokens、768维，可缩为512/256/128维。BF16纯权重约0.54 GB（文本）/1.48 GB（全模态），非运行RAM；官方明确用BF16或FP32，**禁止FP16**，否则可能NaN或静默降质。[G1][G2]

问答检索用“task: question answering | query: {question}”；正文用“title: {真实标题或none} | text: {passage}”。官方有本地Sentence Transformers路径，未核实此checkpoint的第一方收费云API或本项目iOS路径。卡中多语言MTEB v2为61.36，旧一代61.15，主要增量是多模态、代码与输入长度；不能将纯文本效果写成显著跃升，也不能和2025版Qwen卡总分直接排胜负。[G1][G2]

竞品使用的 nomic-embed-text-v1.5 官方元数据标注语言en，RAG需使用search_query/search_document前缀；“被竞品选用”不能证明最适合中文或中英跨语，本轮不据此扩大候选。[N1]

## 最多三项优先验证

- **Qwen3-8B与4B**：建立公开权重效果基准，分辨中文/跨语表现与规模带来的实际收益，不先迁就旧手机预算。
- **voyage-4-large**：提供当前强云服务对照；若选择阿里云路线，则另以明确型号和区域的qwen3.7 API作服务对照，不与公开Qwen3混名。
- **BGE-M3 dense**：判断成熟多语言编码器是否已满足原题，也是复杂模型实际收益的参照。

效果确定之后，再比较0.6B/nano/Gemma2的手机运行时、导入耗时、查询延迟、内存、包体、许可及网络体验。本轮不以旧限制裁掉效果候选。

## 可重复最小同题评测

- 冻结原EPUB哈希、提取器版本、原问题、选文/追问语境和允许阅读范围；原两道失败题必测，以原文位置标注全部必要依据。补少量中文事实/因果/人物指代/跨章问题、英文同题及中文问英文书；两题通过不代表全书体验。
- **A：固定块对照。** 使用同一份现有块文本及原文位置，仅改变embedding及其规定的指令/池化/归一化；先不用reranker、混合检索或改写。记录必要段排名、Recall@8、全部必要依据是否同时覆盖、Top-8文本及来源；另报Recall@20定位较深漏检，20不当成现行产品通过。
- **B：模型适配。** A之后尝试约256/512/1024个各自tokenizer tokens的段落/句子块长；这是实验起点，不是官方推荐值。保留原文位置、完整句子语义，实际校验指令和special tokens后不超限；以必要原文跨度覆盖判定，不能拿变化后的chunk ID直接比较。固定最终原文材料预算，同时报告Top-K、实际总文本量，避免更大块靠更多材料取胜。
- 32K/128K是输入上限，不是建议切片长度；不能据此整章/整书压一个向量。缩维、量化、添加章节标题等影响单独记录；先用官方默认浮点配置。不同模型的向量空间不得混用（Voyage4官方明确兼容的组合除外）。
- 检索与回答分开验收：先看必要原文是否入选，再用同一生成模型、提示及材料预算检验结论和引用。记录冷/热查询延迟、导入耗时、实际峰值内存和API费用；本轮没有这些实测数据。
- 外部参考可用 [MTEB NovelQA](https://huggingface.co/datasets/mteb/NovelQA)：专门找长篇小说的人物、剧情、关系和时间问题所需段落，比整本文档识别更接近本产品。[LMEB原论文](https://arxiv.org/abs/2603.12572)观察到更大模型不总更好、传统MTEB优势不必迁移到长程依赖；选择8B作基准不等于预判8B胜出。本轮不下载或全面复跑公开大数据集。

## 一手来源

- [Q1] [Qwen3-Embedding官方模型卡：系列、用法、分项成绩与比较日期](https://huggingface.co/Qwen/Qwen3-Embedding-8B)。
- [Q2] [Qwen Team官方发布：Apache-2.0及架构](https://qwenlm.github.io/blog/qwen3-embedding/)。
- [Q3] [Model Studio同步API：2026-10-11、区域、text_type/instruct](https://www.alibabacloud.com/help/en/model-studio/text-embedding-synchronous-api)。
- [Q4] [Model Studio当前型号选型页](https://docs.modelstudio.console.alibabacloud.com/en/model-studio/embedding)。
- [V1] [Voyage当前embedding文档：型号及两侧前缀](https://docs.voyageai.com/docs/embeddings)。
- [V2] [Voyage 4官方发布：共享空间与评测](https://blog.voyageai.com/2026/01/15/voyage-4/)。
- [V3] [Voyage当前价格](https://docs.voyageai.com/docs/pricing)。
- [V4] [voyage-4-nano官方模型卡](https://huggingface.co/voyageai/voyage-4-nano)。
- [B1] [BAAI BGE-M3官方卡](https://huggingface.co/BAAI/bge-m3)，[MIT许可原文](https://huggingface.co/BAAI/bge-m3/blob/main/README.md)。
- [B2] [BGE-M3官方配置：参数估算依据](https://huggingface.co/BAAI/bge-m3/raw/main/config.json)。
- [B3] [中文BGE官方卡](https://huggingface.co/BAAI/bge-small-zh-v1.5)，[small元数据及MIT许可](https://huggingface.co/api/models/BAAI/bge-small-zh-v1.5)。
- [B4] [small-zh官方配置](https://huggingface.co/BAAI/bge-small-zh-v1.5/blob/main/config.json)。
- [B5] [base-zh官方配置](https://huggingface.co/BAAI/bge-base-zh-v1.5/raw/main/config.json)。
- [B6] [large-zh官方配置](https://huggingface.co/BAAI/bge-large-zh-v1.5/raw/main/config.json)。
- [G1] [Google当前总览：第2代及Apache-2.0](https://ai.google.dev/gemma/docs/embeddinggemma)。
- [G2] [Google官方第2代卡：加载、指令、精度及成绩](https://huggingface.co/google/embeddinggemma-2)，[许可原文](https://huggingface.co/google/embeddinggemma-2/raw/main/README.md)。
- [N1] [Nomic官方元数据：en语言标签](https://huggingface.co/api/models/nomic-ai/nomic-embed-text-v1.5)，[官方用法及前缀](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5)。
