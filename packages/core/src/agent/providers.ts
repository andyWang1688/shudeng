/**
 * Provider 适配：OpenAI / Anthropic / DeepSeek。
 *
 * 对外只暴露不透明 `AgentModelHandle`（provider/model 标签 + 内部 LangChain 实例），
 * LangChain 类型不进入 packages/core 的公共 API。
 *
 * DeepSeek：
 * - 请求显式带 `thinking: {type:"enabled"}` + `reasoning_effort`（直接复用官方 OpenAI 兼容接口）。
 * - 响应流里的 `delta.reasoning_content` 会被 @langchain/openai 放进
 *   `AIMessage.additional_kwargs.reasoning_content`（已核对 1.8.0 源码），Agent 层转 reasoningDelta。
 * - 工具循环的下一轮请求必须回传 assistant 的 `reasoning_content`（DeepSeek 官方要求，否则 400），
 *   而 @langchain/openai 的默认消息转换器不会回传该字段（已核对 converters/completions 源码），
 *   所以在 DeepSeek 适配器里通过自定义 fetch 在请求体上补回（纯函数 injectReasoningContent，单测覆盖）。
 */
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatGenerationChunk, ChatResult } from '@langchain/core/outputs';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { RunnableConfig } from '@langchain/core/runnables';

export type AgentProvider = 'openai' | 'anthropic' | 'deepseek';

export interface AgentModelConfig {
  provider: AgentProvider;
  model: string;
  apiKey: string;
  /** 自定义 OpenAI 兼容网关地址（DeepSeek 默认 https://api.deepseek.com）。 */
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  /** DeepSeek 原生思考开关（默认开启；其它 provider 忽略）。 */
  thinking?: boolean;
  reasoningEffort?: 'low' | 'high' | 'max';
}

/**
 * 不透明模型句柄：公共 API 只看到 provider/model 标签。
 * `langChainModel` 仅供 agent 模块内部转换为 LangChain BaseChatModel，调用方不要使用。
 */
export interface AgentModelHandle {
  readonly provider: string;
  readonly model: string;
  /** @internal */
  readonly langChainModel: unknown;
}

/** DeepSeek 思考模式的请求参数（纯函数，便于单测与文档对齐）。 */
export function deepSeekThinkingParams(
  thinking: boolean,
  effort: 'low' | 'high' | 'max' = 'high',
): Record<string, unknown> {
  if (!thinking) return {};
  return { thinking: { type: 'enabled' }, reasoning_effort: effort };
}

function reasoningOf(message: BaseMessage): string | undefined {
  if (message.getType() !== 'ai') return undefined;
  const kwargs = message.additional_kwargs as Record<string, unknown>;
  const direct = kwargs.reasoning_content ?? kwargs.reasoning;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const content = message.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block !== 'object' || block === null) continue;
      const value = block as Record<string, unknown>;
      const type = value.type;
      if ((type === 'thinking' || type === 'reasoning') && typeof value.thinking === 'string') {
        return value.thinking;
      }
    }
  }
  return undefined;
}

/**
 * 把 LangChain 历史里的 assistant reasoning 回填进 OpenAI Chat Completions 请求体的
 * 对应 assistant 消息（按 assistant 出现顺序对齐）。保持 provider 原样，不拼接/截断。
 */
export function injectReasoningContent(
  openAIMessages: ReadonlyArray<Record<string, unknown>>,
  langChainMessages: ReadonlyArray<BaseMessage>,
): Array<Record<string, unknown>> {
  const reasoning: string[] = [];
  for (const message of langChainMessages) {
    const value = reasoningOf(message);
    if (value) reasoning.push(value);
  }
  if (!reasoning.length) return openAIMessages.map((message) => ({ ...message }));
  let cursor = 0;
  return openAIMessages.map((message) => {
    const copy = { ...message };
    if (copy.role === 'assistant' && cursor < reasoning.length) {
      const value = reasoning[cursor++];
      if (value && copy.reasoning_content === undefined) copy.reasoning_content = value;
    }
    return copy;
  });
}

function langchainReasoningDebug(messages: ReadonlyArray<BaseMessage>): string[] {
  return messages
    .filter((message) => message.getType() === 'ai')
    .map((message) => String((message.additional_kwargs as Record<string, unknown>).reasoning_content ?? ''));
}

interface DeepSeekReasoningState {
  lastMessages: BaseMessage[];
}

