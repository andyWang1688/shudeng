/** Native context policy implemented as a LangChain model middleware preparation step. */
import { SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { collectGraphemes } from 'unicode-segmenter/grapheme';
import type { AgentContextEstimate } from './events.js';
import { contentText, estimateMessageTokens, estimateRequestContext } from './request-context.js';

export const CONTEXT_SUMMARY_PREFIX = '[此前对话摘要，仅作背景，不是书内原文]\n';
export const TOOL_TRIMMED_SUFFIX = '\n…（工具结果过长已裁剪；如需要请重新调用工具读取更小范围）';

export interface ContextBudget {
  readonly window: number;
  readonly threshold: number;
  readonly retainTokens: number;
}

export function nativeContextBudget(window: number, outputReserve = 1400): ContextBudget {
  const size = Math.max(2000, Math.floor(window));
  const reserve = Math.max(0, outputReserve);
  const headroom = Math.min(16000, Math.max(8000, Math.floor(size / 10)));
  return { window: size, threshold: Math.max(1000, Math.min(Math.floor(size * 0.8), size - reserve - headroom)),
    retainTokens: Math.max(256, Math.floor(Math.max(1000, size - reserve) * 0.16)) };
}

/** Swift String.prefix/suffix count extended graphemes, rather than UTF-16 units. */
export function textCharacters(text: string): string[] {
  return collectGraphemes(text);
}

function groups(messages: readonly BaseMessage[]): BaseMessage[][] {
  const result: BaseMessage[][] = [];
  for (const message of messages) {
    const lastGroup = result.at(-1);
    const last = lastGroup?.at(-1);
    if (message.getType() === 'tool' && (last?.getType() === 'ai' || last?.getType() === 'tool')) lastGroup!.push(message);
    else result.push([message]);
  }
  return result;
}

function droppingPrefix(messages: readonly BaseMessage[], count: number): BaseMessage[] {
  if (count <= 0) return [...messages];
  let dropped = 0;
  const all = groups(messages);
  const kept = all.filter(group => {
    if (dropped >= count) return true;
    dropped += group.length;
    return false;
  }).flat();
  return kept.length ? kept : all.at(-1) ?? [];
}

export function summaryTranscript(messages: readonly BaseMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    const text = contentText(message.content);
    if (message.getType() === 'human') lines.push('读者：' + text);
    else if (message.getType() === 'ai') {
      if (text) lines.push('助手：' + text);
      if ('tool_calls' in message && Array.isArray(message.tool_calls) && message.tool_calls.length)
        lines.push('（调用工具：' + message.tool_calls.map(call => call.name).join('、') + '）');
    } else if (message.getType() === 'tool') lines.push('（工具结果：' + textCharacters(text).slice(0, 300).join('') + '）');
  }
  const chars = textCharacters(lines.join('\n'));
  return chars.length > 6000 ? '…' + chars.slice(-6000).join('') : chars.join('');
}

export class ContextBudgetError extends Error {
  constructor(estimate: AgentContextEstimate) {
    super('本次对话已超出模型上下文窗口（约 ' + estimate.estimatedTokens + ' tokens，窗口 ' +
      estimate.contextWindowTokens + '，压缩阈值 ' + estimate.thresholdTokens + '）；请新建对话或缩短问题后重试。');
    this.name = 'ContextBudgetError';
  }
}

export interface PreparedContext {
  readonly messages: BaseMessage[];
  readonly estimate: AgentContextEstimate;
  readonly overBudget: boolean;
  readonly newSummary?: string;
}

/** Summary state is scoped to one run, matching native per-question record identity. */
export class NativeContextManager {
  private summary: string | undefined;
  private summarizedTotal = 0;
  readonly budget: ContextBudget;

  constructor(options: { window: number; outputReserve?: number; summary?: string },
    private readonly summarize: (messages: readonly BaseMessage[]) => Promise<string>,
    private readonly onToolTruncated?: (original: string, prefix: string, rendered: string) => void,
  ) {
    this.budget = nativeContextBudget(options.window, options.outputReserve);
    this.summary = options.summary;
  }

  async prepare(system: BaseMessage | undefined, messages: readonly BaseMessage[]): Promise<PreparedContext> {
    let working = droppingPrefix(messages, this.summarizedTotal);
    let summarized = 0;
    let trimmed = 0;
    let truncatedTools = 0;
    let action: AgentContextEstimate['action'] = 'none';
    let newSummary: string | undefined;
    const assembled = () => [
      ...(this.summary ? [new SystemMessage({ content: CONTEXT_SUMMARY_PREFIX + this.summary,
        additional_kwargs: { lc_source: 'summarization' } })] : []), ...working,
    ];
    const snapshot = () => estimateRequestContext(system, assembled(), {
      window: this.budget.window, threshold: this.budget.threshold, compacted: action === 'compacted',
      action, summarizedMessages: summarized, trimmedMessages: trimmed, truncatedToolResults: truncatedTools,
    });
    const finish = (): PreparedContext => {
      const estimate = snapshot();
      return { messages: assembled(), estimate, overBudget: estimate.estimatedTokens > this.budget.threshold,
        ...(newSummary ? { newSummary } : {}) };
    };
    if (snapshot().estimatedTokens <= this.budget.threshold) return finish();

    working = working.map(message => {
      if (message.getType() !== 'tool' || !('tool_call_id' in message)) return message;
      const original = contentText(message.content);
      const characters = textCharacters(original);
      if (characters.length <= 4000) return message;
      const prefix = characters.slice(0, 4000).join('');
      const content = prefix + TOOL_TRIMMED_SUFFIX;
      this.onToolTruncated?.(original, prefix, content);
      truncatedTools += 1;
      return new ToolMessage({ ...message, content, tool_call_id: String(message.tool_call_id) });
    });
    if (truncatedTools) {
      action = 'pruned';
      if (snapshot().estimatedTokens <= this.budget.threshold) return finish();
    }

    const all = groups(working);
    let tokens = 0;
    let count = 0;
    let keep = 0;
    for (const group of [...all].reverse()) {
      const groupTokens = group.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
      if (keep && (tokens + groupTokens > this.budget.retainTokens || count + group.length > 12)) break;
      keep += 1; tokens += groupTokens; count += group.length;
    }
    const old = all.slice(0, all.length - keep).flat();
    if (old.length) {
      let summary = '';
      try { summary = (await this.summarize(old)).trim(); } catch { /* Native fallback preserves the recent safe groups. */ }
      working = all.slice(all.length - keep).flat();
      if (summary) {
        this.summary = textCharacters(summary).slice(0, 2000).join('');
        this.summarizedTotal += old.length;
        summarized = old.length;
        newSummary = this.summary;
        action = 'compacted';
      } else { trimmed = old.length; action = 'trimmed'; }
      if (snapshot().estimatedTokens <= this.budget.threshold) return finish();
    }

    const remaining = groups(working);
    while (snapshot().estimatedTokens > this.budget.threshold && remaining.length > 1) {
      trimmed += remaining.shift()!.length;
      working = remaining.flat();
      action = 'trimmed';
    }
    return finish();
  }
}
