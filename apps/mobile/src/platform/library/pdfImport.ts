import { PdfOpenError } from '../pdfErrors';

/** PDF import notices follow the native PDFInfo contract; blank pages are not scans. */
export interface PdfImportInfo {
  readonly pageCount: number;
  readonly textPageCount: number;
  readonly blankPageCount?: number;
}

export interface PdfImportConfirmation {
  readonly title: string;
  readonly message: string;
}

/** Only the native inspection port can produce the typed PDF failures. */
export function importFailureNotice(cause: unknown): PdfImportConfirmation {
  if (cause instanceof PdfOpenError) {
    return {
      title: cause.failure === 'password-required' ? '这份 PDF 打不开' : '这个文件读不出来',
      message: cause.message,
    };
  }
  return { title: '导入失败', message: cause instanceof Error ? cause.message : String(cause) };
}

export function pdfImportConfirmation(info: PdfImportInfo): PdfImportConfirmation | null {
  const blankPages = info.blankPageCount ?? 0;
  const scannedPages = Math.max(0, info.pageCount - info.textPageCount - blankPages);
  if (scannedPages === 0) return null;
  const entirelyScanned = info.textPageCount === 0 && blankPages === 0;
  return entirelyScanned
    ? {
        title: '这份 PDF 是扫描版',
        message: '页面上的字是图片，目前还不能选字提问或高亮。阅读、缩放和加书签都可以正常使用。',
      }
    : {
        title: `这份 PDF 有 ${scannedPages} 页是扫描图片`,
        message: '这些页目前还不能选字提问或高亮；其余页面正常。',
      };
}

export interface PdfImportPresentation {
  readonly onShow: () => void;
  readonly onCloseStart: () => void;
  readonly onDismiss: () => void;
}

/** Bound native presentation/dismissal waits; the reader's actual decision has no timer. */
export function requestPdfImportConfirmation(
  info: PdfImportInfo,
  signal: AbortSignal,
  present: (notice: PdfImportConfirmation, decide: (accepted: boolean) => void, presentation: PdfImportPresentation) => void,
  dismiss: () => void,
): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  const notice = pdfImportConfirmation(info);
  if (!notice) return Promise.resolve(true);
  return new Promise<boolean>((resolve, reject) => {
    let settled = false;
    let phase: 'presenting' | 'shown' | 'closing' = 'presenting';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clearWait = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
    const cleanup = () => { clearWait(); signal.removeEventListener('abort', abort); };
    const decide = (accepted: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      dismiss();
      resolve(accepted);
    };
    const abort = () => decide(false);
    const boundNativeWait = () => { clearWait(); timer = setTimeout(() => decide(false), 1000); };
    const presentation: PdfImportPresentation = {
      onShow: () => { if (!settled && phase === 'presenting') { phase = 'shown'; clearWait(); } },
      onCloseStart: () => { if (!settled && phase !== 'closing') { phase = 'closing'; boundNativeWait(); } },
      onDismiss: () => decide(false),
    };
    signal.addEventListener('abort', abort, { once: true });
    boundNativeWait();
    try { present(notice, decide, presentation); }
    catch (error) {
      if (settled) return;
      settled = true;
      cleanup();
      dismiss();
      reject(error);
    }
  });
}
