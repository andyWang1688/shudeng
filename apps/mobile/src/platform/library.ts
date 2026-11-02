/**
 * iOS 终版书库数据层：旧 Swift 数据幂等迁移、真实书架、导入/删除、阅读进度与标注。
 * 旧数据只读；进度表由本机平台层创建（不改共享 schema），标注继续使用 anchors/annotations。
 */
import type { DocumentPickerAsset } from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { createLocalId, migrateSwiftLibrary } from '@shudeng/core';
import type { AnchorRow, AnnotationRow } from '@shudeng/core/db';
import { getDataLayer, type ShudengDataLayer } from './db';
import type { SQLiteValue } from '@shudeng/core/db';

export type BookFormat = 'EPUB' | 'PDF';

export type ShelfBookRecord = {
  readonly id: string;
  readonly title: string;
  readonly author: string | null;
  readonly format: BookFormat;
  readonly sourceHash: string;
  readonly progressPercent: number | null;
  readonly progressPage: number | null;
  readonly progressLabel: string;
};

export type StoredReaderLocator =
  | { readonly type: 'epub'; readonly cfi: string; readonly href?: string; readonly chapter?: string }
  | {
      readonly type: 'pdf';
      readonly page: number;
      readonly rects?: ReadonlyArray<{ readonly x: number; readonly y: number; readonly width: number; readonly height: number }>;
      readonly text?: string;
    };

export type BookProgress = {
  readonly bookId: string;
  readonly percent: number;
  readonly locator: StoredReaderLocator;
  readonly page: number | null;
  readonly chapter: string | null;
  readonly updatedAt: number;
};

export type ShelfAnnotationKind = 'highlight' | 'note' | 'bookmark';

export type ShelfAnnotation = {
  readonly id: string;
  readonly anchorId: string;
  readonly kind: ShelfAnnotationKind;
  readonly color: string | null;
  readonly body: string | null;
  readonly quote: string;
  readonly chapter: string | null;
  readonly page: number | null;
  readonly createdAt: number;
  readonly locator: StoredReaderLocator | null;
};

export type SaveReaderAnnotationInput = {
  readonly kind: ShelfAnnotationKind;
  readonly color?: string | null;
  readonly body?: string | null;
  readonly quote?: string;
  readonly format: BookFormat;
  readonly locator: StoredReaderLocator;
  readonly chapter?: string | null;
  readonly page?: number | null;
};

const LEGACY_DIR = 'legacy';
const IMPORT_MARKER = '.imported';

/** 把旧 App 导出的 Books 文件复制到正式书架目录；已存在的不覆盖。 */
async function importLegacyBookFiles(): Promise<number> {
  const source = new Directory(Paths.document, LEGACY_DIR, 'Books');
  if (!source.exists) return 0;
  const destination = new Directory(Paths.document, 'Books');
  if (!destination.exists) destination.create({ intermediates: true });
  let copied = 0;
  for (const entry of source.list()) {
    if (!(entry instanceof File)) continue;
    const target = new File(destination, entry.name);
    if (target.exists) continue;
    await entry.copy(target);
    copied += 1;
  }
  return copied;
}

function readOptional(name: string): string | null {
  const file = new File(Paths.document, LEGACY_DIR, name);
  if (!file.exists) return null;
  return file.textSync();
}

function parseOptional<T>(name: string): T | undefined {
  const text = readOptional(name);
  if (!text) return undefined;
  return JSON.parse(text) as T;
}

export class LibraryMigrationError extends Error {
  readonly failures: number;
  constructor(message: string, failures: number) {
    super(message);
    this.name = 'LibraryMigrationError';
    this.failures = failures;
  }
}

