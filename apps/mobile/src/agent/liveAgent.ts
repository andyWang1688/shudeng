/**
 * 开发/QA 用真实 provider 演示：从 App Documents/live-agent.json 读取配置，
 * 不把 key 写入源码或 bundle。生产接入时应改为 SecureStore + AI 服务设置页。
 */
import { File, Paths } from 'expo-file-system';
import { InMemoryBookSource, createChatModel, runBookAgent } from '@shudeng/core/agent';
import type { BookIdentity } from '@shudeng/core/domain';

export type LiveAgentConfig = {
  provider: 'deepseek' | 'openai' | 'anthropic';
  baseUrl: string;
  model: string;
  apiKey: string;
};

const book: BookIdentity = {
  id: 'live-ios-lamp',
  title: '真实模型演示',
  format: 'epub',
  sourceHash: 'live-ios',
};

const source = new InMemoryBookSource({
  book,
  chapters: [
    {
      title: '第一章 · 灯',
      paragraphs: [
        '灯把书页照亮，也把问题留在纸上。',
        '阅读不是把答案抄下来，而是把原文读慢一点。',
      ],
    },
  ],
});

function readConfig(): LiveAgentConfig {
  const file = new File(Paths.document, 'live-agent.json');
  if (!file.exists) throw new Error('缺少 App Documents/live-agent.json（开发配置，不提交仓库）');
  const parsed = JSON.parse(file.textSync()) as Partial<LiveAgentConfig>;
  if (!parsed.apiKey || !parsed.baseUrl || !parsed.model || !parsed.provider) {
    throw new Error('live-agent.json 缺少 provider/baseUrl/model/apiKey');
  }
  return parsed as LiveAgentConfig;
}

export function startLiveAgent(question: string) {
  const config = readConfig();
  const model = createChatModel({
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey,
    thinking: config.provider === 'deepseek',
    reasoningEffort: 'high',
    maxTokens: 8192,
  });
  return runBookAgent({ model, source, book, question });
}
