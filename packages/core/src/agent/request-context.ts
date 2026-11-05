import type { BaseMessage } from '@langchain/core/messages';
import type { AgentContextEstimate, AgentSentMaterial } from './events.js';
import type { RenderedEvidenceMaterial } from './evidence.js';

export function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((block: unknown) => {
    if (typeof block !== 'object' || block === null) return '';
    const value = block as Record<string, unknown>;
    return value.type === 'text' && typeof value.text === 'string' ? value.text : '';
  }).join('');
}

/** Same CJK/scalar heuristic as native AgentTokenEstimator; not a billing count. */
export function estimateTextTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const scalar of text) {
    if (/\p{White_Space}/u.test(scalar)) continue;
    const value = scalar.codePointAt(0)!;
    if ((value >= 0x4e00 && value <= 0x9fff) || (value >= 0x3400 && value <= 0x4dbf) ||
        (value >= 0x3000 && value <= 0x303f) || (value >= 0xff00 && value <= 0xffef)) cjk += 1;
    else other += 1;
  }
  return cjk + Math.ceil(other / 4);
}

export function estimateMessageTokens(message: BaseMessage): number {
  const text = contentText(message.content);
  const reasoningValue = message.additional_kwargs?.reasoning_content ?? message.additional_kwargs?.reasoning;
  const reasoning = typeof reasoningValue === 'string' ? reasoningValue : '';
  let tokens = 4 + estimateTextTokens(text) + estimateTextTokens(reasoning);
  if ('tool_calls' in message && Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls)
      tokens += 4 + estimateTextTokens(call.name ?? '') + estimateTextTokens(JSON.stringify(call.args ?? {}));
  }
  return tokens;
}

export function estimateRequestContext(
  system: BaseMessage | undefined, messages: readonly BaseMessage[],
  context: { readonly window?: number; readonly threshold?: number; readonly compacted: boolean; readonly summarizedMessages: number;
    readonly action?: AgentContextEstimate['action']; readonly trimmedMessages?: number; readonly truncatedToolResults?: number },
): AgentContextEstimate {
  const systemText = contentText(system?.content);
  const systemTokens = estimateTextTokens(systemText);
  let historyTokens = 0;
  let toolTokens = 0;
  let summaryTokens = 0;
  let characterCount = Array.from(systemText).length;
  for (const message of messages) {
    const text = contentText(message.content);
    const reasoningValue = message.additional_kwargs?.reasoning_content ?? message.additional_kwargs?.reasoning;
    const reasoning = typeof reasoningValue === 'string' ? reasoningValue : '';
    const tokens = estimateMessageTokens(message);
    characterCount += Array.from(text).length + Array.from(reasoning).length;
    if ('tool_calls' in message && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        const args = JSON.stringify(call.args ?? {});
        characterCount += Array.from(args).length;
      }
    }
    if (message.additional_kwargs?.lc_source === 'summarization') summaryTokens += estimateTextTokens(text);
    else if (message.getType() === 'tool') toolTokens += tokens;
    else historyTokens += tokens;
  }
  return {
    estimatedTokens: systemTokens + historyTokens + toolTokens + summaryTokens, characterCount,
    systemTokens, historyTokens, toolTokens, summaryTokens,
    ...(context.window && context.window > 0 ? {
      contextWindowTokens: context.window,
      ...(context.threshold !== undefined ? { thresholdTokens: context.threshold } : {}),
    } : {}),
    action: context.action ?? (context.compacted ? 'compacted' : 'none'), summarizedMessages: context.summarizedMessages,
    ...(context.trimmedMessages !== undefined ? { trimmedMessages: context.trimmedMessages } : {}),
    ...(context.truncatedToolResults !== undefined ? { truncatedToolResults: context.truncatedToolResults } : {}),
  };
}

/** Project fixed selection and structured quotes from the actual dispatched request. */
export function requestMaterials(
  messages: readonly BaseMessage[], bookToolNames: ReadonlySet<string>, selectionQuote?: string,
  renderedBookMaterials?: (content: string) => readonly RenderedEvidenceMaterial[] | undefined,
  system?: BaseMessage,
): AgentSentMaterial[] {
  const materials: AgentSentMaterial[] = [];
  if (selectionQuote && [...messages, ...(system ? [system] : [])].some(message =>
      contentText(message.content).includes(selectionQuote))) {
    materials.push({ id: 'selection', kind: 'selection', name: '选中原文', content: selectionQuote });
  }
  for (const message of messages) {
    if (message.getType() !== 'tool' || !('tool_call_id' in message)) continue;
    const content = contentText(message.content);
    if (!content) continue;
    const name = message.name ?? 'tool';
    if (bookToolNames.has(name)) {
      for (const material of renderedBookMaterials?.(content) ?? [])
        materials.push({ ...material, kind: 'book-tool' });
    } else {
      materials.push({ id: String(message.tool_call_id), kind: 'external-tool', name, content });
    }
  }
  return materials;
}
