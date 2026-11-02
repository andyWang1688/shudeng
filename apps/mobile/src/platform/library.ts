/**
 * iOS 迁移第一批：把旧 Swift 数据（App Documents/legacy/*.json）导入共享 SQLite，
 * 并从数据库读出真实书架。旧数据只读，导入幂等（已有 books 时跳过）。
 */
import { Directory, File, Paths } from 'expo-file-system';
import { migrateSwiftLibrary } from '@shudeng/core';
import { getDataLayer } from './db';

export type ShelfBookRecord = {
  readonly id: string;
  readonly title: string;
  readonly author: string | null;
  readonly format: 'EPUB' | 'PDF';
  readonly sourceHash: string;
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

export async function loadShelfBooks(): Promise<readonly ShelfBookRecord[]> {
  const layer = await getDataLayer();
  const rows = await layer.store.listBooks();
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    author: row.author ?? null,
    format: row.format === 'pdf' ? 'PDF' : 'EPUB',
    sourceHash: row.sourceHash,
  }));
}
