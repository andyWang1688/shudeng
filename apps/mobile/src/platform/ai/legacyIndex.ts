/**
 * 旧 Swift `book-index.sqlite` 适配：迁移后的真实书索引工作副本 → 本地 FTS/vector BookSource。
 *
 * 旧库在旧 App 的 Documents/book-index.sqlite；迁移导出应放到 App Documents/legacy/book-index.sqlite。
 * 本模块首次使用时复制到 expo-sqlite 默认目录（不修改旧文件），并复用旧 App 已算好的
 * fragments/FTS terms/384d 向量；查询侧用当前 ONNX EmbeddingProvider。
 * 如果 ONNX 模型未安装，则降级为纯 FTS（仍可引用原文，UI 由 semantic=false 提示）。
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { createLocalId, LegacyIndexBookSource, LegacyIndexSearch, type BookIdentity } from '@shudeng/core';
import { createExpoSQLiteDriver, type ExpoSQLiteDatabaseLike, type SQLiteDriver } from '@shudeng/core/db';
import { embeddingStatus, getEmbeddingProvider } from '../embedding';
import { getDataLayer } from '../db';
import { legacyBookDataDeletedKey, legacyBookIndexRetiredKey } from '../library/bookFileOperations';
import { hasNativeSemanticAssets } from '../settings/nativeSemanticModel';

const LEGACY_INDEX_FILE = 'book-index.sqlite';
const TARGET_DB = 'legacy-book-index.sqlite';

export class LegacyIndexMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegacyIndexMissingError';
  }
}

export interface LegacyIndexRuntime {
  readonly search: LegacyIndexSearch;
  readonly semantic: boolean;
  readonly detail: string;
}

let driverPromise: Promise<SQLiteDriver> | null = null;
let semanticMigrationIssue: string | null = null;

function sqliteDirectory(): Directory {
  return new Directory(Paths.document, 'SQLite');
}

/** 旧 App 的 ONNX 模型目录（迁移导出时建议一并带上）：Documents/legacy/SemanticModel。 */
async function ensureSemanticModel(): Promise<void> {
  const target = new Directory(Paths.document, 'SemanticModel');
  const legacyDirectory = new Directory(Paths.document, 'legacy');
  const marker = new File(legacyDirectory, '.semantic-model-migrated');
  if (marker.exists) return;
  const mark = (): void => {
    if (!legacyDirectory.exists) legacyDirectory.create({ intermediates: true });
    marker.write('1');
  };
  // A deliberate deletion in Settings must stay deleted across future launches.
  if (target.exists) { mark(); return; }
  const source = new Directory(Paths.document, 'legacy', 'SemanticModel');
  if (!source.exists) return;
  if (!['model.onnx', 'tokenizer.json', 'tokenizer_config.json'].every((name) => new File(source, name).exists)
      && !(await hasNativeSemanticAssets(source))) return;
  const staging = new Directory(Paths.document, '.' + createLocalId('legacy-semantic'));
  let promoted = false;
  try {
    staging.create({ intermediates: true });
    for (const entry of source.list()) {
      if (entry instanceof File) await entry.copy(new File(staging, entry.name));
    }
    await staging.move(target);
    promoted = true;
    mark();
  } finally {
    if (!promoted && staging.exists) staging.delete();
  }
}

function candidateSourceFiles(): File[] {
  return [
    new File(Paths.document, 'legacy', LEGACY_INDEX_FILE),
    new File(Paths.document, LEGACY_INDEX_FILE),
  ];
}

async function ensureCopiedDatabase(): Promise<void> {
  const directory = sqliteDirectory();
  if (!directory.exists) directory.create({ intermediates: true });
  const target = new File(directory, TARGET_DB);
  if (target.exists) return;
  const source = candidateSourceFiles().find((file) => file.exists);
  if (!source) {
    throw new LegacyIndexMissingError(
      '未找到旧书索引 book-index.sqlite（应在 App Documents/legacy/book-index.sqlite）；请重新导出旧书数据后重试',
    );
  }
  await source.copy(target);
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = new File(source.parentDirectory, `${LEGACY_INDEX_FILE}${suffix}`);
    if (sidecar.exists) await sidecar.copy(new File(directory, `${TARGET_DB}${suffix}`));
  }
}

async function openDriver(): Promise<SQLiteDriver> {
  await ensureCopiedDatabase();
  await ensureSemanticModel().catch((error: unknown) => { semanticMigrationIssue = error instanceof Error ? error.message : String(error); });
  const database = await SQLite.openDatabaseAsync(TARGET_DB);
  return createExpoSQLiteDriver(database as unknown as ExpoSQLiteDatabaseLike);
}

