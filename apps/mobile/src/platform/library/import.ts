/** 书架读取与导入/删除：系统文档选择器、SHA-256 去重、进度合成书架行。 */
import type { DocumentPickerAsset } from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { createLocalId } from '@shudeng/core';
import { detectBookFormat, engineFormatOf, formatOf, formatProgressLabel } from './pure';
import { ensureProgressTable, loadAllBookProgress } from './progress';
import type { BookFormat, ImportBookResult, ShelfBookRecord } from './types';

export async function loadShelfBooks(): Promise<readonly ShelfBookRecord[]> {
  const layer = await ensureProgressTable();
  const rows = await layer.store.listBooks();
  const progress = await loadAllBookProgress();
  return rows.map((row) => {
    const format = formatOf(row.format);
    const item = progress.get(row.id) ?? null;
    const percent = item ? Math.floor(item.percent * 100) : null;
    const page = item?.page ?? null;
    return {
      id: row.id,
      title: row.title,
      author: row.author ?? null,
      format,
      sourceHash: row.sourceHash,
      progressPercent: percent,
      progressPage: page,
      progressLabel: formatProgressLabel(format, page, percent),
      progressChapter: item?.chapter ?? null,
      progressUpdatedAt: item?.updatedAt ?? null,
    };
  });
}

function detectFormat(asset: DocumentPickerAsset): BookFormat | null {
  return detectBookFormat(asset.name, asset.mimeType);
}

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
  const target = new File(booksDirectory, `${id}.${engineFormatOf(format)}`);
  if (target.exists) target.delete();
  await source.copy(target);
  const title = asset.name.replace(/\.(epub|pdf)$/i, '').trim() || '未命名书籍';
  try {
    await layer.store.saveBook({ id, title, author: null, format: engineFormatOf(format), sourceHash: digest });
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
      progressChapter: null,
      progressUpdatedAt: null,
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
