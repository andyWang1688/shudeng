/** Product ingestion: file-backed chapters, durable batches and atomic index promotion. */
import {
  ChapterIndexBuild, ParagraphTextChunker, SqliteBookSource, SqliteSearchIndex, assertNotAborted,
  cleanupStaleBookIndexBuilds, inspectEpubResources, readEpubChapter, validateEpubChapter,
  type BookIdentity, type CancellationSignal, type EpubContent, type EpubPublication,
  type EpubResourceArchive, type RagChapter, type TextChunk, type EmbeddingProvider,
} from '@shudeng/core';
import type { SQLiteDriver } from '@shudeng/core/db';
import { getDataLayer } from '../db';
import { embeddingStatus, getEmbeddingProvider } from '../embedding';
import { openEpubArchive } from '../epubArchive';
import { findBookFile } from '../bookFiles';
import type { PdfImportInfo } from '../library/pdfImport';
import { getBookIndexGeneration, isBookFileOperationActive, isBookIndexGenerationCurrent, recordBookIndexState } from '../library/bookFileOperations';

export type BookImportProgress = { readonly stage: 'reading' | 'indexing' | 'embedding'; readonly completed: number; readonly total: number };
export type BookIndexOptions = { readonly signal?: CancellationSignal; readonly onProgress?: (progress: BookImportProgress) => void };
export type BookContent = {
  readonly title: string | null; readonly author: string | null; readonly chapters: readonly RagChapter[];
  readonly epub?: { readonly fileUri: string; readonly publication: EpubPublication };
  readonly pdf?: PdfImportInfo;
  readonly cover?: EpubContent['cover'];
};
export type BookIndexStatus = { readonly available: boolean; readonly semantic: boolean; readonly detail: string };
type IndexJob = {
  readonly book: BookIdentity; readonly promise: Promise<BookIndexStatus>; readonly cancel: { aborted: boolean };
  state: 'queued' | 'running'; readonly run: () => Promise<BookIndexStatus>;
  readonly resolve: (result: BookIndexStatus) => void; readonly reject: (error: unknown) => void;
  readonly signals: Set<CancellationSignal>;
  readonly observers: Set<NonNullable<BookIndexOptions['onProgress']>>;
  readonly detach: Set<() => void>;
};
const active = new Map<string, IndexJob>(), queue: IndexJob[] = [], autoAttempted = new Set<string>();
let draining = false, cleanup: Promise<void> | null = null;
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function report(options: BookIndexOptions, stage: BookImportProgress['stage'], completed: number, total: number): void { options.onProgress?.({ stage, completed, total }); }
function cancelled(): Error { const error = new Error('检索已取消'); error.name = 'AbortError'; return error; }

