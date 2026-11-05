/**
 * 纯 TS：把旧 Swift 版书灯的数据（library.json / reading-questions.json /
 * record-timestamps.json）迁移到共享 Drizzle schema / 版本化 AnchorV3。
 *
 * 保证：
 * - 只读输入（不修改、不排序原数组），相同输入 + 相同 options.now → 相同输出；
 * - locator 先转 AnchorV3，并始终保留 legacy.raw 原始副本；
 * - 任何无法转换的记录进入 failures（带 JSON 路径与原始值），`ok=false`，不伪造成功；
 * - 当前 schema 表达不了的字段（settings/pdfInfo/recordIdentity/agent transcript…）
 *   放进迁移结果与 warnings，不静默丢弃。
 */
import { ANCHOR_VERSION, type AnchorKind, type AnchorV3 } from '../domain/anchor.js';
import type { NewAnchorRow, NewAnnotationRow, NewBookRow, NewCitationRow, NewMessageRow } from '../db/schema.js';
import { appleDateToUnixMs, convertLegacyLocator } from './legacy-locator.js';
import { projectLegacyNativeTurn } from './legacy-native-agent.js';
import type {
  LegacyBookmark,
  LegacyBook,
  LegacyBookNote,
  LegacyQuestionEvidence,
  LegacyReadingQuestion,
  LegacyPdfNormRect,
  LegacyReadingSettings,
  MigratedBookState,
  MigratedReadingPosition,
  MigrationFailure,
  MigrationFailureCode,
  MigrationOptions,
  MigrationResult,
  MigrationStats,
  MigrationTables,
  MigrationUnmapped,
  MigrationWarning,
  MigrationWarningCode,
  PreservedBookSettings,
} from './types.js';

const LEGACY_COLORS = new Set(['yellow', 'green', 'blue', 'rose']);
const REMOVAL_VALUES = new Set(['removed', 'removing', 'deleting']);
const APPLE_EPOCH_MAX_SECONDS = 4_102_444_800; // 2100-01-01，用于识别异常日期

interface BookIndexEntry {
  readonly bookId: string;
  readonly format: 'epub' | 'pdf';
  readonly pdfPageCount?: number;
  readonly state: MigratedBookState;
}

interface Counters {
  booksMigrated: number;
  notesMigrated: number;
  bookmarksMigrated: number;
  questionsMigrated: number;
  citationsMigrated: number;
  booksFailed: number;
  notesFailed: number;
  bookmarksFailed: number;
  questionsFailed: number;
  citationsFailed: number;
  anchorsByKind: Record<AnchorKind, number>;
  bookTimestampFallbacks: number;
  noteTimestampFallbacks: number;
  bookmarkTimestampFallbacks: number;
  draftsSkipped: number;
  noteDraftsSkipped: number;
  historyDuplicatesSkipped: number;
  orphanQuestionBooks: number;
}

interface BuildContext {
  readonly now: number;
  readonly recordTimestamps: Map<string, number>;
  readonly tables: {
    books: NewBookRow[];
    anchors: NewAnchorRow[];
    annotations: NewAnnotationRow[];
    messages: NewMessageRow[];
    citations: NewCitationRow[];
  };
  readonly bookStates: MigratedBookState[];
  readonly readingPositions: MigratedReadingPosition[];
  readonly settings: PreservedBookSettings[];
  readonly failures: MigrationFailure[];
  readonly warnings: MigrationWarning[];
  readonly unmapped: {
    noteDrafts: Array<{ path: string; raw: LegacyBookNote }>;
    draftQuestions: Array<{ path: string; raw: Record<string, unknown> }>;
    questionExtras: Array<{ questionId: string; raw: Record<string, unknown> }>;
    agentTranscripts: Array<{ questionId: string; raw: NonNullable<LegacyReadingQuestion['agent']> }>;
    questionsWithHistory: number;
    questionsWithSelection: number;
    notesBookGroups?: unknown;
  };
  readonly counters: Counters;
  readonly bookIndex: Map<string, BookIndexEntry>;
  readonly seenNoteIds: Set<string>;
  readonly seenBookmarkIds: Set<string>;
  readonly seenQuestionIds: Set<string>;
  readonly emittedHistoryIds: Set<string>;
  readonly seenEvidenceIds: Map<string, Set<string>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? (value as unknown[]) : undefined;
}

function recordTimestampKey(kind: 'note' | 'bookmark', bookId: string, recordId: string): string {
  return `${kind}:${bookId}:${recordId}`.toLowerCase();
}

function pushFailure(
  ctx: BuildContext,
  code: MigrationFailureCode,
  path: string,
  message: string,
  raw: unknown,
): void {
  ctx.failures.push({ code, path, message, raw });
}

function pushWarning(ctx: BuildContext, code: MigrationWarningCode, path: string, message: string): void {
  ctx.warnings.push({ code, path, message });
}

