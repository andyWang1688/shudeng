/** 迁移后的书文件：App Documents/Books/<id>.<format>。旧 Swift 文件需在迁移流程中复制到这里。 */
import { File, Paths } from 'expo-file-system';
import type { BookRow } from '@shudeng/core/db';

export function findBookFile(book: Pick<BookRow, 'id' | 'format'>): File | null {
  const file = new File(Paths.document, 'Books', `${book.id}.${book.format}`);
  return file.exists ? file : null;
}

export async function readBookBase64(book: Pick<BookRow, 'id' | 'format'>): Promise<string | null> {
  const file = findBookFile(book);
  if (!file) return null;
  return file.base64();
}
