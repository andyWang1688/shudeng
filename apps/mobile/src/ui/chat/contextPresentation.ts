import type { AgentContextEstimate } from '@shudeng/core';

/** Display the last prepared request without inventing usage for an unknown window. */
export function contextUsagePresentation(estimate: AgentContextEstimate | undefined) {
  if (!estimate || !Number.isFinite(estimate.estimatedTokens)) return {
    ratio: undefined, percent: '—', tokenAmount: '尚无请求记录',
  };
  const used = Math.max(0, Math.round(estimate.estimatedTokens));
  const window = estimate.contextWindowTokens;
  const knownWindow = window !== undefined && Number.isFinite(window) && window > 0;
  const ratio = knownWindow ? used / window : undefined;
  const percent = ratio === undefined ? '—' :
    ((ratio > 0 && ratio < 0.01) ? (ratio * 100).toFixed(1) : Math.round(ratio * 100).toString()) + '%';
  const compact = (count: number) => count >= 1000
    ? Number((count / 1000).toFixed(count < 10000 ? 1 : 0)) + 'k' : Math.round(count).toString();
  const tokenAmount = compact(used) + ' / ' + (knownWindow ? compact(window) : '—') + ' token';
  return { ratio, percent, tokenAmount };
}

/** Continuous 16pt ring, matching native radius, stroke and top start. */
export function contextRingSource(ratio: number | undefined, track: string, progress: string): string {
  const circumference = 2 * Math.PI * 6.4;
  const fraction = Math.max(0, Math.min(1, ratio ?? 0));
  const arc = fraction > 0 ? '<circle cx="8" cy="8" r="6.4" fill="none" stroke="' + progress +
    '" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="' + circumference + '" stroke-dashoffset="' +
    circumference * (1 - fraction) + '" transform="rotate(-90 8 8)"/>' : '';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">' +
    '<circle cx="8" cy="8" r="6.4" fill="none" stroke="' + track + '" stroke-width="2.4"/>' + arc + '</svg>');
}
