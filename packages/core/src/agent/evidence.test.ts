import { describe, expect, it } from 'vitest';
import { EvidenceRegistry, verifyCitations } from './evidence.js';

const excerpt = { context: '前段 中段 尾段', quote: '前段 中段 尾段', chapter: '一章', locator: 'chapter:1' };
const check = (registry: EvidenceRegistry, id: string, quote: string) =>
  verifyCitations({ answer: '回答', citations: [{ id, quote }] }, registry);

describe('citations require original text actually dispatched in this run', () => {
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
});
