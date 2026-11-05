import { describe, expect, it } from 'vitest';
import { isAnchorV3 } from '../domain/anchor.js';
import { migrateSwiftLibrary } from './swift-library.js';
import type { MigrationResult } from './types.js';

const EPUB_ID = 'a'.repeat(64);
const PDF_ID = 'b'.repeat(64);
const REMOVED_ID = 'c'.repeat(64);
const ORPHAN_ID = 'd'.repeat(64);
const NOW = 1_800_000_000_000;
const ISO_NOTE = '2026-10-28T05:38:09Z';

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) value.forEach(deepFreeze);
  else if (typeof value === 'object' && value !== null) Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function readiumLocator(href = 'OEBPS/chapter1.xhtml', title = '第一章 · 灯'): string {
  return JSON.stringify({
    href,
    type: 'application/xhtml+xml',
    title,
    locations: {
      cssSelector: '#p1',
      domRange: {
        start: { charOffset: 0, cssSelector: '#p1', textNodeIndex: 0 },
        end: { charOffset: 36, cssSelector: '#p1', textNodeIndex: 0 },
      },
      position: 18,
      progression: 0.18,
      totalProgression: 0.12,
    },
    text: { highlight: '灯把书页照亮，也把问题留在纸上。' },
  });
}

function pdfLocator(page = 12): string {
  return JSON.stringify({
    href: `pdf://page/${page}`,
    type: 'application/pdf',
    title: `第 ${page} 页`,
    locations: { fragments: [`page=${page}`], page, position: page, progression: 0.06, totalProgression: 0.06 },
    text: { highlight: '价值投资是唯一的路' },
  });
}

function epubBook() {
  return {
    id: EPUB_ID,
    title: '测试 EPUB',
    author: '作者甲',
    // format 缺省 → epub（旧 Codable 兼容）
    locatorJSON: readiumLocator(),
    readingSettings: { fontSize: 110, dark: true, scroll: true },
    recordIdentity: '6BACDF4F-5CE8-4C0E-A3BE-EBD2EF95038C',
    notes: [
      {
        id: 'C7A61C49-17B1-4229-9627-6DC52FB3BC18',
        locatorJSON: readiumLocator(),
        body: '',
      },
      {
        id: 'CE14ABF9-E4F3-46B1-959C-E5EB3E27A213',
        locatorJSON: readiumLocator('OEBPS/chapter2.xhtml', '第二章 · 书页'),
        body: '这里是一条笔记。',
        color: 'rose',
      },
    ],
    bookmarks: [
      {
        id: '31971580-37BE-4B71-B723-13F7F795BB34',
        locatorJSON: JSON.stringify({
          href: 'OEBPS/chapter3.xhtml',
          title: '第三章 · 林黛玉进贾府',
          locations: { position: 9, progression: 0.4 },
          text: { highlight: '黛玉方进入房时' },
        }),
        title: '第三章 · 林黛玉进贾府',
        excerpt: '黛玉方进入房时',
      },
    ],
  };
}

function migrationInput(): {
  library: unknown[];
  questions: unknown[];
  recordTimestamps: Record<string, string>;
  notesBookGroups: unknown;
} {
  return {
    library: [
      epubBook(),
      {
        id: PDF_ID,
        title: '测试 PDF',
        author: '作者乙',
        format: 'pdf',
        pdfInfo: { pageCount: 514, textPageCount: 509 },
        locatorJSON: pdfLocator(12),
        notes: [
          {
            id: '7C743BCC-2677-4263-B0C1-FFEF676D8613',
            locatorJSON: pdfLocator(12),
            body: 'PDF 笔记',
            color: 'blue',
            pdf: {
              page: 12,
              rects: [
                { x: 0.1, y: 0.2, w: 0.3, h: 0.04 },
                { x: 2, y: 0.2, w: 0.3, h: 0.04 },
              ],
            },
          },
        ],
        bookmarks: [
          {
            id: 'B0C1FFEF-676D-4263-B0C1-FFEF676D8613',
            locatorJSON: pdfLocator(12),
            title: '第 12 页',
            excerpt: '价值投资',
          },
        ],
      },
      {
        id: REMOVED_ID,
        title: '已移除的书',
        author: '作者丙',
        removal: 'removed',
        notes: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            locatorJSON: readiumLocator(),
            body: '移除后仍保留的笔记',
          },
        ],
        bookmarks: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            locatorJSON: readiumLocator(),
            title: '移除后仍保留的书签',
          },
        ],
      },
    ],
    questions: [],
    recordTimestamps: {
      [`note:${PDF_ID}:7C743BCC-2677-4263-B0C1-FFEF676D8613`]: ISO_NOTE,
      [`note:${EPUB_ID}:CE14ABF9-E4F3-46B1-959C-E5EB3E27A213`]: ISO_NOTE,
    },
    notesBookGroups: { expanded: { [EPUB_ID]: true }, offsetY: 0 },
  };
}

