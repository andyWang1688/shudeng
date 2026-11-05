import type { ReadiumLocator } from '@shudeng/core/domain';
/** 书库数据层公开类型：旧 Swift 数据迁移、书架、进度、标注、导入与对话摘要。 */

export type BookFormat = 'EPUB' | 'PDF';

export type ShelfBookRecord = {
  readonly id: string;
  readonly title: string;
  readonly author: string | null;
  readonly format: BookFormat;
  readonly sourceHash: string;
  readonly progressPercent: number | null;
  readonly progressPage: number | null;
  readonly progressLabel: string;
  readonly progressChapter: string | null;
  readonly progressUpdatedAt: number | null;
  readonly removed?: boolean;
  readonly coverUri?: string;
};

export type StoredPdfRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type StoredReaderLocator =
  | { readonly type: 'epub'; readonly cfi: string; readonly selection?: ReadiumLocator; readonly href?: string; readonly chapter?: string; readonly totalProgression?: number; readonly position?: number }
  | {
      readonly type: 'pdf';
      readonly page: number;
      readonly rects?: ReadonlyArray<StoredPdfRect>;
      readonly text?: string;
    };

export type BookProgress = {
  readonly bookId: string;
  readonly percent: number;
  readonly locator: StoredReaderLocator;
  readonly page: number | null;
  readonly chapter: string | null;
  readonly updatedAt: number;
};

export type ShelfAnnotationKind = 'highlight' | 'note' | 'bookmark';

export type ShelfAnnotation = {
  readonly id: string;
  readonly anchorId: string;
  readonly kind: ShelfAnnotationKind;
  readonly color: string | null;
  readonly body: string | null;
  readonly quote: string;
  readonly chapter: string | null;
  readonly page: number | null;
  readonly createdAt: number;
  readonly progression?: number;
  /** Chapter-local Readium fallback, kept separate from whole-book progression. */
  readonly localProgression?: number;
  readonly position?: number;
  readonly locator: StoredReaderLocator | null;
};

export type SaveReaderAnnotationInput = {
  readonly kind: ShelfAnnotationKind;
  readonly color?: string | null;
  readonly body?: string | null;
  readonly quote?: string;
  readonly format: BookFormat;
  readonly locator: StoredReaderLocator;
  readonly chapter?: string | null;
  readonly page?: number | null;
};

export type ImportBookResult =
  | { readonly status: 'cancelled' }
  | { readonly status: 'imported'; readonly book: ShelfBookRecord; readonly isDuplicate: boolean };

export type ConversationSummary = {
  readonly conversationId: string;
  readonly bookId: string;
  readonly question: string;
  readonly answer: string;
  readonly turns: number;
  readonly updatedAt: number;
  /** Original first-turn snapshot, when retained in legacy data or turn details. */
  readonly bookTitle?: string;
  readonly title?: string;
  readonly submittedCount?: number;
  readonly assistantIds?: readonly string[];
};