export async function migrateLegacyLibraryIfNeeded(): Promise<{ imported: boolean; books: number; failures: number }> {
  const layer = await getDataLayer();
  const copiedFiles = await importLegacyBookFiles();
  const marker = new File(Paths.document, LEGACY_DIR, IMPORT_MARKER);
  if (marker.exists) {
    const existing = await layer.store.listBooks();
    return { imported: copiedFiles > 0, books: existing.length, failures: 0 };
  }

  const library = parseOptional<unknown>('library.json');
  if (library === undefined) return { imported: false, books: 0, failures: 0 };
  const questions = parseOptional<unknown>('reading-questions.json') ?? [];
  const recordTimestamps = parseOptional<Record<string, string>>('record-timestamps.json') ?? {};
  const notesBookGroups = parseOptional<unknown>('notes-book-groups.json');
  const result = migrateSwiftLibrary({
    library,
    questions,
    recordTimestamps,
    ...(notesBookGroups !== undefined ? { notesBookGroups } : {}),
  });

  const db = layer.db;
  const schema = await import('@shudeng/core/db');
  if (result.tables.books.length > 0) {
    await db.insert(schema.books).values(result.tables.books as never[]).onConflictDoNothing();
  }
  if (result.tables.anchors.length > 0) {
    await db.insert(schema.anchors).values(result.tables.anchors as never[]).onConflictDoNothing();
  }
  if (result.tables.annotations.length > 0) {
    await db.insert(schema.annotations).values(result.tables.annotations as never[]).onConflictDoNothing();
  }
  if (result.tables.messages.length > 0) {
    await db.insert(schema.messages).values(result.tables.messages as never[]).onConflictDoNothing();
  }
  if (result.tables.citations.length > 0) {
    await db.insert(schema.citations).values(result.tables.citations as never[]).onConflictDoNothing();
  }
  await importLegacyBookFiles();
  marker.write(JSON.stringify({ importedAt: Date.now(), books: result.tables.books.length, failures: result.failures.length }));
  if (!result.ok) {
    throw new LibraryMigrationError(
      `旧书库导入有 ${result.failures.length} 条失败记录，已保留可迁移数据`,
      result.failures.length,
    );
  }
  return { imported: true, books: result.tables.books.length, failures: 0 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatOf(value: unknown): BookFormat {
  return value === 'pdf' ? 'PDF' : 'EPUB';
}

/** 旧 Readium locator → reader-web / PDF 页可用的 ReaderLocator。 */
function readerLocatorFromLegacy(raw: unknown, format: BookFormat): StoredReaderLocator | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const href = typeof parsed.href === 'string' ? parsed.href : undefined;
  const locations = isRecord(parsed.locations) ? parsed.locations : undefined;
  const title = typeof parsed.title === 'string' ? parsed.title : undefined;
  if (format === 'PDF') {
    const fromHref = href ? /^pdf:\/\/page\/(\d+)(?:$|[/?#])/i.exec(href)?.[1] : undefined;
    const fromFragment = Array.isArray(locations?.fragments)
      ? locations.fragments.find((item): item is string => typeof item === 'string' && /^page=\d+$/i.test(item))?.slice(5)
      : undefined;
    const pageValue = locations?.page;
    const page = typeof pageValue === 'number' && Number.isInteger(pageValue) && pageValue >= 1
      ? pageValue
      : Number(fromHref ?? fromFragment);
    return Number.isInteger(page) && page >= 1 ? { type: 'pdf', page } : null;
  }
  const cfi = locations && typeof locations.cfi === 'string' ? locations.cfi : undefined;
  if (cfi) return { type: 'epub', cfi, ...(href ? { href } : {}), ...(title ? { chapter: title } : {}) };
  if (href) return { type: 'epub', cfi: href, href, ...(title ? { chapter: title } : {}) };
  return null;
}

function legacyProgression(raw: unknown): number {
  if (typeof raw !== 'string') return 0;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.locations)) return 0;
    const value = parsed.locations.totalProgression ?? parsed.locations.progression;
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
  } catch {
    return 0;
  }
}

// ---------- 阅读进度（平台内建表；不改共享 schema） ----------

const PROGRESS_TABLE = `CREATE TABLE IF NOT EXISTS reading_progress (
  book_id TEXT PRIMARY KEY NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  locator_json TEXT NOT NULL,
  percent REAL NOT NULL,
  page INTEGER,
  chapter TEXT,
  updated_at INTEGER NOT NULL
)`;
let progressTablePromise: Promise<ShudengDataLayer> | null = null;
let backfilled = false;

async function ensureProgressTable(): Promise<ShudengDataLayer> {
  if (!progressTablePromise) {
    progressTablePromise = (async () => {
      const layer = await getDataLayer();
      await layer.driver.exec(PROGRESS_TABLE);
      return layer;
    })().catch((error: unknown) => {
      progressTablePromise = null;
      throw error;
    });
  }
  return progressTablePromise;
}