function fallbackTimestamp(ctx: BuildContext, kind: 'books' | 'notes' | 'bookmarks'): number {
  if (kind === 'books') ctx.counters.bookTimestampFallbacks += 1;
  else if (kind === 'notes') ctx.counters.noteTimestampFallbacks += 1;
  else ctx.counters.bookmarkTimestampFallbacks += 1;
  return ctx.now;
}

function timestampForNote(ctx: BuildContext, bookId: string, noteId: string): number | undefined {
  return ctx.recordTimestamps.get(recordTimestampKey('note', bookId, noteId));
}

function timestampForBookmark(ctx: BuildContext, bookId: string, bookmarkId: string): number | undefined {
  return ctx.recordTimestamps.get(recordTimestampKey('bookmark', bookId, bookmarkId));
}

function parseRecordTimestamps(value: unknown): {
  map: Map<string, number>;
  invalid: Array<{ key: string; reason: string }>;
} {
  const map = new Map<string, number>();
  const invalid: Array<{ key: string; reason: string }> = [];
  const record = asRecord(value);
  if (!record) return { map, invalid };
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw !== 'string') {
      invalid.push({ key, reason: '时间不是 ISO8601 字符串' });
      continue;
    }
    const timestamp = Date.parse(raw);
    if (!Number.isFinite(timestamp)) {
      invalid.push({ key, reason: `无法解析 ISO8601：${raw}` });
      continue;
    }
    map.set(key.toLowerCase(), timestamp);
  }
  return { map, invalid };
}

function buildBookState(
  bookId: string,
  title: string,
  format: 'epub' | 'pdf',
  formatDefaulted: boolean,
  removal: 'removed' | 'removing' | 'deleting' | null,
  sourceAvailable: boolean,
  synthesized: boolean,
  raw: Record<string, unknown>,
): MigratedBookState {
  const recordIdentity = nonEmptyString(raw.recordIdentity);
  const pdfInfo = asRecord(raw.pdfInfo);
  const readingSettings = asRecord(raw.readingSettings);
  return {
    bookId,
    title,
    format,
    formatDefaulted,
    removal,
    sourceAvailable,
    synthesized,
    ...(recordIdentity ? { recordIdentity } : {}),
    ...(pdfInfo && typeof pdfInfo.pageCount === 'number' && typeof pdfInfo.textPageCount === 'number'
      ? {
          pdfInfo: {
            pageCount: pdfInfo.pageCount,
            textPageCount: pdfInfo.textPageCount,
            ...(typeof pdfInfo.blankPageCount === 'number' ? { blankPageCount: pdfInfo.blankPageCount } : {}),
          },
        }
      : {}),
    ...(readingSettings ? { readingSettings: readingSettings as LegacyReadingSettings } : {}),
  };
}

function makeBookRow(
  bookId: string,
  title: string,
  author: string | null,
  format: 'epub' | 'pdf',
  now: number,
): NewBookRow {
  return {
    id: bookId,
    title,
    author,
    format,
    sourceHash: bookId,
    importedAt: now,
    updatedAt: now,
  };
}

function addAnchor(
  ctx: BuildContext,
  anchorId: string,
  bookId: string,
  anchor: AnchorV3,
  quote: string,
  chapter: string | undefined,
  page: number | undefined,
  createdAt: number,
): void {
  ctx.tables.anchors.push({
    id: anchorId,
    bookId,
    engine: anchor.kind,
    locatorJson: JSON.stringify(anchor),
    anchorVersion: ANCHOR_VERSION,
    quote,
    chapter: chapter ?? null,
    page: page ?? null,
    createdAt,
  });
  ctx.counters.anchorsByKind[anchor.kind] += 1;
}

