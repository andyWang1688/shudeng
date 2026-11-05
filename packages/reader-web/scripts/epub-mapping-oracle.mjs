// Frozen pre-optimization mapping. Keep this deliberately independent of sparse spans.
export function legacyIndexedDocumentText(doc) {
  const BLOCK = new Set(['p', 'div', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'blockquote', 'br', 'hr']);
  const OMIT = new Set(['script', 'style', 'head', 'noscript', 'nav']);
  const pieces = [], original = [];
  const append = (text, node) => { pieces.push(text); for (let offset = 0; offset < text.length; offset++) original.push(node ? { node, offset } : null); };
  const walk = node => {
    if (node.nodeType === 3 || node.nodeType === 4) { append(node.nodeValue ?? '', node); return; }
    if (node.nodeType !== 1) return;
    const name = node.localName.toLowerCase();
    if (OMIT.has(name) || node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return;
    if (BLOCK.has(name)) append('\n');
    for (const child of Array.from(node.childNodes)) walk(child);
    if (BLOCK.has(name)) append('\n');
  };
  walk(doc.body ?? doc.documentElement);
  let text = pieces.join(''), points = original;
  const replace = (pattern, replacement) => {
    const strings = [], mapped = [];
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
      const at = match.index ?? 0;
      strings.push(text.slice(cursor, at), replacement); for (const point of points.slice(cursor, at)) mapped.push(point);
      const newline = match[0].indexOf('\n');
      for (let index = 0; index < replacement.length; index++) mapped.push(points[at + (replacement[index] === '\n' && newline >= 0 ? newline + index : index)] ?? null);
      cursor = at + match[0].length;
    }
    strings.push(text.slice(cursor)); for (const point of points.slice(cursor)) mapped.push(point);
    text = strings.join(''); points = mapped;
  };
  replace(/[\t\r\f ]+/g, ' '); replace(/ *\n */g, '\n'); replace(/\n{3,}/g, '\n\n'); replace(/^\s+|\s+$/g, '');
  return { text, points };
}

export function legacyQuoteText(doc, root) {
  const walker = doc.createTreeWalker(root, 4), points = [];
  let text = '', item;
  while ((item = walker.nextNode())) {
    if (item.parentElement?.closest('script,style,noscript')) continue;
    for (let offset = 0; offset < item.data.length; offset++) {
      const character = item.data[offset] ?? '';
      if (/\s/.test(character)) continue;
      text += character; points.push({ node: item, offset });
    }
  }
  return { text, points };
}
