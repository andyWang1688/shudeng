import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Document } from '@langchain/core/documents';
import { createNodeSQLiteDriver, type NodeSQLiteDriver } from '../db/testing/node-sqlite-driver.js';
import { migrate } from '../db/migrations.js';
import { EvidenceRegistry, verifyCitations } from '../agent/evidence.js';
import { InMemoryBookSource } from '../agent/book-source.js';
import { createBookTools } from '../agent/tools.js';
import { ParagraphTextChunker, embeddingChunkOptions } from './chunker.js';
import { SqliteBookSource } from './book-source.js';
import { SqliteSearchIndex } from './search-index.js';
import { BookHybridRetriever } from './retriever.js';
import { indexRagBook } from './index.js';
import type { EmbeddingProvider, RagBook } from './types.js';

const identity = { id: 'reading-context-book', title: '查书', format: 'epub' as const, sourceHash: 'hash-one' };
let driver: NodeSQLiteDriver;
beforeEach(async () => { driver = createNodeSQLiteDriver(); await migrate(driver); });
afterEach(async () => { await driver.close(); });

async function indexed(book: RagBook, maxChars = 120) {
  const index = new SqliteSearchIndex(driver, null);
  const chunks = new ParagraphTextChunker().chunk(book, { maxChars });
  await index.indexBook(book, chunks, []);
  return { index, source: new SqliteBookSource(index, book.book), chunks };
}

