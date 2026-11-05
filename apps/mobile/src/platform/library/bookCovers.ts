/** Publication cover cache; missing images use the generic native fallback, never book-name rules. */
import { Directory, File, Paths } from 'expo-file-system';
import { inspectEpubCover, type EpubContent } from '@shudeng/core';
import type { BookRow } from '@shudeng/core/db';
import { findBookFile } from '../bookFiles';
import { openEpubArchive } from '../epubArchive';
import { getDataLayer } from '../db';
import { getBookIndexGeneration, isBookIndexGenerationCurrent } from './bookFileOperations';

const EXTENSIONS = ['jpg', 'jpeg', 'png', 'svg', 'webp'] as const;
const pending = new Map<string, Promise<string | undefined>>();
const absent = new Map<string, string>();
// Covers are optional. This bounds only the cached image, never the publication/body.
const MAX_COVER_BYTES = 8 * 1024 * 1024;

export function cachedBookCover(id: string): string | undefined {
  for (const extension of EXTENSIONS) {
    const file = new File(Paths.document, 'Covers', id + '.' + extension);
    if (file.exists) return file.uri;
  }
  return undefined;
}

export async function saveBookCover(id: string, cover: EpubContent['cover']): Promise<string | undefined> {
  if (!cover) return undefined;
  const directory = new Directory(Paths.document, 'Covers');
  if (!directory.exists) directory.create({ intermediates: true });
  const file = new File(directory, id + '.' + cover.extension);
  if (!file.exists) {
    const temporary = new File(directory, '.' + id + '.partial');
    try {
      temporary.write(cover.bytes);
      await temporary.move(file);
    } catch (error) {
      const remainder = new File(directory, '.' + id + '.partial');
      if (remainder.exists) remainder.delete();
      throw error;
    }
  }
  absent.delete(id);
  return file.uri;
}

/** Existing migrated books lazily acquire their actual covers once; no personal metadata leaves the device. */
export async function loadBookCover(book: BookRow): Promise<string | undefined> {
  const cached = cachedBookCover(book.id);
  if (cached || book.removedAt !== null) return cached;
  const existing = pending.get(book.id);
  if (existing) return existing;
  const work = (async () => {
    const file = findBookFile(book);
    if (!file) return undefined;
    if (book.format === 'epub') {
      const { driver } = await getDataLayer();
      const generation = await getBookIndexGeneration(driver, book.id);
      const current = () => isBookIndexGenerationCurrent(driver, book, generation);
      const absenceIdentity = book.sourceHash + ':' + generation;
      if (absent.get(book.id) === absenceIdentity) return undefined;
      const markAbsent = async () => { if (await current()) absent.set(book.id, absenceIdentity); };
      if (!await current()) return undefined;
      const archive = await openEpubArchive(file.uri);
      try {
        const cover = await inspectEpubCover(archive);
        if (!cover || archive.getSize(cover.href) > MAX_COVER_BYTES) { await markAbsent(); return undefined; }
        const lease = await archive.materialize(cover.href);
        if (!lease) { await markAbsent(); return undefined; }
        try {
          if (lease.bytes === 0 || lease.bytes > MAX_COVER_BYTES) { await markAbsent(); return undefined; }
          const directory = new Directory(Paths.document, 'Covers');
          if (!directory.exists) directory.create({ intermediates: true });
          const output = new File(directory, book.id + '.' + cover.extension);
          const temporary = new File(directory, '.' + book.id + '.partial');
          try {
            if (!output.exists) {
              if (temporary.exists) temporary.delete();
              await new File(lease.uri).copy(temporary);
              if (!await current()) return undefined;
              await temporary.move(output);
              if (!await current()) { if (output.exists) output.delete(); return undefined; }
            }
            absent.delete(book.id);
            return output.uri;
          } finally {
            // File.move mutates its receiver URI; never delete that receiver after promotion.
            const remainder = new File(directory, '.' + book.id + '.partial');
            if (remainder.exists) remainder.delete();
          }
        } finally { await lease.release(); }
      } catch {
        // A corrupt/oversized optional image must not reject an otherwise readable book.
        await markAbsent();
        return undefined;
      } finally { await archive.close(); }
    }
    const directory = new Directory(Paths.document, 'Covers');
    if (!directory.exists) directory.create({ intermediates: true });
    const { renderPdfThumbnail } = await import('../pdfNative');
    return renderPdfThumbnail(file.uri, new File(directory, book.id + '.png').uri);
  })().finally(() => { pending.delete(book.id); });
  pending.set(book.id, work);
  return work;
}
