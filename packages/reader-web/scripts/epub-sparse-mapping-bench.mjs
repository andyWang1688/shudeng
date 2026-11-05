import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { indexedDocumentText, quoteDocumentText } from '../src/epub-indexed-range.ts';
import { epubDocumentText, parseEpubXml } from '../../core/src/rag/epub-xml.ts';
import { mappingDocumentAdapter } from './epub-test-dom.mjs';

globalThis.Node ??= { TEXT_NODE: 3, CDATA_SECTION_NODE: 4, ELEMENT_NODE: 1 };
globalThis.NodeFilter ??= { SHOW_TEXT: 4 };
if (!globalThis.gc) throw new Error('Run with --expose-gc for retained-heap measurements.');
const [fixturePath, outputPath] = process.argv.slice(2);
if (!fixturePath || !outputPath) throw new Error('Pass existing fixture EPUB path and output JSON path. No old point mapper is imported.');
const sha = value => createHash('sha256').update(value).digest('hex');
const fixture = readFileSync(fixturePath);
assert.equal(sha(fixture), '2786a4a681dfe21d0686b53bb79a54db2e86c9f4ff6b2fbada728b88480a287a');
const chapter = execFileSync('/usr/bin/unzip', ['-p', fixturePath, 'EPUB/chapter.xhtml'], { maxBuffer: 32 * 1024 * 1024 });
assert.equal(chapter.length, 24 * 1024 * 1024);
assert.equal(sha(chapter), 'a5a3998e952ccbb8ac1b86d570f00308cf040e0f616ee63dc8c62d3b3cbadb95');
const source = chapter.toString('utf8'), parseStart = performance.now();
const doc = mappingDocumentAdapter(parseEpubXml(source, 'EPUB/chapter.xhtml', true));
const parseMilliseconds = performance.now() - parseStart;
let textNodes = 0, textUnits = 0;
const stack = [doc.documentElement];
while (stack.length) {
  const node = stack.pop();
  if (node.nodeType === 3 || node.nodeType === 4) { textNodes++; textUnits += (node.nodeValue ?? '').length; }
  for (const child of Array.from(node.childNodes ?? [])) stack.push(child);
}
const measure = run => {
  globalThis.gc(); const before = process.memoryUsage(), start = performance.now();
  const value = run(), milliseconds = performance.now() - start;
  globalThis.gc(); const after = process.memoryUsage();
  return { value, milliseconds, heapBefore: before.heapUsed, heapAfter: after.heapUsed, retainedHeapDelta: after.heapUsed - before.heapUsed, rssAfter: after.rss };
};
const indexed = measure(() => indexedDocumentText(doc));
const expected = epubDocumentText(doc); // String-only ingestion rule, never the old point mapper.
assert.equal(indexed.value.text, expected);
// The fixture generator's "normalizedVisibleText" uses textContent + one space,
// whereas production ingestion retains two newlines at paragraph boundaries.
const fixtureVisibleTextUTF8Bytes = Buffer.byteLength(doc.body.textContent.replace(/\s+/g, ' ').trim());
assert.equal(fixtureVisibleTextUTF8Bytes, 24_642_723);
assert.equal('points' in indexed.value, false);
const lookupStart = performance.now();
for (const marker of ['PARITYGIANTSTART24MZQJH', 'PARITYGIANTMIDDLE24MZQJH', 'PARITYGIANTTAIL24MZQJH']) {
  const at = indexed.value.text.indexOf(marker);
  assert(at >= 0); assert.equal(indexed.value.text.indexOf(marker, at + 1), -1);
  const first = indexed.value.pointAt(at), last = indexed.value.pointAt(at + marker.length - 1);
  assert(first); assert(last); assert.equal(first.node, last.node);
  assert.equal(first.node.data.slice(first.offset, last.offset + 1), marker);
}
let nullEndpoints = 0;
for (let check = 0; check < 100_000; check++) {
  const at = (Math.imul(check, 104729) >>> 0) % indexed.value.text.length;
  const point = indexed.value.pointAt(at);
  if (point) assert.equal(point.node.data[point.offset], indexed.value.text[at]);
  else nullEndpoints++;
}
const lookupMilliseconds = performance.now() - lookupStart;
const quoted = measure(() => quoteDocumentText(doc, doc.body));
assert.equal('points' in quoted.value, false);
for (const marker of ['PARITYGIANTSTART24MZQJH', 'PARITYGIANTMIDDLE24MZQJH', 'PARITYGIANTTAIL24MZQJH']) {
  const at = quoted.value.text.indexOf(marker), first = quoted.value.pointAt(at), last = quoted.value.pointAt(at + marker.length - 1);
  assert(first); assert(last); assert.equal(first.node, last.node);
  assert.equal(first.node.data.slice(first.offset, last.offset + 1), marker);
}
const summary = measured => ({ textUTF16Units: measured.value.text.length, intervals: measured.value.spans.length, utf16UnitsPerInterval: measured.value.text.length / measured.value.spans.length, milliseconds: measured.milliseconds, heapBefore: measured.heapBefore, heapAfter: measured.heapAfter, retainedHeapDelta: measured.retainedHeapDelta, rssAfter: measured.rssAfter, fixedWidthEquivalentPayloadBytes: measured.value.spans.length * (3 * 8 + 8 + 8) });
const result = {
  measuredAtUTC: new Date().toISOString(), nodeVersion: process.version,
  fixture: { path: resolve(fixturePath), sha256: sha(fixture), chapterBytes: chapter.length, chapterSHA256: sha(chapter), parseMilliseconds, textNodes, rawTextUTF16Units: textUnits, fixtureVisibleTextUTF8Bytes, fixtureVisibleNormalization: 'body.textContent.replace(/\\s+/g, space).trim(); generator L104; not the ingestion paragraph contract' },
  indexed: { ...summary(indexed), ingestionStringEqual: true, normalizedUTF8Bytes: Buffer.byteLength(indexed.value.text), normalizedSHA256: sha(indexed.value.text), sampledLookups: 100_000, sampledNullEndpoints: nullEndpoints, lookupMilliseconds },
  quote: summary(quoted), maxRSSKiB: process.resourceUsage().maxRSS,
  boundaries: [
    'Only the sparse mapper runs on this giant fixture. Neither the old point mapper nor a per-character expected array is imported or executed.',
    'Host Node/xmldom retained-heap delta includes mapped string and intervals; it is not a strict upper bound or a WebKit/Hermes device measurement. RSS includes ZIP input, DOM, test adapters and both result strings.',
    'Each interval owns exactly three numeric scalars and one Text reference plus its array slot. fixedWidthEquivalentPayloadBytes uses 8-byte scalars/references, excludes JS object/array headers and allocator overhead, and is not claimed as actual allocation size.',
    'Indexed interval count is bounded by input Text/CDATA node count plus discontinuities introduced by changed normalization matches; unchanged single spaces/newlines do not add intervals. Binary pointAt is O(log interval count). Worst-case alternating changed whitespace can still require O(text length) intervals.',
    'Quote whitespace deletion can create one interval per non-whitespace run in a node; it does not apply ingestion omit rules. This measures source mapping only, not layout, CFI, gestures or rendering.'
  ]
};
writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));

