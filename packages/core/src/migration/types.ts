/**
 * V3 Swift 旧数据迁移：输入/输出类型（纯 TS，无 IO）。
 *
 * 输入是旧 App 目录的若干 JSON 文件内容（只读，不会被修改）：
 * - library.json：`[LegacyBook]`（Book Codable）
 * - reading-questions.json：`[LegacyReadingQuestion]`
 * - record-timestamps.json：`{ "note:<bookID>:<UUID>": ISO8601, "bookmark:..." }`
 * - notes-book-groups.json：UI 展开状态（当前 schema 无对应列，仅告警保留）
 */
import type {
  NewAnchorRow,
  NewAnnotationRow,
  NewBookRow,
  NewCitationRow,
  NewMessageRow,
} from '../db/schema.js';

// ---------- 旧 Swift 模型（Codable JSON 形状） ----------

export interface LegacyReadingSettings {
  scroll?: boolean;
  fontSize?: number;
  dark?: boolean;
  pageCurl?: boolean;
  pdfScroll?: boolean;
}

export interface LegacyPdfInfo {
  pageCount: number;
  textPageCount: number;
  blankPageCount?: number;
}

export interface LegacyPdfNormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LegacyPdfNoteGeometry {
  /** 1-based 页码。 */
  page: number;
  rects: ReadonlyArray<LegacyPdfNormRect>;
}

export interface LegacyBookNote {
  /** UUID 字符串（旧数据大写保留）。 */
  id: string;
  /** Readium Locator JSON 字符串。 */
  locatorJSON: string;
  body?: string;
  color?: string;
  /** PDF 标注几何；EPUB 与旧笔记为 undefined。 */
  pdf?: LegacyPdfNoteGeometry;
}

export interface LegacyBookmark {
  id: string;
  locatorJSON: string;
  title?: string;
  excerpt?: string;
}

export interface LegacyBook {
  /** 书文件 SHA-256（旧 LibraryStore 以内容摘要作 id）。 */
  id: string;
  title: string;
  author?: string;
  /** 旧目录可能没有 format 字段；缺省按 epub 兼容。 */
  format?: string;
  /** 上次阅读位置（Readium Locator JSON）。 */
  locatorJSON?: string | null;
  readingSettings?: LegacyReadingSettings;
  bookmarks?: ReadonlyArray<LegacyBookmark>;
  notes?: ReadonlyArray<LegacyBookNote>;
  noteDrafts?: ReadonlyArray<LegacyBookNote>;
  recordIdentity?: string;
  removal?: string;
  pdfInfo?: LegacyPdfInfo;
}

export interface LegacyQuestionEvidence {
  id?: string;
  locatorJSON: string;
  quote?: string;
  context?: string;
  chapter?: string;
}

export interface LegacyQuestionHistoryTurn {
  id: string;
  question: string;
  answer: string;
  state?: string;
}

export interface LegacyAgentTranscript {
  steps?: ReadonlyArray<unknown>;
  summary?: string;
  reasoning?: string;
  warnings?: ReadonlyArray<string>;
  stepsUsed?: number;
  [key: string]: unknown;
}

export interface LegacyReadingQuestion {
  id: string;
  conversationID?: string;
  turnIndex?: number;
  conversationTitle?: string;
  history?: ReadonlyArray<LegacyQuestionHistoryTurn>;
  bookID: string;
  bookIdentity?: string;
  bookTitle?: string;
  selection?: LegacyQuestionEvidence;
  selectionParts?: ReadonlyArray<LegacyQuestionEvidence>;
  originJSON?: string;
  freeQuestion?: boolean;
  neighbors?: ReadonlyArray<LegacyQuestionEvidence>;
  question?: string;
  state?: string;
  answer?: string;
  evidence?: ReadonlyArray<LegacyQuestionEvidence>;
  citations?: ReadonlyArray<LegacyQuestionEvidence>;
  notice?: string;
  failure?: string;
  agent?: LegacyAgentTranscript;
  searchedChapters?: ReadonlyArray<string>;
  omittedChapters?: ReadonlyArray<string>;
  serviceName?: string;
  model?: string;
  format?: unknown;
  updated?: number;
  retrievalQueries?: ReadonlyArray<string>;
  retrievalNotice?: string;
  [key: string]: unknown;
}

/** migrateSwiftLibrary 接受的输入：旧备份的若干 JSON 文件内容（别名兼容）。 */
export interface SwiftLibraryBackupInput {
  /** library.json 内容（[Book]）。 */
  library?: unknown;
  /** library 的别名。 */
  books?: unknown;
  /** reading-questions.json 内容（[ReadingQuestion]）。 */
  questions?: unknown;
  /** questions 的别名。 */
  readingQuestions?: unknown;
  /** record-timestamps.json 内容（{key: ISO8601}）。 */
  recordTimestamps?: unknown;
  /** notes-book-groups.json（UI 状态，当前不映射）。 */
  notesBookGroups?: unknown;
}

// ---------- 迁移输出 ----------

export type MigrationFailureCode =
  | 'invalid-input'
  | 'invalid-book'
  | 'duplicate-book-id'
  | 'invalid-format'
  | 'invalid-note'
  | 'invalid-bookmark'
  | 'invalid-question'
  | 'invalid-locator-json'
  | 'unsupported-locator'
  | 'invalid-pdf-page'
  | 'orphan-note'
  | 'orphan-bookmark'
  | 'citation-missing-quote'
  | 'duplicate-record-id';

