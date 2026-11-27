/** Locate a top-level answer string even when the remainder of the object is still arriving. */
export function answerStringStart(text: string): number | undefined {
  const start = text.indexOf('{');
  if (start < 0) return;
  let depth = 1;
  let quoted = false;
  let previous = '{';
  for (let index = start + 1; index < text.length && depth > 0; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '\\') index++;
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      if (depth === 1 && (previous === '{' || previous === ',') && text.startsWith('"answer"', index)) {
        const field = /^"answer"\s*:\s*"/.exec(text.slice(index));
        if (field) return index + field[0].length;
      }
      quoted = true;
      previous = char;
    } else if (!/\s/.test(char)) {
      if (char === '{' || char === '[') depth++;
      if (char === '}' || char === ']') depth--;
      previous = char;
    }
  }
}

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
