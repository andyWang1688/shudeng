---
status: accepted
date: 2026-10-29
---

# 按页面文字可用性提供 PDF 能力

用户要求 PDF 与 EPUB 一样进入书架，但文字页和扫描页能支持的交互不同。决定为有文字的页面提供选文、标注、搜索与问答，扫描页保留阅读、缩放与书签，明确不做 OCR、重排和表格结构还原；相比把 PDF 限为只读，这保留核心阅读能力，相比自动识别与重排则降低实现和质量控制成本。

不使用“支持等级”标签，导入时检查并在确有扫描页时说明能力，读者可取消或继续；混合 PDF 按页面处理。业务与异常规则维护在[产品规范](../product-scope.md#书架与阅读)。

iOS 选择 PDFKit，因旧 Readium PDF 路线不能覆盖所需标注；RN 与未来平台边界由 [ADR-0019](0019-react-native-langchain-architecture.md)及[架构](../architecture.md)管理。原生 API、导入检测细节与当时限制保存在[历史记录](../archive/planning/0017-pdf-history.md)。
