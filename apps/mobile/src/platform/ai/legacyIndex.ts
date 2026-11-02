/**
 * 旧 Swift `book-index.sqlite` 适配：迁移后的真实书索引（只读副本）→ 本地 FTS/vector BookSource。
 *
 * 旧库在旧 App 的 Documents/book-index.sqlite；迁移导出应放到 App Documents/legacy/book-index.sqlite。
 * 本模块首次使用时复制到 expo-sqlite 默认目录（不修改旧文件），并复用旧 App 已算好的
 * fragments/FTS terms/384d 向量；查询侧用当前 ONNX EmbeddingProvider。
 * 如果 ONNX 模型未安装，则降级为纯 FTS（仍可引用原文，UI 由 semantic=false 提示）。
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { LegacyIndexBookSource, LegacyIndexSearch, type BookIdentity } from '@shudeng/core';
import { createExpoSQLiteDriver, type ExpoSQLiteDatabaseLike } from '@shudeng/core/db';
import { embeddingStatus, getEmbeddingProvider } from '../embedding';

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

let runtimePromise: Promise<LegacyIndexRuntime> | null = null;

function sqliteDirectory(): Directory {
  return new Directory(Paths.document, 'SQLite');
}

/** 旧 App 的 ONNX 模型目录（迁移导出时建议一并带上）：Documents/legacy/SemanticModel。 */
async function ensureSemanticModel(): Promise<void> {
  const target = new Directory(Paths.document, 'SemanticModel');
  if (target.exists) return;
  const source = new Directory(Paths.document, 'legacy', 'SemanticModel');
  if (!source.exists) return;
  target.create({ intermediates: true });
  for (const entry of source.list()) {
    if (entry instanceof File) await entry.copy(new File(target, entry.name));
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

async function openRuntime(): Promise<LegacyIndexRuntime> {
  await ensureCopiedDatabase();
  await ensureSemanticModel();
  const database = await SQLite.openDatabaseAsync(TARGET_DB);
  const driver = createExpoSQLiteDriver(database as unknown as ExpoSQLiteDatabaseLike);
  let semantic = false;
  let detail = '全文检索（语义模型未安装，仅 FTS）';
  try {
    const status = await embeddingStatus();
    if (status.available) {
      const provider = getEmbeddingProvider();
      const search = new LegacyIndexSearch(driver, provider);
      semantic = true;
      detail = '全文 + 语义检索（ONNX 384 维）';
      return { search, semantic, detail };
    }
    detail = `全文检索（${status.reason}）`;
  } catch (error) {
    detail = `全文检索（${error instanceof Error ? error.message : String(error)}）`;
  }
  return { search: new LegacyIndexSearch(driver, null), semantic, detail };
}

export function getLegacyIndexRuntime(): Promise<LegacyIndexRuntime> {
  if (!runtimePromise) {
    runtimePromise = openRuntime().catch((error: unknown) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

export async function getLegacyIndexStatus(bookId: string): Promise<{
  available: boolean;
  semantic: boolean;
  detail: string;
}> {
  try {
    const runtime = await getLegacyIndexRuntime();
    const available = await runtime.search.hasBook(bookId);
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
  const runtime = await getLegacyIndexRuntime();
  if (!(await runtime.search.hasBook(book.id))) {
    throw new LegacyIndexMissingError('这本书没有可用的旧索引，暂时不能书内问答');
  }
  return new LegacyIndexBookSource(runtime.search, book);
}