function parseStoredLocator(raw: string | null): StoredReaderLocator | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (parsed.type === 'pdf' && typeof parsed.page === 'number') {
      const rects = Array.isArray(parsed.rects)
        ? parsed.rects.filter(isRecord).map((rect) => ({
            x: Number(rect.x) || 0,
            y: Number(rect.y) || 0,
            width: Number(rect.width) || 0,
            height: Number(rect.height) || 0,
          }))
        : undefined;
      return { type: 'pdf', page: parsed.page, ...(rects ? { rects } : {}) };
    }
    if (parsed.type === 'epub' && typeof parsed.cfi === 'string') {
      return {
        type: 'epub',
        cfi: parsed.cfi,
        ...(typeof parsed.href === 'string' ? { href: parsed.href } : {}),
        ...(typeof parsed.chapter === 'string' ? { chapter: parsed.chapter } : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function rowToProgress(row: Record<string, SQLiteValue>): BookProgress | null {
  const locator = parseStoredLocator(typeof row.locator_json === 'string' ? row.locator_json : null);
  if (!locator || typeof row.book_id !== 'string') return null;
  return {
    bookId: row.book_id,
    percent: typeof row.percent === 'number' ? Math.min(1, Math.max(0, row.percent)) : 0,
    locator,
    page: typeof row.page === 'number' ? row.page : locator.type === 'pdf' ? locator.page : null,
    chapter: typeof row.chapter === 'string' ? row.chapter : null,
    updatedAt: typeof row.updated_at === 'number' ? row.updated_at : 0,
  };
}

/** 首次读到旧书时，把 library.json 的 locatorJSON 变成进度（幂等；迁移标记已存在也能补）。 */
async function backfillLegacyProgress(layer: ShudengDataLayer): Promise<void> {
  if (backfilled) return;
  backfilled = true;
  const library = parseOptional<unknown>('library.json');
  if (!Array.isArray(library)) return;
  for (const entry of library) {
    if (!isRecord(entry)) continue;
    const bookId = typeof entry.id === 'string' ? entry.id : null;
    if (!bookId) continue;
    const existing = await layer.driver.all<{ book_id: string }>('SELECT book_id FROM reading_progress WHERE book_id = ? LIMIT 1', [bookId]);
    if (existing.length > 0) continue;
    const format = formatOf(entry.format);
    const locator = readerLocatorFromLegacy(entry.locatorJSON, format);
    if (!locator) continue;
    const percent = legacyProgression(entry.locatorJSON);
    await layer.driver.run(
      'INSERT OR IGNORE INTO reading_progress (book_id, locator_json, percent, page, chapter, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [bookId, JSON.stringify(locator), percent, locator.type === 'pdf' ? locator.page : null, null, Date.now()],
    );
  }
}

export async function loadBookProgress(bookId: string): Promise<BookProgress | null> {
  const layer = await ensureProgressTable();
  await backfillLegacyProgress(layer);
  const rows = await layer.driver.all<Record<string, SQLiteValue>>(
    'SELECT book_id, locator_json, percent, page, chapter, updated_at FROM reading_progress WHERE book_id = ? LIMIT 1',
    [bookId],
  );
  return rows[0] ? rowToProgress(rows[0]) : null;
}

export async function loadAllBookProgress(): Promise<ReadonlyMap<string, BookProgress>> {
  const layer = await ensureProgressTable();
  await backfillLegacyProgress(layer);
  const rows = await layer.driver.all<Record<string, SQLiteValue>>(
    'SELECT book_id, locator_json, percent, page, chapter, updated_at FROM reading_progress',
  );
  const result = new Map<string, BookProgress>();
  for (const row of rows) {
    const progress = rowToProgress(row);
    if (progress) result.set(progress.bookId, progress);
  }
  return result;
}

export async function saveBookProgress(bookId: string, progress: {
  readonly locator: StoredReaderLocator;
  readonly percent: number;
  readonly chapter?: string | null;
}): Promise<void> {
  const layer = await ensureProgressTable();
  await layer.driver.run(
    `INSERT INTO reading_progress (book_id, locator_json, percent, page, chapter, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(book_id) DO UPDATE SET locator_json = excluded.locator_json,
       percent = excluded.percent, page = excluded.page, chapter = excluded.chapter, updated_at = excluded.updated_at`,
    [
      bookId,
      JSON.stringify(progress.locator),
      Math.min(1, Math.max(0, progress.percent)),
      progress.locator.type === 'pdf' ? progress.locator.page : null,
      progress.chapter ?? null,
      Date.now(),
    ],
  );
}

// ---------- 标注（anchors + annotations） ----------

function anchorToStoredLocator(anchor: AnchorRow, format: BookFormat): StoredReaderLocator | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(anchor.locatorJson);
  } catch {
    return null;
  }
  if (isRecord(parsed)) {
    // 新写入的 ReaderLocator（saveReaderAnnotation 也是这种结构）。
    if (parsed.type === 'pdf' && typeof parsed.page === 'number') {
      const rects = Array.isArray(parsed.rects)
        ? parsed.rects.filter(isRecord).map((rect) => ({
            x: Number(rect.x) || 0,
            y: Number(rect.y) || 0,
            width: Number(rect.width) || 0,
            height: Number(rect.height) || 0,
          }))
        : undefined;
      return { type: 'pdf', page: parsed.page, ...(rects ? { rects } : {}) };
    }
    if (parsed.type === 'epub' && typeof parsed.cfi === 'string') {
      return {
        type: 'epub',
        cfi: parsed.cfi,
        ...(typeof parsed.href === 'string' ? { href: parsed.href } : {}),
        ...(typeof parsed.chapter === 'string' ? { chapter: parsed.chapter } : {}),
      };
    }
    // 旧迁移 AnchorV3。
    if (parsed.schema === 'shudeng.anchor.v3' && isRecord(parsed.locator)) {
      const locator = parsed.locator;
      if (typeof parsed.kind === 'string' && parsed.kind === 'pdf' && typeof locator.page === 'number') {
        const rects = Array.isArray(locator.rects)
          ? locator.rects.filter(isRecord).map((rect) => ({
              x: Number(rect.x) || 0,
              y: Number(rect.y) || 0,
              width: Number(rect.w) || 0,
              height: Number(rect.h) || 0,
            }))
          : undefined;
        return { type: 'pdf', page: locator.page, ...(rects ? { rects } : {}) };
      }
      const readium = isRecord(parsed.readium) ? parsed.readium : undefined;
      const readiumLocations = readium && isRecord(readium.locations) ? readium.locations : undefined;
      const cfi = typeof locator.cfi === 'string'
        ? locator.cfi
        : typeof readiumLocations?.cfi === 'string'
          ? readiumLocations.cfi
          : undefined;
      const href = typeof locator.href === 'string' ? locator.href : typeof readium?.href === 'string' ? readium.href : undefined;
      if (typeof parsed.kind === 'string' && parsed.kind !== 'pdf' && (cfi || href)) {
        return {
          type: 'epub',
          cfi: cfi ?? href ?? '',
          ...(href ? { href } : {}),
          ...(anchor.chapter ? { chapter: anchor.chapter } : {}),
        };
      }
    }
    if (isRecord(parsed.legacy) && typeof parsed.legacy.raw === 'string') {
      return readerLocatorFromLegacy(parsed.legacy.raw, format);
    }
  }
  return readerLocatorFromLegacy(anchor.locatorJson, format);
}

export async function loadBookAnnotations(bookId: string): Promise<readonly ShelfAnnotation[]> {
  const layer = await getDataLayer();
  const book = await layer.store.getBook(bookId);
  if (!book) return [];
  const [annotations, anchors] = await Promise.all([
    layer.store.listAnnotations(bookId),
    layer.store.listAnchors(bookId),
  ]);
  const anchorsById = new Map(anchors.map((anchor) => [anchor.id, anchor]));
  return annotations.map((annotation) => {
    const anchor = anchorsById.get(annotation.anchorId);
    return {
      id: annotation.id,
      anchorId: annotation.anchorId,
      kind: annotation.kind,
      color: annotation.color,
      body: annotation.body,
      quote: anchor?.quote ?? '',
      chapter: anchor?.chapter ?? null,
      page: anchor?.page ?? null,
      createdAt: annotation.createdAt,
      locator: anchor ? anchorToStoredLocator(anchor, formatOf(book.format)) : null,
    };
  });
}

function anchorJsonForSelection(input: SaveReaderAnnotationInput): string {
  const base = { schema: 'shudeng.anchor.v3', version: 3 } as const;
  if (input.locator.type === 'pdf') {
    return JSON.stringify({
      ...base,
      kind: 'pdf',
      locator: {
        page: input.locator.page,
        rects: (input.locator.rects ?? []).map((rect) => ({ x: rect.x, y: rect.y, w: rect.width, h: rect.height })),
      },
    });
  }
  if (input.locator.cfi) {
    return JSON.stringify({
      ...base,
      kind: 'cfi',
      locator: { cfi: input.locator.cfi, ...(input.locator.href ? { href: input.locator.href } : {}) },
    });
  }
  return JSON.stringify({
    ...base,
    kind: 'readium',
    locator: { href: input.locator.href ?? '' },
    readium: { href: input.locator.href ?? '' },
  });
}

export async function saveReaderAnnotation(
  bookId: string,
  input: SaveReaderAnnotationInput,
): Promise<{ readonly anchorId: string; readonly annotationId: string }> {
  const layer = await getDataLayer();
  const anchor = await layer.store.saveAnchor({
    bookId,
    engine: input.format === 'PDF' ? 'pdf' : 'cfi',
    locatorJson: anchorJsonForSelection(input),
    quote: input.quote ?? '',
    chapter: input.chapter ?? null,
    page: input.page ?? (input.locator.type === 'pdf' ? input.locator.page : null),
  });
  const annotation = await layer.store.saveAnnotation({
    bookId,
    anchorId: anchor.id,
    kind: input.kind,
    color: input.color ?? null,
    body: input.body ?? null,
  });
  return { anchorId: anchor.id, annotationId: annotation.id };
}

export async function deleteReaderAnnotation(annotationId: string): Promise<void> {
  const layer = await getDataLayer();
  await layer.store.deleteAnnotation(annotationId);
}

// ---------- 书架读取 / 导入 / 删除 ----------

export async function loadShelfBooks(): Promise<readonly ShelfBookRecord[]> {
  const layer = await ensureProgressTable();
  await backfillLegacyProgress(layer);
  const rows = await layer.store.listBooks();
  const progress = await loadAllBookProgress();
  return rows.map((row) => {
    const format = formatOf(row.format);
    const item = progress.get(row.id) ?? null;
    const percent = item ? Math.round(item.percent * 100) : null;
    const page = item?.page ?? null;
    const progressLabel = format === 'PDF'
      ? page !== null ? `第 ${page} 页` : percent !== null ? `已读 ${percent}%` : '未开始'
      : percent !== null ? `已读 ${percent}%` : '未开始';
    return {
      id: row.id,
      title: row.title,
      author: row.author ?? null,
      format,
      sourceHash: row.sourceHash,
      progressPercent: percent,
      progressPage: page,
      progressLabel,
    };
  });
}

function detectFormat(asset: DocumentPickerAsset): BookFormat | null {
  const name = (asset.name ?? '').toLowerCase();
  const mime = (asset.mimeType ?? '').toLowerCase();
  if (name.endsWith('.epub') || mime.includes('epub')) return 'EPUB';
  if (name.endsWith('.pdf') || mime.includes('pdf')) return 'PDF';
  return null;
}

export type ImportBookResult =
  | { readonly status: 'cancelled' }
  | { readonly status: 'imported'; readonly book: ShelfBookRecord };

/** 系统文档选择器导入 EPUB/PDF：复制到 Documents/Books、SHA-256 去重、写 books。 */
export async function importBookFromPicker(): Promise<ImportBookResult> {
  // 动态 import：旧 dev build 尚未包含该原生模块时，书架仍可正常打开，只有点导入才报错。
  const DocumentPicker = await import('expo-document-picker');
  const picked = await DocumentPicker.getDocumentAsync({
    type: ['application/epub+zip', 'application/pdf'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (picked.canceled) return { status: 'cancelled' };
  const asset = picked.assets[0];
  if (!asset) return { status: 'cancelled' };
  const format = detectFormat(asset);
  if (!format) throw new Error('仅支持 EPUB 或 PDF 文件');
  if (!asset.name) throw new Error('无法读取文件名');
  const source = new File(asset.uri);
  if (!source.exists) throw new Error('无法读取所选文件');
  const layer = await ensureProgressTable();
  let digest = '';
  try {
    digest = await source.digest('SHA-256');
  } catch {
    digest = createLocalId('book');
  }
  const id = digest;
  const existing = await layer.store.getBook(id);
  if (existing) throw new Error('这本书已在书架中');
  const booksDirectory = new Directory(Paths.document, 'Books');
  if (!booksDirectory.exists) booksDirectory.create({ intermediates: true });
  const target = new File(booksDirectory, `${id}.${format === 'PDF' ? 'pdf' : 'epub'}`);
  if (target.exists) target.delete();
  await source.copy(target);
  const title = asset.name.replace(/\.(epub|pdf)$/i, '').trim() || '未命名书籍';
  try {
    await layer.store.saveBook({ id, title, author: null, format: format === 'PDF' ? 'pdf' : 'epub', sourceHash: digest });
  } catch (error) {
    if (target.exists) target.delete();
    throw error;
  }
  return {
    status: 'imported',
    book: {
      id,
      title,
      author: null,
      format,
      sourceHash: digest,
      progressPercent: null,
      progressPage: null,
      progressLabel: '未开始',
    },
  };
}

export async function deleteShelfBook(bookId: string): Promise<void> {
  const layer = await ensureProgressTable();
  const book = await layer.store.getBook(bookId);
  if (!book) throw new Error('书籍不存在或已删除');
  await layer.store.deleteBook(bookId);
  await layer.driver.run('DELETE FROM reading_progress WHERE book_id = ?', [bookId]);
  const file = new File(Paths.document, 'Books', `${book.id}.${book.format}`);
  if (file.exists) file.delete();
}
