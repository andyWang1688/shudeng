/**
 * V2 离线检索（纯 TS）公共入口。
 *
 * - TextChunker / EmbeddingProvider / SearchIndex：注入式端口；
 * - ParagraphTextChunker / DeterministicEmbeddingProvider / SqliteSearchIndex：Node/移动端可复用实现；
 * - SqliteBookSource：接到 agent 的 BookSource（LangChain 工具使用）；
 * - indexRagBook：书 → 切块 → embedding → SQLite 索引 一条龙。
 */
export * from './types.js';
export * from './text.js';
export * from './chunker.js';
export * from './embedding.js';
export * from './search-index.js';
export * from './book-source.js';

import { assertNotAborted, type IndexRagBookOptions, type TextChunk } from './types.js';

/** 书导入到索引完成；返回切块与向量便于测试/评测断言。 */
export async function indexRagBook(
  options: IndexRagBookOptions,
): Promise<{ chunks: TextChunk[]; embeddings: Float32Array[] }> {
  const chunks = options.chunker.chunk(
    options.book,
    options.chunkOptions ?? {},
    options.signal ? { signal: options.signal } : {},
  );
  assertNotAborted(options.signal);
  const embeddings = await options.embedding.embed(
    chunks.map((chunk) => chunk.text),
    options.signal ? { signal: options.signal } : {},
  );
  await options.index.indexBook(options.book, chunks, embeddings, options.signal ? { signal: options.signal } : {});
  return { chunks, embeddings };
}
