/** ReaderShell 的纯映射：react-native-reader 协议 locator ⇄ 数据层 StoredReaderLocator、标注 seed 构造。 */
import type { ReaderAnnotationSeed, ReaderLocator } from './readerProtocol';
import type { BookFormat, ShelfAnnotation, StoredReaderLocator } from '../platform/library/types';

export function storedLocatorFromReaderLocator(locator: ReaderLocator | undefined): StoredReaderLocator | null {
  if (!locator) return null;
  if (locator.type === 'pdf') {
    return {
      type: 'pdf',
      page: locator.page,
      ...(locator.rects
        ? {
            rects: locator.rects.map((rect) => ({
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            })),
          }
        : {}),
    };
  }
  return {
    type: 'epub',
    cfi: locator.cfi,
    ...(locator.href ? { href: locator.href } : {}),
    ...(locator.chapter ? { chapter: locator.chapter } : {}),
  };
}

export function readerLocatorFromStoredLocator(stored: StoredReaderLocator): ReaderLocator | null {
  if (stored.type === 'pdf') {
    return {
      type: 'pdf',
      page: stored.page,
      ...(stored.rects ? { rects: stored.rects } : {}),
    };
  }
  return {
    type: 'epub',
    cfi: stored.cfi,
    ...(stored.href ? { href: stored.href } : {}),
    ...(stored.chapter ? { chapter: stored.chapter } : {}),
  };
}

export function annotationSeedFromShelfAnnotation(
  annotation: ShelfAnnotation,
  format: BookFormat,
): ReaderAnnotationSeed | null {
  if (!annotation.locator || annotation.kind === 'bookmark') return null;
  const locator = readerLocatorFromStoredLocator(annotation.locator);
  if (!locator) return null;
  return {
    id: annotation.id,
    format: format === 'PDF' ? 'pdf' : 'epub',
    locator,
    ...(annotation.quote ? { text: annotation.quote } : {}),
    ...(annotation.body ? { note: annotation.body } : {}),
    ...(annotation.color ? { color: annotation.color } : {}),
    ...(annotation.page !== null ? { page: annotation.page } : {}),
  };
}