describe('Agentic book retrieval contracts', () => {
  it('uses real LangChain Documents and bounded outline pages without combining duplicate chapter titles', async () => {
    const book: RagBook = { book: identity, chapters: [
      { ordinal: 1, title: '同名章', href: 'first.xhtml', text: '阅读需要回到原文，核对文字。' },
      { ordinal: 2, title: '同名章', href: 'second.xhtml', text: '第二章独有的书页。' },
    ] };
    const { index, source } = await indexed(book);
    const docs = await new BookHybridRetriever(index, identity.id).invoke('阅读');
    expect(docs[0]).toBeInstanceOf(Document);
    expect(docs[0]?.metadata).toMatchObject({ bookId: identity.id, chapterOrdinal: 1, sources: ['fts'] });
    expect(docs[0]?.metadata.chunkId).toBeTruthy();
    const first = await source.outline({ limit: 1 });
    expect(first.entries).toHaveLength(1); expect(first.nextCursor).toBeTruthy();
    expect((await source.outline({ limit: 1, cursor: first.nextCursor! })).entries[0]?.reference).toBe('chapter:2');
    expect((await source.chapter('同名章'))?.excerpts.map(item => item.quote).join('')).toBe(book.chapters[0]!.text);
    expect((await source.passage({ reference: 'second.xhtml', before: 0 }))?.excerpts[0]?.quote).toBe(book.chapters[1]!.text);
    expect((await index.chunksForChapter(identity.id, '同名章')).every(chunk => chunk.chapterOrdinal === 1)).toBe(true);
  });

  it('continues at exact UTF-16 positions, including inside an old long chunk, with no lost or repeated original text', async () => {
    const text = '重复句。🪔'.repeat(210) + '全文尾部。';
    const { source } = await indexed({ book: identity, chapters: [{ ordinal: 1, title: '长章', text }] }, 4000);
    let cursor: string | undefined;
    let collected = '';
    const positions: number[] = [];
    do {
      const page = await source.passage({ reference: 'chapter:1', ...(cursor ? { cursor } : {}), before: 0, after: 19, maxChars: 256 });
      expect(page).not.toBeNull();
      expect(page!.excerpts.reduce((sum, excerpt) => sum + excerpt.quote.length, 0)).toBeLessThanOrEqual(256);
      for (const excerpt of page!.excerpts) {
        const locator = JSON.parse(excerpt.locator) as { charStart: number; charEnd: number };
        expect(text.slice(locator.charStart, locator.charEnd)).toBe(excerpt.quote);
        positions.push(locator.charStart); collected += excerpt.quote;
      }
      cursor = page!.nextCursor;
    } while (cursor);
    expect(collected).toBe(text);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('rejects cross-book references, cross-book cursors, stale index versions and cancelled reads', async () => {
    const book: RagBook = { book: identity, chapters: [{ ordinal: 1, title: '一', text: '灯照亮原文。'.repeat(100) }] };
    const { index, source } = await indexed(book);
    const hit = (await source.search('原文', 1))[0]!;
    const page = await source.passage({ reference: hit.readRef!, after: 0, before: 0 });
    const otherBook = { ...identity, id: 'other-book' };
    const other = await indexed({ ...book, book: otherBook });
    await expect(other.source.passage({ reference: hit.readRef! })).rejects.toThrow(/不属于当前书/);
    await expect(other.source.passage({ reference: hit.readRef!, cursor: page!.nextCursor! })).rejects.toThrow(/不属于当前书/);
    await index.indexBook(book, new ParagraphTextChunker().chunk(book), []);
    await expect(source.passage({ reference: hit.readRef! })).rejects.toThrow(/变化|更新|改变/);
    await expect(source.search('原文', 1, { signal: { aborted: true } })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(source.outline({}, { signal: { aborted: true } })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(source.passage({ reference: 'chapter:1' }, { signal: { aborted: true } })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('keeps an emoji-leading chunk for the next page when the current budget has only one UTF-16 unit left', async () => {
    const { source, chunks } = await indexed({ book: identity, chapters: [{ ordinal: 1, title: '分段',
      paragraphs: ['a'.repeat(255), '😀THIS_CONTENT_MUST_NOT_DISAPPEAR', 'END_MARKER'] }] }, 255);
    let page = await source.passage({ reference: 'chapter:1', before: 0, after: 19, maxChars: 256 });
    let text = page!.excerpts.map(excerpt => excerpt.quote).join('');
    while (page?.nextCursor) {
      page = await source.passage({ reference: 'chapter:1', cursor: page.nextCursor, before: 0, after: 19, maxChars: 256 });
      expect(page).not.toBeNull(); text += page!.excerpts.map(excerpt => excerpt.quote).join('');
    }
    expect(text).toBe(chunks.map(chunk => chunk.text).join(''));
    expect(text).toContain('😀THIS_CONTENT_MUST_NOT_DISAPPEAR');
    expect(text).toContain('END_MARKER');
  });

  it('prioritizes a selected tail inside a long chunk and preserves its exact position through continuation and locator reads', async () => {
    const selected = 'SELECTED_UNIQUE_TEXT';
    const target = 'a'.repeat(1000) + selected + '😀尾部'.repeat(180);
    const { source, chunks } = await indexed({ book: identity, chapters: [{ ordinal: 1, title: '长章', href: 'long.xhtml',
      paragraphs: ['前置段落。'.repeat(200), target] }] }, 4000);
    expect(chunks).toHaveLength(1);
    const reference = JSON.stringify({ type: 'epub', href: 'long.xhtml', text: { highlight: selected } });
    for (const before of [0, 1]) {
      let passage = await source.passage({ reference, before, after: 0, maxChars: 256 });
      expect(passage?.locationPrecision).toBe('exact');
      expect(passage!.excerpts[0]!.quote).toContain(selected);
      const expectedStart = chunks[0]!.text.indexOf(selected);
      const locator = JSON.parse(passage!.excerpts[0]!.locator);
      expect(locator.charStart).toBe(expectedStart);
      const locatedAgain = await source.passage({ reference: passage!.excerpts[0]!.locator, before: 0, after: 0, maxChars: 256 });
      expect(locatedAgain!.excerpts[0]!.quote).toBe(passage!.excerpts[0]!.quote);
      let collected = passage!.excerpts.map(item => item.quote).join('');
      while (passage?.nextCursor) {
        passage = await source.passage({ reference, cursor: passage.nextCursor, before: 0, after: 0, maxChars: 256 });
        expect(passage).not.toBeNull(); collected += passage!.excerpts.map(item => item.quote).join('');
      }
      expect(collected).toBe(chunks[0]!.text.slice(expectedStart));
    }
    // A separate oversized preceding source must not spend the selected source's budget.
    const separated = await indexed({ book: identity, chapters: [{ ordinal: 1, title: '分段', href: 'separate.xhtml',
      paragraphs: ['前置段落。'.repeat(400), selected + '当前段落。'] }] }, 2000);
    expect(separated.chunks.length).toBeGreaterThan(1);
    const page = await separated.source.passage({ reference: JSON.stringify({ href: 'separate.xhtml', text: { highlight: selected } }), before: 1, maxChars: 256 });
    expect(page!.excerpts[0]!.quote).toContain(selected);
  });

  it('recalls a natural Chinese question through FTS when no semantic model is installed', async () => {
    const { index } = await indexed({ book: identity, chapters: [
      { ordinal: 1, title: '阅读', text: '阅读需要回到原文，反复核对上下文与证据。' },
      { ordinal: 2, title: '景色', text: '山川河流构成了一幅画。' },
    ] });
    const hits = await index.search('为什么作者认为阅读需要回到原文？', { bookId: identity.id, mode: 'fts' });
    expect(hits[0]?.chunk.chapterOrdinal).toBe(1);
    expect(hits.some(hit => hit.chunk.chapterOrdinal === 2)).toBe(false);
  });

  it('resolves actual RN/Readium/PDF positions and disambiguates repeated highlights with neighboring original text', async () => {
    const first = '前文甲。重复选文。后文甲。';
    const second = '前文乙。重复选文。后文乙。';
    const { source } = await indexed({ book: identity, chapters: [
      { ordinal: 1, title: '一', href: 'first.xhtml', paragraphs: [first, '分隔。'.repeat(30), second] },
      { ordinal: 2, title: '二', href: 'second.xhtml', text: '其他章节' },
    ] }, 80);
    const chapterOnly = await source.passage({ reference: JSON.stringify({ type: 'epub', href: 'first.xhtml' }), before: 0, after: 0 });
    expect(chapterOnly?.locationPrecision).toBe('chapter');
    expect(chapterOnly?.excerpts[0]?.quote).toContain(first);
    const selected = JSON.stringify({ type: 'epub', cfi: 'epubcfi(/6/2)', href: 'first.xhtml',
      selection: { href: 'first.xhtml', locations: { progression: .8, domRange: { start: { charOffset: 1 }, end: { charOffset: 5 } } },
        text: { before: '前文乙。', highlight: '重复选文。', after: '后文乙。' } } });
    const located = await source.passage({ reference: selected, before: 0, after: 0 });
    expect(located?.locationPrecision).toBe('exact');
    expect(located?.excerpts[0]?.quote).toContain(second);
    expect(JSON.parse(located!.excerpts[0]!.locator).charStart).toBeGreaterThan(first.length);
    await expect(source.passage({ reference: JSON.stringify({ href: 'first.xhtml', text: { highlight: '重复选文。' } }) })).rejects.toThrow(/多次出现/);
    await expect(source.passage({ reference: JSON.stringify({ type: 'epub', cfi: 'epubcfi(/6/2)' }) })).rejects.toThrow(/只有 CFI/);
    await expect(source.passage({ reference: JSON.stringify({ href: 'first.xhtml', bookId: 'other' }) })).rejects.toThrow(/不属于当前书/);
    const pdfIdentity = { ...identity, id: 'pdf-context', format: 'pdf' as const };
    const pdf = await indexed({ book: pdfIdentity, chapters: [{ ordinal: 12, title: '第12页', page: 12, text: 'PDF 所选页原文。' }] });
    expect((await pdf.source.passage({ reference: JSON.stringify({ type: 'pdf', page: 12 }) }))?.excerpts[0]?.quote).toContain('PDF 所选页原文');
    expect((await pdf.source.passage({ reference: JSON.stringify({ href: 'pdf://page/12', locations: { page: 12 } }) }))?.page).toBe(12);
  });

  it('enforces actual tokenizer budgets both while indexing and embedding long queries, without trimming any indexed original', async () => {
    const embedded: string[] = [];
    const provider: EmbeddingProvider = { modelId: 'token-budget-test', dimension: 2, maxInputTokens: 16,
      countTokens: value => [...value].length * 2 + 2,
      async embed(texts) {
        for (const value of texts) { expect(this.countTokens!(value)).toBeLessThanOrEqual(16); embedded.push(value); }
        return texts.map(() => new Float32Array([1, 0]));
      } };
    const text = '。🪔相同原文反复出现。'.repeat(30);
    const book: RagBook = { book: identity, chapters: [{ ordinal: 1, title: 'token', text }] };
    const index = new SqliteSearchIndex(driver, provider);
    const result = await indexRagBook({ book, index, embedding: provider, chunker: new ParagraphTextChunker() });
    expect(result.chunks.map(chunk => chunk.text).join('')).toBe(text);
    expect(result.chunks.length).toBeGreaterThan(5);
    for (const chunk of result.chunks) expect(text.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.text);
    const query = '请按照原文说明这个情节的前因后果';
    const before = embedded.length;
    await index.search(query, { bookId: identity.id, mode: 'vector' });
    expect(embedded.slice(before).join('')).toBe(query);
    expect(embeddingChunkOptions(provider).maxTokens).toBe(16);
  });

  it('exposes all five book tools and never validates a citation from an invisible quote tail', async () => {
    const source = new InMemoryBookSource({ book: identity, chapters: [{ title: '一', paragraphs: ['开始。' + '原文'.repeat(600) + '不可见尾部。'] }] });
    const registry = new EvidenceRegistry();
    const tools = createBookTools(source, registry);
    expect(tools.map(item => item.name)).toEqual(['search_book', 'read_page', 'read_chapter', 'get_book_outline', 'read_book_passage']);
    const content = await tools[0]!.invoke({ query: '原文' });
    expect(String(content)).toContain('readRef');
    expect(String(content)).not.toContain('不可见尾部');
    expect(registry.get('E1')!.quote.length).toBeLessThanOrEqual(900);
    expect(verifyCitations({ answer: '伪造', citations: [{ id: 'E1', quote: '不可见尾部' }] }, registry).citations).toEqual([]);
    const cancelled = createBookTools(source, new EvidenceRegistry(), { signal: { aborted: true } });
    await expect(cancelled[0]!.invoke({ query: '原文' })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
