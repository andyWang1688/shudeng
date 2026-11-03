import type { VerifiedCitation } from '@shudeng/core';

/** Swift BookType.serif 使用 PostScript 名 SongtiSC-*；family 名在 RN 会回退系统字体。 */
export const SERIF = 'SongtiSC-Regular';
export const SERIF_BOLD = 'SongtiSC-Bold';

export function toolLabel(name: string): string {
  if (name === 'search_book') return '检索书内原文';
  if (name === 'read_page') return '读取页/章';
  if (name === 'read_chapter') return '读取章节';
  return name;
}

export function serviceName(provider: 'deepseek' | 'openai' | 'anthropic' | undefined): string {
  if (provider === 'deepseek') return 'DeepSeek';
  if (provider === 'openai') return 'OpenAI';
  if (provider === 'anthropic') return 'Anthropic';
  return 'AI 服务';
}

export function friendlyError(message: string | undefined): string {
  if (!message) return '请稍后重试；问题与选文已保留。';
  if (/fetch|network|network request|timeout|abort/i.test(message)) {
    return '暂时没能连接 AI 服务，问题与选文已保留，请重试。';
  }
  return message.replace(/^[a-z-]+：/i, '');
}

export function citationTitle(
  citation: VerifiedCitation,
  index: number,
  bookTitle: string,
  format: 'epub' | 'pdf',
): string {
  const chapter = citation.chapter ?? (citation.page ? `第 ${citation.page} 页` : '原文');
  const head = `${index + 1} · ${bookTitle} · ${chapter}`;
  if (format === 'pdf') {
    const quote = citation.quote.replace(/\n/g, ' ').trim();
    return `${head}\n${quote.length > 36 ? `${quote.slice(0, 36)}…` : quote}`;
  }
  return `${head}\n查看原文，核对这段解释`;
}

/** 旧索引 locator 是 Readium JSON；转成 reader 可用 locator，无法定位时就只打开书。 */
export function locatorForCitation(citation: VerifiedCitation): string | undefined {
  if (citation.page) return JSON.stringify({ type: 'pdf', page: citation.page });
  try {
    const parsed: unknown = JSON.parse(citation.locator);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const record = parsed as Record<string, unknown>;
    const locations =
      typeof record.locations === 'object' && record.locations !== null
        ? (record.locations as Record<string, unknown>)
        : undefined;
    const cfi = typeof locations?.cfi === 'string' ? locations.cfi : undefined;
    if (!cfi) return undefined;
    return JSON.stringify({
      type: 'epub',
      cfi,
      ...(typeof record.href === 'string' ? { href: record.href } : {}),
      ...(typeof record.title === 'string' ? { chapter: record.title } : {}),
    });
  } catch {
    return undefined;
  }
}
