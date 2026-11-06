/**
 * V2 离线检索端口（纯 TS，不依赖 Node / RN / 具体 Embedding 运行时）。
 *
 * 分工：
 * - TextChunker：书 → 原文切块（保留章节/页码/字符 offset/locator）。
 * - EmbeddingProvider：文本 → 向量（Node 用确定性 stub；移动端可注入 onnxruntime-react-native）。
 * - SearchIndex：切块 + 向量 → SQLite FTS5 + 向量 BLOB，混合检索（FTS + cosine）。
 */
import type { BookIdentity } from '../domain/types.js';

/** 取消信号（结构兼容 AbortSignal，避免 core 依赖 DOM/Node 类型）。 */
export interface CancellationSignal {
  readonly aborted: boolean;
}

export function assertNotAborted(signal?: CancellationSignal): void {
  if (signal?.aborted) {
    const error = new Error('检索已取消');
    error.name = 'AbortError';
    throw error;
  }
}

/** 章节：ordinal 从 1 开始；EPUB 无 page，PDF 的页可同时作为章节。 */
export interface RagChapter {
  ordinal: number;
  title: string;
  page?: number;
  /** EPUB archive path, resolved relative to the OPF. Never a host filesystem path. */
  href?: string;
  /** 与 paragraphs 二选一：直接给整章文本。 */
  text?: string;
  paragraphs?: ReadonlyArray<string>;
}

export interface RagBook {
  book: BookIdentity;
  chapters: ReadonlyArray<RagChapter>;
}

/** 回跳原文的定位信息；JSON 化后存入 rag_chunks.locator_json。 */
export interface ChunkLocator {
  readonly engine: 'rag-chunk-v1';
  readonly chapter: string;
  readonly chapterOrdinal: number;
  readonly page?: number;
  readonly href?: string;
  readonly locations?: { readonly progression: number };
  readonly text?: { readonly highlight: string };
  /** 相对章节原文的 UTF-16 字符偏移（slice 可还原）。 */
  readonly charStart: number;
  readonly charEnd: number;
  /** 段落区间（章节以 paragraphs 提供时存在，0-based，含端点）。 */
  readonly paragraphStart?: number;
  readonly paragraphEnd?: number;
}

export interface TextChunk {
  readonly id: string;
  readonly bookId: string;
  readonly chapter: string;
  readonly chapterOrdinal: number;
  readonly page?: number;
  /** 相对章节原文的字符 offset（含端点前闭后开）。 */
  readonly startOffset: number;
  readonly endOffset: number;
  readonly text: string;
  readonly locator: ChunkLocator;
  readonly locatorJson: string;
  /** 读取时绑定的索引版本；不改变持久 chunkId。 */
  readonly sourceVersion?: string;
}

export interface ChunkerOptions {
  /** 单块最大字符数（默认 120，给 128 token 窗口留出 specials 余量）。 */
  maxChars?: number;
  /** 含特殊 token 的真实模型预算。必须与 countTokens 一起提供。 */
  maxTokens?: number;
  countTokens?: (text: string) => number;
}

export interface TextChunker {
  chunk(book: RagBook, options?: ChunkerOptions, context?: { signal?: CancellationSignal }): TextChunk[];
}

export interface EmbeddingOptions {
  signal?: CancellationSignal;
}

export interface EmbeddingProvider {
  /** 固定模型/版本标识，写入向量表用于校验（换模型需重建索引）。 */
  readonly modelId: string;
  readonly dimension: number;
  readonly maxInputTokens?: number;
  countTokens?(text: string): number;
  /** 异步平台在切块前准备 tokenizer，无须提前执行推理。 */
  prepare?(): Promise<void>;
  embed(texts: ReadonlyArray<string>, options?: EmbeddingOptions): Promise<Float32Array[]>;
}

export type SearchMode = 'hybrid' | 'fts' | 'vector';

export interface SearchOptions {
  bookId: string;
  /** 返回条数，默认 5。 */
  topK?: number;
  /** 默认 hybrid（FTS + 向量 RRF 融合）。 */
  mode?: SearchMode;
  signal?: CancellationSignal;
}

export type SearchSource = 'fts' | 'vector';

export interface SearchHit {
  chunk: TextChunk;
  /** RRF 融合分数（越大越相关）；单独模式为排名分。 */
  score: number;
  /** 该结果来自哪些检索路径（混合模式下可能同时来自两者）。 */
  sources: SearchSource[];
}

export interface IndexBookOptions {
  signal?: CancellationSignal;
}

export interface BookSearchIndex {
  search(query: string, options: SearchOptions): Promise<SearchHit[]>;
}

/** Agent 与阅读器依赖的只读、可取消、有界读取能力。 */
export interface BookReadIndex extends BookSearchIndex {
  iterateChunks(bookId: string, options?: { readonly batchSize?: number; readonly signal?: CancellationSignal }): AsyncIterable<TextChunk>;
  outline(bookId: string, options?: { cursor?: string; limit?: number; signal?: CancellationSignal }): Promise<ChunkOutline>;
  readPassage(bookId: string, request: ChunkReadRequest): Promise<ChunkReadPage | null>;
}

export interface BookIndexWriter {
  indexBook(
    book: RagBook,
    chunks: ReadonlyArray<TextChunk>,
    embeddings: ReadonlyArray<Float32Array>,
    options?: IndexBookOptions,
  ): Promise<void>;
  deleteBook(bookId: string): Promise<void>;
}

/** SQLite 索引完整端口；数组读取保留给现有评测与迁移调用。 */
export interface SearchIndex extends BookReadIndex, BookIndexWriter {
  listChunks(bookId: string): Promise<TextChunk[]>;
  chunksForChapter(bookId: string, reference: string | number): Promise<TextChunk[]>;
  chunksForPage(bookId: string, page: number): Promise<TextChunk[]>;
}

export interface ChunkOutline {
  entries: Array<{ reference: string; ordinal: number; title: string; page?: number; href?: string; chunkCount: number }>;
  nextCursor?: string;
}

export interface ChunkReadRequest {
  reference: string; cursor?: string; before?: number; after?: number; maxChars?: number;
  signal?: CancellationSignal;
}

export interface ChunkReadPage {
  chunks: TextChunk[]; reference: string; nextCursor?: string;
  locationPrecision?: 'exact' | 'chapter' | 'approximate';
  locationNote?: string;
}

export interface IndexStats {
  readonly bookId: string;
  readonly chunkCount: number;
  readonly vectorCount: number;
  readonly models: ReadonlyArray<{ model: string; dim: number; count: number }>;
}

/** 从书导入到索引完成（chunk→embed→write），测试/评测共用。 */
export interface IndexRagBookOptions {
  index: BookIndexWriter;
  chunker: TextChunker;
  embedding: EmbeddingProvider;
  book: RagBook;
  chunkOptions?: ChunkerOptions;
  signal?: CancellationSignal;
}