function mapNote(
  ctx: BuildContext,
  entry: BookIndexEntry,
  raw: unknown,
  path: string,
): void {
  const record = asRecord(raw);
  if (!record) {
    ctx.counters.notesFailed += 1;
    pushFailure(ctx, 'invalid-note', path, '笔记不是对象', raw);
    return;
  }
  const noteId = nonEmptyString(record.id);
  if (!noteId) {
    ctx.counters.notesFailed += 1;
    pushFailure(ctx, 'invalid-note', path, '笔记缺 id', raw);
    return;
  }
  if (ctx.seenNoteIds.has(noteId.toLowerCase())) {
    ctx.counters.notesFailed += 1;
    pushFailure(ctx, 'duplicate-record-id', path, `重复笔记 id：${noteId}`, raw);
    return;
  }
  const locatorJSON = record.locatorJSON;
  const pdfRaw = asRecord(record.pdf);
  const pdfGeometry = pdfRaw
    ? {
        page: typeof pdfRaw.page === 'number' ? pdfRaw.page : Number.NaN,
        rects: (asArray(pdfRaw.rects) ?? []) as LegacyPdfNormRect[],
      }
    : undefined;
  const conversion = convertLegacyLocator(locatorJSON, pdfGeometry, entry.pdfPageCount, `${path}.locatorJSON`);
  if (!conversion.ok) {
    ctx.counters.notesFailed += 1;
    pushFailure(ctx, conversion.code, `${path}.locatorJSON`, conversion.message, raw);
    return;
  }
  for (const warning of conversion.warnings) ctx.warnings.push(warning);

  const colorRaw = record.color;
  let color: string | null = null;
  if (typeof colorRaw === 'string') {
    if (LEGACY_COLORS.has(colorRaw)) color = colorRaw;
    else {
      pushWarning(ctx, 'unknown-color', `${path}.color`, `未知高亮色 ${colorRaw}，保留 null`);
    }
  } else {
    // Swift 侧 color=nil 渲染为 yellow；迁移时显式落为 yellow，语义不变。
    color = 'yellow';
  }
  const body = typeof record.body === 'string' ? record.body : '';
  const noteIdKey = noteId.toLowerCase();
  const timestamp = timestampForNote(ctx, entry.bookId, noteId);
  const createdAt =
    timestamp ?? fallbackTimestamp(ctx, 'notes');
  if (timestamp === undefined) {
    pushWarning(ctx, 'note-timestamp-defaulted', path, '旧数据无 record-timestamps，使用迁移时间兜底');
  }
  const anchorId = `legacy-anchor:note:${noteId}`;
  addAnchor(
    ctx,
    anchorId,
    entry.bookId,
    conversion.anchor,
    conversion.quote,
    conversion.chapter,
    conversion.page,
    createdAt,
  );
  ctx.tables.annotations.push({
    id: `legacy-note:${noteId}`,
    bookId: entry.bookId,
    anchorId,
    kind: body.trim().length > 0 ? 'note' : 'highlight',
    color,
    body: body.length > 0 ? body : null,
    createdAt,
    updatedAt: createdAt,
  });
  ctx.seenNoteIds.add(noteIdKey);
  ctx.counters.notesMigrated += 1;
}

function mapBookmark(
  ctx: BuildContext,
  entry: BookIndexEntry,
  raw: unknown,
  path: string,
): void {
  const record = asRecord(raw);
  if (!record) {
    ctx.counters.bookmarksFailed += 1;
    pushFailure(ctx, 'invalid-bookmark', path, '书签不是对象', raw);
    return;
  }
  const bookmarkId = nonEmptyString(record.id);
  if (!bookmarkId) {
    ctx.counters.bookmarksFailed += 1;
    pushFailure(ctx, 'invalid-bookmark', path, '书签缺 id', raw);
    return;
  }
  if (ctx.seenBookmarkIds.has(bookmarkId.toLowerCase())) {
    ctx.counters.bookmarksFailed += 1;
    pushFailure(ctx, 'duplicate-record-id', path, `重复书签 id：${bookmarkId}`, raw);
    return;
  }
  const conversion = convertLegacyLocator(record.locatorJSON, undefined, entry.pdfPageCount, `${path}.locatorJSON`);
  if (!conversion.ok) {
    ctx.counters.bookmarksFailed += 1;
    pushFailure(ctx, conversion.code, `${path}.locatorJSON`, conversion.message, raw);
    return;
  }
  for (const warning of conversion.warnings) ctx.warnings.push(warning);

  const excerpt = typeof record.excerpt === 'string' && record.excerpt.length > 0 ? record.excerpt : conversion.quote;
  const title = nonEmptyString(record.title);
  const chapter = conversion.chapter ?? title;
  const timestamp = timestampForBookmark(ctx, entry.bookId, bookmarkId);
  const createdAt = timestamp ?? fallbackTimestamp(ctx, 'bookmarks');
  if (timestamp === undefined) {
    pushWarning(ctx, 'bookmark-timestamp-defaulted', path, '旧数据无 record-timestamps，使用迁移时间兜底');
  }
  const anchorId = `legacy-anchor:bookmark:${bookmarkId}`;
  addAnchor(ctx, anchorId, entry.bookId, conversion.anchor, excerpt, chapter, conversion.page, createdAt);
  ctx.tables.annotations.push({
    id: `legacy-bookmark:${bookmarkId}`,
    bookId: entry.bookId,
    anchorId,
    kind: 'bookmark',
    color: null,
    body: null,
    createdAt,
    updatedAt: createdAt,
  });
  ctx.seenBookmarkIds.add(bookmarkId.toLowerCase());
  ctx.counters.bookmarksMigrated += 1;
}

function resolveBookFormat(record: Record<string, unknown>): 'epub' | 'pdf' | null {
  const raw = record.format;
  if (raw === undefined || raw === null) return 'epub';
  return raw === 'epub' || raw === 'pdf' ? raw : null;
}

function resolveRemoval(record: Record<string, unknown>): {
  removal: 'removed' | 'removing' | 'deleting' | null;
  invalid: string | undefined;
} {
  const raw = record.removal;
  if (raw === undefined || raw === null) return { removal: null, invalid: undefined };
  if (typeof raw === 'string' && REMOVAL_VALUES.has(raw)) {
    return { removal: raw as 'removed' | 'removing' | 'deleting', invalid: undefined };
  }
  return { removal: null, invalid: typeof raw === 'string' ? raw : JSON.stringify(raw) };
}

