import type { WebSource } from '@shudeng/core';

export interface WebSearchPresentation {
  readonly status: 'disabled' | 'unsupported' | 'enabled' | 'searching' | 'complete' | 'failed';
  readonly message?: string;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Persist only real navigable source metadata, never model-generated Markdown links. */
export function parseWebSources(value: unknown): WebSource[] {
  if (!Array.isArray(value)) return [];
  const sources: WebSource[] = [];
  const ids = new Set<string>();
  for (const item of value.slice(0, 100)) {
    if (!record(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id) ||
      typeof item.url !== 'string' || typeof item.title !== 'string' ||
      (item.provider !== 'openai' && item.provider !== 'anthropic')) continue;
    try {
      const url = new URL(item.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
    } catch { continue; }
    ids.add(item.id);
    sources.push({ id: item.id, url: item.url, title: item.title, provider: item.provider });
  }
  return sources;
}

export function parseWebSearchPresentation(value: unknown): WebSearchPresentation | undefined {
  if (!record(value)) return undefined;
  const status = value.status;
  if (status !== 'disabled' && status !== 'unsupported' && status !== 'enabled' &&
    status !== 'searching' && status !== 'complete' && status !== 'failed') return undefined;
  return { status, ...(typeof value.message === 'string' ? { message: value.message } : {}) };
}
