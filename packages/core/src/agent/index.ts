/**
 * Agent 模块公共 API：只暴露自定义事件/端口/不透明模型句柄。
 * LangChain/LangGraph 类型不出本模块。
 */
export * from './events.js';
export * from './book-source.js';
export * from './agent.js';
export { createChatModel, deepSeekThinkingParams } from './providers.js';
export type {
  AgentModelConfig,
  AgentModelHandle,
  AgentProvider,
} from './providers.js';
