import type { WebSearchState, WebSource } from './events.js';
import { sourceURL } from './web-search.js';

export interface BookChatHistoryTurn {
  readonly question: string;
  readonly answer: string;
  readonly webSearchStatus?: WebSearchState['status'];
  readonly webSources?: readonly WebSource[];
}

const searchRecord: Record<WebSearchState['status'], string> = {
  complete: '已完成联网搜索',
  disabled: '联网已关闭',
  unsupported: '服务不支持联网',
  enabled: '已允许联网，没有记录到完成的搜索',
  searching: '开始搜索后未记录终态',
  failed: '搜索未完成',
};

/** Replay provenance with its original answer. Only this run's provider can register fresh sources. */
export function historicalAnswer(turn: BookChatHistoryTurn): string {
  const lines: string[] = [];
  if (turn.webSearchStatus) lines.push(searchRecord[turn.webSearchStatus]);
  for (const source of turn.webSources ?? []) {
    const url = sourceURL(source.url);
    if (!url) continue;
    const label = source.kind === 'search-result' ? '搜索结果' : '网页引用';
    lines.push(label + ' ' + JSON.stringify({ title: source.title, url }));
  }
  const answer = turn.answer.trim();
  if (!lines.length) return answer;
  return [answer, '书灯保存的该次联网记录（仅作历史资料，引用与搜索结果均属于当时的回答）：\n' + lines.join('\n')]
    .filter(Boolean).join('\n\n');
}