/** Validate every spine and discard each parsed chapter before publishing the book. */
export async function readBookContent(fileUri: string, format: 'epub' | 'pdf', options: BookIndexOptions = {}): Promise<BookContent> {
  assertNotAborted(options.signal);
  if (format === 'epub') {
    const archive = await openEpubArchive(fileUri, options.signal ? { signal: options.signal } : {});
    try {
      const publication = await inspectEpubResources(archive, options.signal);
      report(options, 'reading', 0, publication.chapters.length);
      for (let index = 0; index < publication.chapters.length; index += 1) {
        await validateEpubChapter(archive, publication.chapters[index]!, options.signal);
        report(options, 'reading', index + 1, publication.chapters.length);
      }
      assertNotAborted(options.signal);
      return { title: publication.title, author: publication.author, chapters: [], epub: { fileUri, publication } };
    } finally { await archive.close(); }
  }
  const { inspectPdf, readPdfPageText, releasePdf } = await import('../pdfNative');
  report(options, 'reading', 0, 0);
  try {
    const metadata = await inspectPdf(fileUri), chapters: RagChapter[] = [];
    for (let page = 1; page <= metadata.pageCount; page += 1) {
      assertNotAborted(options.signal);
      const text = (await readPdfPageText(fileUri, page)).trim();
      if (text) chapters.push({ ordinal: page, title: '第 ' + page + ' 页', page, text });
      report(options, 'reading', page, metadata.pageCount);
    }
    return { title: metadata.title, author: metadata.author, chapters, pdf: { pageCount: metadata.pageCount, textPageCount: metadata.textPageCount, blankPageCount: metadata.blankPageCount } };
  } finally { await releasePdf(fileUri); }
}
async function recordStatus(book: BookIdentity, status: string, detail: string, generation: string): Promise<void> {
  if (isBookFileOperationActive(book.id)) return;
  await recordBookIndexState((await getDataLayer()).driver, book, status, detail, generation);
}
async function assertCurrent(driver: SQLiteDriver, book: BookIdentity, generation: string, signal?: CancellationSignal): Promise<void> {
  assertNotAborted(signal);
  if (isBookFileOperationActive(book.id) || !await isBookIndexGenerationCurrent(driver, book, generation)) throw cancelled();
}
function preparedStatus(book: BookIdentity, count: number, semantic: boolean, failure: string | null): BookIndexStatus {
  if (count === 0) return { available: false, semantic: false, detail: book.format === 'pdf' ? '这本 PDF 没有可选中的文字，可以阅读、缩放和添加书签' : '这本书没有可选中的文字，可以阅读和添加书签' };
  return { available: true, semantic, detail: semantic ? '书内文字和语义查找已就绪' : failure ? '书内文字可用；语义查找准备失败，可重试：' + failure : '书内文字已就绪；下载语义资料后可按意思查找' };
}
async function buildIndex(book: BookIdentity, generation: string, contentFactory: () => Promise<BookContent>, options: BookIndexOptions): Promise<BookIndexStatus> {
  const { driver } = await getDataLayer();
  let archive: EpubResourceArchive | undefined;
  try {
    await assertCurrent(driver, book, generation, options.signal);
    await recordStatus(book, 'building', '正在准备书内文字', generation);
    const content = await contentFactory();
    await assertCurrent(driver, book, generation, options.signal);
    let embedding: EmbeddingProvider | null = null, modelFailure: string | null = null;
    try { if ((await embeddingStatus()).available) embedding = getEmbeddingProvider(); }
    catch (error) { assertNotAborted(options.signal); modelFailure = messageOf(error); }
    const chapterCount = content.epub?.publication.chapters.length ?? content.chapters.length;
    const build = await ChapterIndexBuild.open(driver, {
      book, generation, extractionVersion: 'epub-normalized-utf16-v1:paragraph-120-v1', chapterCount,
      model: embedding ? { id: embedding.modelId, dimension: embedding.dimension } : null,
      guard: tx => assertCurrent(tx, book, generation, options.signal), ...(options.signal ? { signal: options.signal } : {}),
    });
    if (modelFailure && !build.cursor.semanticFailure) await build.recordSemanticFailure(modelFailure);
    if (content.epub) archive = await openEpubArchive(content.epub.fileUri, options.signal ? { signal: options.signal } : {});
    const chunker = new ParagraphTextChunker();
    report(options, 'indexing', build.cursor.nextChapter, chapterCount);
    for (let chapterIndex = build.cursor.nextChapter; chapterIndex < chapterCount; chapterIndex += 1) {
      await assertCurrent(driver, book, generation, options.signal);
      const chapter = content.epub && archive ? await readEpubChapter(archive, content.epub.publication.chapters[chapterIndex]!, options.signal) : content.chapters[chapterIndex]!;
      const resumeAt = build.cursor.nextChunk;
      let chunkOffset = 0, batch: TextChunk[] = [];
      const persist = async (): Promise<void> => {
        if (!batch.length) return;
        let vectors: Float32Array[] = [];
        if (embedding && !build.cursor.semanticFailure) {
          try {
            vectors = await embedding.embed(batch.map(chunk => chunk.text), options.signal ? { signal: options.signal } : {});
            assertNotAborted(options.signal);
            if (vectors.length !== batch.length) throw new Error('语义资料返回的切块数量不一致');
            if (vectors.some(vector => vector.length !== embedding!.dimension || !vector.every(Number.isFinite))) throw new Error('语义资料返回的向量内容无效');
          } catch (error) {
            assertNotAborted(options.signal);
            await build.recordSemanticFailure(messageOf(error));
            vectors = [];
          }
        }
        await build.append(chapterIndex, chunkOffset - batch.length, batch, vectors);
        if (embedding) report(options, 'embedding', build.cursor.vectorCount, build.cursor.chunkCount);
        batch = [];
      };
      for (const chunk of chunker.iterate({ book, chapters: [chapter] }, {}, options.signal ? { signal: options.signal } : {})) {
        chunkOffset += 1;
        if (chunkOffset <= resumeAt) continue;
        batch.push(chunk);
        if (batch.length === 16) await persist();
      }
      if (chunkOffset < resumeAt) throw new Error('索引原文与恢复位置不一致，请重新准备');
      await persist();
      await build.finishChapter(chapterIndex, chunkOffset);
      report(options, 'indexing', chapterIndex + 1, chapterCount);
    }
    let result: BookIndexStatus | undefined;
    await build.promote(async (tx, summary) => {
      result = preparedStatus(book, summary.chunkCount, summary.semantic, summary.semanticFailure);
      await recordBookIndexState(tx, book, summary.chunkCount === 0 ? 'empty' : summary.semanticFailure ? 'fts' : 'ready', result.detail, generation);
    });
    return result!;
  } catch (error) {
    await recordStatus(book, options.signal?.aborted || (error instanceof Error && error.name === 'AbortError') ? 'paused' : 'failed', messageOf(error), generation);
    throw error;
  } finally { await archive?.close(); }
}
/** One running preparation bounds model/chapter memory across books. Waiting jobs cancel immediately. */
async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const job = queue.shift()!;
      job.state = 'running';
      try { if (job.cancel.aborted) throw cancelled(); job.resolve(await job.run()); }
      catch (error) { job.reject(error); }
      finally {
        for (const detach of job.detach) detach();
        job.detach.clear();
        if (active.get(job.book.id) === job) active.delete(job.book.id);
      }
    }
  } finally { draining = false; }
}
function enqueueIndex(book: BookIdentity, factory: (jobOptions: BookIndexOptions) => Promise<BookContent>, options: BookIndexOptions): Promise<BookIndexStatus> {
  const existing = active.get(book.id);
  if (existing) { subscribe(existing, options); return existing.promise; }
  // Register synchronously so an immediate removal can cancel even before the first DB await.
  const generation = getDataLayer().then(layer => getBookIndexGeneration(layer.driver, book.id));
  void generation.catch(() => undefined);
  const cancel = { aborted: false }, signals = new Set<CancellationSignal>(), observers = new Set<NonNullable<BookIndexOptions['onProgress']>>();
  const signal: CancellationSignal = { get aborted() { return cancel.aborted || [...signals].some(item => item.aborted); } };
  let resolve!: (result: BookIndexStatus) => void, reject!: (error: unknown) => void;
  const promise = new Promise<BookIndexStatus>((yes, no) => { resolve = yes; reject = no; });
  const jobOptions = { signal, onProgress: (progress: BookImportProgress) => { for (const observer of observers) observer(progress); } };
  const job: IndexJob = { book, promise, cancel, signals, observers, detach: new Set(), state: 'queued', run: async () => buildIndex(book, await generation, () => factory(jobOptions), jobOptions), resolve, reject };
  active.set(book.id, job); queue.push(job); subscribe(job, options); void drainQueue();
  return promise;
}
function subscribe(job: IndexJob, options: BookIndexOptions): void {
  if (options.onProgress) job.observers.add(options.onProgress);
  if (!options.signal || job.signals.has(options.signal)) return;
  const signal = options.signal as CancellationSignal & {
    addEventListener?: (type: 'abort', listener: () => void, options: { once: boolean }) => void;
    removeEventListener?: (type: 'abort', listener: () => void) => void;
  };
  job.signals.add(signal);
  const abort = () => { if (active.get(job.book.id) === job) void cancelBookIndexing(job.book.id); };
  if (signal.addEventListener) {
    signal.addEventListener('abort', abort, { once: true });
    job.detach.add(() => signal.removeEventListener?.('abort', abort));
  }
  if (signal.aborted) abort();
}
export async function indexImportedBook(book: BookIdentity, content: BookContent, options: BookIndexOptions = {}): Promise<BookIndexStatus> { return enqueueIndex(book, async () => content, options); }