function questionFixture(): unknown[] {
  const apple = (updated: number) => updated;
  const selection = {
    id: '',
    locatorJSON: readiumLocator(),
    quote: '灯把书页照亮',
    context: '灯把书页照亮，也把问题留在纸上。',
    chapter: '第一章 · 灯',
  };
  return [
    {
      id: 'B305A2A1-4BF2-4C8C-990A-CB07A46F7895',
      conversationID: 'B305A2A1-4BF2-4C8C-990A-CB07A46F7895',
      conversationTitle: '这句话里的灯指什么？',
      turnIndex: 0,
      bookID: EPUB_ID,
      bookIdentity: '6BACDF4F-5CE8-4C0E-A3BE-EBD2EF95038C',
      bookTitle: '测试 EPUB',
      question: '这句话里的灯指什么？',
      answer: '灯指阅读时的照明，也指理解难句的提示。',
      state: 'complete',
      updated: apple(815024254.375372),
      selection,
      evidence: [selection],
      citations: [
        { id: 'E1', locatorJSON: readiumLocator(), quote: '灯把书页照亮', context: '灯把书页照亮…', chapter: '第一章 · 灯' },
        { id: 'E2', locatorJSON: pdfLocator(12), quote: '价值投资是唯一的路', context: '价值投资…', chapter: '第 12 页' },
      ],
      agent: {
        steps: [],
        summary: '查书 2 步',
        reasoning: '先查书，再作答。',
        warnings: [],
        stepsUsed: 2,
      },
      notice: '可能漏掉相关依据',
      history: [
        { id: 'U0-HISTORY-4BF2-4C8C-990A-CB07A46F7895', question: '历史问题', answer: '历史答案', state: 'complete' },
        { id: 'U2-INCOMPLETE-4BF2-4C8C-990A-CB07A46F7895', question: '重复的历史轮次', answer: '', state: 'incomplete' },
      ],
    },
    {
      id: 'U2-INCOMPLETE-4BF2-4C8C-990A-CB07A46F7895',
      conversationID: 'B305A2A1-4BF2-4C8C-990A-CB07A46F7895',
      turnIndex: 1,
      bookID: EPUB_ID,
      bookTitle: '测试 EPUB',
      question: '未完成的问题',
      answer: '',
      state: 'incomplete',
      updated: apple(815024355),
    },
    {
      id: 'DRAFT-EMPTY-4BF2-4C8C-990A-CB07A46F7895',
      bookID: EPUB_ID,
      question: '',
      answer: '',
      state: 'draft',
      updated: apple(815024356),
    },
    {
      id: 'ORPHAN-Q-4BF2-4C8C-990A-CB07A46F7895',
      conversationID: 'ORPHAN-Q-4BF2-4C8C-990A-CB07A46F7895',
      bookID: ORPHAN_ID,
      bookTitle: '已删除但仍有问答的书',
      question: '孤儿书里的引用还在吗？',
      answer: '引用保留。',
      state: 'complete',
      updated: apple(815024357),
      citations: [{ id: 'E1', locatorJSON: pdfLocator(7), quote: '价值投资是唯一的路', chapter: '第 7 页' }],
    },
  ];
}

function expectNoFailures(result: MigrationResult): void {
  expect(result.failures.map((failure) => `${failure.code}:${failure.path}`)).toEqual([]);
  expect(result.ok).toBe(true);
}

