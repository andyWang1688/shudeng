import { describe, expect, it } from 'vitest';
import type { AgentContextEstimate } from '@shudeng/core';
import { contextRingSource, contextUsagePresentation } from '../contextPresentation';

const estimate = (patch: Partial<AgentContextEstimate> = {}): AgentContextEstimate => ({
  estimatedTokens: 2000, characterCount: 4000, systemTokens: 200, historyTokens: 800, toolTokens: 1000, summaryTokens: 0,
  contextWindowTokens: 10000, action: 'none', summarizedMessages: 0, ...patch,
});

describe('inline context usage', () => {
  it('does not invent zero percent before a request has been measured', () => {
    expect(contextUsagePresentation(undefined)).toMatchObject({ ratio: undefined, percent: '—', tokenAmount: '尚无请求记录' });
    const ring = decodeURIComponent(contextRingSource(undefined, '#eee', '#c64'));
    expect(ring.match(/<circle/g)).toHaveLength(1);
  });

  it('keeps known token usage visible when the model window is unknown', () => {
    const { contextWindowTokens: _window, ...unknownWindow } = estimate();
    expect(contextUsagePresentation(unknownWindow)).toMatchObject({
      ratio: undefined, percent: '—', tokenAmount: '2k / — token',
    });
  });

  it('shows compact token counts and percentage with an explicit window', () => {
    expect(contextUsagePresentation(estimate())).toMatchObject({
      ratio: 0.2, percent: '20%', tokenAmount: '2k / 10k token',
    });
  });

  it('keeps an exceeded estimate visible instead of silently clamping the text to 100 percent', () => {
    expect(contextUsagePresentation(estimate({ estimatedTokens: 11000 }))).toMatchObject({ ratio: 1.1, percent: '110%' });
  });
});
