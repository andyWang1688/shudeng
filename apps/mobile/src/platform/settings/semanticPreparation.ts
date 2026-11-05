import { getLocalBookIndexStatus, rebuildBookIndex } from "../ai/bookIndex";
import { loadShelfBooks } from "../library";

export interface SemanticPreparationState {
  readonly running: boolean;
  readonly completed: number;
  readonly total: number;
  readonly failed: number;
  readonly cancelled: boolean;
  readonly detail: string;
}
let state: SemanticPreparationState = {
  running: false,
  completed: 0,
  total: 0,
  failed: 0,
  cancelled: false,
  detail: "",
};
const listeners = new Set<(value: SemanticPreparationState) => void>();
let task: { controller: AbortController; promise: Promise<void> } | null = null;
function publish(value: SemanticPreparationState) {
  state = value;
  for (const listener of listeners) listener(state);
}
export function observeSemanticPreparation(
  listener: (value: SemanticPreparationState) => void,
): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

/** Model installation starts a bounded serial job; leaving settings does not discard preparation. */
export function prepareExistingBooks(): void {
  if (task) return;
  const controller = new AbortController();
  const promise = (async () => {
    publish({
      running: true,
      completed: 0,
      total: 0,
      failed: 0,
      cancelled: false,
      detail: "正在读取待准备书籍…",
    });
    try {
      const books = await loadShelfBooks();
      publish({ ...state, total: books.length });
      for (const book of books) {
        if (controller.signal.aborted) break;
        publish({ ...state, detail: "正在准备 " + book.title });
        try {
          const current = await getLocalBookIndexStatus(book.id);
          if (!current.semantic) {
            const result = await rebuildBookIndex(book.id, {
              signal: controller.signal,
            });
            if (result.available && !result.semantic)
              publish({
                ...state,
                failed: state.failed + 1,
                detail: result.detail,
              });
          }
        } catch (error) {
          if (!controller.signal.aborted)
            publish({
              ...state,
              failed: state.failed + 1,
              detail: error instanceof Error ? error.message : String(error),
            });
        }
        if (!controller.signal.aborted)
          publish({ ...state, completed: state.completed + 1 });
      }
      publish({
        ...state,
        running: false,
        cancelled: controller.signal.aborted,
        detail: controller.signal.aborted
          ? "已取消准备，已完成的内容会保留。"
          : state.failed
            ? state.failed + " 本书准备失败，可点按重试。"
            : "书内语义查找已就绪。",
      });
    } catch (error) {
      publish({
        ...state,
        running: false,
        failed: state.failed + 1,
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      task = null;
    }
  })();
  task = { controller, promise };
}
export async function cancelSemanticPreparation(): Promise<void> {
  const pending = task;
  pending?.controller.abort();
  await pending?.promise;
}
