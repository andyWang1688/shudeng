import { describe, expect, it } from 'vitest';
import { EvidenceRegistry, parseAnswerPayload, placeWebSources, verifyCitations } from './evidence.js';

const excerpt = { context: '前段 中段 尾段', quote: '前段 中段 尾段', chapter: '一章', locator: 'chapter:1' };
it('recovers a plain answer followed by an orphaned citation envelope', () => {
  expect(parseAnswerPayload('可核对的正文。","citations":[{"id":"E1","quote":"原文"}]}')).toEqual({
    answer: '可核对的正文。', citations: [{ id: 'E1', quote: '原文' }],
  });
});
const check = (registry: EvidenceRegistry, id: string, quote: string) =>
  verifyCitations({ answer: '回答', citations: [{ id, quote }] }, registry);

describe('citations require original text actually dispatched in this run', () => {
  it('binds exact, unique answer anchors only to verified book evidence and provider URLs', () => {
    const registry = new EvidenceRegistry();
    const evidence = registry.register(excerpt);
    const other = registry.register({ ...excerpt, locator: 'chapter:2' });
    registry.recordTransmitted(evidence.id, excerpt.quote);
    registry.recordTransmitted(other.id, excerpt.quote);
    const payload = {
      answer: '书内结论。补充背景。重复。重复。',
      citations: [
        { id: evidence.id, quote: '尾段', after: '书内结论。' },
        { id: other.id, quote: '中段', after: '重复。' },
        { id: 'E99', quote: '尾段', after: '书内结论。' },
        { url: 'https://example.com/source', after: '补充背景。' },
        { url: 'https://example.com/invented', after: '书内结论。' },
      ],
    };
    const verified = verifyCitations(payload, registry);
    expect(verified.citations.map(item => item.answerAnchor)).toEqual(['书内结论。', undefined]);
    expect(verified.droppedIds).toEqual(['E99']);
    const source = { id: 'W1', url: 'https://example.com/source', title: '背景', provider: 'deepseek' as const };
    expect(placeWebSources(payload, [source])).toEqual([{ ...source, answerAnchor: '补充背景。' }]);
  });
  it('rejects registered or rendered material that has never been dispatched', () => {
    const registry = new EvidenceRegistry();
    const evidence = registry.register(excerpt);
    registry.recordRendered('[E1] ' + excerpt.quote, [{ id: evidence.id, name: '一章', content: excerpt.quote }]);
    expect(check(registry, evidence.id, '尾段').citations).toEqual([]);
    registry.recordTransmitted(evidence.id, '前段');
    expect(check(registry, evidence.id, '尾段').citations).toEqual([]);
    expect(check(registry, evidence.id, '前段').citations).toHaveLength(1);
  });

  it('retains previous dispatches, normalizes whitespace and never joins separate pieces into a quote', () => {
    const registry = new EvidenceRegistry();
    const evidence = registry.register(excerpt);
    registry.recordTransmitted(evidence.id, '中段\n尾段');
    registry.recordTransmitted(evidence.id, '前段');
    expect(check(registry, evidence.id, '中段 尾段').citations).toHaveLength(1);
    expect(check(registry, evidence.id, '前段 中段').citations).toEqual([]);
    registry.recordTransmitted(evidence.id, '并非书内的传输文本');
    expect(check(registry, evidence.id, '并非书内').citations).toEqual([]);
  });

  it('keeps transmitted material bound to its original location and this run', () => {
    const registry = new EvidenceRegistry();
    const first = registry.register(excerpt);
    const elsewhere = registry.register({ ...excerpt, locator: 'chapter:2' });
    registry.recordTransmitted(first.id, first.quote);
    expect(check(registry, elsewhere.id, '尾段').citations).toEqual([]);
    const nextRun = new EvidenceRegistry();
    const next = nextRun.register(excerpt);
    expect(next.id).toBe(first.id);
    expect(check(nextRun, next.id, '尾段').citations).toEqual([]);
  });

  it('skips a null citation instead of throwing and keeps a trusted citation in the same batch', () => {
    const registry = new EvidenceRegistry();
    const evidence = registry.register(excerpt);
    registry.recordTransmitted(evidence.id, excerpt.quote);
    const outcome = verifyCitations(
      { answer: '回答', citations: [null as never, { id: evidence.id, quote: '尾段' }] },
      registry,
    );
    expect(outcome.citations.map((citation) => citation.id)).toEqual([evidence.id]);
    expect(outcome.droppedIds).toHaveLength(1);
  });
});

describe('answer payload parsing tolerates model formatting without exposing the envelope', () => {
  it('accepts an answer string containing literal newlines', () => {
    const raw = '{"answer":"第一段。\n第二段。","citations":[{"id":"E1","quote":"原文"}]}';
    expect(parseAnswerPayload(raw)).toEqual({
      answer: '第一段。\n第二段。',
      citations: [{ id: 'E1', quote: '原文' }],
    });
  });

  it('accepts an unescaped quote inside the answer and keeps the envelope out of the answer', () => {
    const raw = '{"answer":"他说"你好"然后继续。","citations":[{"id":"E1","quote":"原文"}]}';
    expect(parseAnswerPayload(raw)).toEqual({
      answer: '他说"你好"然后继续。',
      citations: [{ id: 'E1', quote: '原文' }],
    });
  });

  it('unwraps a whole response that the model JSON-encoded a second time', () => {
    const raw = JSON.stringify('{"answer":"双重编码也要取出正文","citations":[]}');
    expect(parseAnswerPayload(raw)).toEqual({ answer: '双重编码也要取出正文', citations: [] });
  });

  it('extracts a valid answer around markdown fencing and surrounding prose', () => {
    const raw = '这是说明。\n```json\n{"answer":"正文含 `code` 与 **Markdown**","citations":[{"id":"E1","quote":"原文"}]}\n```\n结束。';
    expect(parseAnswerPayload(raw)?.answer).toBe('正文含 `code` 与 **Markdown**');
  });

  it('preserves a legitimate code answer exactly', () => {
    const answer = '示例：\n```ts\nconst value = "book";\nconsole.log(value);\n```';
    const raw = JSON.stringify({ answer, citations: [] });
    expect(parseAnswerPayload(raw)?.answer).toBe(answer);
  });

  it('keeps the answer when only the citation array is malformed', () => {
    expect(parseAnswerPayload('{"answer":"正文仍可读","citations":[{"id":')).toEqual({
      answer: '正文仍可读',
      citations: [],
    });
  });

  it('recovers a truncated answer at a safe boundary instead of exposing the envelope', () => {
    expect(parseAnswerPayload('{"answer":"合成正文')).toEqual({ answer: '合成正文', citations: [] });
    expect(parseAnswerPayload('{"answer":"合成正文"')).toEqual({ answer: '合成正文', citations: [] });
    expect(parseAnswerPayload('{"answer":"合成正文","citations":')).toEqual({
      answer: '合成正文',
      citations: [],
    });
  });

  it('returns null rather than treating an unrelated JSON object as an answer', () => {
    expect(parseAnswerPayload('{"citations":[],"answer":42}')).toBeNull();
    expect(parseAnswerPayload('{"citations":[]}')).toBeNull();
  });
});