describe('migrateSwiftLibrary：EPUB / PDF / 移除书', () => {
  it('EPUB：format 缺省按 epub、notes/bookmarks → anchor+annotation、settings 保留、时间戳映射', () => {
    const input = migrationInput();
    const frozen = deepFreeze(JSON.parse(JSON.stringify(input)) as typeof input);
    const before = JSON.stringify(frozen);
    const result = migrateSwiftLibrary(frozen, { now: NOW });

    expectNoFailures(result);
    expect(JSON.stringify(frozen)).toBe(before); // 输入未被修改

    expect(result.tables.books).toHaveLength(3);
    const epubRow = result.tables.books.find((book) => book.id === EPUB_ID)!;
    expect(epubRow).toMatchObject({ title: '测试 EPUB', author: '作者甲', format: 'epub', sourceHash: EPUB_ID, importedAt: NOW, updatedAt: NOW });

    const epubState = result.bookStates.find((state) => state.bookId === EPUB_ID)!;
    expect(epubState.formatDefaulted).toBe(true);
    expect(epubState.readingSettings).toEqual({ fontSize: 110, dark: true, scroll: true });
    expect(epubState.recordIdentity).toBe('6BACDF4F-5CE8-4C0E-A3BE-EBD2EF95038C');

    expect(result.settings).toEqual([
      {
        bookId: EPUB_ID,
        settings: { fontSize: 110, dark: true, scroll: true },
        persisted: false,
        reason: 'shared-schema-has-no-reading-settings-column',
      },
    ]);
    expect(result.warningCounts['format-defaulted-epub']).toBe(2); // EPUB 书 + 移除书都缺 format
    expect(result.warningCounts['settings-not-persisted']).toBe(1);

    const notes = result.tables.annotations.filter(
      (annotation) => annotation.bookId === EPUB_ID && annotation.kind !== 'bookmark',
    );
    expect(notes.map((annotation) => annotation.kind).sort()).toEqual(['highlight', 'note']);
    const highlight = notes.find((annotation) => annotation.kind === 'highlight')!;
    expect(highlight).toMatchObject({ color: 'yellow', body: null });
    const note = notes.find((annotation) => annotation.kind === 'note')!;
    expect(note).toMatchObject({ color: 'rose', body: '这里是一条笔记。' });

    // EPUB 3（2 notes + 1 bookmark）+ PDF 2 + 移除书 2 = 7
    expect(result.tables.annotations).toHaveLength(7);
    const bookmark = result.tables.annotations.find((annotation) => annotation.kind === 'bookmark' && annotation.bookId === EPUB_ID)!;
    expect(bookmark.color).toBeNull();

    // anchors: 阅读位置 2（EPUB/PDF）+ notes 4 + bookmarks 3 = 9
    expect(result.tables.anchors).toHaveLength(9);
    const noteAnchor = result.tables.anchors.find((anchor) => anchor.id === 'legacy-anchor:note:C7A61C49-17B1-4229-9627-6DC52FB3BC18')!;
    expect(noteAnchor.anchorVersion).toBe(3);
    expect(noteAnchor.engine).toBe('offset');
    const parsedAnchor = JSON.parse(noteAnchor.locatorJson) as unknown;
    expect(isAnchorV3(parsedAnchor)).toBe(true);
    if (isAnchorV3(parsedAnchor) && parsedAnchor.legacy) {
      expect(parsedAnchor.legacy.raw).toBe(readiumLocator());
    }
    expect(result.readingPositions).toHaveLength(2);
    const epubPosition = result.readingPositions.find((position) => position.bookId === EPUB_ID)!;
    expect(epubPosition.anchorId).toBe(`legacy-anchor:book-position:${EPUB_ID}`);

    // 时间戳来自 record-timestamps（ISO 显式），无兜底
    const noteTs = Date.parse(ISO_NOTE);
    const timedNote = result.tables.annotations.find((annotation) => annotation.id === 'legacy-note:CE14ABF9-E4F3-46B1-959C-E5EB3E27A213')!;
    expect(timedNote.createdAt).toBe(noteTs);
    expect(timedNote.updatedAt).toBe(noteTs);
    expect(result.stats.timestampFallbacks.notes).toBe(2); // EPUB 高亮与移除书笔记无时间戳
    expect(result.warningCounts['ui-state-not-migrated']).toBe(1);
  });

  it('PDF：page+归一化 rect 映射；非法矩形丢弃告警；书 state 保留 pdfInfo', () => {
    const result = migrateSwiftLibrary(migrationInput(), { now: NOW });
    const pdfNoteAnchor = result.tables.anchors.find((anchor) =>
      anchor.id === 'legacy-anchor:note:7C743BCC-2677-4263-B0C1-FFEF676D8613',
    )!;
    expect(pdfNoteAnchor.engine).toBe('pdf');
    expect(pdfNoteAnchor.page).toBe(12);
    const anchor = JSON.parse(pdfNoteAnchor.locatorJson) as unknown;
    expect(isAnchorV3(anchor)).toBe(true);
    if (isAnchorV3(anchor) && anchor.kind === 'pdf') {
      expect(anchor.locator.page).toBe(12);
      expect(anchor.locator.pageCount).toBe(514);
      expect(anchor.locator.rects).toEqual([{ x: 0.1, y: 0.2, w: 0.3, h: 0.04 }]);
    }
    expect(result.warningCounts['invalid-pdf-rect']).toBe(1);
    const pdfState = result.bookStates.find((state) => state.bookId === PDF_ID)!;
    expect(pdfState.pdfInfo).toEqual({ pageCount: 514, textPageCount: 509 });
    const pdfBook = result.tables.books.find((book) => book.id === PDF_ID)!;
    expect(pdfBook.format).toBe('pdf');
  });

  it('移除书：保留书籍行与笔记/书签，标记 sourceAvailable=false + 告警', () => {
    const result = migrateSwiftLibrary(migrationInput(), { now: NOW });
    expectNoFailures(result);
    const removedBook = result.tables.books.find((book) => book.id === REMOVED_ID)!;
    expect(removedBook.title).toBe('已移除的书');
    const removedAnnotations = result.tables.annotations.filter((annotation) => annotation.bookId === REMOVED_ID);
    expect(removedAnnotations).toHaveLength(2);
    const removedState = result.bookStates.find((state) => state.bookId === REMOVED_ID)!;
    expect(removedState).toMatchObject({ removal: 'removed', sourceAvailable: false, synthesized: false });
    expect(result.warningCounts['book-removed']).toBe(1);
  });
});

