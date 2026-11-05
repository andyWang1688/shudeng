import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { pdfBookmarkSummary } from './pdfBookmarkSummary.ts';

test('PDF bookmark summary uses the first nonblank line and preserves its internal spacing', () => {
  assert.equal(pdfBookmarkSummary(' \r\n\t\n  价值  投资\t \n第二行'), '价值  投资');
});

test('PDF bookmark summary recognizes all Foundation newline separators and Unicode edge spaces', () => {
  for (const newline of ['\n', '\r', '\r\n', '\v', '\f', '\u0085', '\u2028', '\u2029']) {
    assert.equal(pdfBookmarkSummary(`\u00a0\u3000${newline}\u2002首行\u202f${newline}下一行`), '首行');
  }
  assert.equal(pdfBookmarkSummary('\ufeff首行\ufeff\n下一行'), '\ufeff首行\ufeff');
  assert.equal(pdfBookmarkSummary('\u200B\n\u200B真实首行\u200B\n下一行'), '真实首行');
});

test('PDF bookmark summary limits ordinary text to 160 characters without appending later lines', () => {
  assert.equal(pdfBookmarkSummary('文'.repeat(161) + '\n下一行'), '文'.repeat(160));
  assert.equal(pdfBookmarkSummary('短首行\n' + '文'.repeat(200)), '短首行');
});

test('PDF bookmark summary counts extended graphemes like Swift Character', () => {
  const threeCharacters = '👨‍👩‍👧‍👦e\u0301🇨🇳';
  assert.equal(pdfBookmarkSummary(threeCharacters.repeat(60)), threeCharacters.repeat(53) + '👨‍👩‍👧‍👦');
});

test('PDF scanned and whitespace-only pages retain an empty summary', () => {
  for (const text of ['', ' \t\r\n\u3000\u0085\u00a0', '\n\n']) assert.equal(pdfBookmarkSummary(text), '');
});

const require = createRequire(import.meta.url);
const ts = require('typescript');
const hookFile = fileURLToPath(new URL('./usePdfReader.ts', import.meta.url));
const hookCode = ts.transpileModule(readFileSync(hookFile, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

/** Execute the real hook callback with modeled state and injected platform I/O.
 * This checks page capture, writes and duplicate guards, without claiming device behavior. */
function harness(input: { text?: string; read?: () => Promise<string>; annotations?: any[] } = {}) {
  const slots: any[] = [];
  let cursor = 0;
  let records = [...(input.annotations ?? [])];
  const saved: any[] = [];
  const deleted: string[] = [];
  const reads: Array<{ uri: string; page: number }> = [];
  const failures: string[][] = [];
  const react = {
    useEffect() {},
    useCallback: (callback: any) => callback,
    useRef: (value: any) => { const index = cursor++; return slots[index] ?? (slots[index] = { current: value }); },
    useState: (value: any) => {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof value === 'function' ? value() : value };
      return [slots[index].value, (next: any) => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }];
    },
  };
  const compiled: any = new Module(hookFile);
  compiled.filename = hookFile;
  compiled.require = (id: string) => {
    if (id === 'react') return react;
    if (id === 'react-native') return { Alert: { alert: (...args: string[]) => failures.push(args) } };
    if (id === 'expo-secure-store') return {};
    if (id.endsWith('/ui/appearance')) return { useAppearance: () => ({ resolvedMode: 'light' }) };
    if (id.endsWith('/reader-question/ReaderQuestionProvider')) return { useReaderQuestions: () => ({ ask() {} }) };
    if (id.endsWith('/platform/library')) return {
      saveBookProgress: async () => {},
      loadBookAnnotations: async () => [...records],
      saveReaderAnnotation: async (_bookId: string, value: any) => {
        const record = { ...value, id: 'stable-bookmark-' + (saved.length + 1) };
        records.push(record); saved.push(record);
      },
      deleteReaderAnnotation: async (id: string) => { deleted.push(id); records = records.filter(row => row.id !== id); },
    };
    if (id.endsWith('/library/readerPreferences')) return { loadReaderPreferences: async () => null };
    if (id.endsWith('/library/legacyMigration')) return {};
    if (id.endsWith('/platform/pdfNative')) return {
      readPdfPageText: async (uri: string, page: number) => {
        reads.push({ uri, page });
        return input.read ? input.read() : input.text ?? '  原始 PDF 首行  \n第二行';
      },
    };
    if (id === './pdfReaderMetadata') return {};
    if (id === './pdfBookmarkSummary') return { pdfBookmarkSummary };
    throw new Error('Unexpected hook dependency: ' + id);
  };
  compiled._compile(hookCode, hookFile);
  let reader: any;
  const render = () => {
    cursor = 0;
    reader = compiled.exports.usePdfReader({ bookId: 'pdf-book', title: 'PDF', fileUri: 'file:///local/book.pdf',
      initialPage: 7, initialAnnotations: input.annotations ?? [] });
  };
  render();
  reader.onEvent({ type: 'ready', pageCount: 514, outline: [] });
  render();
  return { get reader() { return reader; }, render, saved, deleted, reads, failures };
}

test('PDF bookmark callback reads only the requested page and preserves the saved id on removal', async () => {
  const h = harness();
  await h.reader.toggleBookmark();
  assert.deepEqual(h.reads, [{ uri: 'file:///local/book.pdf', page: 7 }]);
  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].quote, '原始 PDF 首行');
  assert.deepEqual(h.saved[0].locator, { type: 'pdf', page: 7 });
  h.render();
  await h.reader.toggleBookmark();
  assert.deepEqual(h.deleted, [h.saved[0].id]);
  assert.equal(h.saved.length, 1);
  assert.equal(h.reads.length, 1, 'removing an existing bookmark does not extract text or replace its id');
});

test('PDF bookmark callback saves scanned pages without a fabricated page-number summary', async () => {
  const h = harness({ text: '' });
  await h.reader.toggleBookmark();
  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].quote, '');
  assert.equal(h.saved[0].page, 7);
});

test('PDF bookmark async extraction captures the tapped page and ignores a second in-flight tap', async () => {
  let finish!: (text: string) => void;
  const pending = new Promise<string>(resolve => { finish = resolve; });
  const h = harness({ read: () => pending });
  const save = h.reader.toggleBookmark();
  await h.reader.toggleBookmark();
  h.reader.onEvent({ type: 'page', page: 8, pageCount: 514, pageHasText: true });
  h.render();
  finish('第七页的首行\n第七页第二行');
  await save;
  assert.deepEqual(h.reads, [{ uri: 'file:///local/book.pdf', page: 7 }]);
  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].quote, '第七页的首行');
  assert.deepEqual(h.saved[0].locator, { type: 'pdf', page: 7 });
  assert.equal(h.reader.page, 8);
});

test('PDF bookmark extraction failure writes nothing and releases the save guard for retry', async () => {
  let attempts = 0;
  const h = harness({ read: async () => {
    if (++attempts === 1) throw new Error('PDF file is unavailable');
    return '重试后首行';
  } });
  await h.reader.toggleBookmark();
  assert.equal(h.saved.length, 0);
  assert.deepEqual(h.failures, [['书签保存失败', 'PDF file is unavailable']]);
  await h.reader.toggleBookmark();
  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].quote, '重试后首行');
});
