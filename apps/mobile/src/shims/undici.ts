/** undici 在 RN 里用全局 fetch/Web 类型替代。 */
type FetchInput = Parameters<typeof globalThis.fetch>[0];
type FetchInit = Parameters<typeof globalThis.fetch>[1];
export function fetch(input: FetchInput, init?: FetchInit): Promise<Response> {
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('fetch is not available in this runtime');
  }
  return globalThis.fetch(input, init);
}
export const Headers = globalThis.Headers;
export const Request = globalThis.Request;
export const Response = globalThis.Response;
export const FormData = globalThis.FormData;
export const Blob = globalThis.Blob;
export class Agent {
  constructor(_options?: unknown) {}
}
export class ProxyAgent extends Agent {}
export class Dispatcher extends Agent {}
export default { fetch, Headers, Request, Response, FormData, Blob, Agent, ProxyAgent, Dispatcher };