function mapBook(
  ctx: BuildContext,
  raw: unknown,
  index: number,
  sourceNotes: number,
  sourceBookmarks: number,
): { entry?: BookIndexEntry } {
  const path = `library[${index}]`;
  const record = asRecord(raw);
  if (!record) {
    ctx.counters.booksFailed += 1;
    pushFailure(ctx, 'invalid-book', path, '书不是对象', raw);
    return {};
  }
  const bookId = nonEmptyString(record.id);
  const title = nonEmptyString(record.title);
  if (!bookId || !title) {
    ctx.counters.booksFailed += 1;
    pushFailure(ctx, 'invalid-book', path, `书缺 id/title：${String(record.id)} / ${String(record.title)}`, raw);
    for (let i = 0; i < sourceNotes; i += 1) {
      ctx.counters.notesFailed += 1;
      pushFailure(ctx, 'orphan-note', `${path}.notes[${i}]`, '所属书无效，笔记无法迁移', asArray(record.notes)?.[i]);
    }
    for (let i = 0; i < sourceBookmarks; i += 1) {
      ctx.counters.bookmarksFailed += 1;
      pushFailure(ctx, 'orphan-bookmark', `${path}.bookmarks[${i}]`, '所属书无效，书签无法迁移', asArray(record.bookmarks)?.[i]);
    }
    return {};
  }
  if (ctx.bookIndex.has(bookId)) {
    ctx.counters.booksFailed += 1;
    pushFailure(ctx, 'duplicate-book-id', path, `重复书 id：${bookId}`, raw);
    return {};
  }
  const format = resolveBookFormat(record);
  if (format === null) {
    ctx.counters.booksFailed += 1;
    pushFailure(ctx, 'invalid-format', path, `不支持的格式：${String(record.format)}`, raw);
    return {};
  }
  const formatDefaulted = record.format === undefined || record.format === null;
  if (formatDefaulted) pushWarning(ctx, 'format-defaulted-epub', path, '旧目录缺 format，按 epub 迁移');

  const { removal, invalid: invalidRemoval } = resolveRemoval(record);
  if (invalidRemoval !== undefined) {
    pushWarning(ctx, 'ui-state-not-migrated', `${path}.removal`, `未知移除状态 ${invalidRemoval}，按未移除迁移`);
  }
  if (removal === 'removed') pushWarning(ctx, 'book-removed', path, '书已移除（文件已删），保留书籍行与笔记/书签');
  else if (removal !== null) pushWarning(ctx, 'book-removal-pending', path, `书处于移除中状态 ${removal}，按不可用迁移`);
  const sourceAvailable = removal === null;

  const author = typeof record.author === 'string' && record.author.length > 0 ? record.author : null;
  const now = ctx.now;
  ctx.tables.books.push(makeBookRow(bookId, title, author, format, now));
  ctx.counters.booksMigrated += 1;
  ctx.counters.bookTimestampFallbacks += 1;
  pushWarning(ctx, 'book-timestamp-defaulted', path, '旧目录无书籍时间戳，使用迁移时间兜底');
  if (!/^[0-9a-f]{64}$/i.test(bookId)) {
    pushWarning(ctx, 'source-hash-not-sha256', path, `书 id 不是 64 位 hex（仍以 id 作为 sourceHash）：${bookId}`);
  }

  const pdfInfo = asRecord(record.pdfInfo);
  const pdfPageCount =
    pdfInfo && typeof pdfInfo.pageCount === 'number' && Number.isInteger(pdfInfo.pageCount)
      ? pdfInfo.pageCount
      : undefined;
  const state = buildBookState(
    bookId,
    title,
    format,
    formatDefaulted,
    removal,
    sourceAvailable,
    false,
    record,
  );
  ctx.bookStates.push(state);
  const readingSettings = asRecord(record.readingSettings);
  if (readingSettings) {
    ctx.settings.push({
      bookId,
      settings: readingSettings as LegacyReadingSettings,
      persisted: false,
      reason: 'shared-schema-has-no-reading-settings-column',
    });
    pushWarning(ctx, 'settings-not-persisted', `${path}.readingSettings`, '当前共享 schema 无阅读设置列，设置保留在迁移结果中');
  }

  const bookLocator = typeof record.locatorJSON === 'string' ? record.locatorJSON : undefined;
  if (bookLocator && bookLocator.trim().length > 0) {
    const conversion = convertLegacyLocator(bookLocator, undefined, pdfPageCount, `${path}.locatorJSON`);
    if (conversion.ok) {
      const anchorId = `legacy-anchor:book-position:${bookId}`;
      addAnchor(ctx, anchorId, bookId, conversion.anchor, conversion.quote, conversion.chapter, conversion.page, now);
      ctx.readingPositions.push({ bookId, anchorId, legacyRaw: bookLocator });
    } else {
      pushWarning(ctx, 'invalid-book-locator', `${path}.locatorJSON`, `阅读位置无法转换：${conversion.message}`);
    }
  }

  const entry: BookIndexEntry = {
    bookId,
    format,
    ...(pdfPageCount !== undefined ? { pdfPageCount } : {}),
    state,
  };
  ctx.bookIndex.set(bookId, entry);

  const notes = asArray(record.notes) ?? [];
  notes.forEach((note, noteIndex) => mapNote(ctx, entry, note, `${path}.notes[${noteIndex}]`));
  const bookmarks = asArray(record.bookmarks) ?? [];
  bookmarks.forEach((bookmark, bookmarkIndex) =>
    mapBookmark(ctx, entry, bookmark, `${path}.bookmarks[${bookmarkIndex}]`),
  );

  const drafts = asArray(record.noteDrafts) ?? [];
  drafts.forEach((draft, draftIndex) => {
    ctx.counters.noteDraftsSkipped += 1;
    pushWarning(
      ctx,
      'note-drafts-skipped',
      `${path}.noteDrafts[${draftIndex}]`,
      'noteDrafts 是编辑中的草稿，当前 schema 无草稿状态；原始记录保留在 unmapped.noteDrafts',
    );
    if (isRecord(draft)) {
      ctx.unmapped.noteDrafts.push({ path: `${path}.noteDrafts[${draftIndex}]`, raw: draft as unknown as LegacyBookNote });
    }
  });
  return { entry };
}

