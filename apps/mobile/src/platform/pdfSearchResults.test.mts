import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { collectPdfSearch, pdfSearchFragmentRanges, pdfSearchSnippet, trimPdfSearchQuery, type PdfSearchMatch, type PdfTextRange } from './pdfSearchResults.ts';

const match = (offset: number, length: number): PdfSearchMatch => ({ offset, length, rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }] });

test('PDF search retains original newlines and clips the window to 35 before and 55 after', () => {
  const text = '前'.repeat(40) + '\n价值投资\n' + '后'.repeat(70);
  const range = { offset: 41, length: 4 };
  assert.equal(pdfSearchSnippet(text, { offset: 0, length: text.length }, range), '前'.repeat(34) + '\n价值投资\n' + '后'.repeat(54));
});

test('PDF fragments trim only their outer edges and preserve intermediate blank lines', () => {
  const text = '\u200B\r\n  首行 \r\n\r\n\t次行\u00a0\n ';
  const ranges = pdfSearchFragmentRanges(text);
  assert.equal(ranges.length, 1);
  assert.equal(text.slice(ranges[0]!.offset, ranges[0]!.offset + ranges[0]!.length), '首行 \r\n\r\n\t次行');
});

test('PDF fragments aggregate whole lines up to 360 UTF-16 units', () => {
  const text = '一'.repeat(200) + '\n' + '二'.repeat(159) + '\n' + '三'.repeat(5);
  assert.deepEqual(pdfSearchFragmentRanges(text), [{ offset: 0, length: 360 }, { offset: 361, length: 5 }]);
});

test('PDF long lines split at composed boundaries and can exceed 360 to keep one grapheme', () => {
  const text = 'a'.repeat(359) + '👨‍👩‍👧‍👦' + 'b'.repeat(3);
  assert.deepEqual(pdfSearchFragmentRanges(text), [{ offset: 0, length: 370 }, { offset: 370, length: 3 }]);
});

test('PDF source line enumeration follows NSString lines rather than splitting VT/FF', () => {
  const text = '一'.repeat(180) + '\v' + '二'.repeat(180) + '\f' + '三';
  assert.deepEqual(pdfSearchFragmentRanges(text), [{ offset: 0, length: 360 }, { offset: 360, length: 3 }]);
  for (const newline of ['\n', '\r', '\r\n', '\u0085', '\u2028', '\u2029']) {
    const source = '一'.repeat(200) + newline + '二'.repeat(200);
    assert.deepEqual(pdfSearchFragmentRanges(source), [{ offset: 0, length: 200 }, { offset: 200 + newline.length, length: 200 }]);
  }
});

test('PDF snippets are clipped to their fragment and keep whole graphemes at both edges', () => {
  const text = 'not this fragment\n' + '👨‍👩‍👧‍👦' + '前'.repeat(30) + '词' + '后'.repeat(54) + 'e\u0301' + 'outside';
  const fragment = { offset: 18, length: text.length - 18 };
  assert.equal(pdfSearchSnippet(text, fragment, { offset: 59, length: 1 }), '👨‍👩‍👧‍👦' + '前'.repeat(30) + '词' + '后'.repeat(54) + 'e\u0301');
  assert.equal(pdfSearchSnippet('先前片段首行\n当前价值投资\n后续片段', { offset: 7, length: 7 }, { offset: 9, length: 4 }), '当前价值投资\n');
});

test('PDF whitespace-only pages are empty and query trim preserves BOM while removing zero-width space', () => {
  assert.deepEqual(pdfSearchFragmentRanges('\u200B\r\n\u3000\t\n'), []);
  assert.equal(trimPdfSearchQuery('\u200B\n  价值投资 \u200B'), '价值投资');
  assert.equal(trimPdfSearchQuery('\ufeff价值投资\ufeff'), '\ufeff价值投资\ufeff');
  assert.deepEqual(pdfSearchFragmentRanges('\ufeff'), [{ offset: 0, length: 1 }]);
});

test('PDF search reads only hit pages once and returns every bounded occurrence in page order', async () => {
  const reads: number[] = [];
  const scans: Array<{ page: number; bounds: readonly PdfTextRange[] }> = [];
  const hits = await collectPdfSearch({
    isCurrent: () => true,
    readPage: async page => { reads.push(page); return '价值投资\n原文'; },
    searchPage: async (page, bounds) => {
      scans.push({ page, bounds });
      return { pageCount: 3, cancelled: false, matches: page === 2 ? [] : [match(0, 4)] };
    },
  });
  assert.deepEqual(reads, [1, 3]);
  assert.deepEqual(scans.map(scan => [scan.page, scan.bounds.length]), [[1, 0], [1, 1], [2, 0], [3, 0], [3, 1]]);
  assert.deepEqual(hits.map(hit => [hit.page, hit.text]), [[1, '价值投资\n原文'], [3, '价值投资\n原文']]);
  assert.deepEqual(hits[0]!.rects, match(0, 4).rects);
});

