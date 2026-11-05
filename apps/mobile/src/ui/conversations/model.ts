import type { ConversationSummary, ShelfBookRecord } from '../../platform/library';
import type { ConversationRuntimeRecord } from '../chat/conversationRuntime';

export type ConversationItem = ConversationSummary & { readonly searchText?: string; readonly unsaved?: boolean };
export type ConversationSection = {
  readonly bookId: string;
  readonly book: ShelfBookRecord | null;
  readonly title: string;
  readonly count: number;
  readonly collapsed: boolean;
  readonly data: ConversationItem[];
};

export function conversationTitle(item: ConversationItem): string {
  return item.title ?? (item.question ? Array.from(item.question).slice(0, 48).join('') : '未填写的问题');
}

export function initialCollapsed(items: readonly ConversationItem[], saved: unknown): Record<string, boolean> {
  const hasSnapshot = saved !== null && typeof saved === 'object' && !Array.isArray(saved);
  const snapshot = hasSnapshot ? Object.fromEntries(Object.entries(saved).filter(
    (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
  )) : {};
  const latest = [...items].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.bookId;
  for (const item of items) snapshot[item.bookId] ??= hasSnapshot || item.bookId !== latest;
  return snapshot;
}

export function mergeRuntimeConversations(items: readonly ConversationItem[], runtime: readonly ConversationRuntimeRecord[]): readonly ConversationItem[] {
  const merged = new Map(items.map(item => [item.conversationId, item]));
  for (const record of runtime) {
    const saved = merged.get(record.conversationId);
    const additionalTurn = !saved?.assistantIds?.includes(record.turn.id);
    merged.set(record.conversationId, {
      ...saved, conversationId: record.conversationId, bookId: saved?.bookId ?? record.bookId,
      bookTitle: saved?.bookTitle ?? record.bookTitle,
      question: saved?.question ?? record.turn.sourceQuestion ?? '', answer: record.turn.text,
      turns: (saved?.turns ?? 0) + (additionalTurn ? 2 : 0),
      submittedCount: (saved?.submittedCount ?? Math.ceil((saved?.turns ?? 0) / 2)) + (additionalTurn ? 1 : 0),
      updatedAt: Math.max(saved?.updatedAt ?? 0, record.updatedAt), unsaved: !saved || Boolean(record.turn.saveError),
    });
  }
  return [...merged.values()];
}

/** Native scope: title, first question, latest answer and the original book title. */
export function conversationSections(
  items: readonly ConversationItem[], books: readonly ShelfBookRecord[], query: string,
  collapsed: Readonly<Record<string, boolean>>,
): ConversationSection[] {
  const bookById = new Map(books.map(book => [book.id, book]));
  const needle = query.trim().toLocaleLowerCase();
  const grouped = new Map<string, ConversationItem[]>();
  for (const item of [...items].sort((a, b) => b.updatedAt - a.updatedAt || a.conversationId.localeCompare(b.conversationId))) {
    const bookTitle = item.bookTitle ?? bookById.get(item.bookId)?.title ?? '';
    if (needle && ![conversationTitle(item), item.question, item.answer, bookTitle].join('\n').toLocaleLowerCase().includes(needle)) continue;
    const group = grouped.get(item.bookId) ?? [];
    group.push(item); grouped.set(item.bookId, group);
  }
  return [...grouped].map(([bookId, entries]) => {
    const record = bookById.get(bookId);
    const isCollapsed = !needle && (collapsed[bookId] ?? true);
    return { bookId, book: record && !record.removed ? record : null,
      title: entries[0]!.bookTitle ?? record?.title ?? '书内问答', count: entries.length,
      collapsed: isCollapsed, data: isCollapsed ? [] : entries };
  });
}