function deriveFormatFromQuestion(
  question: Record<string, unknown>,
): 'epub' | 'pdf' {
  const candidates: unknown[] = [
    ...(asArray(question.citations) ?? []),
    ...(asArray(question.evidence) ?? []),
    question.selection,
  ];
  for (const candidate of candidates) {
    const record = asRecord(candidate);
    const locatorJSON = typeof record?.locatorJSON === 'string' ? record.locatorJSON : undefined;
    if (locatorJSON && locatorJSON.includes('pdf://')) return 'pdf';
  }
  return 'epub';
}

function synthesizeOrphanBook(
  ctx: BuildContext,
  bookId: string,
  rawQuestion: Record<string, unknown>,
  path: string,
): BookIndexEntry {
  const existing = ctx.bookIndex.get(bookId);
  if (existing) return existing;
  const title = nonEmptyString(rawQuestion.bookTitle) ?? `旧书 ${bookId.slice(0, 8)}`;
  const format = deriveFormatFromQuestion(rawQuestion);
  ctx.tables.books.push(makeBookRow(bookId, title, null, format, ctx.now));
  ctx.counters.booksMigrated += 1;
  const state = buildBookState(bookId, title, format, true, null, false, true, rawQuestion);
  ctx.bookStates.push(state);
  pushWarning(
    ctx,
    'orphan-question-book-synthesized',
    path,
    `旧问答引用了不在 library.json 的书 ${bookId}，已补占位书籍行（标题取旧问答）`,
  );
  ctx.counters.orphanQuestionBooks += 1;
  const entry: BookIndexEntry = { bookId, format, state };
  ctx.bookIndex.set(bookId, entry);
  return entry;
}

