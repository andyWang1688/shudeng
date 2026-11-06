/** Validated import, repeat import/restoration, and the two distinct removal lifecycles. */
import type { DocumentPickerAsset } from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { assertNotAborted, type BookIdentity } from '@shudeng/core';
import {
  cancelBookIndexing,
  readBookContent,
  startBookPreparation,
  resumeAvailableBookIndexes,
  type BookContent,
  type BookIndexOptions,
  type BookImportProgress,
} from '../ai/bookIndex';
import { detectBookFormat, engineFormatOf, formatOf, formatProgressLabel } from './pure';
import { ensureProgressTable, loadAllBookProgress } from './progress';
import { cancelConversationRun, listConversationIdsForBook, markConversationsDeleted } from './conversations';
import { deleteBookRecords, lockBookFileOperation, recoverBookFileIntent, recoverBookFileOperations, removeBookIndexRecords, saveBookFileIntent, type BookFileIntent } from './bookFileOperations';
import { loadBookCover } from './bookCovers';
import type { ImportBookResult, ShelfBookRecord } from './types';
import { pdfImportConfirmation, type PdfImportInfo } from './pdfImport';

export type { BookImportProgress };

export interface ShelfLoadOptions {
  readonly includeRemoved?: boolean;
  readonly onlyRemoved?: boolean;
}

export interface ImportBookOptions extends BookIndexOptions {
  readonly confirmScannedPdf?: (info: PdfImportInfo) => Promise<boolean>;
}

export async function loadShelfBooks(options: ShelfLoadOptions = {}): Promise<readonly ShelfBookRecord[]> {
  const layer = await ensureProgressTable();
  await recoverBookFileOperations();
  const [rows, removedRows, progress] = await Promise.all([
    layer.store.listBooks(),
    layer.driver.all<{ id: string }>('SELECT id FROM books WHERE removed_at IS NOT NULL'),
    loadAllBookProgress(),
  ]);
  const removed = new Set(removedRows.map((row) => row.id));
  const visible = rows.filter((row) => options.onlyRemoved ? removed.has(row.id) : options.includeRemoved || !removed.has(row.id));
  const records: ShelfBookRecord[] = [];
  // First migration may need to inspect several publications. Avoid inflating all of them concurrently.
  for (const row of visible) {
    const format = formatOf(row.format);
    const item = progress.get(row.id) ?? null;
    const percent = item ? Math.floor(item.percent * 100) : null;
    const page = item?.page ?? null;
    const coverUri = await loadBookCover(row).catch(() => undefined);
    records.push({
      id: row.id,
      title: row.title,
      author: row.author ?? null,
      format,
      sourceHash: row.sourceHash,
      removed: removed.has(row.id),
      ...(coverUri ? { coverUri } : {}),
      progressPercent: percent,
      progressPage: page,
      progressLabel: formatProgressLabel(format, page, percent),
      progressChapter: item?.chapter ?? null,
      progressUpdatedAt: item?.updatedAt ?? null,
    });
  }
  void resumeAvailableBookIndexes(rows).catch(error => console.warn('书内文字恢复失败', error));
  return records;
}

const importing = new Map<string, Promise<ImportBookResult>>();

/** Picker-independent boundary: provider failures and import failures share the same cleanup. */
export async function importBookAsset(asset: DocumentPickerAsset, options: ImportBookOptions = {}): Promise<ImportBookResult> {
  const format = detectBookFormat(asset.name, asset.mimeType);
  if (!format) throw new Error('仅支持 EPUB 或 PDF 文件');
  if (!asset.name) throw new Error('无法读取文件名');
  const source = new File(asset.uri);
  if (!source.exists) throw new Error('无法读取所选文件');
  assertNotAborted(options.signal);
  // Hash failure must stop import; random IDs silently break deduplication and restoration.
  const digest = await source.digest('SHA-256');
  if (!/^[a-f0-9]{64}$/i.test(digest)) throw new Error('无法核对书籍文件，请重新选择后重试');
  const pending = importing.get(digest);
  if (pending) return pending;
  const operation = (async (): Promise<ImportBookResult> => {
    const layer = await ensureProgressTable();
    await recoverBookFileOperations();
    const existing = (await layer.store.listBooks()).find((book) => book.sourceHash.toLowerCase() === digest.toLowerCase());
    const id = existing?.id ?? digest.toLowerCase();
    const booksDirectory = new Directory(Paths.document, 'Books');
    if (!booksDirectory.exists) booksDirectory.create({ intermediates: true });
    const target = new File(booksDirectory, id + '.' + engineFormatOf(format));
    // A brief import lock must not leave a running preparation paused for this process.
    await cancelBookIndexing(id);
    const unlock = lockBookFileOperation(id);
    if (existing && target.exists && (await target.digest('SHA-256').catch(() => '')).toLowerCase() === digest.toLowerCase()) {
      try {
        await layer.store.restoreRemovedBook(id);
        const book = (await loadShelfBooks()).find((row) => row.id === id);
        if (!book) throw new Error('无法读取已导入的书籍');
        return { status: 'imported', book, isDuplicate: true };
      } finally {
        unlock();
        void resumeAvailableBookIndexes([{ ...existing, removedAt: null }], true).catch(error => console.warn('书内文字恢复失败', error));
      }
    }
    const staging = new File(booksDirectory, '.importing-' + id + '.' + engineFormatOf(format));
    let intent: BookFileIntent = { kind: 'import', targetUri: target.uri, stagingUri: staging.uri, phase: 'staging', existing: !!existing };
    let ready = false;
    let preparation: { readonly book: BookIdentity; readonly content: BookContent } | undefined;
    try {
      await saveBookFileIntent(id, intent);
      if (staging.exists) staging.delete();
      await source.copy(staging);
      if ((await staging.digest('SHA-256')).toLowerCase() !== digest.toLowerCase()) throw new Error('所选文件在读取时发生变化，请重新选择后重试');
      const content = await readBookContent(staging.uri, engineFormatOf(format), options);
      if (content.pdf && pdfImportConfirmation(content.pdf) && options.confirmScannedPdf && !(await options.confirmScannedPdf(content.pdf))) {
        await recoverBookFileIntent(id, intent);
        return { status: 'cancelled' };
      }
      assertNotAborted(options.signal);
      const filenameTitle = asset.name.replace(/\.(epub|pdf)$/i, '').trim() || '未命名书籍';
      // Match the native import contract: PDF names come from the selected document; EPUB uses publication metadata.
      const title = existing?.title ?? (format === 'PDF' ? filenameTitle : content.title ?? filenameTitle);
      const author = existing?.author ?? (format === 'PDF' ? null : content.author);
      const book = { id, title, author, format: engineFormatOf(format), sourceHash: digest.toLowerCase() };
      assertNotAborted(options.signal);
      intent = { ...intent, phase: 'ready', book, indexState: { status: 'building', detail: '已导入，可以阅读；正在准备书内文字' } };
      await saveBookFileIntent(id, intent);
      ready = true;
      await recoverBookFileIntent(id, intent);
      preparation = { book, content: content.epub ? { ...content, epub: { ...content.epub, fileUri: target.uri } } : content };
      const record = (await loadShelfBooks()).find((row) => row.id === id);
      if (!record) throw new Error('无法读取导入结果');
      return { status: 'imported', book: record, isDuplicate: existing !== undefined };
    } catch (error) {
      // A validated publication is recoverable, even if promotion/save fails. Keep its durable intent.
      if (!ready) await recoverBookFileIntent(id, intent).catch(() => undefined);
      throw error;
    } finally {
      unlock();
      if (preparation) startBookPreparation(preparation.book, preparation.content);
    }
  })().finally(() => { importing.delete(digest); });
  importing.set(digest, operation);
  return operation;
}

