/** LangChain 官方 Retriever 端口；底层保留本地 SQLite 混合检索和原文位置。 */
import { Document } from '@langchain/core/documents';
import { BaseRetriever } from '@langchain/core/retrievers';
import type { BookSearchIndex, CancellationSignal, TextChunk } from './types.js';

export function chunkReadRef(chunk: TextChunk): string {
  return JSON.stringify({ type: 'book-chunk', bookId: chunk.bookId, chunkId: chunk.id,
    ...(chunk.sourceVersion ? { version: chunk.sourceVersion } : {}) });
}

export class BookHybridRetriever extends BaseRetriever {
  lc_namespace = ['shudeng', 'retrievers', 'book'];
  constructor(private readonly index: BookSearchIndex, private readonly bookId: string, private readonly topK = 5, private readonly signal?: CancellationSignal) {
    super();
  }

  async _getRelevantDocuments(query: string): Promise<Document[]> {
    const hits = await this.index.search(query, { bookId: this.bookId, topK: Math.max(1, Math.min(8, this.topK)), ...(this.signal ? { signal: this.signal } : {}) });
    return hits.map(({ chunk, score, sources }) => new Document({
      id: chunk.id, pageContent: chunk.text,
      metadata: { bookId: chunk.bookId, chunkId: chunk.id, chapter: chunk.chapter,
        chapterOrdinal: chunk.chapterOrdinal, page: chunk.page, locator: chunk.locatorJson,
        startOffset: chunk.startOffset, endOffset: chunk.endOffset,
        sourceVersion: chunk.sourceVersion, readRef: chunkReadRef(chunk), score, sources },
    }));
  }
}
