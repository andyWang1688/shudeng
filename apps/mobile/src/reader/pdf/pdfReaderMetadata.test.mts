import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pdfScannedPagesMessage, resolvePdfReaderPageInfo } from './pdfReaderMetadata.ts';

const inspected = { pageCount: 514, textPageCount: 509, blankPageCount: 5 };
const bookId = 'migrated-pdf';

test('a migrated PDF retains the original help entry when its saved blank count is unknown', () => {
  const library = [{ id: bookId, pdfInfo: { pageCount: 514, textPageCount: 509 } }];
  assert.deepEqual(resolvePdfReaderPageInfo(bookId, inspected, library), {
    textPageCount: 509, scannedPageCount: 5,
  });
});

test('a saved blank count keeps true blank pages out of scanned pages', () => {
  const library = [{ id: bookId, pdfInfo: inspected }];
  assert.equal(resolvePdfReaderPageInfo(bookId, inspected, library).scannedPageCount, 0);
});

test('a new import uses the current inspection instead of unrelated legacy metadata', () => {
  const library = [{ id: 'another-book', pdfInfo: { pageCount: 514, textPageCount: 509 } }];
  assert.equal(resolvePdfReaderPageInfo(bookId, inspected, library).scannedPageCount, 0);
  assert.equal(resolvePdfReaderPageInfo(bookId, inspected, undefined).scannedPageCount, 0);
});

test('changed page totals or text totals prevent adopting historical inspection', () => {
  for (const pdfInfo of [{ pageCount: 515, textPageCount: 509 }, { pageCount: 514, textPageCount: 508 }]) {
    assert.equal(resolvePdfReaderPageInfo(bookId, inspected, [{ id: bookId, pdfInfo }]).scannedPageCount, 0);
  }
});

test('invalid historical blank counts fall back to the current inspection', () => {
  for (const blankPageCount of [-1, 6, 1.5, '5']) {
    const library = [{ id: bookId, pdfInfo: { ...inspected, blankPageCount } }];
    assert.equal(resolvePdfReaderPageInfo(bookId, inspected, library).scannedPageCount, 0);
  }
});

test('PDF help uses the original entirely scanned copy only when no text or blank pages exist', () => {
  const allScanned = '页面上的字是图片，目前还不能选字提问或高亮。阅读、缩放和加书签都可以正常使用。';
  const mixed = '这些页目前还不能选字提问或高亮；其余页面正常。';
  assert.equal(pdfScannedPagesMessage({ pageCount: 4, textPageCount: 0, scannedPageCount: 4 }), allScanned);
  assert.equal(pdfScannedPagesMessage({ pageCount: 4, textPageCount: 1, scannedPageCount: 3 }), mixed);
  assert.equal(pdfScannedPagesMessage({ pageCount: 4, textPageCount: 0, scannedPageCount: 3 }), mixed);
  assert.equal(pdfScannedPagesMessage({ pageCount: 0, textPageCount: null, scannedPageCount: 0 }), mixed);
});
