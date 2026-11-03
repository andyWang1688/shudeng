/**
 * 旧 Swift 书库迁移：复制旧 Books 文件、把 library.json / reading-questions.json 等
 * 一次性迁入共享 SQLite（幂等，已迁移过只补文件）。只读旧目录，不修改原数据。
 */
import { Directory, File, Paths } from 'expo-file-system';
import { migrateSwiftLibrary } from '@shudeng/core';
import { anchors, annotations, books, citations, messages } from '@shudeng/core/db';
import { getDataLayer } from '../db';

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

/** 读旧目录里的 JSON 文件原文；不存在返回 null。 */
export function readLegacyFile(name: string): string | null {
  const file = new File(Paths.document, LEGACY_DIR, name);
  if (!file.exists) return null;
  return file.textSync();
}

/** 读并解析旧 JSON 文件；缺失返回 undefined，坏 JSON 抛错（迁移失败可诊断）。 */
export function parseLegacyJSON(name: string): unknown {
  const text = readLegacyFile(name);
  if (!text) return undefined;
  return JSON.parse(text);
}

/** 旧 record-timestamps.json 形状校验：只保留字符串值。 */
function recordTimestampsOf(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') result[key] = item;
  }
  return result;
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

  const library = parseLegacyJSON('library.json');
  if (library === undefined) return { imported: false, books: 0, failures: 0 };
  const questions = parseLegacyJSON('reading-questions.json') ?? [];
  const recordTimestamps = recordTimestampsOf(parseLegacyJSON('record-timestamps.json'));
  const notesBookGroups = parseLegacyJSON('notes-book-groups.json');
  const result = migrateSwiftLibrary({
    library,
    questions,
    recordTimestamps,
    ...(notesBookGroups !== undefined ? { notesBookGroups } : {}),
  });

  const db = layer.db;
  if (result.tables.books.length > 0) {
    await db.insert(books).values([...result.tables.books]).onConflictDoNothing();
  }
  if (result.tables.anchors.length > 0) {
    await db.insert(anchors).values([...result.tables.anchors]).onConflictDoNothing();
  }
  if (result.tables.annotations.length > 0) {
    await db.insert(annotations).values([...result.tables.annotations]).onConflictDoNothing();
  }
  if (result.tables.messages.length > 0) {
    await db.insert(messages).values([...result.tables.messages]).onConflictDoNothing();
  }
  if (result.tables.citations.length > 0) {
    await db.insert(citations).values([...result.tables.citations]).onConflictDoNothing();
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
