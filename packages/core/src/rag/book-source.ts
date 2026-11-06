/**
 * SqliteBookSource：把 SQLite 混合检索（rag_chunks + FTS5 + 向量）接到
 * agent 的 BookSource 端口，供 LangChain 工具（search_book/read_page/read_chapter）使用。
 *
 * 返回的 quote 就是索引里的 chunk 原文（引用核对真值）；locator 是 rag-chunk-v1 JSON，
 * 宿主（阅读器/UI）据此回跳原文（章节/页码/字符 offset）。
 */
import type { BookExcerpt, BookOutline, BookPassage, BookPassageRequest, BookSource, BookSourceContext } from '../agent/book-source.js';
import type { BookIdentity } from '../domain/types.js';
import type { BookReadIndex, TextChunk } from './types.js';
import { BookHybridRetriever, chunkReadRef } from './retriever.js';

/** chunk → agent 工具使用的原文摘录。 */
export function chunkToExcerpt(chunk: TextChunk): BookExcerpt {
  return {
    context: chunk.text,
    quote: chunk.text,
    chapter: chunk.chapter,
    ...(chunk.page !== undefined ? { page: chunk.page } : {}),
    locator: chunk.locatorJson,
    chunkId: chunk.id,
    readRef: chunkReadRef(chunk),
    ...(chunk.sourceVersion ? { sourceVersion: chunk.sourceVersion } : {}),
  };
}

function toPassage(chunks: ReadonlyArray<TextChunk>, page?: number): BookPassage | null {
  if (chunks.length === 0) return null;
  const first = chunks[0]!;
  return {
    chapter: first.chapter,
    ...(page !== undefined ? { page } : first.page !== undefined ? { page: first.page } : {}),
    excerpts: chunks.map(chunkToExcerpt),
  };
}

export class SqliteBookSource implements BookSource {
  private readonly index: BookReadIndex;
  private readonly book: BookIdentity;

  constructor(index: BookReadIndex, book: BookIdentity) {
    this.index = index;
    this.book = book;
  }

  async search(query: string, limit = 5, context: BookSourceContext = {}): Promise<BookExcerpt[]> {
    const documents = await new BookHybridRetriever(this.index, this.book.id, limit, context.signal).invoke(query);
    return documents.map(document => ({
      context: document.pageContent, quote: document.pageContent,
      chapter: String(document.metadata.chapter), locator: String(document.metadata.locator),
      chunkId: String(document.metadata.chunkId), readRef: String(document.metadata.readRef),
      ...(typeof document.metadata.page === 'number' ? { page: document.metadata.page } : {}),
      ...(typeof document.metadata.sourceVersion === 'string' ? { sourceVersion: document.metadata.sourceVersion } : {}),
    }));
  }

  /**
   * PDF：按 page；EPUB 没有页概念时回退为章节序号（1-based），与 InMemoryBookSource 对齐。
   */
  async page(page: number, context: BookSourceContext = {}): Promise<BookPassage | null> {
    return this.passage({ reference: `page:${page}`, before: 0, after: 19 }, context);
  }

  async chapter(reference: string, context: BookSourceContext = {}): Promise<BookPassage | null> {
    return this.passage({ reference, before: 0, after: 19 }, context);
  }

  async outline(options: { cursor?: string; limit?: number } = {}, context: BookSourceContext = {}): Promise<BookOutline> {
    return this.index.outline(this.book.id, { ...options, ...context });
  }

  async passage(request: BookPassageRequest, context: BookSourceContext = {}): Promise<BookPassage | null> {
    const page = await this.index.readPassage(this.book.id, { ...request, ...context });
    if (!page) return null;
    const passage = toPassage(page.chunks);
    return passage ? { ...passage, reference: page.reference,
      ...(page.locationPrecision ? { locationPrecision: page.locationPrecision } : {}),
      ...(page.locationNote ? { locationNote: page.locationNote } : {}),
      ...(page.nextCursor ? { truncated: true, nextCursor: page.nextCursor } : {}) } : null;
  }
}
