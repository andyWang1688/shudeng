/**
 * 书内只读数据源端口：生产实现注入 BookIndex/ReaderBridge，测试与评测用内存书。
 * 端口只返回原文与定位，不依赖具体阅读器引擎。
 */
import type { BookIdentity } from '../domain/types.js';

export interface BookExcerpt {
  /** 片段的展示上下文（可短于 quote）。 */
  context: string;
  /** 可被引用的完整原文（引用核对必须以此为真值）。 */
  quote: string;
  chapter: string;
  page?: number;
  /** 回跳原文的定位串；不同引擎格式不同，由宿主解释。 */
  locator: string;
}

export interface BookPassage {
  chapter: string;
  page?: number;
  excerpts: BookExcerpt[];
  truncated?: boolean;
}

export interface BookSource {
  /** 关键词检索，按相关度/阅读顺序返回片段。 */
  search(query: string, limit?: number): Promise<BookExcerpt[]>;
  /** PDF 页码或 EPUB 章节序号（1-based）读取；找不到返回 null。 */
  page(page: number): Promise<BookPassage | null>;
  /** 按标题 / href / 序号匹配章节。 */
  chapter(reference: string): Promise<BookPassage | null>;
}

/** 一本书的内存分章文本，用于测试与 Node 评测。 */
export interface InMemoryBook {
  book: BookIdentity;
  /** 有序章节：标题 + 段落/页文本。 */
  chapters: ReadonlyArray<{ title: string; paragraphs: ReadonlyArray<string>; page?: number }>;
}

/**
 * 最小内存数据源：按行/段落切片段，不做语义检索（V1 spike 只验证 Agent 闭环）。
 */
export class InMemoryBookSource implements BookSource {
  private readonly book: InMemoryBook;
  private readonly fragments: ReadonlyArray<BookExcerpt>;

  constructor(book: InMemoryBook) {
    this.book = book;
    const fragments: BookExcerpt[] = [];
    book.chapters.forEach((chapter, chapterIndex) => {
      chapter.paragraphs.forEach((paragraph, paragraphIndex) => {
        const quote = paragraph.trim();
        if (!quote) return;
        fragments.push({
          context: quote,
          quote,
          chapter: chapter.title,
          ...(chapter.page !== undefined ? { page: chapter.page } : {}),
          locator: `chapter:${chapterIndex + 1}:p:${paragraphIndex + 1}`,
        });
      });
    });
    this.fragments = fragments;
  }

  get identity(): BookIdentity {
    return this.book.book;
  }

  async search(query: string, limit = 5): Promise<BookExcerpt[]> {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const terms = needle.split(/\s+/).filter(Boolean);
    return this.fragments
      .filter((fragment) => {
        const haystack = `${fragment.chapter}\n${fragment.quote}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .slice(0, Math.max(0, Math.min(limit, 8)));
  }

  async page(page: number): Promise<BookPassage | null> {
    if (!Number.isInteger(page) || page < 1) return null;
    const indexed = this.book.chapters.filter((chapter) => chapter.page === page);
    const selected = indexed.length
      ? indexed
      : this.book.chapters.slice(page - 1, page);
    if (!selected.length) return null;
    const chapter = selected[0]!;
    const excerpts = this.fragments.filter((fragment) => fragment.chapter === chapter.title);
    if (!excerpts.length) return null;
    const resolvedPage = chapter.page ?? page;
    return { chapter: chapter.title, page: resolvedPage, excerpts };
  }

  async chapter(reference: string): Promise<BookPassage | null> {
    const needle = reference.trim().toLowerCase();
    if (!needle) return null;
    const index = this.book.chapters.findIndex((chapter, offset) => {
      const title = chapter.title.toLowerCase();
      return title === needle || title.includes(needle) || String(offset + 1) === needle;
    });
    if (index < 0) return null;
    const chapter = this.book.chapters[index]!;
    const excerpts = this.fragments.filter((fragment) => fragment.chapter === chapter.title);
    if (!excerpts.length) return null;
    return {
      chapter: chapter.title,
      ...(chapter.page !== undefined ? { page: chapter.page } : {}),
      excerpts,
    };
  }
}
