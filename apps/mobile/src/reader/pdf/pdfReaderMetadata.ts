import type { PdfInspection } from '../../platform/pdfNative';

type PdfPageCounts = Pick<PdfInspection, 'pageCount' | 'textPageCount' | 'blankPageCount'>;

/** Match PDFInfo.isEntirelyScanned: a PDF with blank pages uses the mixed-page copy. */
export function pdfScannedPagesMessage(info: { readonly pageCount: number; readonly textPageCount: number | null; readonly scannedPageCount: number }): string {
  return info.textPageCount === 0 && info.scannedPageCount > 0 && info.scannedPageCount === info.pageCount
    ? '页面上的字是图片，目前还不能选字提问或高亮。阅读、缩放和加书签都可以正常使用。'
    : '这些页目前还不能选字提问或高亮；其余页面正常。';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The original reader uses the inspection saved at import, including an unknown blank count. */
export function resolvePdfReaderPageInfo(bookId: string, inspected: PdfPageCounts, legacyLibrary: unknown) {
  let blankPageCount = inspected.blankPageCount;
  const book = Array.isArray(legacyLibrary)
    ? legacyLibrary.find((entry: unknown) => isRecord(entry) && entry.id === bookId)
    : undefined;
  const legacy = isRecord(book) && isRecord(book.pdfInfo) ? book.pdfInfo : undefined;
  // Check both totals before adopting historical metadata. A missing count in an old
  // inspection means unknown, as in Swift PDFInfo, and must retain its original UI.
  if (legacy?.pageCount === inspected.pageCount && legacy.textPageCount === inspected.textPageCount) {
    const savedBlankCount = legacy.blankPageCount ?? 0;
    if (typeof savedBlankCount === 'number' && Number.isSafeInteger(savedBlankCount)
      && savedBlankCount >= 0 && savedBlankCount <= inspected.pageCount - inspected.textPageCount) {
      blankPageCount = savedBlankCount;
    }
  }
  return {
    textPageCount: inspected.textPageCount,
    scannedPageCount: Math.max(0, inspected.pageCount - inspected.textPageCount - blankPageCount),
  };
}
