import type { ShelfAnnotation } from "../../platform/library";
export function annotationOrder(
  a: ShelfAnnotation,
  b: ShelfAnnotation,
): number {
  if ((a.locator === null) !== (b.locator === null))
    return a.locator === null ? 1 : -1;
  if (a.locator?.type === "pdf" && b.locator?.type === "pdf") {
    const page = a.locator.page - b.locator.page;
    if (page) return page;
  }
  if (a.locator !== null && b.locator !== null && a.position !== b.position) {
    if (a.position === undefined) return 1;
    if (b.position === undefined) return -1;
    return a.position - b.position;
  }
  const progress =
    (a.locator === null ? 1 : (a.progression ?? a.localProgression ?? 0)) -
    (b.locator === null ? 1 : (b.progression ?? b.localProgression ?? 0));
  if (progress) return progress;
  const position =
    (a.locator === null ? 0 : (a.position ?? 0)) -
    (b.locator === null ? 0 : (b.position ?? 0));
  return position || a.id.localeCompare(b.id);
}
export function annotationChapter(
  annotation: ShelfAnnotation,
  format: "EPUB" | "PDF",
): string {
  const page =
    annotation.page ??
    (annotation.locator?.type === "pdf"
      ? annotation.locator.page
      : annotation.position);
  if (format === "PDF" && page !== undefined && page !== null)
    return `第 ${page} 页`;
  return annotation.chapter || "阅读位置";
}
export function bookAnnotationExport(
  title: string,
  format: "EPUB" | "PDF",
  annotations: readonly ShelfAnnotation[],
): string {
  return (
    `《${title}》\n\n` +
    annotations
      .filter((annotation) => annotation.kind !== "bookmark")
      .sort(annotationOrder)
      .map((annotation) =>
        [
          annotationChapter(annotation, format),
          annotation.quote ? `原文：${annotation.quote}` : null,
          annotation.body ? `想法：${annotation.body}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      )
      .join("\n\n") +
    "\n"
  );
}
