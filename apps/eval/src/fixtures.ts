/**
 * V1 评测夹具：一本固定小书 + 一组问题。
 * 文字与 Swift 版 AgentRuntimeTests 的夹具对齐，便于后续做行为对照。
 */
import type { BookIdentity } from '@shudeng/core/domain';
import type { InMemoryBook } from '@shudeng/core/agent';

export interface EvalCase {
  id: string;
  question: string;
  /** 模拟模型检索的书内关键词。 */
  searchQuery: string;
  /** 期望被引用的连续原文（必须真的出现在被检索段落里）。 */
  citationQuote: string;
  /** 模拟模型最终回答正文。 */
  answer: string;
  /** 伪造引用评测：模型给出的 quote 不在原文里，应被剔除。 */
  forgedCitation?: string;
}

const book: BookIdentity = {
  id: 'fixture-book-1',
  title: '书灯夹具：灯与书页',
  format: 'epub',
  sourceHash: 'fixture-hash-1',
};

export const fixtureBook: InMemoryBook = {
  book,
  chapters: [
    {
      title: '第一章 · 灯',
      paragraphs: [
        '灯把书页照亮，也把问题留在纸上。',
        '阅读不是把答案抄下来，而是把原文读慢一点。',
      ],
    },
    {
      title: '第二章 · 书页',
      paragraphs: ['书页记录的是作者写下的句子，读者要回到这些句子本身。'],
    },
  ],
};

export const evalCases: ReadonlyArray<EvalCase> = [
  {
    id: 'lamp-meaning',
    question: '书里的“灯”是什么意思？',
    searchQuery: '灯',
    citationQuote: '灯把书页照亮',
    answer: '“灯”指的是阅读时的照明：它把书页照亮，也把问题留在纸上。',
  },
  {
    id: 'reading-attitude',
    question: '这本书怎么看阅读这件事？',
    searchQuery: '阅读',
    citationQuote: '阅读不是把答案抄下来，而是把原文读慢一点',
    answer: '阅读要慢下来读原文，而不是直接抄答案。',
  },
  {
    id: 'forged-citation',
    question: '书里有没有说灯会自己写答案？',
    searchQuery: '灯',
    citationQuote: '灯把书页照亮',
    answer: '没有这样的原文；灯只是照亮书页。',
    forgedCitation: '灯会自己写答案并替读者做决定',
  },
];
