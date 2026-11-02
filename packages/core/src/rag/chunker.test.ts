import { describe, expect, it } from 'vitest';
import type { RagBook } from './types.js';
import { ParagraphTextChunker } from './chunker.js';

function fixtureBook(): RagBook {
  return {
    book: { id: 'book-1', title: '测试书', format: 'epub', sourceHash: 'hash-1' },
    chapters: [
      {
        ordinal: 1,
        title: '第一章 · 灯',
        paragraphs: ['灯把书页照亮，也把问题留在纸上。', '阅读不是把答案抄下来，而是把原文读慢一点。'],
      },
      {
        ordinal: 2,
        title: '第二章 · 书页',
        page: 12,
        paragraphs: ['书页记录的是作者写下的句子，读者要回到这些句子本身。'],
      },
    ],
  };
}

describe('ParagraphTextChunker（切块/offset/locator）', () => {
  it('chunk 的 [startOffset,endOffset) 能精确 slice 还原原文', () => {
    const book = fixtureBook();
    const chunker = new ParagraphTextChunker();
    const chunks = chunker.chunk(book, { maxChars: 480 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    for (const chunk of chunks) {
      const chapter = book.chapters.find((item) => item.ordinal === chunk.chapterOrdinal);
      expect(chapter).toBeDefined();
      const fullText = chapter?.paragraphs?.join('\n\n') ?? chapter?.text ?? '';
      expect(chunk.text).toBe(fullText.slice(chunk.startOffset, chunk.endOffset));
      expect(chunk.text.trim().length).toBeGreaterThan(0);
      expect(chunk.locator.engine).toBe('rag-chunk-v1');
      expect(chunk.locator.chapter).toBe(chunk.chapter);
      expect(chunk.locator.chapterOrdinal).toBe(chunk.chapterOrdinal);
      expect(chunk.locator.charStart).toBe(chunk.startOffset);
      expect(chunk.locator.charEnd).toBe(chunk.endOffset);
      if (chunk.page !== undefined) expect(chunk.locator.page).toBe(chunk.page);
      expect(JSON.parse(chunk.locatorJson)).toMatchObject({ chapter: chunk.chapter });
    }
    expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(chunks.length);
  });

  it('长段落按 maxChars 切分且不超过上限，offset 连续可覆盖', () => {
    const sentence = '灯把书页照亮，也把问题留在纸上。';
    const longParagraph = sentence.repeat(60);
    const book: RagBook = {
      book: { id: 'book-long', title: '长书', format: 'epub', sourceHash: 'h' },
      chapters: [{ ordinal: 1, title: '长章', paragraphs: [longParagraph] }],
    };
    const chunker = new ParagraphTextChunker();
    const chunks = chunker.chunk(book, { maxChars: 280 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(280);
      expect(longParagraph.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.text);
    }
    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index]!.startOffset).toBeGreaterThanOrEqual(chunks[index - 1]!.endOffset);
    }
    expect(chunks[0]!.startOffset).toBe(0);
    expect(chunks[chunks.length - 1]!.endOffset).toBe(longParagraph.length);
  });

  it('整章文本模式（无 paragraphs）也能切块并记录 offset', () => {
    const book: RagBook = {
      book: { id: 'book-text', title: '整章书', format: 'pdf', sourceHash: 'h' },
      chapters: [
        {
          ordinal: 1,
          title: '第 1 页',
          page: 1,
          text: '灯把书页照亮。'.repeat(40),
        },
      ],
    };
    const chunks = new ParagraphTextChunker().chunk(book, { maxChars: 200 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.locator.paragraphStart).toBeUndefined();
      expect((book.chapters[0]!.text ?? '').slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.text);
      expect(chunk.page).toBe(1);
    }
  });

  it('已取消的信号会中止切块', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => new ParagraphTextChunker().chunk(fixtureBook(), {}, { signal: controller.signal })).toThrow(
      /取消/,
    );
  });
});
