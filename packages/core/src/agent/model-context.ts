import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAICompletions } from '@langchain/openai';
import type { AgentProvider } from './providers.js';

export interface ModelContextOptions {
  readonly provider: AgentProvider;
  readonly model: string;
  readonly baseUrl?: string;
  /** Explicit shared input + output window; overrides model-profile input data. */
  readonly contextWindowTokens?: number;
}

export interface ModelContextInfo {
  /** Conservative shared budget passed unchanged to the context manager. */
  readonly contextWindowTokens: number;
  /** Profile input/output limits are separate, never added to create a total window. */
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly source: 'manual' | 'profile' | 'fallback';
  readonly endpoint: 'official' | 'custom';
  /** Profile only supplies input limits; its shared window is not independently known. */
  readonly limitKind: 'shared' | 'input' | 'conservative';
  readonly profileProvider?: 'openai' | 'anthropic';
  readonly notice: string;
}

const FALLBACK_WINDOW = 32_768;
type ProfileLimits = { readonly maxInputTokens?: number; readonly maxOutputTokens?: number };
const profiles = new Map<string, ProfileLimits>();

function positiveLimit(value: number | undefined): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function readProfile(provider: 'openai' | 'anthropic', model: string): ProfileLimits {
  const key = provider + ':' + model;
  const cached = profiles.get(key);
  if (cached) return cached;
  // Constructors and .profile only read the integration's bundled metadata.
  // No invoke(), API key, environment credentials, or metadata network request.
  let result: ProfileLimits = {};
  try {
    const instance = provider === 'anthropic'
      ? new ChatAnthropic({ model, apiKey: 'metadata-inspection-only' })
      : new ChatOpenAICompletions({ model, apiKey: 'metadata-inspection-only' });
    const input = positiveLimit(instance.profile.maxInputTokens);
    const output = positiveLimit(instance.profile.maxOutputTokens);
    result = { ...(input ? { maxInputTokens: input } : {}), ...(output ? { maxOutputTokens: output } : {}) };
  } catch { /* Missing or incompatible metadata uses the explicit conservative fallback. */ }
  profiles.set(key, result);
  return result;
}

function endpointKind(provider: AgentProvider, baseUrl?: string): ModelContextInfo['endpoint'] {
  if (baseUrl === undefined) return 'official';
  try {
    const url = new URL(baseUrl.trim());
    const hosts = { openai: 'api.openai.com', anthropic: 'api.anthropic.com', deepseek: 'api.deepseek.com' };
    const path = url.pathname.replace(/\/+$/, '');
    const resource = provider === 'anthropic' ? '/messages' : '/chat/completions';
    return url.protocol === 'https:' && url.hostname === hosts[provider] && !url.port &&
      !url.username && !url.password && !url.search && !url.hash &&
      ['', '/v1', resource, '/v1' + resource].includes(path) ? 'official' : 'custom';
  } catch { return 'custom'; }
}

/** Local, key-free inspection. Profile data come from LangChain/models.dev, not this endpoint. */
export function inspectModelContext(options: ModelContextOptions): ModelContextInfo {
  const endpoint = endpointKind(options.provider, options.baseUrl);
  const model = options.model.trim();
  // Protocol and model vendor can differ at a compatible gateway. Only exact bundled
  // profile matches count; a family name alone never manufactures a token limit.
  const profileProvider = model.startsWith('claude-') ? 'anthropic' :
    options.provider === 'anthropic' ? 'anthropic' : 'openai';
  const limits = model ? readProfile(profileProvider, model) : {};
  const profile = limits.maxInputTokens !== undefined;
  const metadata: ProfileLimits & Pick<ModelContextInfo, 'profileProvider'> =
    { ...limits, ...(profile ? { profileProvider } : {}) };
  if (options.contextWindowTokens !== undefined) {
    if (!Number.isSafeInteger(options.contextWindowTokens) || options.contextWindowTokens < 1_000)
      throw new Error('上下文窗口需为至少 1,000 的安全整数。');
    return { ...metadata, contextWindowTokens: options.contextWindowTokens, source: 'manual', endpoint,
      limitKind: 'shared', notice: '按手动值预算；实际限制以服务为准。' };
  }
  if (profile) {
    return { ...metadata, contextWindowTokens: limits.maxInputTokens!, source: 'profile', endpoint,
      limitKind: 'input', notice: endpoint === 'custom' || profileProvider !== options.provider
        ? '按同名模型输入上限保守预算；未验证此服务限制。'
        : '按 LangChain 资料的输入上限保守预算；资料可能过期。' };
  }
  return { ...metadata, contextWindowTokens: FALLBACK_WINDOW, source: 'fallback', endpoint,
    limitKind: 'conservative', notice: '未找到模型资料，暂按 32,768 tokens 保守预算；可手动填写。' };
}

export interface ModelContextBudget {
  readonly contextWindowTokens: number;
  readonly outputReserveTokens: number;
}

/** Output is reserved once, in NativeContextManager. Keep room for input on small windows. */
export function resolveModelContextBudget(info: ModelContextInfo, requestedOutputTokens: number): ModelContextBudget {
  if (!Number.isSafeInteger(info.contextWindowTokens) || info.contextWindowTokens < 1_000)
    throw new Error('上下文窗口需为至少 1,000 的安全整数。');
  if (!Number.isSafeInteger(requestedOutputTokens) || requestedOutputTokens <= 0)
    throw new Error('输出预算需为正安全整数。');
  if (info.maxOutputTokens !== undefined && positiveLimit(info.maxOutputTokens) === undefined)
    throw new Error('模型输出上限需为正安全整数。');
  return { contextWindowTokens: info.contextWindowTokens, outputReserveTokens: Math.min(
    requestedOutputTokens, info.maxOutputTokens ?? requestedOutputTokens,
    Math.floor(info.contextWindowTokens / 2),
  ) };
}
