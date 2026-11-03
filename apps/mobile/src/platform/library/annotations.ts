/**
 * 标注读写：anchors（定位）+ annotations（高亮/笔记/书签）。兼容新 ReaderLocator JSON、
 * 旧 AnchorV3（schema=shudeng.anchor.v3）与 legacy.raw Readium locator 三种存量形状。
 */
import type { AnchorRow } from '@shudeng/core/db';
import { getDataLayer } from '../db';
import { loadShelfBooks } from './import';
import type { ShelfBookRecord } from './types';
import {
  anchorJsonForSelection,
  formatOf,
  isRecord,
  legacyPdfRects,
  readerLocatorFromLegacy,
  storedLocatorFromUnknown,
} from './pure';
import type {
  BookFormat,
  SaveReaderAnnotationInput,
  ShelfAnnotation,
  StoredReaderLocator,
} from './types';

function anchorToStoredLocator(anchor: AnchorRow, format: BookFormat): StoredReaderLocator | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(anchor.locatorJson);
  } catch {
    return null;
  }
  if (isRecord(parsed)) {
    // 新写入的 ReaderLocator（saveReaderAnnotation 也是这种结构）。
    const newLocator = storedLocatorFromUnknown(parsed);
    if (newLocator) return newLocator;
    // 旧迁移 AnchorV3。
    if (parsed.schema === 'shudeng.anchor.v3' && isRecord(parsed.locator)) {
      const locator = parsed.locator;
      if (typeof parsed.kind === 'string' && parsed.kind === 'pdf' && typeof locator.page === 'number') {
        const rects = legacyPdfRects(locator.rects);
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

export async function loadAllAnnotations(): Promise<ReadonlyArray<{ book: ShelfBookRecord; annotation: ShelfAnnotation }>> {
  const books = await loadShelfBooks();
  const result: Array<{ book: ShelfBookRecord; annotation: ShelfAnnotation }> = [];
  for (const book of books) {
    const annotations = await loadBookAnnotations(book.id);
    for (const annotation of annotations) result.push({ book, annotation });
  }
  return result.sort((a, b) => b.annotation.createdAt - a.annotation.createdAt);
}
