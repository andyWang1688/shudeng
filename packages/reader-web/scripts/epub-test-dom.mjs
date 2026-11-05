import { createRequire } from 'node:module';
const requireCore = createRequire(new URL('../../core/package.json', import.meta.url));
const { DOMParser } = requireCore('@xmldom/xmldom');

// Only supplies browser DOM operations used by the pure offset mapper. Real
// layout, CFI and WebKit behavior remain covered by the existing WK regressions.
export function mappingDocument(content) {
  const doc = new DOMParser().parseFromString('<html xmlns="http://www.w3.org/1999/xhtml"><body>' + content + '</body></html>', 'application/xhtml+xml');
  return mappingDocumentAdapter(doc);
}
export function mappingDocumentAdapter(doc) {
  doc.body = doc.getElementsByTagName('body')[0];
  const visit = node => {
    if (node.nodeType === 1) {
      node.closest = selector => {
        const names = selector.split(',');
        for (let parent = node; parent?.nodeType === 1; parent = parent.parentNode) if (names.includes(parent.localName)) return parent;
        return null;
      };
    }
    if (node.parentNode?.nodeType === 1) Object.defineProperty(node, 'parentElement', { value: node.parentNode, configurable: true });
    for (const child of Array.from(node.childNodes ?? [])) visit(child);
  };
  visit(doc.documentElement);
  doc.querySelector = selector => selector === 'body' ? doc.body : selector.startsWith('#') ? doc.getElementById(selector.slice(1)) : null;
  doc.createTreeWalker = root => {
    const nodes = [];
    const walk = node => { for (const child of Array.from(node.childNodes ?? [])) { if (child.nodeType === 3) nodes.push(child); else walk(child); } };
    walk(root);
    let index = 0;
    return { nextNode: () => nodes[index++] ?? null };
  };
  doc.createRange = () => ({
    setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
    setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
  });
  return doc;
}