export type MigrationWarningCode =
  | 'format-defaulted-epub'
  | 'source-hash-not-sha256'
  | 'book-timestamp-defaulted'
  | 'note-timestamp-defaulted'
  | 'bookmark-timestamp-defaulted'
  | 'settings-not-persisted'
  | 'agent-transcript-not-migrated'
  | 'question-extras-not-migrated'
  | 'note-drafts-skipped'
  | 'draft-skipped'
  | 'incomplete-answer'
  | 'book-removed'
  | 'book-removal-pending'
  | 'orphan-question-book-synthesized'
  | 'invalid-book-locator'
  | 'invalid-pdf-rect'
  | 'invalid-pdf-geometry'
  | 'pdf-page-mismatch'
  | 'history-duplicate-skipped'
  | 'question-timestamp-defaulted'
  | 'invalid-record-timestamp'
  | 'ui-state-not-migrated'
  | 'unknown-color'
  | 'duplicate-evidence-id';

export interface MigrationFailure {
  readonly code: MigrationFailureCode;
  /** JSON 路径，例：library[2].notes[0]。 */
  readonly path: string;
  readonly message: string;
  /** 无法转换的原始记录/定位，便于人工修复（不写入 DB）。 */
  readonly raw?: unknown;
}

export interface MigrationWarning {
  readonly code: MigrationWarningCode;
  readonly path: string;
  readonly message: string;
}

export type MigrationAnchorsByKind = Record<'readium' | 'offset' | 'cfi' | 'pdf', number>;

export interface MigrationStats {
  readonly source: {
    readonly books: number;
    readonly notes: number;
    readonly bookmarks: number;
    readonly questions: number;
    readonly citations: number;
  };
  readonly migrated: {
    readonly books: number;
    readonly anchors: number;
    readonly annotations: number;
    readonly messages: number;
    readonly citations: number;
  };
  readonly failed: {
    readonly books: number;
    readonly notes: number;
    readonly bookmarks: number;
    readonly questions: number;
    readonly citations: number;
  };
  readonly skipped: {
    readonly drafts: number;
    readonly noteDrafts: number;
    readonly historyDuplicates: number;
    readonly orphanQuestionBooks: number;
  };
  readonly timestampFallbacks: {
    readonly books: number;
    readonly notes: number;
    readonly bookmarks: number;
  };
  readonly anchorsByKind: MigrationAnchorsByKind;
}

/** 每本书的旧元数据（含不可入库字段），供 UI/后续 schema 扩展使用。 */
export interface MigratedBookState {
  readonly bookId: string;
  readonly title: string;
  readonly format: 'epub' | 'pdf';
  /** 旧数据缺 format 时按 epub 兼容。 */
  readonly formatDefaulted: boolean;
  readonly removal: 'removed' | 'removing' | 'deleting' | null;
  /** 文件是否仍可用（removed 后旧 App 会删文件）。 */
  readonly sourceAvailable: boolean;
  /** 旧 LibraryStore 的 recordIdentity（UUID），当前 schema 无列。 */
  readonly recordIdentity?: string;
  /** PDF 导入检查结果，当前 schema 无列。 */
  readonly pdfInfo?: LegacyPdfInfo;
  /** 阅读设置，当前 schema 无列（见 settings 输出与 warning）。 */
  readonly readingSettings?: LegacyReadingSettings;
  /** 旧 catalog 中不存在此书、由旧问答引用补出的占位书。 */
  readonly synthesized: boolean;
}

export interface MigratedReadingPosition {
  readonly bookId: string;
  readonly anchorId: string;
  /** 旧阅读位置原始 locator（已在 anchor.legacy.raw 中保留一份）。 */
  readonly legacyRaw: string;
}

/** 当前 schema 没有 reading settings 列：保留在迁移结果中，不写 DB。 */
export interface PreservedBookSettings {
  readonly bookId: string;
  readonly settings: LegacyReadingSettings;
  readonly persisted: false;
  readonly reason: 'shared-schema-has-no-reading-settings-column';
}

/** schema 无法表达的旧字段（保留原值，供后续版本迁移）。 */
export interface MigrationUnmapped {
  readonly noteDrafts: ReadonlyArray<{ path: string; raw: LegacyBookNote }>;
  readonly draftQuestions: ReadonlyArray<{ path: string; raw: Record<string, unknown> }>;
  readonly questionExtras: ReadonlyArray<{ questionId: string; raw: Record<string, unknown> }>;
  readonly agentTranscripts: ReadonlyArray<{ questionId: string; raw: LegacyAgentTranscript }>;
  readonly noteDraftsCount: number;
  readonly questionsWithHistory: number;
  readonly questionsWithSelection: number;
  readonly notesBookGroups?: unknown;
}

export interface MigrationTables {
  readonly books: ReadonlyArray<NewBookRow>;
  readonly anchors: ReadonlyArray<NewAnchorRow>;
  readonly annotations: ReadonlyArray<NewAnnotationRow>;
  readonly messages: ReadonlyArray<NewMessageRow>;
  readonly citations: ReadonlyArray<NewCitationRow>;
}

export interface MigrationResult {
  readonly schema: 'shudeng.swift-library-migration.v1';
  /** false 表示存在 failures（部分成功，调用方必须展示失败清单）。 */
  readonly ok: boolean;
  readonly now: number;
  readonly tables: MigrationTables;
  readonly bookStates: ReadonlyArray<MigratedBookState>;
  readonly readingPositions: ReadonlyArray<MigratedReadingPosition>;
  readonly settings: ReadonlyArray<PreservedBookSettings>;
  readonly unmapped: MigrationUnmapped;
  readonly failures: ReadonlyArray<MigrationFailure>;
  readonly warnings: ReadonlyArray<MigrationWarning>;
  readonly warningCounts: Readonly<Record<string, number>>;
  readonly stats: MigrationStats;
}

export interface MigrationOptions {
  /** 缺失时间戳时的兜底（Unix 毫秒）；测试传固定值保证确定性。 */
  readonly now?: number;
}
