import { describe, expect, it } from 'vitest';
import { legacyNativeMetadataCandidates, projectLegacyNativeContext, projectLegacyNativeTurn } from './legacy-native-agent.js';
import { migrateSwiftLibrary } from './swift-library.js';

const evidence = { id: 'E1', locatorJSON: '{"href":"one.xhtml"}', quote: '旧原文', context: '前旧原文后', chapter: '第一章' };
function nativeTurn() {
  return {
    id: 'UPPER-UUID', conversationID: 'CONVERSATION-UUID', bookID: 'book', bookTitle: '旧书', turnIndex: 1,
    question: '为什么？', answer: '因为。', state: 'complete', updated: 815024254.125,
    conversationTitle: '对话名', bookIdentity: 'BOOK-UUID', originJSON: '{"href":"one.xhtml"}', freeQuestion: false,
    retrievalQueries: ['关键词'], retrievalTrace: { keyword: [1], semantic: [2], anchors: [3], expanded: [4] },
    searchedChapters: ['第一章'], omittedChapters: ['附录'], serviceName: '旧服务', model: '旧模型', format: 'OpenAI',
    history: [{ id: 'prior', question: '前问', answer: '前答', state: 'complete' }],
    notice: '保留提示', retrievalNotice: '检索提示', selection: evidence, selectionParts: [evidence], evidence: [evidence], citations: [evidence], neighbors: [evidence],
    agent: { steps: [{ id: 'call-1', tool: 'search_book', title: '查书内资料', detail: '关键词', preview: '仅保存的 160 字预览', isError: false, duration: 1.25, finished: true }],
      summary: '查书 3 步 · 参考 1 段原文', reasoning: '先查原书', reasoningDuration: 2.125, reasoningExpanded: true,
      warnings: ['资料可能不全'], stepsUsed: 3, context: { estimatedTokens: 120, characterCount: 345, limitTokens: 800, contextWindow: 1000,
        thresholdTokens: 800, percent: .12, thresholdPercent: .8, systemTokens: 10, historyTokens: 40, toolTokens: 60, summaryTokens: 10,
        summarizedMessages: 2, trimmedMessages: 3, truncatedToolResults: 1, action: 'compacted' },
      apiKey: 'SYNTHETIC-SECRET-MUST-NOT-COPY', provider: { key: 'SYNTHETIC-SECRET-MUST-NOT-COPY' } },
  };
}

