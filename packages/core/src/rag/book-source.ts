/**
 * SqliteBookSource：把 SQLite 混合检索（rag_chunks + FTS5 + 向量）接到
 * agent 的 BookSource 端口，供 LangChain 工具（search_book/read_page/read_chapter）使用。
 *
 * 返回的 quote 就是索引里的 chunk 原文（引用核对真值）；locator 是 rag-chunk-v1 JSON，
 * 宿主（阅读器/UI）据此回跳原文（章节/页码/字符 offset）。
 */
import type { BookExcerpt, BookPassage, BookSource } from '../agent/book-source.js';
import type { BookIdentity } from '../domain/types.js';
import type { SearchIndex, TextChunk } from './types.js';

/** chunk → agent 工具使用的原文摘录。 */
export function chunkToExcerpt(chunk: TextChunk): BookExcerpt {
  return {
    context: chunk.text,
    quote: chunk.text,
    chapter: chunk.chapter,
    ...(chunk.page !== undefined ? { page: chunk.page } : {}),
    locator: chunk.locatorJson,
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
  private readonly index: SearchIndex;
  private readonly book: BookIdentity;

  constructor(index: SearchIndex, book: BookIdentity) {
    this.index = index;
    this.book = book;
  }

  async search(query: string, limit = 5): Promise<BookExcerpt[]> {
    const hits = await this.index.search(query, { bookId: this.book.id, topK: limit });
    return hits.map((hit) => chunkToExcerpt(hit.chunk));
  }

  /**
   * PDF：按 page；EPUB 没有页概念时回退为章节序号（1-based），与 InMemoryBookSource 对齐。
   */
  async page(page: number): Promise<BookPassage | null> {
    const byPage = await this.index.chunksForPage(this.book.id, page);
    if (byPage.length > 0) return toPassage(byPage, page);
    const byChapterOrdinal = await this.index.chunksForChapter(this.book.id, page);
    return toPassage(byChapterOrdinal, page);
  }

  async chapter(reference: string): Promise<BookPassage | null> {
    const chunks = await this.index.chunksForChapter(this.book.id, reference);
    return toPassage(chunks);
  }
}
