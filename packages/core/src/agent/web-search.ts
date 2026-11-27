/** Provider-native search only: credentials and requests stay at the configured model endpoint. */
import { tools as openAITools } from '@langchain/openai';
import { tools as anthropicTools } from '@langchain/anthropic';
import type { ServerTool } from '@langchain/core/tools';
import type { AgentEvent, WebSearchState, WebSource } from './events.js';
import type { AgentProvider } from './providers.js';

const DEEPSEEK_WEB_SEARCH_TOOL = 'deepseek_web_search';
const DEEPSEEK_READ_URL_TOOL = 'deepseek_read_url';
export const READ_WEB_LINKS_TOOL = 'read_web_links';
const LINK_PATTERN = /https?:\/\/[^\s<>"'`()[\]{}，。；！？、]+/gi;

function trailingProsePunctuation(link: string, offset: number, question: string): string {
  if (question[offset - 1] === '<' && question[offset + link.length] === '>') return '';
  return /[.,]+$/.exec(link)?.[0] ?? '';
}

export function isDeepSeekWebTool(type: unknown): boolean {
  return type === DEEPSEEK_WEB_SEARCH_TOOL || type === DEEPSEEK_READ_URL_TOOL;
}

export interface AgentWebSearchConfig {
  enabled: boolean;
  /** Total server searches for providers exposing a search limit. Clamped to 1–5, default 3. */
  maxUses?: number;
  /** Explicitly confirmed gateway protocol; model names never establish gateway support. */
  capability?: 'openai-responses' | 'anthropic-server';
}

export interface WebSearchPolicy {
  readonly state: WebSearchState;
  readonly provider?: WebSource['provider'];
  readonly maxUses: number;
}

export function resolveWebSearchPolicy(provider: AgentProvider, address: string | undefined, config?: AgentWebSearchConfig, model?: string): WebSearchPolicy {
  const maxUses = Math.max(1, Math.min(5, Math.floor(Number.isFinite(config?.maxUses) ? config!.maxUses! : 3)));
  if (!config?.enabled) return { state: { status: 'disabled' }, maxUses };
  let url: URL | undefined;
  try {
    url = new URL(address ?? (provider === 'anthropic' ? 'https://api.anthropic.com' : provider === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com'));
  } catch {
    // Endpoint validation owns the user-facing configuration error.
  }
  const origin = url?.origin;
  const officialDeepSeek = provider !== 'anthropic' && origin === 'https://api.deepseek.com' &&
    /^\/(?:v1(?:\/chat\/completions)?|chat\/completions)?\/?$/.test(url!.pathname);
  if (officialDeepSeek && model?.trim() !== 'deepseek-flash') {
    return { state: { status: 'unsupported', message: '需使用 deepseek-flash' }, maxUses };
  }
  const supported = officialDeepSeek ||
    provider === 'openai' && (origin === 'https://api.openai.com' || config.capability === 'openai-responses') ||
    provider === 'anthropic' && (origin === 'https://api.anthropic.com' || config.capability === 'anthropic-server');
  if (!supported) return { state: { status: 'unsupported', message: '当前服务未确认支持' }, maxUses };
  return { state: { status: 'enabled', message: '已允许服务商内置搜索；是否实际搜索取决于本次问题。' }, provider: officialDeepSeek ? 'deepseek' : provider, maxUses };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function sourceURL(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

/** Per-run state: a model handle can be reused without sharing search budgets or source registries. */
export class ProviderWebSearch {
  private state: WebSearchState;
  private readonly calls = new Set<string>();
  private readonly sources = new Map<string, WebSource>();
  private readonly searchResults = new Map<string, { url: string; title: string }>();
  private budgetError?: Error;
  private unavailable = false;
  private deepSeekWebStarted = false;
  readonly questionLinks: readonly string[];

  constructor(readonly policy: WebSearchPolicy, private readonly emit: (event: AgentEvent) => void, question = '') {
    this.state = { ...policy.state };
    // DeepSeek suppresses direct URL reading when deep thinking search is also
    // declared. Offer only the URL reader for links in the current user message.
    this.questionLinks = policy.provider === 'deepseek'
      ? [...new Set([...question.matchAll(LINK_PATTERN)].map(({ 0: link, index }) => {
        const suffix = trailingProsePunctuation(link, index, question);
        return sourceURL(link.slice(0, link.length - suffix.length));
      }).filter((url): url is string => !!url))].slice(0, 10)
      : [];
  }

  get snapshot(): WebSearchState { return { ...this.state }; }
  get allSources(): WebSource[] { return [...this.sources.values()]; }
  get remaining(): number { return Math.max(0, this.policy.maxUses - this.calls.size); }
  get failedWithoutBudgetViolation(): boolean { return this.unavailable && !this.budgetError; }
  get verifiedPages(): readonly { url: string; title: string }[] {
    return [...this.searchResults.values(), ...this.sources.values()];
  }

  linkReadingQuestion(question: string): string {
    const prose = question.replace(LINK_PATTERN, (link: string, offset: number) =>
      '[链接]' + trailingProsePunctuation(link, offset, question));
    return `读取以下网址，核实读者问题涉及的网页事实。\n${this.questionLinks.join('\n')}\n\n读者问题：\n${prose.slice(0, 4000)}`;
  }

  guidanceFor(tools: readonly ServerTool[]): string {
    if (tools.some(tool => tool.type === DEEPSEEK_READ_URL_TOOL)) {
      return `本轮已启用联网。读者要求打开当前问题的网页时，使用 ${READ_WEB_LINKS_TOOL}，也可在查书后调用。` +
        '只引用实际取得的网页来源；如果没有读到网页，说明本次未读到。';
    }
    if (tools.length) {
      return '本轮已启用服务商内置联网搜索。读者询问能否联网时，明确回答可以；不要回答没有可用的联网搜索工具。' +
        '需要网页事实、时效信息或用户明确要求联网时，实际使用搜索工具核实；普通书籍解释无需强行搜索。';
    }
    if (this.state.status === 'unsupported') {
      return '本轮未启用服务商内置联网搜索：' + (this.state.message ?? '当前服务不支持') + '。不要声称可以联网。';
    }
    if (this.state.status === 'failed') {
      return '本轮联网搜索不可用或未完成。不要声称已经查到网页；没有实际网页来源时，明确说明本次未能联网。';
    }
    if (this.policy.provider) return '本步骤不能再发起联网搜索。根据已有资料回答，只引用实际取得的网页来源。已有网页结果时，不要声称本轮无法联网。';
    return '本轮联网搜索已关闭。不要声称可以联网或已经搜索网页。';
  }

  /** Call outside SDK callbacks, whose errors may otherwise be logged and swallowed. */
  assertWithinBudget(): void {
    if (this.budgetError) throw this.budgetError;
  }

  announce(): void { this.emit({ type: 'webSearchStatus', ...this.state }); }

  tools(): ServerTool[] {
    if (!this.policy.provider || this.unavailable || this.remaining === 0) return [];
    // DeepSeek sets its own per-request limit. Once it starts a web call, don't offer the tool again in this turn.
    if (this.policy.provider === 'deepseek')
      return this.deepSeekWebStarted ? [] : [{ type: this.questionLinks.length ? DEEPSEEK_READ_URL_TOOL : DEEPSEEK_WEB_SEARCH_TOOL }];
    return [this.policy.provider === 'openai'
      ? openAITools.webSearch({ search_context_size: 'low' })
      : anthropicTools.webSearch_20250305({ maxUses: this.remaining })];
  }

  private update(state: WebSearchState): void {
    if (this.state.status === state.status && this.state.message === state.message) return;
    this.state = state;
    this.emit({ type: 'webSearchStatus', ...state });
  }

  /** Only explicit search-capability errors allow a one-time retry without web tools. */
  isUnsupportedRequest(error: unknown): boolean {
    if (!this.policy.provider) return false;
    const value = record(error);
    if (value?.status !== 400) return false;
    const message = error instanceof Error ? error.message : String(value.message ?? '');
    return /web[_ -]?search|deepseek_read_url/i.test(message) &&
      /unsupported|not supported|does not support|only support|not (?:yet )?available|not enabled|not permitted|unknown tool|invalid tool/i.test(message);
  }

  disableUnsupported(): void {
    this.unavailable = true;
    this.update({ status: 'failed', message: '服务商不支持本次内置联网搜索，已关闭联网并继续使用书内资料。' });
  }

  failLinkRead(message: string): void {
    this.unavailable = true;
    this.update({ status: 'failed', message });
  }

  private addSource(value: Record<string, unknown>, kind?: 'search-result'): void {
    if (!this.policy.provider) return;
    const url = sourceURL(value.url);
    if (!url || this.sources.has(url)) return;
    const source: WebSource = { id: `W${this.sources.size + 1}`, url,
      title: typeof value.title === 'string' && value.title.trim() ? value.title.trim().slice(0, 500) : new URL(url).hostname,
      provider: this.policy.provider, ...(kind ? { kind } : {}) };
    this.sources.set(url, source);
    this.emit({ type: 'webSource', source });
  }

  private observeDeepSeek(kwargs: Record<string, unknown> | undefined): void {
    if (kwargs?.deepseekWebStarted === true) {
      this.deepSeekWebStarted = true;
      if (this.state.status === 'enabled') this.update({ status: 'searching' });
    }
    let completed = false;
    let failure: string | undefined;
    const steps = kwargs?.server_tool_calls;
    for (const step of Array.isArray(steps) ? steps : []) {
      const calls = record(step)?.calls;
      for (const entry of Array.isArray(calls) ? calls : []) {
        const call = record(entry);
        if (!call || !isDeepSeekWebTool(call.type) || typeof call.id !== 'string' || !call.id) continue;
        this.deepSeekWebStarted = true;
        if (call.status === 'completed') {
          completed = true;
          const results = Array.isArray(call.sources) ? call.sources : [];
          for (const item of [call.page, ...results]) {
            const result = record(item);
            const url = sourceURL(result?.url);
            if (url && !this.searchResults.has(url) && this.searchResults.size < 100)
              this.searchResults.set(url, { url, title: typeof result?.title === 'string' ? result.title.slice(0, 500) : '' });
          }
        }
        if (call.status === 'failed') {
          const code = record(call.error)?.code;
          failure ??= typeof code === 'string' ? code.slice(0, 160) : '未知错误';
        }
      }
    }
    if (completed) this.update({ status: 'complete' });
    else if (failure) {
      this.unavailable = true;
      this.update({ status: 'failed', message: '服务商内置搜索未成功：' + failure });
    }
    const annotations = kwargs?.annotations;
    for (const entry of Array.isArray(annotations) ? annotations : []) {
      const annotation = record(entry);
      const source = record(annotation?.url_citation);
      if (annotation?.type === 'url_citation' && source) this.addSource(source);
    }
  }

  /** Inspect only protocol fields, never model-written JSON/text or application tool results. */
  observeMessage(message: unknown): void {
    if (!this.policy.provider) return;
    const msg = record(message);
    if (!msg) return;
    const kwargs = record(msg.additional_kwargs);
    if (this.policy.provider === 'deepseek') {
      this.observeDeepSeek(kwargs);
      return;
    }
    const walk = (value: unknown, depth = 0): void => {
      if (depth > 8) return;
      if (Array.isArray(value)) { for (const child of value) walk(child, depth + 1); return; }
      const item = record(value);
      if (!item) return;
      const type = item.type;
      if (type === 'url_citation' || type === 'citation' && item.source === 'url_citation' ||
          type === 'web_search_result_location' || type === 'web_search_result') this.addSource(item);
      const call = type === 'web_search_call' || type === 'server_tool_use' && item.name === 'web_search';
      if (call && typeof item.id === 'string' && item.id) {
        this.calls.add(item.id);
        if (this.calls.size > this.policy.maxUses) {
          this.budgetError ??= new Error('服务商返回的联网搜索次数超过本次预算');
          this.update({ status: 'failed', message: this.budgetError.message });
        } else if (!this.budgetError) this.update({ status: item.status === 'completed' ? 'complete' : 'searching' });
      }
      if (type === 'web_search_tool_result_error') {
        this.unavailable = true;
        this.update({ status: 'failed', message: '服务商内置搜索未成功：' + String(item.error_code ?? '未知错误').slice(0, 160) });
      }
      if (type === 'web_search_tool_result' && Array.isArray(item.content) && this.state.status !== 'failed')
        this.update({ status: 'complete' });
      for (const key of ['annotations', 'citations', 'content', 'results']) if (item[key] !== undefined) walk(item[key], depth + 1);
    };
    walk(msg.content);
    const metadata = record(msg.response_metadata);
    walk(kwargs?.tool_outputs);
    walk(metadata?.output);
    walk(metadata?.tool_outputs);
  }

  failed(error: unknown): void {
    if (this.policy.provider) this.update({ status: 'failed', message: '本次 AI 请求未完成，联网结果不完整：' +
      (error instanceof Error ? error.message : String(error)).slice(0, 240) });
  }

  finish(answerReferences: readonly { url?: unknown }[] = []): void {
    if (this.state.status === 'enabled') this.update({ status: 'enabled', message: '已启用联网，本次未使用。' });
    if (this.policy.provider === 'deepseek') {
      if (this.state.status === 'searching') this.update({ status: 'failed', message: '服务商没有返回完整的联网结果。' });
      if (this.state.status === 'complete') {
        for (const reference of answerReferences) {
          const url = sourceURL(reference?.url);
          const result = url && this.searchResults.get(url);
          if (result) this.addSource(result);
        }
        if (!this.sources.size) {
          for (const result of [...this.searchResults.values()].slice(0, 3)) this.addSource(result, 'search-result');
          if (!this.sources.size) this.update({ status: 'complete', message: '已完成联网搜索，服务商未返回可查看的网页链接。' });
        }
      }
      return;
    }
    if (this.calls.size && this.state.status !== 'failed') this.update({ status: 'complete' });
  }
}
