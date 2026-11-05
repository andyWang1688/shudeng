import type { VerifiedCitation } from '@shudeng/core';
import type { AIConfig } from '../../platform/aiConfig';

/** Swift BookType.serif 使用 PostScript 名 SongtiSC-*；family 名在 RN 会回退系统字体。 */
export const SERIF = 'SongtiSC-Regular';
export const SERIF_BOLD = 'SongtiSC-Bold';

export function toolLabel(name: string): string {
  if (name === 'search_book') return '检索书内原文';
  if (name === 'read_page') return '读取页/章';
  if (name === 'read_chapter') return '读取章节';
  return name;
}

export function serviceName(config: Pick<AIConfig, 'name' | 'provider'> | null | undefined): string {
  const name = config?.name?.trim();
  if (name) return name;
  const provider = config?.provider;
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

/** Preserve CFI, Readium and Anchor locators; resolving them belongs to the reader. */
export function locatorForCitation(citation: VerifiedCitation): string | undefined {
  if (citation.page !== undefined && citation.page > 0)
    return JSON.stringify({ type: 'pdf', page: citation.page, text: citation.quote });
  const locator = citation.locator.trim();
  if (!locator) return undefined;
  if (!locator.startsWith('{')) return locator;
  try {
    const parsed: unknown = JSON.parse(locator);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const record = parsed as Record<string, unknown>;
    return JSON.stringify({ ...record, quote: citation.quote });
  } catch {
    return undefined;
  }
}

/** Extract a partial JSON answer string without exposing the response envelope. */
export function streamingAnswer(raw: string): string {
  const start = /"answer"\s*:\s*"/.exec(raw);
  if (!start) return /^\s*(?:```(?:json)?\s*)?\{/.test(raw) ? '' : raw;
  const value = raw.slice(start.index + start[0].length);
  let answer = '';
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '"') break;
    if (char !== '\\') {
      answer += char;
      continue;
    }
    const escaped = value[++index];
    if (escaped === undefined) break;
    if (escaped === 'u') {
      const code = value.slice(index + 1, index + 5);
      if (code.length < 4) break;
      if (/^[0-9a-f]{4}$/i.test(code)) {
        answer += String.fromCharCode(parseInt(code, 16));
        index += 4;
      }
    } else {
      answer +=
        ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[escaped] ?? escaped;
    }
  }
  return answer;
}
