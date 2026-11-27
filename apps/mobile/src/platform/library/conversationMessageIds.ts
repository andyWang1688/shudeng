/** Swift imported both IDs from the turn ID; RN derives the question ID from the answer ID. */
export function questionIdForAnswer(answerId: string): string {
  return answerId.startsWith('legacy-q:') && answerId.endsWith(':assistant')
    ? answerId.slice(0, -'assistant'.length) + 'user'
    : answerId + ':user';
}