describe('Native historical metadata projection', () => {
  it('preserves full safe Native display fields and units without fabricating request materials or usage', () => {
    const source = nativeTurn(); const bytes = JSON.stringify(source);
    const candidate = projectLegacyNativeTurn(source)!;
    expect(candidate).toMatchObject({ questionId: 'UPPER-UUID', assistantId: 'legacy-q:UPPER-UUID:assistant', createdAt: Math.round((815024254.125 + 978307200) * 1000),
      details: { status: 'done', reasoning: '先查原书', reasoningDurationMs: 2125, modelSteps: 3,
        contextEstimate: { estimatedTokens: 120, characterCount: 345, contextWindowTokens: 1000, thresholdTokens: 800, action: 'compacted' },
        legacyNative: { version: 1, sourceState: 'complete', notice: '保留提示', retrievalNotice: '检索提示', reasoningExpanded: true,
          conversationTitle: source.conversationTitle, bookIdentity: source.bookIdentity, originJSON: source.originJSON, freeQuestion: false,
          retrievalQueries: source.retrievalQueries, retrievalTrace: source.retrievalTrace, searchedChapters: source.searchedChapters,
          omittedChapters: source.omittedChapters, serviceName: source.serviceName, model: source.model, format: 'OpenAI', updated: source.updated, history: source.history,
          selection: evidence, selectionParts: [evidence], evidence: [evidence], neighbors: [evidence], citations: [evidence],
          agent: { steps: source.agent.steps, summary: source.agent.summary, reasoningDuration: 2.125, context: source.agent.context } } } });
    expect(candidate.details).not.toHaveProperty('contextUsage'); expect(candidate.details).not.toHaveProperty('sentMaterials');
    expect(candidate.details).not.toHaveProperty('contextSummary'); expect(candidate.details).not.toHaveProperty('tools');
    expect(JSON.stringify(candidate)).not.toContain('SYNTHETIC-SECRET'); expect(JSON.stringify(source)).toBe(bytes);
  });

  it('uses documented old context defaults and drops invalid units without inferring a model window', () => {
    expect(projectLegacyNativeContext({ estimatedTokens: 100, characterCount: 300, limitTokens: 500 })).toEqual({
      estimatedTokens: 100, characterCount: 300, thresholdTokens: 500, systemTokens: 0, historyTokens: 0, toolTokens: 0, summaryTokens: 0, summarizedMessages: 0, action: 'none' });
    for (const invalid of [-1, 1.5, NaN, Infinity, '100']) expect(projectLegacyNativeContext({ estimatedTokens: invalid, characterCount: 300 })).toBeUndefined();
    const source = nativeTurn(); source.agent.reasoningDuration = -1; source.agent.stepsUsed = 1.5;
    const details = projectLegacyNativeTurn(source)!.details;
    expect(details).not.toHaveProperty('reasoningDurationMs'); expect(details).not.toHaveProperty('modelSteps');
    expect(details.legacyNative.agent?.reasoningDuration).toBe(-1);
  });

  it('keeps independent turns authoritative and rejects ambiguous duplicate identities', () => {
    const first = nativeTurn();
    const second = { ...nativeTurn(), id: 'second', turnIndex: 2, history: [{ id: first.id, question: 'stale', answer: 'stale', state: 'complete' }] };
    expect(legacyNativeMetadataCandidates([first, second]).map(item => item.questionId)).toEqual(['UPPER-UUID', 'second']);
    expect(legacyNativeMetadataCandidates([first, { ...first, id: first.id.toLowerCase() }])).toEqual([]);
    expect(legacyNativeMetadataCandidates([first, { ...second, bookID: 'different-book' }])).toEqual([]);
  });

  it('distinguishes saved interruptions from known failure and emits blank assistants only for submitted runs', () => {
    for (const state of ['preparing', 'generating', 'incomplete']) {
      const source = { ...nativeTurn(), answer: '', state };
      expect(projectLegacyNativeTurn(source)?.details.status).toBe('interrupted');
      expect(migrateSwiftLibrary({ library: [{ id: 'book', title: '书' }], questions: [source] }, { now: 1 }).tables.messages).toContainEqual(expect.objectContaining({ id: 'legacy-q:UPPER-UUID:assistant', content: '' }));
    }
    const failure = { ...nativeTurn(), answer: '', state: 'incomplete', failure: '连接断开' };
    expect(projectLegacyNativeTurn(failure)?.details).toMatchObject({ status: 'error', error: '连接断开', legacyNative: { sourceState: 'incomplete', failure: '连接断开' } });
    expect(projectLegacyNativeTurn({ ...failure, state: 'draft' })).toBeUndefined();
    expect(projectLegacyNativeTurn({ ...failure, question: '' })).toBeUndefined();
    expect(projectLegacyNativeTurn({ ...failure, state: 'unknown' })).toBeUndefined();
  });

  it('recognizes only the exact persisted Native interruption and cancellation reasons', () => {
    const source = { ...nativeTurn(), state: 'incomplete', answer: '' };
    for (const failure of ['上次生成已中断，请主动重试。', '系统未提供后台时间，请主动重试。', '系统后台时间已结束，回答未完成，请主动重试。', '原书已移除，回答未完成；重新导入相同文件后可主动重试。']) {
      expect(projectLegacyNativeTurn({ ...source, failure })?.details).toMatchObject({ status: 'interrupted', error: failure, legacyNative: { failure } });
    }
    expect(projectLegacyNativeTurn({ ...source, failure: '已主动取消；保留已保存内容。' })?.details.status).toBe('cancelled');
    expect(projectLegacyNativeTurn({ ...source, failure: '某个没有已知原因的取消错误' })?.details.status).toBe('error');
    for (const state of ['preparing', 'generating']) expect(projectLegacyNativeTurn({ ...source, state, failure: '历史残留错误' })?.details.status).toBe('interrupted');
  });
});