export async function importBookFromPicker(options: ImportBookOptions = {}): Promise<ImportBookResult> {
  const DocumentPicker = await import('expo-document-picker');
  const picked = await DocumentPicker.getDocumentAsync({
    type: ['application/epub+zip', 'application/pdf'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (picked.canceled || !picked.assets[0]) return { status: 'cancelled' };
  const asset = picked.assets[0];
  try { return await importBookAsset(asset, options); }
  finally {
    // Only the picker's cache copy is disposable; an original provider document is never removed.
    if (asset.uri.startsWith(Paths.cache.uri.replace(/\/$/, '') + '/')) {
      try { const cached = new File(asset.uri); if (cached.exists) cached.delete(); } catch { /* Cache cleanup is safe to retry by the OS. */ }
    }
  }
}

/** Remove only the publication; keep positions, annotations, questions and citation snapshots. */
export async function removeShelfBook(bookId: string): Promise<void> {
  const layer = await ensureProgressTable();
  await recoverBookFileOperations();
  const book = await layer.store.getBook(bookId);
  if (!book) throw new Error('书籍不存在或已删除');
  const file = new File(Paths.document, 'Books', book.id + '.' + book.format);
  const staging = new File(Paths.document, 'Books', '.removing-' + book.id + '.' + book.format);
  const intent: BookFileIntent = { kind: 'remove', targetUri: file.uri, stagingUri: staging.uri };
  const unlock = lockBookFileOperation(bookId);
  try {
    const conversations = await listConversationIdsForBook(bookId);
    for (const conversationId of conversations) cancelConversationRun(conversationId);
    await cancelBookIndexing(bookId);
    await saveBookFileIntent(bookId, intent);
    if (file.exists) await file.move(staging);
    await layer.driver.transaction(async tx => {
      await removeBookIndexRecords(tx, bookId);
      await tx.run('UPDATE books SET removed_at = ?, updated_at = ? WHERE id = ?', [Date.now(), Date.now(), bookId]);
    });
    await recoverBookFileIntent(bookId, intent);
  } catch (error) {
    await recoverBookFileIntent(bookId, intent).catch(() => undefined);
    throw error;
  } finally {
    unlock();
  }
}

/** Permanent removal is a separate destructive UI action. */
export async function deleteShelfBook(bookId: string): Promise<void> {
  const layer = await ensureProgressTable();
  const pending = await layer.driver.all<{ id: string }>('SELECT id FROM book_file_operations WHERE id = ? AND kind = ?', [bookId, 'delete']);
  await recoverBookFileOperations();
  const book = await layer.store.getBook(bookId);
  if (!book && pending.length > 0) return;
  if (!book) throw new Error('书籍不存在或已删除');
  const file = new File(Paths.document, 'Books', book.id + '.' + book.format);
  const staging = new File(Paths.document, 'Books', '.deleting-' + book.id + '.' + book.format);
  const intent: BookFileIntent = { kind: 'delete', targetUri: file.uri, stagingUri: staging.uri };
  const unlock = lockBookFileOperation(bookId);
  let committed = false;
  let rollbackDeleted = (): void => {};
  try {
    await cancelBookIndexing(bookId);
    const ids = await listConversationIdsForBook(bookId);
    rollbackDeleted = markConversationsDeleted(ids);
    await saveBookFileIntent(bookId, intent);
    if (file.exists) await file.move(staging);
    await layer.driver.transaction(async (tx) => {
      await deleteBookRecords(tx, bookId, ids);
    });
    committed = true;
    await recoverBookFileIntent(bookId, intent);
  } catch (error) {
    if (!committed) rollbackDeleted();
    await recoverBookFileIntent(bookId, intent).catch(() => undefined);
    throw error;
  } finally {
    unlock();
  }
}
