# iPhone 本地整书检索：候选组件事实核验

核验日期：2026-10-14。状态：研究备选，不是已决定架构。本次仅核对官方文档、仓库和模型卡；未安装组件、转换模型或进行手机实测。

## 结论

本地生成向量、在手机 SQLite 内检索，再把必要原文交给用户配置的聊天服务，是可研究的方向。它把 embedding 与聊天服务分开，避免要求每个用户额外配置向量服务；但手机建索引速度、内存、耗电和召回效果尚未验证，不能直接承诺首发可用。

## SQLite 与 sqlite-vec

- sqlite-vec 是纯 C、无依赖的 SQLite 向量扩展；官方明确支持 iOS/Android，并称从 v0.1.2 提供移动平台预编译库。[仓库](https://github.com/asg017/sqlite-vec)、[移动平台文档](https://alexgarcia.xyz/sqlite-vec/android-ios.html)
- 使用 MIT / Apache-2.0 双许可；属于可考虑的宽松许可组件，仍需保留所选许可证要求的声明。组件许可不代表整个应用自动满足 App Store 要求。[MIT 原文](https://github.com/asg017/sqlite-vec/blob/main/LICENSE-MIT)、[Apache 原文](https://github.com/asg017/sqlite-vec/blob/main/LICENSE-APACHE)、[作者说明](https://alexgarcia.xyz/blog/2024/sqlite-vec-stable-release/index.html)
- README 明确写着 **pre-v1，预期会有 breaking changes**。官方移动文档不等于本项目已有可用 Swift 集成；版本锁定、SQLite 链接方式、真机与发布构建都待验证。[仓库](https://github.com/asg017/sqlite-vec)、[移动平台文档](https://alexgarcia.xyz/sqlite-vec/android-ios.html)
- 可以使用 `vec0` 虚表，也可以把向量存在普通表，用距离函数进行暴力 KNN；单本书的实际规模是否需要更多索引优化，应通过测量决定，不必先部署独立向量数据库。[KNN 文档](https://alexgarcia.xyz/sqlite-vec/features/knn.html)

## 中文关键词检索不能直接套默认 FTS5

- FTS5 默认 `unicode61` 把连续的字母/数字等 token 字符视为一个 token，按空白、标点等分隔；**它不是中文词法分词器**。因此不能因为名称中有 Unicode，就声称它能把无空格的中文句子切成“自由”“束缚”等词。这是依据官方分词规则作出的工程判断。[Unicode61 规则](https://sqlite.org/fts5.html#unicode61_tokenizer)
- 内置 trigram 支持连续三字符子串匹配；但全文查询中少于三个 Unicode 字符的子串不匹配，不能不加处理地承担两字中文词检索。[Trigram 文档](https://sqlite.org/fts5.html#the_trigram_tokenizer)
- 候选方向是适当的中文预分词/自定义 tokenizer，或经过评估的字符 n-gram 与短词补充策略；本次没有选定方案。索引和查询必须采用一致规则，并单独验证中文短词、人名、术语及中英混合内容。[自定义 tokenizer API](https://sqlite.org/fts5.html#custom_tokenizers)

## 本地 embedding 候选：multilingual-e5-small

| 项目 | 已确认事实与边界 |
| --- | --- |
| 许可 | 官方模型卡标记 MIT。 |
| 语言 | 模型卡列出中英文，说明支持 100 种语言；不等于已经证明本产品中文书籍检索质量。 |
| 结构/输出 | 12 层、384 维 embedding。 |
| 长度 | 官方示例 `max_length=512` 并截断，配置中 `max_position_embeddings=512`；需按该 tokenizer 控制片段长度，不能把 512 当作中文字数。 |
| 输入格式 | 查询加 `query: `，入库段落加 `passage: `，非英文也一样；官方示例采用 masked average pooling 和 L2 normalization。 |
| 参数量 | 本次未取得足够明确的官方参数总数证据，不把具体数值作为已核实结论。官方原始权重文件约 471 MB，这也不是手机运行内存。 |
| iOS 产物 | 官方仓库有 PyTorch/safetensors、ONNX、OpenVINO 文件；所检查目录未发现官方 Core ML 成品或开箱即用 iOS SDK。ONNX 文件存在，不等于已验证手机推理。 |

来源：[官方模型卡](https://huggingface.co/intfloat/multilingual-e5-small)、[模型卡原文/许可证标记](https://huggingface.co/intfloat/multilingual-e5-small/raw/main/README.md)、[配置](https://huggingface.co/intfloat/multilingual-e5-small/raw/main/config.json)、[官方文件目录](https://huggingface.co/intfloat/multilingual-e5-small/tree/main)、[ONNX 文件目录](https://huggingface.co/intfloat/multilingual-e5-small/tree/main/onnx)。

可研究两条集成路线：PyTorch 转 Core ML，或 ONNX Runtime Mobile。Apple 官方支持 PyTorch 到 Core ML 的转换，ONNX Runtime 官方支持 iOS；这些是通用能力，**尚未验证此模型的转换、算子、tokenizer、pooling 和精度一致性**。仓库的 `model_qint8_avx512_vnni.onnx` 不能仅凭约 118 MB 文件大小，就当作 iPhone 优化模型。

来源：[Apple 转换文档](https://apple.github.io/coremltools/docs-guides/source/convert-pytorch.html)、[ONNX Runtime Mobile](https://onnxruntime.ai/docs/get-started/with-mobile.html)。

## 聊天配置与 embedding 配置是两回事

Anthropic 官方明确说明不提供自家 embedding 模型，文档引导用户评估 Voyage 等独立服务。因此，用户有 Anthropic 聊天 Key，不意味着拥有 embedding 能力；采用外部 embedding 时需要另行处理服务可用性、凭据、费用与整书文本发送范围。OpenAI 兼容聊天地址也不能仅凭“兼容聊天”假定支持 embedding。

来源：[Anthropic embeddings 文档](https://docs.anthropic.com/en/docs/build-with-claude/embeddings)。最后一句是接口能力边界的工程判断，而非对所有兼容服务的实测结论。

## 决策前必须补充的验证

- 目标 iPhone 上整书建索引耗时、峰值内存、发热/耗电、切后台中断后的恢复；导入完成不应意味着阻塞阅读直到向量全部生成。
- 分词与模型转换前后的 embedding 一致性；英文提问找中文书、中文提问找英文书、术语短词、跨章指代的召回。
- 同一本书分别比较关键词、向量和混合检索；判断改进来自哪里，而非默认向量必然更好。
- SQLite/向量扩展在真机发布构建中的链接、持久化与版本升级行为。向量属于可重建索引，阅读进度、笔记、对话不应依赖索引可用性才能保存。

这些是待执行的验收项，没有完成或通过的结论。
