# EPUB 文件导入与有界索引验收记录

2026-11-03；覆盖纯 TypeScript、Node/SQLite 和平台编排。未执行 iOS 构建、安装、设备或 WKWebView 验收。

## 已实现合同

1. EPUB 通过 EpubResourceArchive 检查 metadata，并逐 spine 校验、逐章回收。文件晋级和书籍保存后即可阅读；后台准备单队列运行，导入 UI 不等待模型。失败/暂停保存在 book_index_state，可显式重试或下次启动恢复。
2. ChapterIndexBuild 独占 pending 命名空间。每 16 chunks 的正文、FTS、vectors 和 typed checkpoint 一起提交，每批核对 sourceHash、generation、文件操作和取消。正式旧索引保留到最终事务晋级；chunk ID、locator 和 vector/FTS 关联完整恢复。删除同事务清正式、pending、checkpoint 并递增 generation。
3. 同书任务合并所有调用者的取消/进度订阅，等待任务可立即取消；重复导入先取消并等待旧 writer，完成后恢复。崩溃恢复清无主/失效构建。只有模型错误可降级语义能力，数据库、revision 和生命周期异常直接传播。
4. 向量每页 64 行，仅保留候选 top K。精确搜索按 keyset chunks，以 KMP 和相邻 grapheme/context 窗口扫描；保留全部真实非重叠出现、Unicode case/diacritic folding、跨 chunk、overlap 去重、未知 gap、35/55 上下文、256 引用上下文和精确 UTF16 locator。
5. rag-index-revision 在正式重建、晋级和删除同事务递增。向量/全文/章节/页读取前后检查 revision，平台另查 sourceHash/generation，避免混代。封面独立查 package 与图片 lease；8 MiB 缓存预算失败仅降级，始终释放 lease，缺失缓存绑定 sourceHash/generation。

## 迁移与 10 万 chunks 查询

0005_rag_keyset_indexes 只增加两个索引，未改表或既有 0001–0004：

    CREATE INDEX IF NOT EXISTS rag_chunks_book_id ON rag_chunks (book_id, id);
    CREATE INDEX IF NOT EXISTS rag_chunks_reading_order ON rag_chunks
      (book_id, chapter_ordinal, start_offset, end_offset, id);

覆盖新库、0004 既存 chunk/vector/FTS 数据升级、第二条 DDL 故障整体回滚及重试。10 万 chunks 首/后页返回行与升级前完全一致，四种 EXPLAIN QUERY PLAN 均不再出现 TEMP B-TREE。

一次 Node 并行验收样本（毫秒，受缓存和负载影响，不代表设备耗时）：

| 查询 | 加索引前 | 加索引后 | 最终索引 |
| --- | ---: | ---: | --- |
| vector 首 64 行 | 105.38 | 0.089 | rag_chunks_book_id |
| vector 9 万后的 64 行 | 10.84 | 0.086 | rag_chunks_book_id，id 范围 seek |
| 原文首 64 行 | 68.40 | 0.202 | rag_chunks_reading_order |
| 原文 9 万后的 64 行 | 33.13 | 0.205 | rag_chunks_reading_order，tuple 范围 seek |

同一 fixture 全扫描向量 top 17 与原全量打分排序一致；原文首 64 chunks 保持同序。

## 验证

最终定向结果：core 43/43；mobile 生命周期/索引/搜索 79/79；core/mobile TypeScript 和 diff 空白检查通过。独立复核的 7/7 反例、core 定向 28/28 与迁移 4/4 均通过，本范围没有剩余阻断问题。

三个 fixture（search-fixture.epub、pride-and-prejudice.epub、semantic-fixture.epub）的章节 title/href/ordinal/text、chunk ID、UTF16 slice 全等。搜索包含单 UTF16 切分的 surrogate/ZWJ/组合标记、1,200 字符查询、5,000 个组合标记、EOF 孤立高代理、overlap/gap、删除重导、同 hash 晋级。50 万 UTF16 无匹配正文的扫描器保留 source 峰值低于 1,000 单位；该诊断不等于 RSS。

独立复核用全文 Intl.Segmenter oracle 对 200 组确定性 Unicode 随机分片逐项比 offset/highlight/context/before/after；另注入瞬时 revision 读取故障，确认不能被模型 fallback 吞掉。

仓库根目录复现：

    pnpm --filter @shudeng/core exec vitest run src/db/query-index-migration.test.ts src/rag/bounded-read.test.ts src/rag/search-index.test.ts src/rag/checkpoint-index.test.ts src/rag/epub-publication.test.ts src/rag/epub-content.test.ts src/rag/chunker.test.ts
    packages/core/node_modules/.bin/vitest run --config apps/mobile/vitest.library-index.config.mts
    pnpm --filter @shudeng/core typecheck
    pnpm --filter @shudeng/mobile typecheck
    git diff --check

## 未验证边界

- 输入内存随最大单章/输入 chunk、查询长度和不可切分的单个 grapheme 增长；结果内存随真实匹配数增长。未人为截断长查询、组合序列或结果。单章 XML 仍整体解析，任意长组合序列 carry 重分段可能增加 CPU 耗时。
- 封面字节预算不等于像素预算；巨像素图片尚无 ImageIO 缩略图/像素限制证据，需设备验收。过大或损坏封面不得阻止有效正文导入。
- iOS/Hermes 大书的 App/WK RSS、首屏、准备耗时、取消延迟、杀进程恢复和临时文件占用等待统一构建验收；本记录不把 Node 通过写成设备通过。
