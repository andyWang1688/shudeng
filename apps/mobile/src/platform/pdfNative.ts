import { requireOptionalNativeModule } from 'expo';
import { normalizePdfOpenError } from './pdfErrors';
import { collectPdfSearch, trimPdfSearchQuery, type PdfSearchHit, type PdfSearchPage } from './pdfSearchResults';
export type { PdfSearchHit } from './pdfSearchResults';
export { trimPdfSearchQuery } from './pdfSearchResults';

export type PdfOutlineItem = { readonly title: string; readonly page: number; readonly depth: number };
export type PdfInspection = {
  readonly pageCount: number;
  readonly title: string | null;
  readonly author: string | null;
  readonly textPageCount: number;
  readonly blankPageCount: number;
  readonly outline: readonly PdfOutlineItem[];
};
type PdfNativeModule = {
  inspectPdf(uri: string, requestID?: string): Promise<PdfInspection>;
  beginPdfInspection(): string;
  cancelPdfInspection(requestID: string): void;
  readPdfPageText(uri: string, page: number): Promise<string>;
  searchPdfPage(uri: string, query: string, token: number, page: number, bounds: readonly number[]): Promise<PdfSearchPage>;
  cancelPdfSearch(): number;
  releasePdf(uri: string): Promise<void>;
  renderPdfThumbnail(uri: string, destinationUri: string): Promise<string>;
  getLegacyHighlightColor(): string | null;
};

function pdfModule(): PdfNativeModule {
  const module = requireOptionalNativeModule<PdfNativeModule>('ShudengPdf');
  if (!module) throw new Error('当前版本无法读取 PDF，请安装完整版本后重试');
  return module;
}

/** Native PDFKit reads local file URLs on a serial background queue, without base64 copies. */
export async function inspectPdf(uri: string): Promise<PdfInspection> {
  try { return await pdfModule().inspectPdf(uri); }
  catch (cause) { throw normalizePdfOpenError(cause) ?? cause; }
}

/** One reader-owned inspection; cancellation never affects another URI consumer. */
export function startPdfInspection(uri: string): { readonly promise: Promise<PdfInspection>; cancel(): void } {
  let cancel = () => {};
  const promise = (async () => {
    const module = pdfModule();
    const requestID = module.beginPdfInspection();
    cancel = () => module.cancelPdfInspection(requestID);
    try { return await module.inspectPdf(uri, requestID); }
    catch (cause) { throw normalizePdfOpenError(cause) ?? cause; }
    finally { cancel(); }
  })();
  return { promise, cancel: () => cancel() };
}

export async function readPdfPageText(uri: string, page: number): Promise<string> {
  if (!Number.isSafeInteger(page) || page < 1) return Promise.reject(new Error('PDF 页码无效'));
  return pdfModule().readPdfPageText(uri, page);
}

export async function searchPdf(uri: string, query: string): Promise<readonly PdfSearchHit[]> {
  const module = pdfModule();
  const operation = ++searchSequence;
  const token = module.cancelPdfSearch();
  const text = trimPdfSearchQuery(query);
  if (!text) return [];
  try {
    return await collectPdfSearch({
      searchPage: (page, bounds) => module.searchPdfPage(uri, text, token, page, bounds.flatMap(range => [range.offset, range.length])),
      readPage: (page) => module.readPdfPageText(uri, page),
      isCurrent: () => operation === searchSequence,
    });
  } catch (cause) {
    if (operation !== searchSequence) return [];
    throw cause;
  }
}

let searchSequence = 0;
export function cancelPdfSearch(): void {
  searchSequence += 1;
  requireOptionalNativeModule<PdfNativeModule>('ShudengPdf')?.cancelPdfSearch();
}

export async function releasePdf(uri: string): Promise<void> {
  return pdfModule().releasePdf(uri);
}

/** First-page PNG, at most 400 by 600 pixels, written atomically to a local file URL. */
export async function renderPdfThumbnail(uri: string, destinationUri: string): Promise<string> {
  return pdfModule().renderPdfThumbnail(uri, destinationUri);
}

/** A migration source only; new reader preferences remain owned by TypeScript. */
export function getLegacyHighlightColor(): string | null {
  return requireOptionalNativeModule<PdfNativeModule>('ShudengPdf')?.getLegacyHighlightColor() ?? null;
}
