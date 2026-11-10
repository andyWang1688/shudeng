import { createLocalId, type SQLiteDriver, type SQLiteValue } from '@shudeng/core/db';
import { decodeEpubAnchor, encodeEpubAnchor, sameEpubBookmark, sameEpubSelection } from '@shudeng/core/domain';
import type { SaveReaderAnnotationInput } from './types';

type ExistingAnnotation = Record<string, SQLiteValue> & { id: string; anchor_id: string; kind: string; color: string | null; body: string | null; locator_json: string; quote: string; chapter: string | null };

/** The lookup and write share one serialized transaction, so rapid repeats cannot insert twice. */
export async function saveEpubAnnotation(driver: SQLiteDriver, bookId: string, input: SaveReaderAnnotationInput): Promise<{ readonly anchorId: string; readonly annotationId: string }> {
  const location = decodeEpubAnchor(input.locator);
  if (input.locator.type !== 'epub' || !location) throw new Error('这条标注没有可用的原文位置');
  const body = input.body;
  if (input.kind === 'note' && !body?.trim()) throw new Error('笔记内容不能为空');
  return driver.transaction(async transaction => {
    const candidates = await transaction.all<ExistingAnnotation>(
      `SELECT a.id, a.anchor_id, a.kind, a.color, a.body, r.locator_json, r.quote, r.chapter
       FROM annotations a JOIN anchors r ON r.id = a.anchor_id
       WHERE a.book_id = ? AND (CASE WHEN a.kind = 'bookmark' THEN 1 ELSE 0 END) = ?
       ORDER BY a.created_at, a.id`,
      [bookId, input.kind === 'bookmark' ? 1 : 0],
    );
    const existing = candidates.find(candidate => (input.kind === 'bookmark' ? sameEpubBookmark : sameEpubSelection)(candidate.locator_json, input.locator));
    // Validate against the durable record, including calls from an older UI snapshot.
    if (input.kind === 'note' && existing?.kind === 'highlight') throw new Error('请先取消高亮，再添加笔记');
    const anchorId = existing?.anchor_id ?? createLocalId('anchor');
    const annotationId = existing?.id ?? createLocalId('annotation');
    const now = Date.now();
    const previousLocation = existing ? decodeEpubAnchor(existing.locator_json) : null;
    const selection = location.selection ?? previousLocation?.selection;
    const locatorJson = encodeEpubAnchor({ ...previousLocation, ...location, ...(selection ? { selection } : {}) }, existing?.locator_json);
    if (existing) {
      // Highlighting a note changes its color without erasing its body or changing identity.
      const kind = input.kind === 'highlight' && existing.kind === 'note' ? 'note' : input.kind;
      const nextBody = input.kind === 'note' ? body ?? null : existing.body;
      const color = input.color === undefined ? existing.color : input.color;
      await transaction.run('UPDATE anchors SET locator_json = ?, anchor_version = 3, quote = ?, chapter = ? WHERE id = ?', [locatorJson, input.quote ?? existing.quote, input.chapter ?? existing.chapter, anchorId]);
      await transaction.run('UPDATE annotations SET kind = ?, color = ?, body = ?, updated_at = ? WHERE id = ?', [kind, color, nextBody, now, annotationId]);
    } else {
      await transaction.run('INSERT INTO anchors (id, book_id, engine, locator_json, anchor_version, quote, chapter, page, created_at) VALUES (?, ?, ?, ?, 3, ?, ?, NULL, ?)', [anchorId, bookId, location.cfi ? 'cfi' : 'readium', locatorJson, input.quote ?? '', input.chapter ?? null, now]);
      await transaction.run('INSERT INTO annotations (id, book_id, anchor_id, kind, color, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [annotationId, bookId, anchorId, input.kind, input.color ?? (input.kind === 'note' ? 'yellow' : null), body ?? null, now, now]);
    }
    return { anchorId, annotationId };
  });
}
