import { stampRetryable } from '@langchain/core/errors';
import { AsyncCaller } from '@langchain/core/utils/async_caller';
import type { AsyncCallerCallOptions } from '@langchain/core/utils/async_caller';
import { providerBoundaryError } from './provider-transport.js';

// Mirror AsyncCaller's public generics; no SDK retry loop or internal handler is replaced.
function withProviderBoundary<T extends (...args: any[]) => Promise<any>>(callable: T): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await callable(...args);
    } catch (error) {
      const boundary = providerBoundaryError(error);
      throw boundary ? stampRetryable(boundary, false) : error;
    }
  }) as T;
}

/**
 * Uses only LangChain 1.3's public AsyncCaller methods and retryable metadata.
 * Its default HTTP/rate-limit/temporary-network policy remains in super.
 */
export class ProviderAsyncCaller extends AsyncCaller {
  override call<A extends any[], T extends (...args: A) => Promise<any>>(
    callable: T,
    ...args: Parameters<T>
  ): Promise<Awaited<ReturnType<T>>> {
    return super.call(withProviderBoundary(callable), ...args);
  }

  override callWithOptions<A extends any[], T extends (...args: A) => Promise<any>>(
    options: AsyncCallerCallOptions,
    callable: T,
    ...args: Parameters<T>
  ): Promise<Awaited<ReturnType<T>>> {
    return super.callWithOptions(options, withProviderBoundary(callable), ...args);
  }
}
