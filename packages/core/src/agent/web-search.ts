/** Provider-native search only: credentials and requests stay at the configured model endpoint. */
import { tools as openAITools } from '@langchain/openai';
import { tools as anthropicTools } from '@langchain/anthropic';
import type { ServerTool } from '@langchain/core/tools';
import type { AgentEvent, WebSearchState, WebSource } from './events.js';
import type { AgentProvider } from './providers.js';

export interface AgentWebSearchConfig {
  enabled: boolean;
  /** Total server searches across this Agent run. Clamped to 1–5, default 3. */
  maxUses?: number;
  /** Explicitly confirmed gateway protocol; model names never establish gateway support. */
  capability?: 'openai-responses' | 'anthropic-server';
}

export interface WebSearchPolicy {
  readonly state: WebSearchState;
  readonly provider?: WebSource['provider'];
  readonly maxUses: number;
}

export function resolveWebSearchPolicy(provider: AgentProvider, address: string | undefined, config?: AgentWebSearchConfig): WebSearchPolicy {
  const maxUses = Math.max(1, Math.min(5, Math.floor(Number.isFinite(config?.maxUses) ? config!.maxUses! : 3)));
  if (!config?.enabled) return { state: { status: 'disabled' }, maxUses };
  let origin: string | undefined;
  try {
    origin = new URL(address ?? (provider === 'anthropic' ? 'https://api.anthropic.com' : provider === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com')).origin;
  } catch {
    // Endpoint validation owns the user-facing configuration error.
  }
  const supported = provider === 'openai' && (origin === 'https://api.openai.com' || config.capability === 'openai-responses') ||
    provider === 'anthropic' && (origin === 'https://api.anthropic.com' || config.capability === 'anthropic-server');
  if (!supported) return { state: { status: 'unsupported', message: '当前 AI 服务尚未确认支持内置联网搜索，本次仅使用书内资料。' }, maxUses };
  return { state: { status: 'enabled', message: '已允许服务商内置搜索；是否实际搜索取决于本次问题。' }, provider: provider as WebSource['provider'], maxUses };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function sourceURL(value: unknown): string | undefined {
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
  private budgetError?: Error;
  private unavailable = false;

  constructor(readonly policy: WebSearchPolicy, private readonly emit: (event: AgentEvent) => void) {
    this.state = { ...policy.state };
  }

  get snapshot(): WebSearchState { return { ...this.state }; }
  get allSources(): WebSource[] { return [...this.sources.values()]; }
  get remaining(): number { return Math.max(0, this.policy.maxUses - this.calls.size); }
  get failedWithoutBudgetViolation(): boolean { return this.unavailable && !this.budgetError; }

  /** Call outside SDK callbacks, whose errors may otherwise be logged and swallowed. */
  assertWithinBudget(): void {
    if (this.budgetError) throw this.budgetError;
  }

  announce(): void { this.emit({ type: 'webSearchStatus', ...this.state }); }

  tools(): ServerTool[] {
    if (!this.policy.provider || this.unavailable || this.remaining === 0) return [];
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
    return /web[_ -]?search/i.test(message) &&
      /unsupported|not supported|does not support|not (?:yet )?available|not enabled|not permitted|unknown tool|invalid tool/i.test(message);
  }

  disableUnsupported(): void {
    this.unavailable = true;
    this.update({ status: 'failed', message: '服务商不支持本次内置联网搜索，已关闭联网并继续使用书内资料。' });
  }

  private addSource(value: Record<string, unknown>): void {
    if (!this.policy.provider) return;
    const url = sourceURL(value.url);
    if (!url || this.sources.has(url)) return;
    const source: WebSource = { id: `W${this.sources.size + 1}`, url,
      title: typeof value.title === 'string' && value.title.trim() ? value.title.trim().slice(0, 500) : new URL(url).hostname,
      provider: this.policy.provider };
    this.sources.set(url, source);
    this.emit({ type: 'webSource', source });
  }

  /** Inspect only protocol fields, never model-written JSON/text or application tool results. */
  observeMessage(message: unknown): void {
    if (!this.policy.provider) return;
    const msg = record(message);
    if (!msg) return;
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
    const kwargs = record(msg.additional_kwargs);
    const metadata = record(msg.response_metadata);
    walk(kwargs?.tool_outputs);
    walk(metadata?.output);
    walk(metadata?.tool_outputs);
  }

  failed(error: unknown): void {
    if (this.policy.provider) this.update({ status: 'failed', message: '本次 AI 请求未完成，联网结果不完整：' +
      (error instanceof Error ? error.message : String(error)).slice(0, 240) });
  }

  finish(): void {
    if (this.calls.size && this.state.status !== 'failed') this.update({ status: 'complete' });
  }
}
