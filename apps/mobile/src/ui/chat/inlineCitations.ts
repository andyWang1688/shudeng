import { MarkedLexer, type Token } from 'react-native-marked';
import type { ChatTurn } from './types';

type InlineCitation = { kind: 'book' | 'web'; index: number; label: string };

function visitProse(tokens: readonly Token[], visit: (token: Token) => void): void {
  for (const token of tokens) {
    visit(token);
    if (token.type === 'link' || token.type === 'image') continue;
    if ('tokens' in token && Array.isArray(token.tokens)) visitProse(token.tokens, visit);
    if (token.type === 'list') for (const item of token.items) visitProse(item.tokens, visit);
    if (token.type === 'table') for (const cell of [...token.header, ...token.rows.flat()]) visitProse(cell.tokens, visit);
  }
}

export function citationPresentation(turn: ChatTurn, text = turn.text) {
  const links = new Map<string, InlineCitation>();
  const placements: { offset: number; href: string }[] = [];
  const originalLinks = new Set<string>();
  const textRuns: string[] = [];
  if (turn.citations.some(citation => citation.answerAnchor) || turn.webSources?.some(source => source.answerAnchor)) {
    visitProse(MarkedLexer(text, { gfm: true }), token => {
      if (token.type === 'link' && typeof token.href === 'string') originalLinks.add(token.href);
      if (token.type === 'text' && !token.tokens?.length) textRuns.push(token.raw);
    });
  }
  const place = (anchor: string | undefined, citation: InlineCitation) => {
    if (!anchor || /[\r\n]/.test(anchor)) return;
    const start = text.indexOf(anchor);
    if (start < 0 || text.indexOf(anchor, start + 1) >= 0 || !textRuns.some(run => run.includes(anchor))) return;
    let href = 'shudengcitation:' + links.size;
    while (text.includes(href) || originalLinks.has(href)) href += 'x';
    links.set(href, citation);
    placements.push({ offset: start + anchor.length, href });
  };
  turn.citations.forEach((citation, index) => place(citation.answerAnchor, { kind: 'book', index,
    label: citation.chapter ?? (citation.page !== undefined ? '第 ' + citation.page + ' 页' : '原文 ' + (index + 1)),
  }));
  turn.webSources?.forEach((source, index) => {
    let label = '网页';
    try { label = new URL(source.url).hostname.replace(/^www./, ''); } catch { return; }
    place(source.answerAnchor, { kind: 'web', index, label });
  });

  const insert = (valid: ReadonlyMap<string, InlineCitation>) => {
    let markdown = text;
    for (const { offset, href } of placements) {
      if (valid.has(href)) markdown = markdown.slice(0, offset) + '[来源](' + href + ')' + markdown.slice(offset);
    }
    return markdown;
  };
  placements.sort((left, right) => right.offset - left.offset);
  let markdown = text;
  if (links.size) {
    const rendered = new Set<string>();
    visitProse(MarkedLexer(insert(links), { gfm: true }), token => {
      if (token.type === 'link' && typeof token.href === 'string') rendered.add(token.href);
    });
    // An anchor inside a code example or a Markdown destination cannot become a visible link.
    for (const href of links.keys()) if (!rendered.has(href)) links.delete(href);
    markdown = insert(links);
  }
  return { markdown, links, placedBooks: new Set([...links.values()].filter(link => link.kind === 'book').map(link => link.index)),
    placedWeb: new Set([...links.values()].filter(link => link.kind === 'web').map(link => link.index)) };
}