function mapQuestion(
  ctx: BuildContext,
  raw: unknown,
  index: number,
  allQuestionIds: Set<string>,
): void {
  const path = `questions[${index}]`;
  const record = asRecord(raw);
  if (!record) {
    ctx.counters.questionsFailed += 1;
    pushFailure(ctx, 'invalid-question', path, '问答不是对象', raw);
    return;
  }
  const questionId = nonEmptyString(record.id);
  const bookId = nonEmptyString(record.bookID);
  if (!questionId || !bookId) {
    ctx.counters.questionsFailed += 1;
    pushFailure(ctx, 'invalid-question', path, '问答缺 id/bookID', raw);
    return;
  }
  if (ctx.seenQuestionIds.has(questionId.toLowerCase())) {
    ctx.counters.questionsFailed += 1;
    pushFailure(ctx, 'duplicate-record-id', path, `重复问答 id：${questionId}`, raw);
    return;
  }
  ctx.seenQuestionIds.add(questionId.toLowerCase());

  const conversationId = nonEmptyString(record.conversationID) ?? questionId;
  const entry = ctx.bookIndex.get(bookId) ?? synthesizeOrphanBook(ctx, bookId, record, path);
  const updated = typeof record.updated === 'number' ? appleDateToUnixMs(record.updated) : undefined;
  const timestamp = updated ?? ctx.now;
  if (updated === undefined) {
    pushWarning(ctx, 'question-timestamp-defaulted', path, '问答无有效 updated 时间，使用迁移时间兜底');
  }
  const questionText = typeof record.question === 'string' ? record.question : '';
  const answer = typeof record.answer === 'string' ? record.answer : '';
  const state = typeof record.state === 'string' ? record.state : 'draft';
  const citations = asArray(record.citations) ?? [];
  const selection = asRecord(record.selection);
  if (selection) ctx.unmapped.questionsWithSelection += 1;

  const isDraftWithoutContent =
    state === 'draft' &&
    questionText.trim().length === 0 &&
    answer.trim().length === 0 &&
    citations.length === 0;
  if (isDraftWithoutContent) {
    ctx.counters.draftsSkipped += 1;
    pushWarning(ctx, 'draft-skipped', path, '空草稿不迁移（原始记录保留在 unmapped.draftQuestions）');
    ctx.unmapped.draftQuestions.push({ path, raw: record });
    return;
  }

  const userId = `legacy-q:${questionId}:user`;
  const assistantId = `legacy-q:${questionId}:assistant`;
  if (questionText.length > 0) {
    ctx.tables.messages.push({
      id: userId,
      conversationId,
      role: 'user',
      content: questionText,
      reasoningContent: null,
      toolCallsJson: null,
      toolCallId: null,
      isError: false,
      createdAt: timestamp,
    });
  }
  let assistantMessageId: string | null = null;
  const projectedNativeTurn = projectLegacyNativeTurn(record);
  // A submitted Native run may have stopped before the first answer token. Keep
  // an assistant row on a fresh import so its historical state remains visible.
  if (answer.length > 0 || projectedNativeTurn !== undefined) {
    const agent = asRecord(record.agent);
    const reasoning = typeof agent?.reasoning === 'string' && agent.reasoning.length > 0 ? agent.reasoning : null;
    ctx.tables.messages.push({
      id: assistantId,
      conversationId,
      role: 'assistant',
      content: answer,
      reasoningContent: reasoning,
      toolCallsJson: null,
      toolCallId: null,
      isError: false,
      createdAt: timestamp,
    });
    assistantMessageId = assistantId;
  } else if (state === 'incomplete') {
    pushWarning(ctx, 'incomplete-answer', path, '旧记录回答未完成，无 assistant 消息');
  }

  const history = asArray(record.history) ?? [];
  if (history.length > 0) {
    ctx.unmapped.questionsWithHistory += 1;
    history.forEach((turnRaw, turnIndex) => {
      const turn = asRecord(turnRaw);
      const turnId = turn ? nonEmptyString(turn.id) : undefined;
      if (!turn || !turnId) {
        pushWarning(ctx, 'history-duplicate-skipped', `${path}.history[${turnIndex}]`, '历史轮次缺 id，跳过');
        return;
      }
      if (allQuestionIds.has(turnId.toLowerCase()) || ctx.emittedHistoryIds.has(turnId.toLowerCase())) {
        ctx.counters.historyDuplicatesSkipped += 1;
        pushWarning(
          ctx,
          'history-duplicate-skipped',
          `${path}.history[${turnIndex}]`,
          `历史轮次 ${turnId} 已有独立记录，避免重复`,
        );
        return;
      }
      ctx.emittedHistoryIds.add(turnId.toLowerCase());
      const turnQuestion = typeof turn.question === 'string' ? turn.question : '';
      const turnAnswer = typeof turn.answer === 'string' ? turn.answer : '';
      if (turnQuestion.length > 0) {
        ctx.tables.messages.push({
          id: `legacy-q:${turnId}:user`,
          conversationId,
          role: 'user',
          content: turnQuestion,
          reasoningContent: null,
          toolCallsJson: null,
          toolCallId: null,
          isError: false,
          createdAt: timestamp,
        });
      }
      if (turnAnswer.length > 0) {
        ctx.tables.messages.push({
          id: `legacy-q:${turnId}:assistant`,
          conversationId,
          role: 'assistant',
          content: turnAnswer,
          reasoningContent: null,
          toolCallsJson: null,
          toolCallId: null,
          isError: false,
          createdAt: timestamp,
        });
      }
    });
  }

  const agentRaw = asRecord(record.agent);
  if (agentRaw) {
    ctx.unmapped.agentTranscripts.push({
      questionId,
      raw: agentRaw as NonNullable<LegacyReadingQuestion['agent']>,
    });
    pushWarning(ctx, 'agent-transcript-not-migrated', `${path}.agent`, 'Agent 步骤记录当前 schema 无列，保留在 unmapped.agentTranscripts');
  }

  const extrasKeys = [
    'conversationTitle',
    'selection',
    'selectionParts',
    'evidence',
    'originJSON',
    'freeQuestion',
    'neighbors',
    'notice',
    'failure',
    'retrievalQueries',
    'retrievalNotice',
    'retrievalTrace',
    'searchedChapters',
    'omittedChapters',
    'serviceName',
    'model',
    'format',
    'bookIdentity',
    'bookTitle',
  ] as const;
  const extras: Record<string, unknown> = {};
  for (const key of extrasKeys) {
    if (record[key] !== undefined) extras[key] = record[key];
  }
  if (Object.keys(extras).length > 0) {
    ctx.unmapped.questionExtras.push({ questionId, raw: extras });
    pushWarning(ctx, 'question-extras-not-migrated', path, '旧问答的部分展示字段当前 schema 无列，保留在 unmapped.questionExtras');
  }

  const evidenceIds = ctx.seenEvidenceIds.get(conversationId) ?? new Set<string>();
  ctx.seenEvidenceIds.set(conversationId, evidenceIds);
  citations.forEach((citationRaw, citationIndex) => {
    const citationPath = `${path}.citations[${citationIndex}]`;
    const citation = asRecord(citationRaw);
    if (!citation) {
      ctx.counters.citationsFailed += 1;
      pushFailure(ctx, 'invalid-question', citationPath, '引用不是对象', citationRaw);
      return;
    }
    const quote = typeof citation.quote === 'string' ? citation.quote : '';
    if (quote.trim().length === 0) {
      ctx.counters.citationsFailed += 1;
      pushFailure(ctx, 'citation-missing-quote', citationPath, '引用 quote 为空，无法核对原文', citationRaw);
      return;
    }
    const conversion = convertLegacyLocator(
      citation.locatorJSON,
      undefined,
      entry.pdfPageCount,
      `${citationPath}.locatorJSON`,
    );
    if (!conversion.ok) {
      ctx.counters.citationsFailed += 1;
      pushFailure(ctx, conversion.code, `${citationPath}.locatorJSON`, conversion.message, citationRaw);
      return;
    }
    for (const warning of conversion.warnings) ctx.warnings.push(warning);
    const evidenceRaw = nonEmptyString(citation.id) ?? `E${citationIndex + 1}`;
    if (evidenceIds.has(evidenceRaw)) {
      pushWarning(ctx, 'duplicate-evidence-id', citationPath, `同一会话重复 evidence id：${evidenceRaw}`);
    }
    evidenceIds.add(evidenceRaw);
    const anchorId = `legacy-anchor:citation:${questionId}:${citationIndex}`;
    addAnchor(
      ctx,
      anchorId,
      bookId,
      conversion.anchor,
      quote,
      conversion.chapter,
      conversion.page,
      timestamp,
    );
    ctx.tables.citations.push({
      id: `legacy-cite:${questionId}:${citationIndex}`,
      conversationId,
      messageId: assistantMessageId,
      evidenceId: evidenceRaw,
      quote,
      locatorJson: JSON.stringify(conversion.anchor),
      chapter: conversion.chapter ?? null,
      page: conversion.page ?? null,
      createdAt: timestamp,
    });
    ctx.counters.citationsMigrated += 1;
  });

  ctx.counters.questionsMigrated += 1;
}

