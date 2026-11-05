import type { ProviderEndpoint } from './provider-endpoint.js';

export type ProviderFetch = typeof globalThis.fetch;

export class ProviderBoundaryError extends Error {
  constructor(
    readonly code: 'redirect-denied' | 'endpoint-denied' | 'adapter-missing',
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'ProviderBoundaryError';
  }
}

/** SDKs wrap fetch rejections in APIConnectionError while preserving cause. */
export function providerBoundaryError(error: unknown): ProviderBoundaryError | undefined {
  const seen = new Set<object>();
  for (let current = error; typeof current === 'object' && current !== null && !seen.has(current);) {
    if (current instanceof ProviderBoundaryError) return current;
    seen.add(current);
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function isExplicitRedirectRejection(error: unknown): boolean {
  const seen = new Set<object>();
  for (let current = error; typeof current === 'object' && current !== null && !seen.has(current);) {
    seen.add(current);
    const { message, cause } = current as { message?: unknown; cause?: unknown };
    if (typeof message === 'string' && (
      // Expo 58 FetchRedirectException.reason, retained by FetchError.createFromError.
      message.includes("Redirect is not allowed when redirect mode is 'error'") ||
      // Node's standards-compliant fetch keeps this exact reason in cause.
      message === 'unexpected redirect'
    )) return true;
    current = cause;
  }
  return false;
}

function isNativeRuntime(): boolean {
  const scope = globalThis as unknown as {
    HermesInternal?: unknown;
    navigator?: { product?: string; userAgent?: string };
  };
  return (
    Boolean(scope.HermesInternal) ||
    scope.navigator?.product === 'ReactNative' ||
    scope.navigator?.userAgent === 'ReactNative'
  );
}

/**
 * The platform must inject a transport that rejects redirects before following them.
 * React Native's legacy fetch ignores redirect:error, so using it is a closed failure.
 * Expo 58 fetch's native URLSession redirect delegate calls completionHandler(nil).
 */
export function createProviderFetch(endpoint: ProviderEndpoint, injected?: ProviderFetch): ProviderFetch {
  if (!injected && isNativeRuntime())
    throw new ProviderBoundaryError('adapter-missing', 'AI 请求缺少可阻止重定向的原生网络适配器');
  const transport = injected ?? globalThis.fetch.bind(globalThis);
  return async (input, init) => {
    const inputURL = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const expected = new URL(endpoint.sdkEndpoint);
    if (
      inputURL.origin !== expected.origin ||
      inputURL.pathname !== expected.pathname ||
      inputURL.username ||
      inputURL.password ||
      inputURL.hash
    )
      throw new ProviderBoundaryError('endpoint-denied', 'AI SDK 尝试访问所配置文字端点以外的地址');
    const target = new URL(endpoint.endpoint);
    target.search = inputURL.search;
    // Request inputs retain their method/headers/body when a versioned Anthropic
    // SDK URL must be mapped to the configured custom text endpoint.
    const nextInput =
      typeof input === 'string' || input instanceof URL
        ? target.toString()
        : new Request(target.toString(), input);
    try {
      return await transport(nextInput, { ...init, credentials: 'omit', redirect: 'error' });
    } catch (error) {
      if (isExplicitRedirectRejection(error))
        throw new ProviderBoundaryError(
          'redirect-denied',
          '服务地址要求重定向，已拒绝跟随。请检查 Base URL 后重试。',
          error,
        );
      throw error;
    }
  };
}
