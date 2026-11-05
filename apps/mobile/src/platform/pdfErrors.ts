/** Stable codes belong to the native PDF inspection port, never to arbitrary error text. */
export type PdfOpenFailure = 'password-required' | 'invalid-document';

export class PdfOpenError extends Error {
  constructor(readonly failure: PdfOpenFailure, cause: unknown) {
    super(failure === 'password-required'
      ? '这个文件需要密码才能打开，目前还不能导入。'
      : '文件可能已损坏，未能加入书架。', { cause });
    this.name = 'PdfOpenError';
  }
}

export function normalizePdfOpenError(cause: unknown): PdfOpenError | null {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return null;
  switch (cause.code) {
    case 'ERR_SHUDENG_PDF_PASSWORD_REQUIRED': return new PdfOpenError('password-required', cause);
    case 'ERR_SHUDENG_PDF_INVALID_DOCUMENT': return new PdfOpenError('invalid-document', cause);
    default: return null;
  }
}
