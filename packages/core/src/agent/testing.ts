/**
 * 测试/评测用的脚本化 ChatModel（自定义 BaseChatModel，无网络、无 key）。
 * 只用于测试与 eval，不进入 Agent 公共 API。
 */
import { BaseChatModel, type BaseChatModelCallOptions } from '@langchain/core/language_models/chat_models';
import { AIMessageChunk, type BaseMessage } from '@langchain/core/messages';
import { ChatGenerationChunk } from '@langchain/core/outputs';
import type { ChatResult } from '@langchain/core/outputs';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { AgentModelHandle } from './providers.js';

export interface ScriptedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ScriptedChunk {
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
  /** 回答正文增量。 */
  text?: string;
  /** provider 原生思考增量（模拟 DeepSeek reasoning_content）。 */
  reasoning?: string;
  /** 本 chunk 携带的工具调用（一次性完整参数）。 */
  toolCalls?: ReadonlyArray<ScriptedToolCall>;
  /** 该 chunk 前的延迟毫秒数，用于取消测试。 */
  delayMs?: number;
}

export interface ScriptedTurn {
  chunks: ReadonlyArray<ScriptedChunk>;
}

function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    if (signal?.aborted) {
      clearTimeout(timer);
      reject(abortError());
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** 自定义脚本 ChatModel：逐 chunk 产出 content / reasoning / tool_calls，并记录每次请求的消息。 */
export class ScriptedChatModel extends BaseChatModel<BaseChatModelCallOptions> {
  private readonly turns: ScriptedTurn[];
  private index = 0;
  readonly calls: BaseMessage[][] = [];
  boundTools: unknown[] = [];

  constructor(turns: ReadonlyArray<ScriptedTurn>) {
    super({});
    this.turns = turns.map((turn) => ({ chunks: turn.chunks }));
  }

  _llmType(): string {
    return 'scripted-chat-model';
  }

  override bindTools(tools: unknown[]): this {
    this.boundTools = tools;
    return this;
  }

  /** 逐 chunk 产出（模拟 provider 流式 chunk）；真实 provider 在 invoke 路径也会走流式回调。 */
  private async *turnChunks(options: this['ParsedCallOptions']): AsyncGenerator<ChatGenerationChunk> {
    const turn = this.turns[this.index++] ?? { chunks: [] };
    for (const chunk of turn.chunks) {
      await delay(chunk.delayMs ?? 0, options.signal);
      if (options.signal?.aborted) throw abortError();
      const toolCallChunks = (chunk.toolCalls ?? []).map((call, offset) => ({
        name: call.name,
        args: JSON.stringify(call.args),
        id: call.id,
        index: offset,
        type: 'tool_call_chunk' as const,
      }));
      const message = new AIMessageChunk({
        content: chunk.text ?? '',
        additional_kwargs: chunk.reasoning ? { reasoning_content: chunk.reasoning } : {},
        tool_call_chunks: toolCallChunks,
      });
      if (chunk.usage) Object.assign(message, { usage_metadata: chunk.usage });
      yield new ChatGenerationChunk({ text: chunk.text ?? '', message });
    }
  }

  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    this.calls.push(messages);
    let aggregated: ChatGenerationChunk | undefined;
    for await (const chunk of this.turnChunks(options)) {
      // 模拟 ChatOpenAI 的流式回调：LangGraph messages 模式下逐 chunk 可见（含 reasoning）。
      await runManager?.handleLLMNewToken(
        chunk.text ?? '',
        { prompt: 0, completion: 0 },
        undefined,
        undefined,
        undefined,
        { chunk } as never,
      );
      aggregated = aggregated ? aggregated.concat(chunk) : chunk;
    }
    const final =
      aggregated ?? new ChatGenerationChunk({ text: '', message: new AIMessageChunk({ content: '' }) });
    return { generations: [final] };
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    this.calls.push(messages);
    yield* this.turnChunks(options);
  }
}

/** 构造脚本模型句柄（provider 标签固定为 scripted，便于评测/测试断言）。 */
export function createScriptedModel(turns: ReadonlyArray<ScriptedTurn>): AgentModelHandle {
  return {
    provider: 'scripted',
    model: 'scripted',
    langChainModel: new ScriptedChatModel(turns),
  };
}
