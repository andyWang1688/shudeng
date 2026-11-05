import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDocumentText, quoteDocumentText, rangeAtIndexedOffset } from '../src/epub-indexed-range.ts';
import { mappingDocument } from './epub-test-dom.mjs';

globalThis.Node ??= { TEXT_NODE: 3, CDATA_SECTION_NODE: 4, ELEMENT_NODE: 1 };
globalThis.NodeFilter ??= { SHOW_TEXT: 4 };

function textDocument(value) {
  const doc = mappingDocument('<p>x</p>'), node = doc.body.firstChild.firstChild;
  node.data = node.nodeValue = value; // Preserve CR/form-feed rather than XML newline folding.
  return { doc, node };
}
function expectPoint(mapped, index, node, offset) {
  const actual = mapped.pointAt(index);
  assert.equal(actual?.node ?? null, node);
  assert.equal(actual?.offset ?? null, offset);
}

test('normalization keeps the precise first whitespace/newline endpoints across four passes', () => {
  const { doc, node } = textDocument('  A\t \rB \n  C\n\n\n\nD  ');
  const mapped = indexedDocumentText(doc);
  assert.equal(mapped.text, 'A B\nC\n\nD');
  const offsets = [2, 3, 6, 8, 11, 12, 13, 16];
  offsets.forEach((offset, index) => expectPoint(mapped, index, node, offset));
  assert.equal(mapped.spans.length, 5);
  assert.equal('points' in mapped, false);
});

test('synthetic paragraph separators have null endpoints but a range may cross them', () => {
  const doc = mappingDocument('<p>A</p><p>B</p>'), mapped = indexedDocumentText(doc);
  const first = doc.body.firstChild.firstChild, last = doc.body.lastChild.firstChild;
  assert.equal(mapped.text, 'A\n\nB');
  expectPoint(mapped, 0, first, 0); expectPoint(mapped, 3, last, 0);
  for (const index of [-1, 1, 2, 4, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) expectPoint(mapped, index, null, null);
  assert.equal(mapped.spans.length, 2);
  assert.equal(rangeAtIndexedOffset(doc, 0, 2, 'A\n'), null);
  assert.equal(rangeAtIndexedOffset(doc, 1, 4, '\n\nB'), null);
  const range = rangeAtIndexedOffset(doc, 0, 4, 'A\n\nB');
  assert.equal(range.startContainer, first); assert.equal(range.startOffset, 0);
  assert.equal(range.endContainer, last); assert.equal(range.endOffset, 1);
});

test('UTF16 half-surrogates remain separately addressable and DOM failures return null', () => {
  const { doc, node } = textDocument('A😀B');
  for (const [start, end, quote] of [[1, 2, '\ud83d'], [2, 3, '\ude00'], [1, 3, '😀']]) {
    const range = rangeAtIndexedOffset(doc, start, end, quote);
    assert.equal(range.startContainer, node); assert.equal(range.startOffset, start);
    assert.equal(range.endContainer, node); assert.equal(range.endOffset, end);
  }
  assert.equal(rangeAtIndexedOffset(doc, 0, 9, 'A😀B'), null);
  assert.equal(rangeAtIndexedOffset(doc, 1, 3, 'wrong'), null);
  doc.createRange = () => { throw new Error('detached range'); };
  assert.equal(rangeAtIndexedOffset(doc, 1, 3, '😀'), null);
});

test('ingestion omission and case sensitivity remain distinct from quote text', () => {
  const doc = mappingDocument('<nav>nav</nav><p hidden="false">hid</p><p aria-hidden="true">aria</p><p aria-hidden="TRUE">upper</p><SCRIPT>UPPER</SCRIPT><script>lower</script><style>style</style><noscript>no</noscript><p><![CDATA[cdata]]>Text</p>');
  const indexed = indexedDocumentText(doc), quoted = quoteDocumentText(doc, doc.body);
  assert.equal(indexed.text, 'upper\n\ncdataText');
  assert.equal(quoted.text, 'navhidariaupperUPPERText');
  assert.equal(quoteDocumentText(doc, doc.body.firstChild.firstChild).text, '', 'TreeWalker nextNode excludes its Text root');
});

test('quote folding retains combining marks and UTF16 offsets while removing only JS whitespace', () => {
  const { doc, node } = textDocument(' \t😀\u00a0e\u0301 \n\u0085');
  const mapped = quoteDocumentText(doc, doc.body);
  assert.equal(mapped.text, '😀é\u0085');
  [2, 3, 5, 6, 9].forEach((offset, index) => expectPoint(mapped, index, node, offset));
  assert.equal(mapped.spans.length, 3);
  expectPoint(mapped, mapped.text.length, null, null);
});

test('ordinary single spaces and newlines preserve one linear interval at scale', () => {
  const { doc, node } = textDocument('x y\nz '.repeat(16_384) + 'tail');
  const mapped = indexedDocumentText(doc);
  assert.equal(mapped.spans.length, 1);
  assert.deepEqual(mapped.spans[0], { start: 0, end: node.data.length, node, offset: 0 });
  for (const index of [0, 1, 3, 8191, mapped.text.length - 1]) expectPoint(mapped, index, node, index);
  const empty = indexedDocumentText(mappingDocument('<p> \t\n </p>'));
  assert.equal(empty.text, ''); assert.equal(empty.spans.length, 0); expectPoint(empty, 0, null, null);
});