function normalizeInput(input: unknown): {
  books: unknown[];
  questions: unknown[];
  recordTimestamps: unknown;
  notesBookGroups: unknown;
  invalid: string | null;
} {
  if (Array.isArray(input)) {
    return { books: input, questions: [], recordTimestamps: undefined, notesBookGroups: undefined, invalid: null };
  }
  const record = asRecord(input);
  if (!record) {
    return { books: [], questions: [], recordTimestamps: undefined, notesBookGroups: undefined, invalid: '输入不是对象或数组' };
  }
  const books = asArray(record.library) ?? asArray(record.books);
  const questions = asArray(record.questions) ?? asArray(record.readingQuestions);
  if (!books) {
    return {
      books: [],
      questions: questions ?? [],
      recordTimestamps: record.recordTimestamps,
      notesBookGroups: record.notesBookGroups,
      invalid: '输入缺 library/books 数组',
    };
  }
  return {
    books,
    questions: questions ?? [],
    recordTimestamps: record.recordTimestamps,
    notesBookGroups: record.notesBookGroups,
    invalid: null,
  };
}

function countCitations(questions: ReadonlyArray<unknown>): number {
  let count = 0;
  for (const question of questions) {
    const record = asRecord(question);
    count += asArray(record?.citations)?.length ?? 0;
  }
  return count;
}

function toStats(
  source: MigrationStats['source'],
  counters: Counters,
): MigrationStats {
  return {
    source,
    migrated: {
      books: counters.booksMigrated,
      anchors: Object.values(counters.anchorsByKind).reduce((sum, value) => sum + value, 0),
      annotations: counters.notesMigrated + counters.bookmarksMigrated,
      messages: 0,
      citations: counters.citationsMigrated,
    },
    failed: {
      books: counters.booksFailed,
      notes: counters.notesFailed,
      bookmarks: counters.bookmarksFailed,
      questions: counters.questionsFailed,
      citations: counters.citationsFailed,
    },
    skipped: {
      drafts: counters.draftsSkipped,
      noteDrafts: counters.noteDraftsSkipped,
      historyDuplicates: counters.historyDuplicatesSkipped,
      orphanQuestionBooks: counters.orphanQuestionBooks,
    },
    timestampFallbacks: {
      books: counters.bookTimestampFallbacks,
      notes: counters.noteTimestampFallbacks,
      bookmarks: counters.bookmarkTimestampFallbacks,
    },
    anchorsByKind: counters.anchorsByKind,
  };
}

