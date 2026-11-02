/**
 * 书内只读工具：search_book / read_page / read_chapter。
 * 工具只通过 BookSource 端口读原文，并把原文登记到本轮 EvidenceRegistry，
 * 供完成时引用核对。模型只看到 [E#] + 预览，quote 真值在登记表里。
 */
import { tool } from 'langchain';
import { z } from 'zod';
import type { BookExcerpt, BookPassage, BookSource } from './book-source.js';
import type { EvidenceRegistry } from './evidence.js';

const PREVIEW_LIMIT = 900;

function preview(text: string, limit = PREVIEW_LIMIT): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit)}…（片段较长，仅显示前 ${limit} 字）`;
}

function renderHits(hits: BookExcerpt[], registry: EvidenceRegistry): string {
  if (!hits.length) {
    return '没有找到相关原文。可以换关键词、查看目录，或明确告诉读者没有找到。';
  }
  const lines = ['引用时必须使用方括号里的 id；quote 必须是该条原文中的连续文字：'];
  for (const hit of hits) {
    const evidence = registry.register(hit);
    const location = hit.page ? `${hit.chapter} · 第 ${hit.page} 页` : hit.chapter;
    lines.push(`[${evidence.id}] ${location}\n${preview(evidence.quote)}`);
  }
  return lines.join('\n\n');
}

function renderPassage(passage: BookPassage, target: string, registry: EvidenceRegistry): string {
  if (!passage.excerpts.length) {
    return `${target} 没有可读取的文字（可能是扫描页或空白页）；可以换一页或改用 search_book。`;
  }
  const heading = passage.truncated
    ? `${target} 原文（后文较长，只返回前面几段）。引用时使用方括号里的 id：`
    : `${target} 原文。引用时使用方括号里的 id：`;
  const lines = [heading];
  for (const excerpt of passage.excerpts) {
    const evidence = registry.register(excerpt);
    lines.push(`[${evidence.id}] ${preview(evidence.quote, 1200)}`);
  }
  return lines.join('\n\n');
}

function failure(message: string): string {
  return `工具执行失败：${message}。请修正参数或换一种方式继续；不要假设工具返回了内容。`;
}

/**
 * 构造本轮可用的 LangChain 工具。
 * 每次运行新建（EvidenceRegistry 是运行内状态），Agent 模块之外不暴露这些工具实例。
 */
export function createBookTools(source: BookSource, registry: EvidenceRegistry) {
  const searchBook = tool(
    async ({ query, limit }) => {
      try {
        const hits = await source.search(query, limit ?? 5);
        return renderHits(hits, registry);
      } catch (error) {
        return failure(error instanceof Error ? error.message : '检索失败');
      }
    },
    {
      name: 'search_book',
      description:
        '在当前书中搜索关键词，返回可引用的原文片段。需要书内依据时先用它；没找到可以换更具体的词再试。',
      schema: z.object({
        query: z.string().describe('搜索关键词或短语，建议 2 个字以上'),
        limit: z.number().int().min(1).max(8).optional().describe('返回条数，1-8，默认 5'),
      }),
    },
  );

  const readPage = tool(
    async ({ page }) => {
      try {
        const passage = await source.page(page);
        if (!passage) return failure(`没有找到第 ${page} 页/章`);
        return renderPassage(passage, `第 ${page} 页/章`, registry);
      } catch (error) {
        return failure(error instanceof Error ? error.message : '读取失败');
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
        const passage = await source.chapter(reference);
        if (!passage) return failure(`没有找到章节「${reference}」`);
        return renderPassage(passage, passage.chapter, registry);
      } catch (error) {
        return failure(error instanceof Error ? error.message : '读取失败');
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

  return [searchBook, readPage, readChapter];
}
