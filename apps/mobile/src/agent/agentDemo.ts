/**
 * 开发/QA 演示：直接消费 @shudeng/core 的公开 Agent API。
 * 不实现第二套 Agent；脚本模型仅用于无网络、无 key 的 Hermes 打包验证。
 */
import {
  InMemoryBookSource,
  runBookAgent,
  type AgentEvent,
  type AgentRunSession,
} from '@shudeng/core/agent';
import type { BookIdentity } from '@shudeng/core/domain';
import { createScriptedModel } from '@shudeng/core/agent/testing';

const book: BookIdentity = {
  id: 'demo-lamp',
  title: '阅读与灯（演示）',
  format: 'epub',
  sourceHash: 'demo-source',
};

const source = new InMemoryBookSource({
  book,
  chapters: [
    {
      title: '第一回 · 灯下阅读',
      paragraphs: [
        '灯把书页照亮，也把问题留在纸上。',
        '阅读不是为了逃离生活，而是为了更清楚地回到生活。',
      ],
    },
  ],
});

const model = createScriptedModel([
  {
    chunks: [
      { reasoning: '书里用灯比喻阅读。需要先查一下原文，再引用可核对的句子。', delayMs: 120 },
      { toolCalls: [{ id: 'call-search', name: 'search_book', args: { query: '灯' } }], delayMs: 120 },
    ],
  },
  {
    chunks: [
      { reasoning: '找到了包含“灯”的原文，可以把这句作为引用。', delayMs: 120 },
      {
        text: JSON.stringify({
          answer: '书里把灯比作阅读：灯照亮书页，也提醒读者停下来想一想。',
          citations: [{ id: 'E1', quote: '灯把书页照亮，也把问题留在纸上。' }],
        }),
        delayMs: 160,
      },
    ],
  },
]);

export function startDemoAgent(question = '灯在书里是什么意思？'): AgentRunSession {
  return runBookAgent({ model, source, book, question });
}

export type DemoEvent = AgentEvent;