/** 迁移入口：纯函数；只读输入，不抛业务异常（输入非对象除外，返回 ok=false 的失败结果）。 */
export function migrateSwiftLibrary(input: unknown, options: MigrationOptions = {}): MigrationResult {
  const now = options.now ?? Date.now();
  const normalized = normalizeInput(input);
  const timestampParsed = parseRecordTimestamps(normalized.recordTimestamps);

  const ctx: BuildContext = {
    now,
    recordTimestamps: timestampParsed.map,
    tables: { books: [], anchors: [], annotations: [], messages: [], citations: [] },
    bookStates: [],
    readingPositions: [],
    settings: [],
    failures: [],
    warnings: [],
    unmapped: {
      noteDrafts: [],
      draftQuestions: [],
      questionExtras: [],
      agentTranscripts: [],
      questionsWithHistory: 0,
      questionsWithSelection: 0,
      ...(normalized.notesBookGroups !== undefined ? { notesBookGroups: normalized.notesBookGroups } : {}),
    },
    counters: {
      booksMigrated: 0,
      notesMigrated: 0,
      bookmarksMigrated: 0,
      questionsMigrated: 0,
      citationsMigrated: 0,
      booksFailed: 0,
      notesFailed: 0,
      bookmarksFailed: 0,
      questionsFailed: 0,
      citationsFailed: 0,
      anchorsByKind: { readium: 0, offset: 0, cfi: 0, pdf: 0 },
      bookTimestampFallbacks: 0,
      noteTimestampFallbacks: 0,
      bookmarkTimestampFallbacks: 0,
      draftsSkipped: 0,
      noteDraftsSkipped: 0,
      historyDuplicatesSkipped: 0,
      orphanQuestionBooks: 0,
    },
    bookIndex: new Map(),
    seenNoteIds: new Set(),
    seenBookmarkIds: new Set(),
    seenQuestionIds: new Set(),
    emittedHistoryIds: new Set(),
    seenEvidenceIds: new Map(),
  };

  for (const invalid of timestampParsed.invalid) {
    pushWarning(ctx, 'invalid-record-timestamp', `recordTimestamps.${invalid.key}`, invalid.reason);
  }
  for (const [key, value] of Object.entries(normalized.notesBookGroups !== undefined ? { notesBookGroups: normalized.notesBookGroups } : {})) {
    if (value !== undefined) pushWarning(ctx, 'ui-state-not-migrated', key, '旧 UI 状态（分组展开/滚动位置）当前 schema 无列，保留在 unmapped');
  }
  if (normalized.invalid) {
    pushFailure(ctx, 'invalid-input', 'input', normalized.invalid, input);
  }

  if (normalized.invalid === null) {
    normalized.books.forEach((book, index) => {
      const record = asRecord(book);
      const sourceNotes = asArray(record?.notes)?.length ?? 0;
      const sourceBookmarks = asArray(record?.bookmarks)?.length ?? 0;
      mapBook(ctx, book, index, sourceNotes, sourceBookmarks);
    });
    const allQuestionIds = new Set(
      normalized.questions
        .map((question) => nonEmptyString(asRecord(question)?.id)?.toLowerCase())
        .filter((id): id is string => id !== undefined),
    );
    normalized.questions.forEach((question, index) => mapQuestion(ctx, question, index, allQuestionIds));
  }

  const source: MigrationStats['source'] = {
    books: normalized.books.length,
    notes: normalized.books.reduce<number>((sum, book) => sum + (asArray(asRecord(book)?.notes)?.length ?? 0), 0),
    bookmarks: normalized.books.reduce<number>((sum, book) => sum + (asArray(asRecord(book)?.bookmarks)?.length ?? 0), 0),
    questions: normalized.questions.length,
    citations: countCitations(normalized.questions),
  };
  const warningCounts: Record<string, number> = {};
  for (const warning of ctx.warnings) warningCounts[warning.code] = (warningCounts[warning.code] ?? 0) + 1;

  const tables: MigrationTables = {
    books: ctx.tables.books,
    anchors: ctx.tables.anchors,
    annotations: ctx.tables.annotations,
    messages: ctx.tables.messages,
    citations: ctx.tables.citations,
  };
  const migratedStats = toStats(source, ctx.counters);
  return {
    schema: 'shudeng.swift-library-migration.v1',
    ok: ctx.failures.length === 0,
    now,
    tables,
    bookStates: ctx.bookStates,
    readingPositions: ctx.readingPositions,
    settings: ctx.settings,
    unmapped: {
      noteDrafts: ctx.unmapped.noteDrafts,
      draftQuestions: ctx.unmapped.draftQuestions,
      questionExtras: ctx.unmapped.questionExtras,
      agentTranscripts: ctx.unmapped.agentTranscripts,
      noteDraftsCount: ctx.unmapped.noteDrafts.length,
      questionsWithHistory: ctx.unmapped.questionsWithHistory,
      questionsWithSelection: ctx.unmapped.questionsWithSelection,
      ...(ctx.unmapped.notesBookGroups !== undefined ? { notesBookGroups: ctx.unmapped.notesBookGroups } : {}),
    },
    failures: ctx.failures,
    warnings: ctx.warnings,
    warningCounts,
    stats: {
      ...migratedStats,
      migrated: {
        ...migratedStats.migrated,
        messages: tables.messages.length,
      },
    },
  };
}
