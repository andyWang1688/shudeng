/**
 * V3 迁移端到端评测：旧 Swift 备份 JSON → migrateSwiftLibrary → 写入 Node SQLite（Drizzle 0001+0002 schema）
 * → 校验行数/FK/actor/locator/引用/失败清单。仅 Node 证据；不改 apps/mobile，不读真实用户数据（夹具脱敏）。
 */
import {
  annotations as annotationsTable,
  anchors as anchorsTable,
  books as booksTable,
  citations as citationsTable,
  createDatabase,
  isAnchorV3,
  migrate,
  messages as messagesTable,
  migrateSwiftLibrary,
  type SQLiteValue,
} from '@shudeng/core';
import { createNodeSQLiteDriver } from '@shudeng/core/db/testing';
import {
  MIGRATION_EPUB_ID,
  MIGRATION_NOW,
  MIGRATION_PDF_ID,
  MIGRATION_REMOVED_ID,
  migrationCopyOfLegacyBackup,
} from './migration-fixture.js';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];
function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
}

function parseAnchorOrNull(value: unknown): unknown {
  try {
    return typeof value === 'string' ? (JSON.parse(value) as unknown) : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log('=== V3 Swift 旧数据迁移端到端评测 ===');
  const input = migrationCopyOfLegacyBackup();
  const before = JSON.stringify(input);
  const result = migrateSwiftLibrary(input, { now: MIGRATION_NOW });

  console.log(
    `迁移结果：ok=${result.ok} books=${result.tables.books.length} anchors=${result.tables.anchors.length} annotations=${result.tables.annotations.length} messages=${result.tables.messages.length} citations=${result.tables.citations.length} failures=${result.failures.length} warnings=${result.warnings.length}`,
  );

  const driver = createNodeSQLiteDriver();
  try {
    const migration = await migrate(driver);
    console.log(`schema 迁移：${migration.applied.join(',') || '(已是最新)'}`);
    const db = createDatabase(driver);
    await db.withTransaction(async (tx) => {
      if (result.tables.books.length) await tx.insert(booksTable).values([...result.tables.books]);
      if (result.tables.anchors.length) await tx.insert(anchorsTable).values([...result.tables.anchors]);
      if (result.tables.annotations.length) await tx.insert(annotationsTable).values([...result.tables.annotations]);
      if (result.tables.messages.length) await tx.insert(messagesTable).values([...result.tables.messages]);
      if (result.tables.citations.length) await tx.insert(citationsTable).values([...result.tables.citations]);
    });

    type Row = Record<string, SQLiteValue>;
    const rows = async (sql: string, params: ReadonlyArray<SQLiteValue> = []): Promise<Row[]> =>
      driver.all<Row>(sql, params);

    const bookRows = await rows(
      'SELECT id, title, format, imported_at FROM books ORDER BY id',
    );
    check('books 行数与内容', bookRows.length === 4, `写入 ${bookRows.length} 本书（含孤儿占位书）`);
    check(
      'books 时间戳/格式',
      bookRows.every((book) => book.imported_at === MIGRATION_NOW) &&
        bookRows.find((book) => book.id === MIGRATION_PDF_ID)?.format === 'pdf',
      'imported_at 统一迁移时间，PDF 格式保留',
    );

    const anchorRows = await rows(
      'SELECT id, locator_json, anchor_version, engine FROM anchors ORDER BY id',
    );
    const anchorsValid = anchorRows.every(
      (row) => isAnchorV3(parseAnchorOrNull(row.locator_json)) && row.anchor_version === 3,
    );
    check('anchors 全部为 AnchorV3 + version=3', anchorRows.length === 11 && anchorsValid, `${anchorRows.length} 个锚点全部可解析`);
    const pdfAnchor = anchorRows.find((row) => row.id === 'legacy-anchor:note:7C743BCC-2677-4263-B0C1-FFEF676D8613')!;
    const parsedPdf = parseAnchorOrNull(pdfAnchor.locator_json);
    check(
      'PDF 锚点 page=34 + 归一化 rect',
      isAnchorV3(parsedPdf) && parsedPdf.kind === 'pdf' && parsedPdf.locator.page === 34 && parsedPdf.locator.rects.length === 1,
      'PDF 页与 rect 映射正确',
    );

    const annotationRows = await rows(
      'SELECT id, book_id, kind, color FROM annotations ORDER BY id',
    );
    check('annotations 行数', annotationRows.length === 6, `写入 ${annotationRows.length} 条（坏笔记未写入）`);
    const removedAnnotations = annotationRows.filter((row) => row.book_id === MIGRATION_REMOVED_ID);
    check('移除书保留笔记/书签', removedAnnotations.length === 2, `${removedAnnotations.length} 条笔记/书签随移除书保留`);
    const timedAnnotation = annotationRows.find((row) => row.id === 'legacy-note:7C743BCC-2677-4263-B0C1-FFEF676D8613')!;
    const timedAnnotationId = typeof timedAnnotation?.id === 'string' ? timedAnnotation.id : '';
    const timedCreated = (
      await rows('SELECT created_at FROM annotations WHERE id = ?', [timedAnnotationId])
    )[0]?.created_at;
    check(
      'record-timestamps 映射',
      timedCreated === Date.parse('2026-10-28T05:38:09Z'),
      `created_at=${String(timedCreated)}`,
    );

    const messageRows = await rows(
      'SELECT id, conversation_id, role, content, reasoning_content FROM messages ORDER BY id',
    );
    check('messages 行数（草稿不写）', messageRows.length === 6, `${messageRows.length} 条消息`);
    check(
      '旧问答 reasoning 映射',
      messageRows.some((row) => row.role === 'assistant' && row.reasoning_content === '先查书，再作答。'),
      'assistant.reasoning_content 保留',
    );

    const citationRows = await rows(
      'SELECT id, quote, locator_json, page FROM citations ORDER BY id',
    );
    check(
      'citations 行数 + AnchorV3 locator',
      citationRows.length === 3 &&
        citationRows.every(
          (row) => typeof row.quote === 'string' && row.quote.length > 0 && isAnchorV3(parseAnchorOrNull(row.locator_json)),
        ),
      `${citationRows.length} 条引用，locator 全部 v3`,
    );
    check(
      'PDF 引用 page 映射',
      citationRows.some((row) => row.page === 34),
      'pdf://page/34 引用页号保留',
    );

    const fk = await rows('PRAGMA foreign_key_check');
    check('外键完整性', fk.length === 0, 'foreign_key_check 无违规');

    check('输入不被修改', JSON.stringify(input) === before, '迁移前后输入 JSON 完全一致');
    check('不伪造成功', result.ok === false && result.failures.length === 2, `failures=${result.failures.map((failure) => failure.code).join(',')}`);
    check(
      '失败清单可定位',
      result.failures.every((failure) => failure.path.length > 0) &&
        result.failures.some((failure) => failure.code === 'invalid-locator-json') &&
        result.failures.some((failure) => failure.code === 'citation-missing-quote'),
      '坏笔记/空 quote 引用均有 path',
    );
    check(
      '移除书 state / 占位书',
      result.bookStates.find((state) => state.bookId === MIGRATION_REMOVED_ID)?.sourceAvailable === false &&
        result.bookStates.some((state) => state.synthesized === true && state.title === '已删除但仍有问答的书'),
      'removed + synthesized 状态保留',
    );
    check(
      'settings 保留但不入库',
      result.settings.length === 1 && result.settings[0]?.persisted === false,
      'readingSettings 存在迁移结果中（schema 无列，warning 说明）',
    );
    check(
      '真实旧样本字段未丢',
      result.unmapped.agentTranscripts.length === 1 &&
        result.unmapped.notesBookGroups !== undefined &&
        result.warningCounts['ui-state-not-migrated'] === 1,
      'agent transcript / notes-book-groups 保留在 unmapped',
    );
    void MIGRATION_EPUB_ID;
  } finally {
    await driver.close();
  }

  const failed = checks.filter((item) => !item.ok);
  console.log(`\n结果：${checks.length - failed.length}/${checks.length} 通过`);
  if (failed.length > 0) process.exitCode = 1;
}

void main();
