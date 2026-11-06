/**
 * 书内只读工具：search_book / read_page / read_chapter。
 * 工具只通过 BookSource 端口读原文，并把原文登记到本轮 EvidenceRegistry，
 * 供完成时引用核对。模型只看到 [E#] + 预览，quote 真值在登记表里。
 */
import { tool } from 'langchain';
import { z } from 'zod';
import type { BookExcerpt, BookPassage, BookSource, BookSourceContext } from './book-source.js';
import type { EvidenceRegistry, RenderedEvidenceMaterial } from './evidence.js';
import { assertNotAborted } from '../rag/types.js';

const PREVIEW_LIMIT = 900;

function preview(text: string, limit = PREVIEW_LIMIT): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit)}…（片段较长，仅显示前 ${limit} 字）`;
}

function locatorMetadata(locator: string): unknown {
  try {
    const parsed: unknown = JSON.parse(locator);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const { text: _sourceText, ...position } = parsed as Record<string, unknown>;
      return position;
    }
  } catch { /* Legacy non-JSON locators remain opaque. */ }
  return locator;
}

function renderHits(hits: BookExcerpt[], registry: EvidenceRegistry, limit = PREVIEW_LIMIT, budget = 8000): string {
  if (!hits.length) {
    return '没有找到相关原文。可以换关键词、查看目录，或明确告诉读者没有找到。';
  }
  const materials: RenderedEvidenceMaterial[] = [];
  const blocks = ['引用使用 citationId；quote 必须是下列原文中的连续文字。需要前后文时把 readRef 传给 read_book_passage。'];
  let remaining = budget;
  for (const hit of hits) {
    if (remaining <= 0) break;
    let end = Math.min(hit.quote.length, limit, remaining);
    if (end < hit.quote.length && /[\uD800-\uDBFF]/.test(hit.quote[end - 1] ?? '')) end -= 1;
    const visible = hit.quote.slice(0, end);
    if (!visible.trim()) continue;
    // 核验表只接收实际发给模型的原文，不能用不可见的全文替模型背书。
    const evidence = registry.register({ ...hit, context: visible, quote: visible });
    const location = hit.page ? `${hit.chapter} · 第 ${hit.page} 页` : hit.chapter;
    materials.push({ id: evidence.id, name: location, content: preview(hit.quote, end) });
    const metadata = { citationId: evidence.id,
      chapter: hit.chapter, ...(hit.page !== undefined ? { page: hit.page } : {}),
      locator: locatorMetadata(hit.locator), ...(hit.chunkId ? { chunkId: hit.chunkId } : {}),
      ...(hit.readRef ? { readRef: hit.readRef } : {}),
      ...(hit.sourceVersion ? { sourceVersion: hit.sourceVersion } : {}),
      ...(end < hit.quote.length ? { truncated: true } : {}) };
    blocks.push(`${JSON.stringify(metadata)}\n[${evidence.id}] ${location}\n${preview(hit.quote, end)}`);
    remaining -= visible.length;
  }
  if (materials.length < hits.length) blocks.push('返回内容已达到本次上限，请缩小检索或使用 read_book_passage 继续读取。');
  return registry.recordRendered(blocks.join('\n\n'), materials);
}

function renderPassage(passage: BookPassage, target: string, registry: EvidenceRegistry): string {
  if (!passage.excerpts.length) {
    return `${target} 没有可读取的文字（可能是扫描页或空白页）；可以换一页或改用 search_book。`;
  }
  const rendered = renderHits(passage.excerpts, registry, passage.reference ? 12000 : 1200, 12000);
  // Preserve the registered material association for request previews while adding continuation metadata.
  const metadata = { target, reference: passage.reference, nextCursor: passage.nextCursor, truncated: passage.truncated ?? false,
    locationPrecision: passage.locationPrecision, locationNote: passage.locationNote };
  const payload = `${JSON.stringify(metadata)}\n\n${rendered}`;
  return registry.recordRendered(payload, registry.renderedMaterials(rendered) ?? []);
}

function failure(message: string): string {
  return `工具执行失败：${message}。请修正参数或换一种方式继续；不要假设工具返回了内容。`;
}

function toolFailure(error: unknown, fallback: string): string {
  if (error instanceof Error && error.name === 'AbortError') throw error;
  return failure(error instanceof Error ? error.message : fallback);
}

/**
 * 构造本轮可用的 LangChain 工具。
 * 每次运行新建（EvidenceRegistry 是运行内状态），Agent 模块之外不暴露这些工具实例。
 */
export function createBookTools(source: BookSource, registry: EvidenceRegistry, context: BookSourceContext = {}) {
  const searchBook = tool(
    async ({ query, limit }) => {
      try {
        assertNotAborted(context.signal);
        const hits = await source.search(query, limit ?? 5, context);
        assertNotAborted(context.signal);
        return renderHits(hits, registry);
      } catch (error) {
        return toolFailure(error, '检索失败');
      }
    },
    {
      name: 'search_book',
      description:
        '只检索当前整本书，自动融合关键词和本地向量，返回原文、引用 ID 和 readRef。可以使用自然语言或关键词，多次改写检索；结果不足时用 read_book_passage 展开原文。',
      schema: z.object({
        query: z.string().min(1).max(1000).describe('自然语言问题、关键词或短语，建议聚焦一个主题'),
        limit: z.number().int().min(1).max(8).optional().describe('返回条数，1-8，默认 5'),
      }),
    },
  );

  const getOutline = tool(async ({ cursor, limit }) => {
    try {
      if (!source.outline) return failure('当前书源不支持读取目录');
      assertNotAborted(context.signal);
      const outline = await source.outline({ ...(cursor ? { cursor } : {}), ...(limit ? { limit } : {}) }, context);
      assertNotAborted(context.signal);
      return JSON.stringify(outline);
    } catch (error) { return toolFailure(error, '目录读取失败'); }
  }, {
    name: 'get_book_outline',
    description: '分批读取当前书的章节目录和章节 reference。全书问题先查看目录并逐章补充依据；有 nextCursor 时继续读取目录，不能把少量搜索结果当成整本书。',
    schema: z.object({ cursor: z.string().max(4000).optional().describe('上次返回的 nextCursor，原样传入'), limit: z.number().int().min(1).max(50).optional() }),
  });

  const readPassage = tool(async ({ reference, cursor, before, after, maxChars }) => {
    try {
      if (!source.passage) return failure('当前书源不支持定位续读，请改用 read_chapter');
      assertNotAborted(context.signal);
      const passage = await source.passage({ reference, ...(cursor ? { cursor } : {}),
        ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}), ...(maxChars !== undefined ? { maxChars } : {}) }, context);
      assertNotAborted(context.signal);
      return passage ? renderPassage(passage, passage.chapter, registry) : failure('没有找到该位置的原文');
    } catch (error) { return toolFailure(error, '原文读取失败'); }
  }, {
    name: 'read_book_passage',
    description: '按 search_book 的 readRef、目录 reference 或当前阅读 locator JSON 读取原文及前后文。返回 nextCursor 时，使用同一个 reference 和该 cursor 继续读；只返回当前书原文。',
    schema: z.object({ reference: z.string().min(1).max(8000), cursor: z.string().max(16000).optional(),
      before: z.number().int().min(0).max(3).optional(), after: z.number().int().min(0).max(19).optional(),
      maxChars: z.number().int().min(256).max(12000).optional() }),
  });

  const readPage = tool(
    async ({ page }) => {
      try {
        assertNotAborted(context.signal);
        const passage = await source.page(page, context);
        assertNotAborted(context.signal);
        if (!passage) return failure(`没有找到第 ${page} 页/章`);
        return renderPassage(passage, `第 ${page} 页/章`, registry);
      } catch (error) {
        return toolFailure(error, '读取失败');
      }
    },
    {
      name: 'read_page',
      description: '读取指定页（PDF）或指定章节序号（EPUB，第一章为 1）的原文。',
      schema: z.object({
        page: z.number().int().min(1).max(20000).describe('页号（PDF）或章节序号（EPUB），从 1 开始'),
      }),
    },
  );

  const readChapter = tool(
    async ({ reference }) => {
      try {
        assertNotAborted(context.signal);
        const passage = await source.chapter(reference, context);
        assertNotAborted(context.signal);
        if (!passage) return failure(`没有找到章节「${reference}」`);
        return renderPassage(passage, passage.chapter, registry);
      } catch (error) {
        return toolFailure(error, '读取失败');
      }
    },
    {
      name: 'read_chapter',
      description: '按章节标题、目录里的 href 或序号读取一章原文（PDF 也可按页序号读取）。',
      schema: z.object({
        reference: z.string().describe('章节标题、目录里的 href，或从 1 开始的章节序号'),
      }),
    },
  );

  return [searchBook, readPage, readChapter, getOutline, readPassage] as [
    typeof searchBook, typeof readPage, typeof readChapter, typeof getOutline, typeof readPassage,
  ];
}
