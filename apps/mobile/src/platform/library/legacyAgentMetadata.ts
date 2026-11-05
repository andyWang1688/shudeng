import { legacyNativeMetadataCandidates } from '@shudeng/core';
import type { NewMessageRow, SQLiteDriver } from '@shudeng/core/db';

export const LEGACY_AGENT_METADATA_KEY = 'legacy-native-agent-metadata:v1';

/**
 * Additive, independently versioned upgrade for installations whose .imported /
 * removals markers already exist. No source-file writes or conversation replay.
 * Missing installed assistant messages stay missing: deletion and a never-imported
 * empty answer cannot be distinguished safely. Newly imported rows are supplied
 * only to recognize their deterministic fallback timestamp.
 * callerOwnsTransaction is used only by the initial library import so messages,
 * details and recovery markers either all commit or all roll back.
 */
export async function backfillLegacyAgentMetadata(
  driver: SQLiteDriver, questions: unknown, newlyImportedMessages: readonly NewMessageRow[] = [], callerOwnsTransaction = false,
): Promise<number> {
  if (questions === undefined) return 0; // Source may become available on a later launch.
  if (!Array.isArray(questions)) throw new Error('旧问答元数据不是数组，已保留源文件，请重新导出后重试');
  const candidates = legacyNativeMetadataCandidates(questions);
  const imported = new Map(newlyImportedMessages.map(row => [row.id, row]));
  const backfill = async (tx: SQLiteDriver): Promise<number> => {
    if ((await tx.all('SELECT key FROM app_preferences WHERE key = ?', [LEGACY_AGENT_METADATA_KEY])).length) return 0;
    let inserted = 0;
    const skipped = { missingSourceTimestamp: 0, missingAssistant: 0, identityMismatchOrExistingDetails: 0 };
    for (const candidate of candidates) {
      const fresh = imported.get(candidate.assistantId);
      const createdAt = candidate.createdAt ?? (fresh?.role === 'assistant' && fresh.conversationId === candidate.conversationId && fresh.content === candidate.answer ? fresh.createdAt : undefined);
      if (createdAt === undefined) { skipped.missingSourceTimestamp += 1; continue; }
      const reasoning = candidate.details.reasoning ?? '';
      const result = await tx.run(
        `INSERT INTO conversation_turn_details (message_id, details_json)
         SELECT m.id, ? FROM messages m JOIN books b ON b.id = ?
         LEFT JOIN conversations c ON c.id = m.conversation_id
         WHERE m.id = ? AND m.role = 'assistant' AND m.conversation_id = ? AND m.content = ? AND m.created_at = ?
           AND m.tool_calls_json IS NULL AND m.tool_call_id IS NULL AND m.is_error = 0
           AND (m.reasoning_content IS NULL OR m.reasoning_content = '' OR m.reasoning_content = ?)
           AND (c.id IS NULL OR c.book_id = ?)
           AND NOT EXISTS (SELECT 1 FROM app_preferences WHERE key = ?)
           AND NOT EXISTS (SELECT 1 FROM book_file_operations WHERE id = b.id AND kind <> 'remove')
           AND NOT EXISTS (SELECT 1 FROM messages WHERE id = ?)
           AND EXISTS (SELECT 1 FROM messages u WHERE u.id = ? AND u.role = 'user' AND u.conversation_id = m.conversation_id
                       AND u.content = ? AND u.created_at = ? AND u.tool_calls_json IS NULL AND u.tool_call_id IS NULL AND u.is_error = 0)
         ON CONFLICT(message_id) DO NOTHING`,
        [JSON.stringify(candidate.details), candidate.bookId, candidate.assistantId, candidate.conversationId, candidate.answer, createdAt,
          reasoning, candidate.bookId, 'legacy-book-data-deleted:' + candidate.bookId, candidate.assistantId + ':user', candidate.userId, candidate.question, createdAt],
      );
      inserted += result.changes;
      if (!result.changes) {
        const exists = await tx.all('SELECT id FROM messages WHERE id = ?', [candidate.assistantId]);
        if (exists.length) skipped.identityMismatchOrExistingDetails += 1;
        else skipped.missingAssistant += 1;
      }
      // Details and reasoning commit together. An existing RN details row, even an
      // empty/malformed one, fully owns the message and is never merged/overwritten.
      if (result.changes && reasoning.length) {
        await tx.run(
          `UPDATE messages SET reasoning_content = ? WHERE id = ? AND role = 'assistant' AND conversation_id = ? AND content = ? AND created_at = ?
           AND (reasoning_content IS NULL OR reasoning_content = '')`,
          [reasoning, candidate.assistantId, candidate.conversationId, candidate.answer, createdAt],
        );
      }
    }
    // This marker belongs to the same transaction; a failure is safely retryable.
    await tx.run('INSERT INTO app_preferences (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', [LEGACY_AGENT_METADATA_KEY, JSON.stringify({ version: 1, inserted, skipped })]);
    return inserted;
  };
  return callerOwnsTransaction ? backfill(driver) : driver.transaction(backfill);
}
