/** Product Skills and user instructions loaded by Deep Agents from virtual text files. */
import { createFilesystemMiddleware, createMemoryMiddleware, createSkillsMiddleware, StateBackend, type FileData } from 'deepagents/browser';
import type { AnyAgentMiddleware } from 'langchain';

export const DEFAULT_ASSISTANT_INSTRUCTIONS = '帮助我读懂书，而不是替我决定答案。先直接回应问题，用清楚的中文解释；必要时举例，并指出原文依据、补充知识与推断的区别。';

const skills = {
  'explain-selection': {
    description: '解释选中的句子、这句话、其中的人物指代、术语或论证时使用；先核对准确位置的前后文。',
    body: '# 选文解释\n1. 结合问题与提问选文确定疑惑。使用当前阅读位置调用 read_book_passage，读取有界前后文。\n2. 定位失败或位置不明确时说明；可用 search_book 查相关语境，但把搜索命中与原选文位置区分。\n3. 先按原文语境解释指代、术语和论证，再按需要跨章节查证。选文明确问题指向，可参考范围仍为当前整本书。\n4. 回答给出解释与实际读取的依据；类比、常识和推断分别说明。',
  },
  'verify-in-book': {
    description: '查证作者观点、找原文出处、比较术语或追问为什么时使用；通过搜索、展开与反例检查形成可核查依据。',
    body: '# 书内查证\n1. 把问题和对话中的指代改写为明确查询，用 search_book 查当前书。人名、术语用原词，同义表达用自然语言。\n2. 阅读相关命中的 readRef；需要更完整语境时调用 read_book_passage，并按 nextCursor 连续读取。\n3. 材料不足时带着具体缺口换词、跨章或查反例；避免重复相同搜索。结果分数表示相关性，不表示结论正确概率。\n4. 只引用本轮工具登记的来源ID与实际原文。查不到就明确说明，不用网页来源冒充书内观点。',
  },
  'cover-whole-book': {
    description: '总结整本书、梳理全书结构、跨章节比较或概括作者整体观点时使用；先规划章节覆盖，避免以少量搜索片段代表全书。',
    body: '# 全书覆盖\n1. 调用 get_book_outline 建立章节计划，使用游标逐批获取有界目录。\n2. 按目录 reference 使用 read_book_passage 读取章节；通过 nextCursor 续读，记录实际覆盖章节与被截断范围。\n3. 分章归纳，再合并主题、论证关系和差异。搜索用于定位或补查，不能替代全书覆盖。\n4. 达到工具、时间或输出预算时停止扩展，保留已核查依据，并在回答中明确已经覆盖与尚未覆盖的章节；只读到局部时给局部总结。',
  },
} as const;

export function createReadingGuidance(instructions?: string): { middleware: AnyAgentMiddleware[]; files: Record<string, FileData> } {
  const backend = new StateBackend();
  const timestamp = '2026-11-04T00:00:00.000Z';
  const file = (content: string): FileData => ({ content, mimeType: 'text/plain', created_at: timestamp, modified_at: timestamp });
  const files: Record<string, FileData> = {
    '/reader/AGENTS.md': file('## 读者自定义指令\n' + (instructions?.trim() || DEFAULT_ASSISTANT_INSTRUCTIONS)),
  };
  for (const [name, skill] of Object.entries(skills))
    files['/reader/skills/' + name + '/SKILL.md'] = file('---\nname: ' + name + '\ndescription: ' + skill.description + '\n---\n\n' + skill.body + '\n');
  return { files, middleware: [
    createMemoryMiddleware({ backend, sources: ['/reader/AGENTS.md'] }),
    createSkillsMiddleware({ backend, sources: ['/reader/skills/'] }),
    createFilesystemMiddleware({ backend, tools: ['read_file'],
      // Evidence stays in its registry; never silently evict it to files.
      toolTokenLimitBeforeEvict: null, humanMessageTokenLimitBeforeEvict: null,
      systemPrompt: 'read_file 只读取运行内的阅读 Skills 和读者配置；这些文件不包含书籍原文。按任务需要读取相关 SKILL.md。',
    }),
  ] as unknown as AnyAgentMiddleware[] };
}
