/**
 * 书内只读数据源端口：生产实现注入 BookIndex/ReaderBridge，测试与评测用内存书。
 * 端口只返回原文与定位，不依赖具体阅读器引擎。
 */
import type { BookIdentity } from '../domain/types.js';
import { assertNotAborted, type CancellationSignal } from '../rag/types.js';

export interface BookSourceContext { signal?: CancellationSignal }

export interface BookExcerpt {
  /** 片段的展示上下文（可短于 quote）。 */
  context: string;
  /** 可被引用的完整原文（引用核对必须以此为真值）。 */
  quote: string;
  chapter: string;
  page?: number;
  /** 回跳原文的定位串；不同引擎格式不同，由宿主解释。 */
  locator: string;
  /** 索引时生成的来源身份；相同文字在不同位置仍是不同来源。 */
  chunkId?: string;
  /** 供 read_book_passage 原样使用的定位，包含当前书和索引版本。 */
  readRef?: string;
  sourceVersion?: string;
}

export interface BookPassage {
  chapter: string;
  page?: number;
  excerpts: BookExcerpt[];
  truncated?: boolean;
  reference?: string;
  nextCursor?: string;
  locationPrecision?: 'exact' | 'chapter' | 'approximate';
  locationNote?: string;
}

export interface BookOutlineEntry {
  reference: string;
  ordinal: number;
  title: string;
  page?: number;
  href?: string;
  chunkCount?: number;
}

export interface BookOutline {
  entries: BookOutlineEntry[];
  nextCursor?: string;
}

export interface BookPassageRequest {
  reference: string;
  /** 返回值中的不透明续读游标，须原样传回。 */
  cursor?: string;
  before?: number;
  after?: number;
  maxChars?: number;
}

export interface BookSource {
  /** 关键词检索，按相关度/阅读顺序返回片段。 */
  search(query: string, limit?: number, context?: BookSourceContext): Promise<BookExcerpt[]>;
  /** PDF 页码或 EPUB 章节序号（1-based）读取；找不到返回 null。 */
  page(page: number, context?: BookSourceContext): Promise<BookPassage | null>;
  /** 按标题 / href / 序号匹配章节。 */
  chapter(reference: string, context?: BookSourceContext): Promise<BookPassage | null>;
  outline?(options?: { cursor?: string; limit?: number }, context?: BookSourceContext): Promise<BookOutline>;
  passage?(request: BookPassageRequest, context?: BookSourceContext): Promise<BookPassage | null>;
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
          chunkId: `${book.book.id}:c${chapterIndex + 1}:p${paragraphIndex + 1}`,
          readRef: `chapter:${chapterIndex + 1}:p:${paragraphIndex + 1}`,
        });
      });
    });
    this.fragments = fragments;
  }

  get identity(): BookIdentity {
    return this.book.book;
  }

  async search(query: string, limit = 5, context: BookSourceContext = {}): Promise<BookExcerpt[]> {
    assertNotAborted(context.signal);
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

  async page(page: number, context: BookSourceContext = {}): Promise<BookPassage | null> {
    assertNotAborted(context.signal);
    if (!Number.isInteger(page) || page < 1) return null;
    const byPage = this.book.chapters.findIndex((chapter) => chapter.page === page);
    const index = byPage >= 0 ? byPage : page - 1;
    const chapter = this.book.chapters[index];
    if (!chapter) return null;
    const excerpts = this.fragments.filter((fragment) => fragment.locator.startsWith(`chapter:${index + 1}:`));
    if (!excerpts.length) return null;
    const resolvedPage = chapter.page ?? page;
    return { chapter: chapter.title, page: resolvedPage, excerpts };
  }

  async chapter(reference: string, context: BookSourceContext = {}): Promise<BookPassage | null> {
    assertNotAborted(context.signal);
    const needle = reference.trim().toLowerCase();
    if (!needle) return null;
    const index = this.book.chapters.findIndex((chapter, offset) => {
      const title = chapter.title.toLowerCase();
      return title === needle || title.includes(needle) || String(offset + 1) === needle;
    });
    if (index < 0) return null;
    const chapter = this.book.chapters[index]!;
    const excerpts = this.fragments.filter((fragment) => fragment.locator.startsWith(`chapter:${index + 1}:`));
    if (!excerpts.length) return null;
    return {
      chapter: chapter.title,
      ...(chapter.page !== undefined ? { page: chapter.page } : {}),
      excerpts,
    };
  }

  async outline(options: { cursor?: string; limit?: number } = {}, context: BookSourceContext = {}): Promise<BookOutline> {
    assertNotAborted(context.signal);
    const start = Number(options.cursor ?? 0);
    if (!Number.isInteger(start) || start < 0) throw new Error('目录游标无效');
    const limit = Math.max(1, Math.min(50, options.limit ?? 30));
    const entries = this.book.chapters.slice(start, start + limit).map((chapter, offset) => ({
      reference: `chapter:${start + offset + 1}`, ordinal: start + offset + 1, title: chapter.title,
      ...(chapter.page !== undefined ? { page: chapter.page } : {}),
    }));
    return { entries, ...(start + entries.length < this.book.chapters.length ? { nextCursor: String(start + entries.length) } : {}) };
  }

  async passage(request: BookPassageRequest, context: BookSourceContext = {}): Promise<BookPassage | null> {
    assertNotAborted(context.signal);
    const match = /^chapter:(\d+)(?::p:(\d+))?$/.exec(request.reference);
    if (!match) {
      const found = await this.chapter(request.reference, context);
      if (!found) return null;
      const first = found.excerpts[0];
      return first ? this.passage({ ...request, reference: first.locator }, context) : null;
    }
    const ordinal = Number(match[1]);
    const chapter = this.book.chapters[ordinal - 1];
    if (!chapter) return null;
    const fragments = this.fragments.filter(fragment => fragment.locator.startsWith(`chapter:${ordinal}:`));
    const anchor = match[2] ? fragments.findIndex(fragment => fragment.locator === request.reference) : 0;
    if (anchor < 0) return null;
    const start = request.cursor ? Number(request.cursor) : Math.max(0, anchor - Math.max(0, Math.min(3, request.before ?? 1)));
    if (!Number.isInteger(start) || start < 0) throw new Error('续读游标无效');
    const count = Math.max(1, Math.min(20, (request.before ?? 1) + (request.after ?? 5) + 1));
    const maxChars = Math.max(256, Math.min(12000, request.maxChars ?? 6000));
    const excerpts: BookExcerpt[] = [];
    let chars = 0;
    for (const fragment of fragments.slice(start, start + count)) {
      if (excerpts.length && chars + fragment.quote.length > maxChars) break;
      excerpts.push(fragment); chars += fragment.quote.length;
    }
    const next = start + excerpts.length;
    return { chapter: chapter.title, excerpts, reference: request.reference,
      ...(chapter.page !== undefined ? { page: chapter.page } : {}),
      ...(next < fragments.length ? { truncated: true, nextCursor: String(next) } : {}),
    };
  }
}