async function getWorkingDriver(): Promise<SQLiteDriver> {
  if (!driverPromise) {
    driverPromise = openDriver().catch((error: unknown) => {
      driverPromise = null;
      throw error;
    });
  }
  return driverPromise;
}

const LEGACY_BOOK_TABLES = ['fragment_terms', 'embeddings', 'fragments', 'chapters', 'contents', 'preparations', 'embedding_progress'] as const;

/** Retirement survives reimport and recopying the immutable backup into a new working database. */
async function purgeRetiredRows(working: SQLiteDriver): Promise<void> {
  const { driver } = await getDataLayer();
  const prefixes = [legacyBookIndexRetiredKey(''), legacyBookDataDeletedKey('')];
  const retired = await driver.all<{ key: string }>('SELECT key FROM app_preferences WHERE key LIKE ? OR key LIKE ?', prefixes.map(prefix => prefix + '%'));
  if (!retired.length) return;
  const ids = new Set(retired.map(row => {
    const prefix = prefixes.find(value => row.key.startsWith(value))!;
    return row.key.slice(prefix.length);
  }));
  const available = new Set((await working.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'" )).map(row => row.name));
  await working.transaction(async tx => {
    for (const id of ids) for (const table of LEGACY_BOOK_TABLES) {
      if (available.has(table)) await tx.run('DELETE FROM ' + table + ' WHERE book_id = ?', [id]);
    }
  });
}

/** Removal cleanup must not create a working database merely to delete from it. */
export async function purgeRetiredLegacyBookIndexes(): Promise<void> {
  if (!new File(sqliteDirectory(), TARGET_DB).exists) return;
  await purgeRetiredRows(await getWorkingDriver());
}

async function canUseLegacyIndex(bookId: string): Promise<boolean> {
  const { driver } = await getDataLayer();
  const rows = await driver.all<{ id: string }>(
    `SELECT id FROM books WHERE id = ? AND removed_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM book_file_operations WHERE id = books.id)
       AND NOT EXISTS (SELECT 1 FROM app_preferences WHERE key IN (?, ?))`,
    [bookId, legacyBookIndexRetiredKey(bookId), legacyBookDataDeletedKey(bookId)],
  );
  return rows.length > 0;
}

async function currentRuntime(driver: SQLiteDriver): Promise<LegacyIndexRuntime> {
  let semantic = false;
  let detail = semanticMigrationIssue ? '书内文字可用；语义资料迁移失败：' + semanticMigrationIssue : '全文检索（语义模型未安装，仅 FTS）';
  try {
    const status = await embeddingStatus();
    if (status.available) {
      const provider = getEmbeddingProvider();
      const search = new LegacyIndexSearch(driver, provider, { onVectorError(error) {
        semantic = false;
        detail = '书内文字可用；语义查找暂不可用：' + (error instanceof Error ? error.message : String(error));
      } });
      semantic = true;
      detail = '全文 + 语义检索（ONNX 384 维）';
      return { search, get semantic() { return semantic; }, get detail() { return detail; } };
    }
    detail = `全文检索（${status.reason}）`;
  } catch (error) {
    detail = `全文检索（${error instanceof Error ? error.message : String(error)}）`;
  }
  return { search: new LegacyIndexSearch(driver, null), semantic, detail };
}

export async function getLegacyIndexRuntime(): Promise<LegacyIndexRuntime> {
  const driver = await getWorkingDriver();
  await purgeRetiredRows(driver);
  return currentRuntime(driver);
}

export async function getLegacyIndexStatus(bookId: string): Promise<{
  available: boolean;
  semantic: boolean;
  detail: string;
}> {
  try {
    if (!(await canUseLegacyIndex(bookId))) return { available: false, semantic: false, detail: '旧索引已失效，请重新准备书内文字' };
    const runtime = await getLegacyIndexRuntime();
    const available = await runtime.search.hasBook(bookId) && await canUseLegacyIndex(bookId);
    return {
      available,
      semantic: runtime.semantic,
      detail: available ? runtime.detail : '这本书没有旧索引，暂时不能书内问答',
    };
  } catch (error) {
    return {
      available: false,
      semantic: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function createLegacyBookSource(book: BookIdentity): Promise<LegacyIndexBookSource> {
  if (!(await canUseLegacyIndex(book.id))) throw new LegacyIndexMissingError('旧索引已失效，请重新准备书内文字');
  const runtime = await getLegacyIndexRuntime();
  if (!(await runtime.search.hasBook(book.id)) || !(await canUseLegacyIndex(book.id))) {
    throw new LegacyIndexMissingError('这本书没有可用的旧索引，暂时不能书内问答');
  }
  return new LegacyIndexBookSource(runtime.search, book);
}
