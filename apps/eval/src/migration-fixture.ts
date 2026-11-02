/**
 * V3 迁移评测夹具（合成、已脱敏）：结构对齐真实旧备份样本：
 * - EPUB：format 缺省 + Readium locator（cssSelector/domRange/position）+ 阅读位置 + 2 笔记 + 书签 + settings
 * - PDF：pdfInfo + pdf://page/N locator + 带归一化 rect 的笔记（真实备份中未出现，按 Swift 结构合成）
 * - 移除书：removal='removed'，文件已删但 library.json 仍保留笔记/书签
 * - 旧问答：conversation/history/citations（EPUB+PDF）/agent.transcript/notice/selection
 * - 一条坏笔记 locator + 一条空 quote 引用，用于验证 failure 清单与“部分成功不伪造”
 */
import type { SwiftLibraryBackupInput } from '@shudeng/core';

export const MIGRATION_EPUB_ID = '1'.repeat(64);
export const MIGRATION_PDF_ID = '2'.repeat(64);
export const MIGRATION_REMOVED_ID = '3'.repeat(64);
export const MIGRATION_ORPHAN_BOOK_ID = '4'.repeat(64);
export const MIGRATION_NOW = 1_800_000_000_000;

export const EPUB_LOCATOR_JSON = JSON.stringify({
  href: 'OEBPS/chapter1.xhtml',
  type: 'application/xhtml+xml',
  title: '第一章 · 灯',
  locations: {
    cssSelector: '#p1',
    domRange: {
      start: { charOffset: 0, cssSelector: '#p1', textNodeIndex: 0 },
      end: { charOffset: 30, cssSelector: '#p1', textNodeIndex: 0 },
    },
    position: 18,
    progression: 0.18,
    totalProgression: 0.12,
  },
  text: { highlight: '灯把书页照亮，也把问题留在纸上。' },
});

export const PDF_LOCATOR_JSON = JSON.stringify({
  href: 'pdf://page/34',
  type: 'application/pdf',
  title: '第 34 页',
  locations: { fragments: ['page=34'], page: 34, position: 34, progression: 0.06, totalProgression: 0.06 },
  text: { highlight: '价值投资是唯一的路' },
});

export function migrationCopyOfLegacyBackup(): SwiftLibraryBackupInput {
  return {
    library: [
      {
        id: MIGRATION_EPUB_ID,
        title: '迁移评测 EPUB',
        author: '作者甲',
        locatorJSON: EPUB_LOCATOR_JSON,
        recordIdentity: '6BACDF4F-5CE8-4C0E-A3BE-EBD2EF95038C',
        readingSettings: { fontSize: 110, dark: true, scroll: true },
        notes: [
          { id: 'C7A61C49-17B1-4229-9627-6DC52FB3BC18', locatorJSON: EPUB_LOCATOR_JSON, body: '' },
          {
            id: 'CE14ABF9-E4F3-46B1-959C-E5EB3E27A213',
            locatorJSON: EPUB_LOCATOR_JSON,
            body: '迁移评测笔记正文',
            color: 'rose',
          },
          // 坏 locator：进入 failures，不应影响其它记录
          { id: 'BAD-NOTE-0000-0000-0000-000000000000', locatorJSON: 'not-json', body: '坏笔记' },
        ],
        bookmarks: [
          {
            id: '31971580-37BE-4B71-B723-13F7F795BB34',
            locatorJSON: EPUB_LOCATOR_JSON,
            title: '第三章 · 林黛玉进贾府',
            excerpt: '黛玉方进入房时',
          },
        ],
      },
      {
        id: MIGRATION_PDF_ID,
        title: '迁移评测 PDF',
        author: '作者乙',
        format: 'pdf',
        pdfInfo: { pageCount: 514, textPageCount: 509 },
        locatorJSON: PDF_LOCATOR_JSON,
        notes: [
          {
            id: '7C743BCC-2677-4263-B0C1-FFEF676D8613',
            locatorJSON: PDF_LOCATOR_JSON,
            body: 'PDF 笔记',
            color: 'blue',
            pdf: { page: 34, rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.04 }] },
          },
        ],
      },
      {
        id: MIGRATION_REMOVED_ID,
        title: '已移除的书',
        author: '作者丙',
        format: 'pdf',
        removal: 'removed',
        notes: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            locatorJSON: EPUB_LOCATOR_JSON,
            body: '移除后仍保留的笔记',
          },
        ],
        bookmarks: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            locatorJSON: EPUB_LOCATOR_JSON,
            title: '移除后仍保留的书签',
          },
        ],
      },
    ],
    questions: [
      {
        id: 'B305A2A1-4BF2-4C8C-990A-CB07A46F7895',
        conversationID: 'B305A2A1-4BF2-4C8C-990A-CB07A46F7895',
        conversationTitle: '这句里的灯指什么？',
        turnIndex: 0,
        bookID: MIGRATION_EPUB_ID,
        bookTitle: '迁移评测 EPUB',
        question: '这句里的灯指什么？',
        answer: '灯既指照明，也指理解难句的提示。',
        state: 'complete',
        updated: 815024254.375372,
        selection: {
          id: '',
          locatorJSON: EPUB_LOCATOR_JSON,
          quote: '灯把书页照亮',
          context: '灯把书页照亮，也把问题留在纸上。',
          chapter: '第一章 · 灯',
        },
        citations: [
          { id: 'E1', locatorJSON: EPUB_LOCATOR_JSON, quote: '灯把书页照亮', chapter: '第一章 · 灯' },
          { id: 'E2', locatorJSON: PDF_LOCATOR_JSON, quote: '价值投资是唯一的路', chapter: '第 34 页' },
          // 空 quote：进入 failures
          { id: 'E3', locatorJSON: EPUB_LOCATOR_JSON, quote: '  ', chapter: '第一章 · 灯' },
        ],
        history: [
          {
            id: 'U0-HISTORY-4BF2-4C8C-990A-CB07A46F7895',
            question: '历史问题',
            answer: '历史答案',
            state: 'complete',
          },
        ],
        agent: { steps: [], summary: '查书 2 步', reasoning: '先查书，再作答。', warnings: [], stepsUsed: 2 },
        notice: '可能漏掉相关依据',
      },
      {
        id: 'ORPHAN-Q-4BF2-4C8C-990A-CB07A46F7895',
        conversationID: 'ORPHAN-Q-4BF2-4C8C-990A-CB07A46F7895',
        bookID: MIGRATION_ORPHAN_BOOK_ID,
        bookTitle: '已删除但仍有问答的书',
        question: '孤儿书里的引用还在吗？',
        answer: '引用保留。',
        state: 'complete',
        updated: 815024357,
        citations: [
          { id: 'E1', locatorJSON: PDF_LOCATOR_JSON, quote: '价值投资是唯一的路', chapter: '第 34 页' },
        ],
      },
      {
        id: 'DRAFT-EMPTY-4BF2-4C8C-990A-CB07A46F7895',
        bookID: MIGRATION_EPUB_ID,
        question: '',
        answer: '',
        state: 'draft',
        updated: 815024356,
      },
    ],
    recordTimestamps: {
      [`note:${MIGRATION_PDF_ID}:7C743BCC-2677-4263-B0C1-FFEF676D8613`]: '2026-10-28T05:38:09Z',
      [`note:${MIGRATION_EPUB_ID}:CE14ABF9-E4F3-46B1-959C-E5EB3E27A213`]: '2026-10-28T05:38:09Z',
    },
    notesBookGroups: { expanded: { [MIGRATION_EPUB_ID]: true }, offsetY: 0 },
  };
}