describe('migrateSwiftLibrary：旧 AI 问答/引用/历史', () => {
  it('映射 messages/citations、历史轮次去重、Apple Date 转换、agent/extras 保留', () => {
    const input = { ...migrationInput(), questions: questionFixture() };
    const result = migrateSwiftLibrary(input, { now: NOW });
    expectNoFailures(result);

    const q1 = 'B305A2A1-4BF2-4C8C-990A-CB07A46F7895';
    const q1Ts = Math.round((815024254.375372 + 978307200) * 1000);
    const messages = result.tables.messages;
    expect(messages).toHaveLength(8);
    const user = messages.find((message) => message.id === `legacy-q:${q1}:user`)!;
    const assistant = messages.find((message) => message.id === `legacy-q:${q1}:assistant`)!;
    expect(user).toMatchObject({ conversationId: q1, role: 'user', content: '这句话里的灯指什么？', createdAt: q1Ts });
    expect(assistant).toMatchObject({ role: 'assistant', reasoningContent: '先查书，再作答。', createdAt: q1Ts });

    // 历史轮次：新 id 映射；和正式记录重复的 id 跳过
    expect(messages.some((message) => message.id.startsWith('legacy-q:U0-HISTORY'))).toBe(true);
    expect(messages.some((message) => message.id === 'legacy-q:U2-INCOMPLETE-4BF2-4C8C-990A-CB07A46F7895:assistant')).toBe(true);
    expect(result.stats.skipped.historyDuplicates).toBe(1);
    expect(result.warningCounts['history-duplicate-skipped']).toBe(1);

    // 未完成/草稿
    expect(result.stats.skipped.drafts).toBe(1);
    expect(result.unmapped.draftQuestions).toHaveLength(1);
    expect(messages.some((message) => message.id.includes('DRAFT-EMPTY'))).toBe(false);

    // 引用：q1 两条 + 孤儿书一条
    expect(result.tables.citations).toHaveLength(3);
    const citation = result.tables.citations.find((item) => item.id === `legacy-cite:${q1}:0`)!;
    expect(citation).toMatchObject({ conversationId: q1, evidenceId: 'E1', quote: '灯把书页照亮', messageId: `legacy-q:${q1}:assistant` });
    const pdfCitation = result.tables.citations.find((item) => item.id === `legacy-cite:${q1}:1`)!;
    expect(pdfCitation.page).toBe(12);
    expect(isAnchorV3(JSON.parse(pdfCitation.locatorJson))).toBe(true);

    // 孤儿书：补占位书 + warning，引用仍迁移
    expect(result.tables.books.some((book) => book.id === ORPHAN_ID)).toBe(true);
    const orphanState = result.bookStates.find((state) => state.bookId === ORPHAN_ID)!;
    expect(orphanState).toMatchObject({ synthesized: true, sourceAvailable: false, title: '已删除但仍有问答的书' });
    expect(result.stats.skipped.orphanQuestionBooks).toBe(1);
    expect(result.warningCounts['orphan-question-book-synthesized']).toBe(1);

    // schema 无法表达的字段保留
    expect(result.unmapped.agentTranscripts).toHaveLength(1);
    expect(result.unmapped.agentTranscripts[0]).toMatchObject({ questionId: q1 });
    expect(result.unmapped.questionExtras.some((item) => item.questionId === q1)).toBe(true);
    expect(result.stats.migrated.messages).toBe(8);
    expect(result.stats.migrated.citations).toBe(3);
  });

  it('确定性：相同输入 + 相同 now → 输出一致；输入不被修改', () => {
    const input = { ...migrationInput(), questions: questionFixture() };
    const before = JSON.stringify(input);
    const first = migrateSwiftLibrary(deepFreeze(JSON.parse(before) as unknown), { now: NOW });
    const second = migrateSwiftLibrary(JSON.parse(before) as unknown, { now: NOW });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('migrateSwiftLibrary：failure 清单（不伪造成功）', () => {
  it('无效输入/书/格式/重复 id/locator/引用 → failures + 部分成功', () => {
    const input = {
      library: [
        {},
        { id: 'x'.repeat(64), title: '坏格式', format: 'mobi' },
        { id: EPUB_ID, title: '重复书', author: 'A' },
        { id: EPUB_ID, title: '重复书 2' },
        {
          id: PDF_ID,
          title: '有坏记录的 PDF',
          format: 'pdf',
          notes: [{ id: 'note-bad', locatorJSON: 'not-json' }],
          bookmarks: [{ id: 'bookmark-bad', locatorJSON: JSON.stringify({ title: '无 href' }) }],
          notes2: [],
        },
      ],
      questions: [
        { id: 'Q-BAD-1', bookID: PDF_ID, question: '缺引用 quote', state: 'complete', answer: 'a', citations: [{ id: 'E1', locatorJSON: pdfLocator(1), quote: '  ' }] },
        { id: 'Q-BAD-2', bookID: PDF_ID, question: '坏 locator', state: 'complete', answer: 'b', citations: [{ id: 'E2', locatorJSON: 'bad', quote: '有效 quote' }] },
        { bookID: PDF_ID, question: '缺 id' },
      ],
    };
    const result = migrateSwiftLibrary(input, { now: NOW });
    expect(result.ok).toBe(false);
    const codes = result.failures.map((failure) => failure.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'invalid-book',
        'invalid-format',
        'duplicate-book-id',
        'invalid-locator-json',
        'unsupported-locator',
        'citation-missing-quote',
        'invalid-question',
      ]),
    );
    // 部分成功：重复书保留第一本 + 坏记录 PDF 的书行仍迁移
    expect(result.tables.books.map((book) => book.id)).toEqual([EPUB_ID, PDF_ID]);
    expect(result.failures.every((failure) => failure.path.length > 0)).toBe(true);
    expect(result.tables.citations).toHaveLength(0);
    expect(result.stats.failed.books).toBeGreaterThan(0);
    expect(result.stats.failed.citations).toBe(2); // 空 quote + 坏 locator 各一条
  });

  it('缺 library 的输入 → invalid-input，不产出任何行', () => {
    const result = migrateSwiftLibrary({ questions: [] }, { now: NOW });
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toMatchObject({ code: 'invalid-input', path: 'input' });
    expect(result.tables.books).toHaveLength(0);
  });
});
