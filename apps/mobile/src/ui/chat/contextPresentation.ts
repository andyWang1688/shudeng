import type { AgentContextEstimate } from '@shudeng/core';

export function contextPercent(fraction: number): string {
  const percent = Math.max(0, Math.min(1, fraction)) * 100;
  return (percent > 0 && percent < 1 ? percent.toFixed(1) : Math.round(percent).toString()) + '%';
}

export function humanContextSize(count: number): string {
  if (count >= 10000) return (count / 10000).toFixed(1) + ' 万字';
  if (count >= 1000) return (count / 1000).toFixed(1) + ' 千字';
  return count + ' 字';
}

export function contextBreakdown(estimate: AgentContextEstimate, external: boolean): string {
  if (!estimate.estimatedTokens) return '构成：暂无已发送内容';
  return '构成：' + [
    ['对话历史', estimate.historyTokens],
    [external ? '资料与工具' : '书内资料', estimate.toolTokens],
    ['摘要', estimate.summaryTokens],
    ['系统提示', estimate.systemTokens],
  ].filter(([, tokens]) => Number(tokens) > 0)
    .map(([label, tokens]) => label + ' ' + Math.round(Number(tokens) / estimate.estimatedTokens * 100) + '%').join(' · ');
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
