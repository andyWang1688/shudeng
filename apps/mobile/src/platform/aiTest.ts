/** AI 服务连通性测试：用 Agent 对一句固定问题跑一轮，不写聊天记录。 */
import { InMemoryBookSource, createChatModel, runBookAgent } from '@shudeng/core/agent';
import type { AIConfig } from './aiConfig';

export async function testAIConnection(config: AIConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const model = createChatModel({
      provider: config.provider,
      model: config.model,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      thinking: config.provider === 'deepseek',
      reasoningEffort: 'high',
      maxTokens: 2048,
    });
    const book = { id: 'connection-test', title: '连接测试', format: 'epub' as const, sourceHash: 'test' };
    const source = new InMemoryBookSource({
      book,
      chapters: [{ title: '连接测试', paragraphs: ['这是连接测试材料。'] }],
    });
    const session = runBookAgent({ model, source, book, question: '请用一句话确认你能正常回答。' });
    const timer = setTimeout(() => session.cancel(), 120_000);
    try {
      const result = await session.result;
      if (!result || !result.answer.trim()) return { ok: false, message: '模型未返回回答' };
      return { ok: true, message: `连接成功：${result.answer.replace(/\s+/g, ' ').slice(0, 120)}` };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
