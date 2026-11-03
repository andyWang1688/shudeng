/** AI 服务连通性测试：用 Agent 对一句固定问题跑一轮，不写聊天记录。 */
import { InMemoryBookSource, createChatModel, runBookAgent } from '@shudeng/core/agent';
import type { AIConfig } from './aiConfig';

export interface AITestOptions {
  /** 硬超时；默认 22s，允许测试注入更短值。 */
  readonly timeoutMs?: number | undefined;
  /** 页面卸载/用户取消时 abort；abort 后仍 resolve 一个失败结果。 */
  readonly signal?: AbortSignal | undefined;
}

const DEFAULT_TIMEOUT_MS = 22_000;

/**
 * 固定问题跑一轮 Agent 测试连接。任何路径（成功/异常/超时/取消）都 resolve，
 * 不会让设置页 spinner 悬挂；超时/取消会 cancel Agent session。
 */
export async function testAIConnection(
  config: AIConfig,
  options: AITestOptions = {},
): Promise<{ ok: boolean; message: string }> {
  const timeoutMs = Math.min(30_000, Math.max(5_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const signal = options.signal;
  if (signal?.aborted) return { ok: false, message: '已取消连接测试' };

  let session: ReturnType<typeof runBookAgent> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let abortHandler: (() => void) | null = null;

  const fallback = new Promise<{ ok: false; message: string }>((resolve) => {
    const finish = (message: string): void => {
      try {
        session?.cancel();
      } catch {
        // 取消尽力而为；Promise.race 已保证不会悬挂。
      }
      resolve({ ok: false, message });
    };
    timer = setTimeout(() => finish('连接超时，请检查网络或 Base URL 后重试。'), timeoutMs);
    abortHandler = () => finish('已取消连接测试');
    signal?.addEventListener('abort', abortHandler, { once: true });
    if (signal?.aborted) finish('已取消连接测试');
  });

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
    session = runBookAgent({ model, source, book, question: '请用一句话确认你能正常回答。' });

    const result = await Promise.race([session.result, fallback]);
    if (result === null) return { ok: false, message: '连接测试被取消或超时，请重试。' };
    if ('ok' in result) return result;
    if (!result.answer.trim()) return { ok: false, message: '模型未返回回答' };
    return { ok: true, message: `连接成功：${result.answer.replace(/\s+/g, ' ').slice(0, 120)}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  } finally {
    if (timer !== null) clearTimeout(timer);
    if (abortHandler) signal?.removeEventListener('abort', abortHandler);
    try {
      session?.cancel();
    } catch {
      // session 已结束或取消失败都不影响测试结果。
    }
  }
}