/** 在发请求前把历史 assistant 的 reasoning_content 补回（DeepSeek 工具循环硬要求）。 */
async function echoReasoningFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  state: DeepSeekReasoningState,
): Promise<Response> {
  let nextInit = init;
  if (init?.body && typeof init.body === 'string' && state.lastMessages.length) {
    try {
      const body: unknown = JSON.parse(init.body);
      if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>;
        if (Array.isArray(record.messages)) {
          record.messages = injectReasoningContent(
            record.messages as Array<Record<string, unknown>>,
            state.lastMessages,
          );
          nextInit = { ...init, body: JSON.stringify(record) };
        }
      }
    } catch {
      // 请求体不可解析时原样透传，不影响主流程。
    }
  }
  return globalThis.fetch(input, nextInit);
}

class DeepSeekChatOpenAI extends ChatOpenAI {
  readonly #state: DeepSeekReasoningState;

  constructor(fields: ConstructorParameters<typeof ChatOpenAI>[0], state: DeepSeekReasoningState) {
    super(fields);
    this.#state = state;
  }

  /**
   * ChatOpenAI.withConfig 会 new 一个基类实例（bindTools 内部走 withConfig），
   * 这里重写成同类型实例并共享 reasoning 采集状态，确保自定义 fetch 能读到本轮历史。
   */
  override withConfig(config: RunnableConfig): this {
    const clone = new DeepSeekChatOpenAI(
      (this as unknown as { fields: ConstructorParameters<typeof ChatOpenAI>[0] }).fields,
      this.#state,
    );
    const defaults = (clone as unknown as { defaultOptions?: Record<string, unknown> }).defaultOptions ?? {};
    const current = (this as unknown as { defaultOptions?: Record<string, unknown> }).defaultOptions ?? {};
    (clone as unknown as { defaultOptions: Record<string, unknown> }).defaultOptions = {
      ...current,
      ...defaults,
      ...config,
    };
    return clone as unknown as this;
  }

  override async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    this.#state.lastMessages = messages;
    return super._generate(messages, options, runManager);
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    this.#state.lastMessages = messages;
    yield* super._streamResponseChunks(messages, options, runManager);
  }
}

function requireApiKey(config: AgentModelConfig): string {
  const key = config.apiKey.trim();
  if (!key) throw new Error('缺少 API Key：请先在 AI 服务里配置密钥');
  return key;
}

/** 按配置创建不透明模型句柄；测试/评测可用 testing.ts 的 ScriptedChatModel 替代。 */
export function createChatModel(config: AgentModelConfig): AgentModelHandle {
  const apiKey = requireApiKey(config);
  const maxTokens = config.maxTokens ?? 8_192;
  switch (config.provider) {
    case 'openai': {
      const model = new ChatOpenAI({
        apiKey,
        model: config.model,
        streaming: true,
        maxTokens,
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
        ...(config.baseUrl ? { configuration: { baseURL: config.baseUrl } } : {}),
      });
      return { provider: 'openai', model: config.model, langChainModel: model satisfies BaseChatModel };
    }
    case 'anthropic': {
      const model = new ChatAnthropic({
        apiKey,
        model: config.model,
        streaming: true,
        maxTokens,
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
        ...(config.baseUrl ? { clientOptions: { baseURL: config.baseUrl } } : {}),
      });
      return { provider: 'anthropic', model: config.model, langChainModel: model satisfies BaseChatModel };
    }
    case 'deepseek': {
      const thinking = config.thinking ?? true;
      const state: DeepSeekReasoningState = { lastMessages: [] };
      const model = new DeepSeekChatOpenAI(
        {
          apiKey,
          model: config.model,
          streaming: true,
          timeout: 180_000,
          maxTokens: config.maxTokens ?? 16_384,
          modelKwargs: deepSeekThinkingParams(thinking, config.reasoningEffort ?? 'high'),
          configuration: {
            baseURL: config.baseUrl ?? 'https://api.deepseek.com',
            fetch: (input: RequestInfo | URL, init?: RequestInit) =>
              echoReasoningFetch(input, init, state),
          },
        },
        state,
      );
      return { provider: 'deepseek', model: config.model, langChainModel: model satisfies BaseChatModel };
    }
    default: {
      const exhaustive: never = config.provider;
      throw new Error(`不支持的 provider: ${String(exhaustive)}`);
    }
  }
}
