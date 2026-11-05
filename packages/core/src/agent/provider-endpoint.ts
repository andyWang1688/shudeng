import type { AgentProvider } from './providers.js';

export interface ProviderEndpoint {
  /** The exact text endpoint the person configured, following the native address contract. */
  readonly endpoint: string;
  readonly sdkBaseURL: string;
  /** Anthropic SDK always appends /v1/messages, even for custom version prefixes. */
  readonly sdkEndpoint: string;
}

const defaults: Record<AgentProvider, string> = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  deepseek: 'https://api.deepseek.com',
};

/** Mirrors AIConnection.endpoint(for:): root, API prefix and full text endpoint are accepted. */
export function resolveProviderEndpoint(provider: AgentProvider, address?: string): ProviderEndpoint {
  let url: URL;
  try {
    url = new URL(address === undefined ? defaults[provider] : address.trim());
  } catch {
    throw new Error('AI 服务地址无效');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  )
    throw new Error('AI 服务地址须为 HTTPS，或本机 HTTP；不能包含账号、查询参数或片段');
  const resource = provider === 'anthropic' ? '/messages' : '/chat/completions';
  let path = url.pathname.replace(/\/+$/, '');
  if (!path) path = '/v1';
  if (!path.endsWith(resource)) path += resource;
  url.pathname = path;
  const endpoint = url.toString();
  let sdkBaseURL = endpoint.slice(0, -resource.length);
  if (provider === 'anthropic' && sdkBaseURL.endsWith('/v1')) sdkBaseURL = sdkBaseURL.slice(0, -3);
  return {
    endpoint,
    sdkBaseURL,
    sdkEndpoint: sdkBaseURL + (provider === 'anthropic' ? '/v1/messages' : resource),
  };
}
