import { decodeEpubAnchor, epubDestination } from '@shudeng/core/domain';
import { saveEpubAnnotation } from './epubAnnotations';
/**
 * 标注读写：anchors（定位）+ annotations（高亮/笔记/书签）。兼容新 ReaderLocator JSON、
 * 旧 AnchorV3（schema=shudeng.anchor.v3）与 legacy.raw Readium locator 三种存量形状。
 */
import { createDatabase, ShudengStore, type AnchorRow } from '@shudeng/core/db';
import { getDataLayer } from '../db';
import {
  anchorJsonForSelection,
  annotationReadingOrder,
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
  if (format === 'EPUB') {
    const location = decodeEpubAnchor(anchor.locatorJson);
    return location ? { type: 'epub', ...location, cfi: epubDestination(location), ...(anchor.chapter ? { chapter: anchor.chapter } : {}) } : null;
  }
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
      if (parsed.kind === 'readium') {
        // ReadiumAnchorV3 stores its full locator here, not in the optional readium field.
        const readium = readerLocatorFromLegacy(JSON.stringify(locator), format);
        if (readium) return readium;
      }
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
          cfi: cfi ?? (readium ? JSON.stringify(readium) : href ?? ''),
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
      ...annotationReadingOrder(anchor?.locatorJson),
      locator: anchor ? anchorToStoredLocator(anchor, formatOf(book.format)) : null,
    };
  });
}

export async function saveReaderAnnotation(
  bookId: string,
  input: SaveReaderAnnotationInput,
): Promise<{ readonly anchorId: string; readonly annotationId: string }> {
  const layer = await getDataLayer();
  if (input.format === 'EPUB') return saveEpubAnnotation(layer.driver, bookId, input);
  return layer.driver.transaction(async transaction => {
    const store = new ShudengStore(createDatabase(transaction));
    const anchor = await store.saveAnchor({
      bookId,
      engine: input.format === 'PDF' ? 'pdf' : 'cfi',
      locatorJson: anchorJsonForSelection(input),
      quote: input.quote ?? '',
      chapter: input.chapter ?? null,
      page: input.page ?? (input.locator.type === 'pdf' ? input.locator.page : null),
    });
    const annotation = await store.saveAnnotation({
      bookId,
      anchorId: anchor.id,
      kind: input.kind,
      color: input.color ?? null,
      body: input.body ?? null,
    });
    return { anchorId: anchor.id, annotationId: annotation.id };
  });
}

export async function deleteReaderAnnotation(annotationId: string): Promise<void> {
  const layer = await getDataLayer();
  await layer.store.deleteAnnotation(annotationId);
}

/** Removing the current page's bookmark matches is one durable operation. */
export async function deleteReaderBookmarks(bookId: string, annotationIds: readonly string[]): Promise<void> {
  if (!annotationIds.length) return;
  const { driver } = await getDataLayer();
  await driver.transaction(async transaction => {
    for (const id of new Set(annotationIds)) await transaction.run("DELETE FROM annotations WHERE id = ? AND book_id = ? AND kind = 'bookmark'", [id, bookId]);
  });
}

/** Preserve identity/kind/anchor when editing a note or changing a highlight color. */
export async function updateReaderAnnotation(annotationId: string, patch: { readonly color?: string; readonly body?: string }): Promise<void> {
  const { driver } = await getDataLayer();
  const [row] = await driver.all('SELECT kind FROM annotations WHERE id = ?', [annotationId]);
  if (!row) throw new Error('这条标注已被删除');
  if (patch.body !== undefined && (row.kind !== 'note' || !patch.body.trim())) throw new Error('笔记内容不能为空');
  if (patch.color !== undefined && row.kind !== 'highlight' && row.kind !== 'note') throw new Error('这条标注不能改色');
  // The native editor validates trimmed content but stores the entered body verbatim.
  if (patch.body !== undefined) await driver.run('UPDATE annotations SET body = ?, updated_at = ? WHERE id = ?', [patch.body, Date.now(), annotationId]);
  if (patch.color !== undefined) await driver.run('UPDATE annotations SET color = ?, updated_at = ? WHERE id = ?', [patch.color, Date.now(), annotationId]);
}