test('PDF bounded matching retains the overlapping occurrence at a fragment boundary', async () => {
  const text = 'a'.repeat(362);
  const hits = await collectPdfSearch({
    isCurrent: () => true, readPage: async () => text,
    searchPage: async (_page, bounds) => {
      if (!bounds.length) return { pageCount: 1, cancelled: false, matches: [match(0, 3)] };
      assert.deepEqual(bounds, [{ offset: 0, length: 360 }, { offset: 360, length: 2 }]);
      // The platform scans each explicit fragment independently, not the whole page.
      return { pageCount: 1, cancelled: false, matches: [match(358, 2), match(360, 2)] };
    },
  });
  assert.equal(hits.length, 2);
  assert.equal(hits[1]!.text, 'aa');
});

test('PDF search returns more than 200 real results instead of silently truncating', async () => {
  const text = 'x '.repeat(250);
  const hits = await collectPdfSearch({
    isCurrent: () => true, readPage: async () => text,
    searchPage: async (_page, bounds) => ({ pageCount: 1, cancelled: false,
      matches: !bounds.length ? [match(0, 1)] : Array.from({ length: 250 }, (_, index) => match(index * 2, 1)) }),
  });
  assert.equal(hits.length, 250);
});

test('PDF search cancellation at each await discards partial results and stops further I/O', async () => {
  for (const stop of ['probe', 'read', 'bounded']) {
    let active = true;
    const calls: string[] = [];
    const hits = await collectPdfSearch({
      isCurrent: () => active,
      readPage: async () => { calls.push('read'); if (stop === 'read') active = false; return '价值投资'; },
      searchPage: async (_page, bounds) => {
        const phase = bounds.length ? 'bounded' : 'probe';
        calls.push(phase); if (stop === phase) active = false;
        return { pageCount: 2, cancelled: false, matches: [match(0, 4)] };
      },
    });
    assert.deepEqual(hits, []);
    assert.deepEqual(calls, stop === 'probe' ? ['probe'] : stop === 'read' ? ['probe', 'read'] : ['probe', 'read', 'bounded']);
  }
});

test('native cancellation stops PDF search even when the JS operation is still current', async () => {
  const hits = await collectPdfSearch({ isCurrent: () => true, readPage: async () => { throw new Error('must not read'); },
    searchPage: async () => ({ pageCount: 5, cancelled: true, matches: [] }) });
  assert.deepEqual(hits, []);
});

const require = createRequire(import.meta.url);
const ts = require('typescript');
const nativeFile = fileURLToPath(new URL('./pdfNative.ts', import.meta.url));
const nativeCode = ts.transpileModule(readFileSync(nativeFile, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function port(native: any) {
  const compiled: any = new Module(nativeFile); compiled.filename = nativeFile;
  compiled.require = (id: string) => {
    if (id === 'expo') return { requireOptionalNativeModule: () => native };
    if (id === './pdfSearchResults') return { collectPdfSearch, trimPdfSearchQuery };
    throw new Error(id);
  };
  compiled._compile(nativeCode, nativeFile);
  return compiled.exports;
}

test('the PDF port passes Foundation-trimmed queries and exact UTF-16 range bounds to native I/O', async () => {
  let token = 0;
  const calls: any[] = [];
  const api = port({ cancelPdfSearch: () => ++token, readPdfPageText: async () => '价值投资',
    searchPdfPage: async (...args: any[]) => { calls.push(args); return { pageCount: 1, cancelled: false, matches: [match(0, 4)] }; } });
  await api.searchPdf('file:///book.pdf', '\u200B 价值投资 \u200B');
  assert.deepEqual(calls, [['file:///book.pdf', '价值投资', 1, 1, []], ['file:///book.pdf', '价值投资', 1, 1, [0, 4]]]);
});

test('a newer PDF query prevents late results from the old query reappearing', async () => {
  let complete!: (value: any) => void;
  let token = 0;
  const old = new Promise(resolve => { complete = resolve; });
  const api = port({ cancelPdfSearch: () => ++token, readPdfPageText: async () => '新词',
    searchPdfPage: async (_uri: string, query: string) => query === '旧词' ? old : { pageCount: 1, cancelled: false, matches: [match(0, 2)] } });
  const first = api.searchPdf('file:///book.pdf', '旧词');
  const second = await api.searchPdf('file:///book.pdf', '新词');
  complete({ pageCount: 1, cancelled: false, matches: [match(0, 2)] });
  assert.deepEqual(await first, []);
  assert.equal(second[0].text, '新词');
});

test('cancelled PDF reads do not surface late I/O errors; active read errors still reject', async () => {
  let fail!: (error: Error) => void;
  let didRead!: () => void;
  const started = new Promise<void>(resolve => { didRead = resolve; });
  const reading = new Promise<string>((_resolve, reject) => { fail = reject; });
  const api = port({ cancelPdfSearch: () => 1, readPdfPageText: () => { didRead(); return reading; },
    searchPdfPage: async () => ({ pageCount: 1, cancelled: false, matches: [match(0, 2)] }) });
  const pending = api.searchPdf('file:///book.pdf', '旧词');
  await started; api.cancelPdfSearch(); fail(new Error('source disappeared'));
  assert.deepEqual(await pending, []);
  await assert.rejects(api.searchPdf('file:///book.pdf', '新词'), /source disappeared/);
});
