export function splitCitationTail(text: string): { answer: string; references: string } | null {
  const marker = /"\s*,\s*"citations"\s*:\s*(?=\[)/g;
  for (const match of text.matchAll(marker)) {
    const answer = text.slice(0, match.index).trimEnd();
    if (!answer || /^[{`"\[]/.test(answer) || (answer.match(/```/g)?.length ?? 0) % 2) continue;
    const suffix = text.slice(match.index + match[0].length);
    if (/^\[\s*(?:\{\s*"id"\s*:\s*"E\d+"|\]\s*\})/.test(suffix)) {
      return { answer, references: suffix };
    }
  }
  return null;
}