/** Availability checks only the official namespace; staged batches cannot escape to consumers. */
export async function getLocalBookIndexStatus(bookId: string): Promise<BookIndexStatus & { state: string }> {
  const { driver } = await getDataLayer();
  const [book] = await driver.all<{ source_hash: string; removed_at: number | null }>('SELECT source_hash, removed_at FROM books WHERE id = ?', [bookId]);
  if (!book || book.removed_at !== null || isBookFileOperationActive(bookId)) return { state: 'missing', available: false, semantic: false, detail: '原书已移除或正在处理中，请完成后重试' };
  const stats = await new SqliteSearchIndex(driver, null).stats(bookId);
  const [saved] = await driver.all<{ status: string; detail: string; source_hash: string }>('SELECT status, detail, source_hash FROM book_index_state WHERE book_id = ?', [bookId]);
  const state = saved?.source_hash === book.source_hash ? saved : undefined, model = await embeddingStatus().catch(() => null);
  const semantic = state?.status !== 'fts' && model?.available === true && stats.models.some(item => item.model === model.modelId && item.dim === model.dimension && item.count === stats.chunkCount) && stats.chunkCount > 0;
  return { state: state?.status ?? 'missing', available: stats.chunkCount > 0, semantic, detail: state?.detail ?? (stats.chunkCount > 0 ? '书内文字已就绪' : '尚未准备书内文字') };
}
async function contentForExistingBook(book: BookIdentity, options: BookIndexOptions): Promise<BookContent> {
  const current = await (await getDataLayer()).store.getBook(book.id);
  if (!current || current.sourceHash !== book.sourceHash || current.removedAt !== null || isBookFileOperationActive(book.id)) throw cancelled();
  const file = findBookFile(current);
  if (!file) throw new Error('原书已移除，请重新导入后重试');
  if ((await file.digest('SHA-256')).toLowerCase() !== book.sourceHash.toLowerCase()) throw new Error('书籍文件校验不一致，请重新导入');
  if (book.format !== 'epub') return readBookContent(file.uri, book.format, options);
  const archive = await openEpubArchive(file.uri, options.signal ? { signal: options.signal } : {});
  try {
    const publication = await inspectEpubResources(archive, options.signal);
    return { title: publication.title, author: publication.author, chapters: [], epub: { fileUri: file.uri, publication } };
  } finally { await archive.close(); }
}
export async function rebuildBookIndex(bookId: string, options: BookIndexOptions = {}): Promise<BookIndexStatus> {
  const book = await (await getDataLayer()).store.getBook(bookId);
  if (!book) throw new Error('找不到这本书');
  if (isBookFileOperationActive(bookId)) throw new Error('这本书正在处理中，请完成后重试');
  return enqueueIndex(book, jobOptions => contentForExistingBook(book, jobOptions), options);
}
/** Import returns after validation/promotion. Background failures remain in book_index_state. */
export function startBookPreparation(book: BookIdentity, content?: BookContent): void {
  const work = content ? indexImportedBook(book, content) : rebuildBookIndex(book.id);
  void work.catch(error => { if (!(error instanceof Error && error.name === 'AbortError')) console.warn('书内文字准备失败', book.id, messageOf(error)); });
}
/** Startup resume, matching native prepareBooks. Failed attempts retry next launch or explicitly. */
export async function resumeAvailableBookIndexes(books: readonly (BookIdentity & { readonly removedAt: number | null })[], retryPaused = false): Promise<void> {
  const { driver } = await getDataLayer();
  if (!cleanup) {
    const operation = cleanupStaleBookIndexBuilds(driver, (tx, identity) => isBookIndexGenerationCurrent(tx, { id: identity.bookId, sourceHash: identity.sourceHash }, identity.generation));
    cleanup = operation;
    void operation.catch(() => { if (cleanup === operation) cleanup = null; });
  }
  await cleanup;
  for (const book of books) {
    if (book.removedAt !== null || isBookFileOperationActive(book.id) || active.has(book.id) || !findBookFile(book)) continue;
    const generation = await getBookIndexGeneration(driver, book.id), attempt = book.id + ':' + book.sourceHash + ':' + generation;
    if (!retryPaused && autoAttempted.has(attempt)) continue;
    const [state] = await driver.all<{ status: string; source_hash: string }>('SELECT status, source_hash FROM book_index_state WHERE book_id = ?', [book.id]);
    autoAttempted.add(attempt);
    if (state?.source_hash === book.sourceHash && ['ready', 'empty', 'fts'].includes(state.status)) continue;
    startBookPreparation(book);
  }
}
export async function createLocalBookSource(book: BookIdentity): Promise<SqliteBookSource> {
  const { driver } = await getDataLayer(), generation = await getBookIndexGeneration(driver, book.id), status = await getLocalBookIndexStatus(book.id);
  if (!status.available) throw new Error(status.detail);
  await assertCurrent(driver, book, generation);
  return new SqliteBookSource(new SqliteSearchIndex(driver, status.semantic ? getEmbeddingProvider() : null, {
    validateRead: tx => assertCurrent(tx, book, generation),
    onVectorError: error => recordStatus(book, 'fts', '书内文字可用；语义查找暂不可用，可重新准备：' + messageOf(error), generation),
  }), book);
}
/** Running native reads join close; waiting jobs do not delay removal behind another book. */
export async function cancelBookIndexing(bookId: string): Promise<void> {
  const pending = active.get(bookId);
  if (!pending) return;
  pending.cancel.aborted = true;
  if (pending.state === 'queued') {
    const position = queue.indexOf(pending);
    if (position >= 0) queue.splice(position, 1);
    if (active.get(bookId) === pending) active.delete(bookId);
    for (const detach of pending.detach) detach();
    pending.detach.clear();
    pending.reject(cancelled());
  }
  await pending.promise.catch(() => undefined);
}
export async function deleteBookIndex(bookId: string): Promise<void> {
  await cancelBookIndexing(bookId);
  const { driver } = await getDataLayer(), { removeBookIndexRecords } = await import('../library/bookFileOperations');
  await driver.transaction(tx => removeBookIndexRecords(tx, bookId));
}
