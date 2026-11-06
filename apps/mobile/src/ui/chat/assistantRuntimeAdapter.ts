import type { AppendMessage, MessageStatus, ThreadMessageLike } from '@assistant-ui/react-native';
import type { ChatTurn } from './types';

/** Keep persisted book turns authoritative; assistant-ui owns only the presentation runtime. */
export function assistantMessageStatus(turn: ChatTurn): MessageStatus {
  switch (turn.status) {
    case 'streaming': return { type: 'running' };
    case 'done': return { type: 'complete', reason: 'stop' };
    case 'cancelled': return { type: 'incomplete', reason: 'cancelled' };
    case 'interrupted': return { type: 'incomplete', reason: 'other', error: turn.error ?? '上次回答已中断' };
    case 'error': return { type: 'incomplete', reason: 'error', error: turn.error ?? '回答未完成' };
  }
}

export function bookTurnToAssistantMessage(turn: ChatTurn): ThreadMessageLike {
  if (turn.role === 'user') return {
    id: turn.id, role: 'user', content: [{ type: 'text', text: turn.text }],
  };
  return {
    id: turn.id, role: 'assistant', status: assistantMessageStatus(turn),
    content: [
      ...(turn.reasoning ? [{ type: 'reasoning' as const, text: turn.reasoning }] : []),
      ...turn.tools.map(tool => ({
        type: 'tool-call' as const, toolCallId: tool.callId, toolName: tool.name, args: {},
        ...((tool.finished ?? tool.status !== 'running') ? { result: tool.preview ?? tool.detail ?? (tool.status === 'error' ? '未完成' : '已完成') } : {}),
        ...(tool.status === 'error' ? { isError: true } : {}),
      })),
      { type: 'text', text: turn.text },
      ...(turn.webSources ?? []).map(source => ({
        type: 'source' as const, sourceType: 'url' as const, id: source.id, url: source.url, title: source.title,
      })),
    ],
  };
}

export function submittedQuestion(message: AppendMessage): string {
  return message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n').trim();
}
