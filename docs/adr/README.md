# 决策索引

当前开发从[导航](../README.md)进入；这里只在需要原因、取舍或历史边界时选读。accepted 是决定获准，验收结果另见[记录](../validation/README.md)。旧 ADR 不因曾经 accepted 就对所有平台、阶段持续适用。

## 当前决定与适用范围

| 决定 | 当前适用范围 |
| --- | --- |
| [0001 独立实现](0001-independent-implementation.md) | 实现与资源来源边界。 |
| [0003 本机可靠保存](0003-defer-full-backup.md) | 本机数据；完整备份恢复仍暂缓。 |
| [0006 有限后台生成](0006-bounded-background-generation.md) | 关闭不等于停止，不承诺固定后台时长。 |
| [0011 整书范围](0011-remove-only-read-scope.md) | 移除“仅已读”限制，不扩展为跨书架问答。 |
| [0012 AI 发送说明](0012-confirm-ai-send-scope-on-setup.md) | 在服务配置时确认。 |
| [0013 固定阅读正文](0013-fixed-reading-viewport-overlay-controls.md) | 工具栏覆盖显隐，保持正文位置。 |
| [0016 标注与书签](0016-annotations-information-architecture.md) | 记录内容标注与位置书签分开的取舍；详细交互、保存例外在产品规范。 |
| [0017 PDF 范围](0017-pdf-support.md) | 文字页与扫描页能力边界；原生 API 仅适用对应端。 |
| [0018 按需资料 / 大 PDF](0018-lightweight-model-and-large-pdf.md) | 按需下载与默认阅读策略；历史实现和测试数字按当时版本理解。 |
| [0019 RN / LangChain](0019-react-native-langchain-architecture.md) | 当前共享架构、设备内 Agent 与明确取代范围。 |
| [0020 跨端设计](0020-cross-platform-design-principles.md) | 设计原则；具体端的视觉基准仍需确认。 |

## 被替代或仅保留部分意图

| 历史决定 | 取代关系 / 使用边界 |
| --- | --- |
| [0002 完整备份](0002-local-data-and-backup.md) | 被 0003 取代。 |
| [0004 Readium](0004-readium-reader.md) | Swift 历史；RN 路线由 0019 取代。 |
| [0005 整书问答](0005-book-question-answering.md) → [0007 简单 RAG](0007-simple-local-rag.md) → [0008 混合检索](0008-local-hybrid-retrieval.md) | 演变历史。0011 移除已读限制；0019 取代单次生成与禁止工具 Agent 的限制。 |
| [0009 原型基准](0009-native-ui-design-baseline.md) → [0010 阅读优先](0010-reading-first-progressive-disclosure.md) | 旧原型与固定视觉要求失效；0013 修改正文布局，0020 保留层级意图、取代固定视觉。 |
| [0014 系统列表](0014-system-list-components.md) / [0015 导航修复](0015-ios26-navigation-bar-appearance.md) | UIKit 实施历史；成熟组件优先意图保留，RN 与跨端遵守 0019/0020，不复制旧 workaround。 |

新 ADR 只用于改动成本显著、缺少背景令人意外且有真实取舍的决定；格式及记录时机见[文档维护规范](../agents/documentation.md)。决定变化时更新取代关系，详细执行规则维护在当前专题正文，过程与测量结果写入验收记录；不为常规整理新增 ADR。
