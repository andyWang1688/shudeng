import type { ReadiumLocator } from '@shudeng/core/domain';
/** reader-web 消息类型（与 packages/reader-web/src/protocol.ts 对齐的最小集合）。 */

export type ReaderFormat = 'epub' | 'pdf';
export type ReaderContentsItem = { readonly label: string; readonly href: string; readonly depth: number };
export type ReaderSearchResult = { readonly label: string; readonly excerpt: string; readonly locator: string };

/** UI 从 SQLite 恢复的标注种子；ready 后由 WebView 注入 reader:annotation:add。 */
export type ReaderAnnotationSeed = {
  readonly id: string;
  readonly format: ReaderFormat;
  readonly locator: ReaderLocator;
  readonly text?: string;
  readonly note?: string;
  readonly color?: string;
  readonly page?: number;
};

export type ReaderLocator =
  | { readonly type: 'epub'; readonly cfi: string; readonly selection?: ReadiumLocator; readonly href?: string; readonly chapter?: string; readonly fraction?: number; readonly totalProgression?: number; readonly position?: number }
  | { readonly type: 'pdf'; readonly page: number; readonly rects?: readonly PdfRect[]; readonly text?: string };

export type PdfRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type SelectionRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type ReaderBookmarkContext = { readonly requestId: number; readonly locator: ReaderLocator | null; readonly quote: string; readonly visibleIds: readonly string[] };
export type ReaderNavigationCommand = { readonly operationId: string; readonly locator: string; readonly citation: { readonly quote: string; readonly ordinal: number; readonly id: string } | null };
export type ReaderNavigationReceipt = { readonly operationId: string; readonly status: 'arrived' | 'failed'; readonly message?: string; readonly progress?: { readonly fraction: number; readonly chapter?: string; readonly locator: ReaderLocator } };

export type ReaderEvent =
  | { readonly type: 'navigated'; readonly receipt: ReaderNavigationReceipt }
  | { readonly type: 'bookmarkContext'; readonly context: ReaderBookmarkContext }
  | { readonly type: 'ready'; readonly format: ReaderFormat }
  | {
      readonly type: 'selection';
      readonly quote: string;
      readonly locator?: ReaderLocator;
      readonly rects?: readonly SelectionRect[];
      readonly page?: number;
    }
  | { readonly type: 'progress'; readonly percent: number; readonly locator?: ReaderLocator }
  | { readonly type: 'annotationAdded'; readonly locator: ReaderLocator; readonly quote: string }
  | { readonly type: 'selectionCleared' }
  | { readonly type: 'annotationSelected'; readonly annotation: ReaderAnnotationSeed }
  | { readonly type: 'contents'; readonly items: readonly ReaderContentsItem[] }
  | { readonly type: 'searchResults'; readonly requestId: number; readonly items: readonly ReaderSearchResult[]; readonly done: boolean; readonly error?: string }
  | { readonly type: 'error'; readonly message: string };

export type IncomingMessage =
  | { readonly type: 'reader:navigated'; readonly payload: ReaderNavigationReceipt }
  | { readonly type: 'reader:bookmark-context'; readonly payload: ReaderBookmarkContext }
  | { readonly type: 'reader:selectionCleared' }
  | { readonly type: 'reader:ready'; readonly payload: { readonly format: ReaderFormat; readonly title: string; readonly flow?: string } }
  | {
      readonly type: 'reader:selection';
      readonly payload: {
        readonly format: ReaderFormat;
        readonly text: string;
        readonly locator: ReaderLocator;
        readonly rects?: readonly SelectionRect[];
        readonly page?: number;
      };
    }
  | {
      readonly type: 'reader:progress';
      readonly payload: {
        readonly format: ReaderFormat;
        readonly fraction: number;
        readonly locator: ReaderLocator;
      };
    }
  | { readonly type: 'reader:annotation'; readonly payload: unknown }
  | { readonly type: 'reader:annotationSelected'; readonly payload: ReaderAnnotationSeed }
  | { readonly type: 'reader:contents'; readonly payload: { readonly items: readonly ReaderContentsItem[] } }
  | { readonly type: 'reader:searchResults'; readonly payload: { readonly requestId: number; readonly items: readonly ReaderSearchResult[]; readonly done: boolean; readonly error?: string } }
  | { readonly type: 'reader:error'; readonly payload: { readonly message: string } }
  | { readonly type: 'reader:state'; readonly payload: unknown };

export function parseIncomingMessage(raw: string | unknown): IncomingMessage | null {
  try {
    const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (typeof value !== 'object' || value === null) return null;
    const type = (value as { type?: unknown }).type;
    if (typeof type !== 'string' || !type.startsWith('reader:')) return null;
    return value as IncomingMessage;
  } catch {
    return null;
  }
}

/** 把 reader-web 协议事件映射为 ReaderShell 兼容的事件（保留旧壳字段）。 */
export function mapIncomingToReaderEvent(message: IncomingMessage): ReaderEvent | null {
  switch (message.type) {
    case 'reader:navigated': return { type: 'navigated', receipt: message.payload };
    case 'reader:bookmark-context': return { type: 'bookmarkContext', context: message.payload };
    case 'reader:selectionCleared': return { type: 'selectionCleared' };
    case 'reader:ready':
      return { type: 'ready', format: message.payload.format };
    case 'reader:selection':
      return {
        type: 'selection',
        quote: message.payload.text,
        locator: message.payload.locator,
        ...(message.payload.rects ? { rects: message.payload.rects } : {}),
        ...(message.payload.page === undefined ? {} : { page: message.payload.page }),
      };
    case 'reader:progress':
      return {
        type: 'progress',
        percent: clampPercent(message.payload.fraction),
        locator: message.payload.locator,
      };
    case 'reader:error':
      return { type: 'error', message: message.payload.message };
    case 'reader:annotationSelected':
      return { type: 'annotationSelected', annotation: message.payload };
    case 'reader:contents':
      return { type: 'contents', items: message.payload.items };
    case 'reader:searchResults':
      return { type: 'searchResults', ...message.payload };
    default:
      return null;
  }
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function openPayloadForBook(
  bookId: string,
  fixture: { title: string; mimeType: string; base64: string },
  initialLocation?: string,
) {
  const format: ReaderFormat = bookId.toLowerCase().includes('pdf') ? 'pdf' : 'epub';
  return {
    type: 'reader:open' as const,
    payload: {
      format,
      url: `inline://${format}`,
      title: fixture.title,
      dataBase64: fixture.base64,
      mimeType: fixture.mimeType,
      ...(initialLocation ? { initialLocation } : {}),
    },
  };
}
